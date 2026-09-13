/**
 * 用户设定本 + 私聊记录云同步（openid 由云函数上下文注入）
 * 集合（需在控制台新建，权限：仅云函数可读写）：
 * - user_notebook
 * - user_chat_meta
 * - user_chat_msgs
 */
const cloud = require('wx-server-sdk');

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV || CLOUD_ENV_ID,
  timeout: 60000
});

const db = cloud.database();
const MAX_MSGS = 160;
const MAX_CONTENT = 1800;
const MAX_NOTEBOOK_BYTES = 900 * 1024;
const DELETE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function openidOf() {
  try {
    const wxContext = cloud.getWXContext();
    return String((wxContext && wxContext.OPENID) || '').trim();
  } catch (_) {
    return '';
  }
}

function slimMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content != null ? m.content : '').slice(0, MAX_CONTENT),
    createdAt: Number(m.createdAt) || Number(m.fakeAt) || 0
  };
  if (m.name) out.name = String(m.name).slice(0, 40);
  if (m.kind) out.kind = String(m.kind).slice(0, 40);
  if (m.recalled) out.recalled = true;
  if (m.ocId) out.ocId = String(m.ocId).slice(0, 80);
  if (m.game && typeof m.game === 'object') {
    try {
      out.game = JSON.parse(JSON.stringify(m.game));
    } catch (_) {}
  }
  return out;
}

function slimFavorites(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const copy = Object.assign({}, item);
    if (copy.generatedBio) copy.generatedBio = String(copy.generatedBio).slice(0, 8000);
    if (Array.isArray(copy.ocStories)) {
      copy.ocStories = copy.ocStories.slice(0, 20).map((s) => {
        if (!s || typeof s !== 'object') return s;
        return Object.assign({}, s, {
          content: String(s.content || s.body || '').slice(0, 6000)
        });
      });
    }
    return copy;
  }).filter(Boolean);
}

function pruneDeletedArchive(list) {
  const now = Date.now();
  const seen = {};
  const out = [];
  (list || []).forEach((e) => {
    if (!e || !e.id || !e.item) return;
    const id = String(e.id);
    if (seen[id]) return;
    const deletedAt = Number(e.deletedAt) || 0;
    if (deletedAt && now - deletedAt >= DELETE_TTL_MS) return;
    seen[id] = true;
    const slim = slimFavorites([e.item])[0];
    if (!slim) return;
    out.push({
      id: id,
      deletedAt: deletedAt || now,
      item: slim
    });
  });
  return out.slice(-80);
}

function mergeDeletedArchive(existingList, incomingList, removedFavorites) {
  const map = {};
  pruneDeletedArchive(existingList).forEach((e) => {
    map[e.id] = e;
  });
  pruneDeletedArchive(incomingList).forEach((e) => {
    const prev = map[e.id];
    if (!prev || Number(e.deletedAt) >= Number(prev.deletedAt || 0)) {
      map[e.id] = e;
    }
  });
  const now = Date.now();
  (removedFavorites || []).forEach((item) => {
    if (!item || !item.id) return;
    const id = String(item.id);
    if (map[id]) return;
    const slim = slimFavorites([item])[0];
    if (!slim) return;
    map[id] = { id: id, deletedAt: now, item: slim };
  });
  return pruneDeletedArchive(Object.keys(map).map((k) => map[k]));
}

function byteLen(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  } catch (_) {
    return 0;
  }
}

async function upsertDoc(colName, docId, data) {
  const col = db.collection(colName);
  try {
    await col.doc(docId).set({ data: data });
    return { ok: true, method: 'set' };
  } catch (e) {
    try {
      await col.add({ data: Object.assign({ _id: docId }, data) });
      return { ok: true, method: 'add' };
    } catch (e2) {
      return { ok: false, err: String((e2 && e2.message) || e2 || e) };
    }
  }
}

async function getDoc(colName, docId) {
  try {
    const res = await db.collection(colName).doc(docId).get();
    if (res && res.data && Object.keys(res.data).length) {
      return Object.assign({ _id: docId }, res.data);
    }
  } catch (_) {}
  return null;
}

