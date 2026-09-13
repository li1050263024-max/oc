const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COL = 'oc_douyin_bgm_lib';
const MAX_LIST = 80;

function collectionMissing(err) {
  const msg = String((err && (err.message || err.errMsg)) || err || '');
  return /collection not exist|Db or Table not exist|RESOURCE_NOT_FOUND|not exists/i.test(msg);
}

async function listTracks() {
  try {
    const res = await db
      .collection(COL)
      .orderBy('createdAt', 'desc')
      .limit(MAX_LIST)
      .get();
    const rows = (res && res.data) || [];
    const fileList = rows.map((t) => t && t.fileID).filter(Boolean);
    const urlMap = {};
    if (fileList.length) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: fileList });
        ((tr && tr.fileList) || []).forEach((row) => {
          if (row && row.fileID) urlMap[row.fileID] = row.tempFileURL || '';
        });
      } catch (_) {}
    }
    const tracks = rows
      .filter((t) => t && t.fileID)
      .map((t) => ({
        id: String(t._id || ''),
        name: String(t.name || 'BGM').slice(0, 80),
        fileID: String(t.fileID || ''),
        url: urlMap[t.fileID] || '',
        size: Number(t.size) || 0,
        createdAt: Number(t.createdAt) || 0
      }));
    return { ok: true, tracks: tracks };
  } catch (e) {
    if (collectionMissing(e)) {
      return {
        ok: false,
        tracks: [],
        errMsg: '请先在云开发控制台创建集合 oc_douyin_bgm_lib'
      };
    }
    return {
      ok: false,
      tracks: [],
      errMsg: String((e && e.message) || e || '读取曲库失败')
    };
  }
}

async function registerTrack(event) {
  const fileID = String((event && event.fileID) || '').trim();
  const name = String((event && event.name) || 'BGM')
    .replace(/\.[^.]+$/, '')
    .slice(0, 80) || 'BGM';
  const size = Number((event && event.size) || 0) || 0;
  if (!fileID || !/^cloud:\/\//i.test(fileID)) {
    return { ok: false, errMsg: '缺少有效的 cloud fileID' };
  }
  try {
    const exist = await db.collection(COL).where({ fileID: fileID }).limit(1).get();
    if (exist && exist.data && exist.data.length) {
      const row = exist.data[0];
      return { ok: true, id: row._id, existed: true, name: row.name || name, fileID: fileID };
    }
    const wxContext = cloud.getWXContext();
    const add = await db.collection(COL).add({
      data: {
        fileID: fileID,
        name: name,
        size: size,
        createdAt: Date.now(),
        openid: (wxContext && wxContext.OPENID) || ''
      }
    });
    return { ok: true, id: add._id, existed: false, name: name, fileID: fileID };
  } catch (e) {
    if (collectionMissing(e)) {
      return {
        ok: false,
        errMsg: '请先在云开发控制台创建集合 oc_douyin_bgm_lib（权限建议：仅管理端可写）'
      };
    }
    return { ok: false, errMsg: String((e && e.message) || e || '登记失败') };
  }
}

async function removeTrack(event) {
  const id = String((event && event.id) || '').trim();
  const fileID = String((event && event.fileID) || '').trim();
  if (!id && !fileID) return { ok: false, errMsg: '缺少 id' };
  try {
    if (id) {
      await db.collection(COL).doc(id).remove();
    } else {
      const hit = await db.collection(COL).where({ fileID: fileID }).limit(1).get();
      const row = hit && hit.data && hit.data[0];
      if (row && row._id) await db.collection(COL).doc(row._id).remove();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, errMsg: String((e && e.message) || e || '删除失败') };
  }
}

/** 管理端批量登记：{ tracks: [{ fileID, name, size }] } */
async function registerBatch(event) {
  const tracks = Array.isArray(event && event.tracks) ? event.tracks : [];
  if (!tracks.length) return { ok: false, errMsg: 'tracks 为空' };
  let added = 0;
  let skipped = 0;
  const errors = [];
  for (let i = 0; i < tracks.length && i < 50; i++) {
    const t = tracks[i] || {};
    try {
      const r = await registerTrack(t);
      if (!r.ok) {
        errors.push(r.errMsg || 'fail');
        continue;
      }
      if (r.existed) skipped += 1;
      else added += 1;
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }
  return { ok: true, added: added, skipped: skipped, errors: errors.slice(0, 5) };
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'list').toLowerCase();
  if (action === 'list') return listTracks();
  if (action === 'register') return registerTrack(event || {});
  if (action === 'registerBatch') return registerBatch(event || {});
  if (action === 'remove') return removeTrack(event || {});
  return { ok: false, errMsg: '未知操作' };
};