async function pushNotebook(openid, event) {
  const favorites = slimFavorites(event && event.favorites);
  const families = Array.isArray(event && event.families) ? event.families.slice(0, 40) : [];
  const deletedIncoming = Array.isArray(event && event.deletedOcIds)
    ? event.deletedOcIds.map(String)
    : [];
  const archiveIncoming = Array.isArray(event && event.deletedArchive)
    ? event.deletedArchive
    : [];
  const updatedAt = Math.max(0, Number(event && event.updatedAt) || Date.now());
  const existing = await getDoc('user_notebook', openid);
  const cloudAt = existing ? Number(existing.updatedAt) || 0 : 0;
  const cloudFavCount =
    existing && Array.isArray(existing.favorites) ? existing.favorites.length : 0;

  // 禁止空本地把非空云端盖掉（清缓存/新设备打开备份页时常见）
  if ((!favorites || !favorites.length) && cloudFavCount > 0) {
    const archiveIncoming = Array.isArray(event && event.deletedArchive)
      ? event.deletedArchive
      : [];
    const deletedIncoming = Array.isArray(event && event.deletedOcIds)
      ? event.deletedOcIds.map(String)
      : [];
    const deletedSet = new Set(
      (Array.isArray(existing.deletedOcIds) ? existing.deletedOcIds : []).map(String)
    );
    deletedIncoming.forEach((id) => {
      if (id) deletedSet.add(id);
    });
    const cloudFavs = existing.favorites || [];
    const removedFromCloud = cloudFavs.filter(
      (f) => f && f.id && deletedSet.has(String(f.id))
    );
    let deletedArchive = mergeDeletedArchive(
      existing.deletedArchive,
      archiveIncoming,
      removedFromCloud
    );
    deletedArchive = pruneDeletedArchive(deletedArchive);
    const keepFavs = cloudFavs.filter(
      (f) => f && f.id && !deletedSet.has(String(f.id))
    );
    await upsertDoc('user_notebook', openid, {
      openid: openid,
      favorites: keepFavs,
      families: existing.families || families,
      deletedOcIds: deletedArchive.map((e) => e.id).slice(-300),
      deletedArchive: deletedArchive,
      updatedAt: Math.max(cloudAt, updatedAt),
      syncedAt: Date.now()
    });
    return {
      ok: true,
      skipped: true,
      updatedAt: Math.max(cloudAt, updatedAt),
      errMsg: 'refuse_empty_overwrite',
      favorites: keepFavs.length,
      deletedMerged: deletedArchive.length
    };
  }

  if (existing && cloudAt > updatedAt) {
    // 本地时间戳落后时仍合并删除归档，避免已删除 OC 永远上不了云
    const deletedSet = new Set(
      (Array.isArray(existing.deletedOcIds) ? existing.deletedOcIds : []).map(String)
    );
    deletedIncoming.forEach((id) => {
      if (id) deletedSet.add(id);
    });
    const cloudFavs = Array.isArray(existing.favorites) ? existing.favorites : [];
    const removedFromCloud = cloudFavs.filter(
      (f) => f && f.id && deletedSet.has(String(f.id))
    );
    let deletedArchive = mergeDeletedArchive(
      existing.deletedArchive,
      archiveIncoming,
      removedFromCloud
    );
    deletedArchive = pruneDeletedArchive(deletedArchive);
    const keepFavs = cloudFavs.filter(
      (f) => f && f.id && !deletedSet.has(String(f.id))
    );
    await upsertDoc('user_notebook', openid, {
      openid: openid,
      favorites: keepFavs,
      families: existing.families || [],
      deletedOcIds: deletedArchive.map((e) => e.id).slice(-300),
      deletedArchive: deletedArchive,
      updatedAt: cloudAt,
      syncedAt: Date.now()
    });
    return {
      ok: true,
      skipped: true,
      updatedAt: cloudAt,
      errMsg: 'stale_push',
      deletedMerged: deletedArchive.length
    };
  }
  const deletedSet = new Set(
    (existing && Array.isArray(existing.deletedOcIds) ? existing.deletedOcIds : []).map(String)
  );
  deletedIncoming.forEach((id) => {
    if (id) deletedSet.add(id);
  });
  // 恢复后的 id 若已出现在本次 favorites 中，则移出删除集合
  favorites.forEach((f) => {
    if (f && f.id) deletedSet.delete(String(f.id));
  });
  const filtered = favorites.filter((f) => f && f.id && !deletedSet.has(String(f.id)));
  const removedFromCloud = (existing && Array.isArray(existing.favorites) ? existing.favorites : []).filter(
    (f) => f && f.id && deletedSet.has(String(f.id))
  );
  let deletedArchive = mergeDeletedArchive(
    existing && existing.deletedArchive,
    archiveIncoming,
    removedFromCloud
  );
  // 已恢复进 favorites 的不再留在删除归档
  deletedArchive = deletedArchive.filter(
    (e) => e && e.id && !filtered.some((f) => String(f.id) === e.id)
  );
  deletedArchive = pruneDeletedArchive(deletedArchive);

  const payload = {
    openid: openid,
    favorites: filtered,
    families: families,
    deletedOcIds: deletedArchive.map((e) => e.id).slice(-300),
    deletedArchive: deletedArchive,
    updatedAt: updatedAt,
    syncedAt: Date.now()
  };
  if (byteLen(payload) > MAX_NOTEBOOK_BYTES) {
    // 归档过大时只保留最近 20 条
    payload.deletedArchive = deletedArchive.slice(-20);
    payload.deletedOcIds = payload.deletedArchive.map((e) => e.id);
    if (byteLen(payload) > MAX_NOTEBOOK_BYTES) {
      return { ok: false, errMsg: '设定本过大，请先删减 OC/故事后再同步' };
    }
  }
  const r = await upsertDoc('user_notebook', openid, payload);
  if (!r.ok) return { ok: false, errMsg: r.err || '写入失败' };
  return { ok: true, updatedAt: updatedAt, bytes: byteLen(payload) };
}

async function listBackup(openid) {
  const notebook = await getDoc('user_notebook', openid);
  if (!notebook) {
    return { ok: true, favorites: [], deletedArchive: [], updatedAt: 0 };
  }
  let deletedArchive = pruneDeletedArchive(notebook.deletedArchive || []);
  const deletedSet = new Set(deletedArchive.map((e) => e.id));
  (Array.isArray(notebook.deletedOcIds) ? notebook.deletedOcIds : []).forEach((id) => {
    if (id) deletedSet.add(String(id));
  });
  const favorites = (notebook.favorites || []).filter(
    (f) => f && f.id && !deletedSet.has(String(f.id))
  );
  // 过期归档写回，真正从云端删掉
  const prevLen = Array.isArray(notebook.deletedArchive) ? notebook.deletedArchive.length : 0;
  if (deletedArchive.length !== prevLen || deletedArchive.length !== (notebook.deletedOcIds || []).length) {
    await upsertDoc('user_notebook', openid, {
      openid: openid,
      favorites: favorites,
      families: notebook.families || [],
      deletedOcIds: deletedArchive.map((e) => e.id),
      deletedArchive: deletedArchive,
      updatedAt: Number(notebook.updatedAt) || Date.now(),
      syncedAt: Date.now()
    });
  }
  return {
    ok: true,
    favorites: favorites,
    deletedArchive: deletedArchive,
    updatedAt: Number(notebook.updatedAt) || 0
  };
}

async function pushChatMeta(openid, event) {
  const ocSessions =
    event && event.ocSessions && typeof event.ocSessions === 'object' ? event.ocSessions : {};
  const hiddenOcIds = Array.isArray(event && event.hiddenOcIds)
    ? event.hiddenOcIds.slice(0, 200)
    : [];
  const updatedAt = Math.max(0, Number(event && event.updatedAt) || Date.now());
  const payload = {
    openid: openid,
    ocSessions: ocSessions,
    hiddenOcIds: hiddenOcIds,
    updatedAt: updatedAt,
    syncedAt: Date.now()
  };
  const r = await upsertDoc('user_chat_meta', openid, payload);
  if (!r.ok) return { ok: false, errMsg: r.err || '写入失败' };
  return { ok: true, updatedAt: updatedAt };
}

function sessionDocId(openid, ocId, sessionId) {
  const a = String(openid || '').slice(0, 40);
  const b = String(ocId || '').replace(/[^\w\-]/g, '').slice(0, 40);
  const c = String(sessionId || 'default').replace(/[^\w\-]/g, '').slice(0, 40);
  return a + '_dm_' + b + '_' + c;
}

async function pushChatSession(openid, event) {
  const ocId = String((event && event.ocId) || '').trim();
  const sessionId = String((event && event.sessionId) || 'default').trim() || 'default';
  if (!ocId) return { ok: false, errMsg: '缺少 ocId' };
  let messages = Array.isArray(event && event.messages) ? event.messages : [];
  if (messages.length > MAX_MSGS) messages = messages.slice(-MAX_MSGS);
  messages = messages.map(slimMessage).filter(Boolean);
  const memory = String((event && event.memory) || '').slice(0, 900);
  const updatedAt = Math.max(0, Number(event && event.updatedAt) || Date.now());
  const docId = sessionDocId(openid, ocId, sessionId);
  const payload = {
    openid: openid,
    kind: 'dm',
    ocId: ocId,
    sessionId: sessionId,
    messages: messages,
    memory: memory,
    updatedAt: updatedAt,
    syncedAt: Date.now()
  };
  if (byteLen(payload) > 900 * 1024) {
    messages = messages.slice(-80);
    payload.messages = messages;
  }
  const r = await upsertDoc('user_chat_msgs', docId, payload);
  if (!r.ok) return { ok: false, errMsg: r.err || '写入失败' };
  return { ok: true, docId: docId, updatedAt: updatedAt, count: messages.length };
}

async function pullAll(openid) {
  const notebook = await getDoc('user_notebook', openid);
  const chatMeta = await getDoc('user_chat_meta', openid);
  let deletedArchive = notebook ? pruneDeletedArchive(notebook.deletedArchive || []) : [];
  const deletedIds = deletedArchive.map((e) => e.id);
  return {
    ok: true,
    notebook: notebook
      ? {
          favorites: (notebook.favorites || []).filter(
            (f) => f && f.id && deletedIds.indexOf(String(f.id)) < 0
          ),
          families: notebook.families || [],
          deletedOcIds: deletedIds.length
            ? deletedIds
            : notebook.deletedOcIds || [],
          deletedArchive: deletedArchive,
          updatedAt: Number(notebook.updatedAt) || 0
        }
      : null,
    chatMeta: chatMeta
      ? {
          ocSessions: chatMeta.ocSessions || {},
          hiddenOcIds: chatMeta.hiddenOcIds || [],
          updatedAt: Number(chatMeta.updatedAt) || 0
        }
      : null
  };
}

async function pullChatSession(openid, event) {
  const ocId = String((event && event.ocId) || '').trim();
  const sessionId = String((event && event.sessionId) || 'default').trim() || 'default';
  if (!ocId) return { ok: false, errMsg: '缺少 ocId' };
  const docId = sessionDocId(openid, ocId, sessionId);
  const doc = await getDoc('user_chat_msgs', docId);
  if (!doc) return { ok: true, session: null };
  return {
    ok: true,
    session: {
      ocId: doc.ocId,
      sessionId: doc.sessionId,
      messages: Array.isArray(doc.messages) ? doc.messages : [],
      memory: doc.memory || '',
      updatedAt: Number(doc.updatedAt) || 0
    }
  };
}

exports.main = async (event) => {
  const openid = openidOf();
  if (!openid) return { ok: false, errMsg: '无法识别用户' };
  const action = event && event.action != null ? String(event.action).trim() : '';
  try {
    if (action === 'pull') return await pullAll(openid);
    if (action === 'listBackup') return await listBackup(openid);
    if (action === 'pullChatSession') return await pullChatSession(openid, event);
    if (action === 'pushNotebook') return await pushNotebook(openid, event);
    if (action === 'pushChatMeta') return await pushChatMeta(openid, event);
    if (action === 'pushChatSession') return await pushChatSession(openid, event);
    return { ok: false, errMsg: '未知 action' };
  } catch (e) {
    return { ok: false, errMsg: String((e && e.message) || e) };
  }
};
