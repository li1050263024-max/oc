const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_OC_WORK = 'oc_work_in_progress';
const { workFromFavoriteItem } = require('./favorite.js');
const { safeGetFavorites, safeSetFavorites } = require('./favoriteStore.js');
const { personalityBlend, quirkBlend } = require('./ocResult.js');
const { isLayer3Ready } = require('./ocWork.js');
const { getHiddenOcIds, unhideOcFromChatList } = require('./chatListTrash.js');

function filterHiddenList(list) {
  const hidden = getHiddenOcIds();
  return (list || []).filter((m) => hidden.indexOf(m.id) < 0);
}

const ocImage = require('./ocImage.js');

function readStoredChatAvatarPath(ocId) {
  try {
    return require('./chatAvatar.js').readOcAvatarPathsFromStorage(ocId) || '';
  } catch (e) {
    return '';
  }
}

function mapOcListItem(id, name, work, chatRemark, imageMeta) {
  const r = (work && work.result) || {};
  const display =
    (chatRemark && String(chatRemark).trim()) || name || '未命名';
  const meta = imageMeta || {};
  const avatarUrl =
    meta.chatAvatarPath ||
    ocImage.primaryImagePath(meta.ocImages, meta.ocImagePath) ||
    (work && work.chatAvatarPath) ||
    (work && ocImage.primaryImagePath(work.ocImages, work.ocImagePath)) ||
    '';
  const bioText = String((work && work.generatedBio) || '').trim();
  return {
    id,
    name: display,
    work,
    avatarUrl,
    race: r.race || '—',
    gender: r.gender || '—',
    age: r.age || '—',
    personalityText: personalityBlend(r),
    quirkText: quirkBlend(r),
    hasBio: !!bioText
  };
}

/** 按 id / 角色姓名去重，避免同一 OC 在列表中重复出现 */
function dedupeOcListByIdentity(list) {
  const seenId = {};
  const seenName = {};
  const out = [];
  (list || []).forEach((m) => {
    if (!m) return;
    if (m.id && seenId[m.id]) return;
    const rawName = String(
      (m.work && m.work.result && m.work.result.name) || m.name || ''
    ).trim();
    if (rawName && seenName[rawName]) return;
    if (m.id) seenId[m.id] = true;
    if (rawName) seenName[rawName] = true;
    out.push(m);
  });
  return out;
}

/** 对话列表：设定本中已保存的 OC（含无小传；聊天时再校验小传） */
function buildOcChatList() {
  const mapped = [];
  const favs = safeGetFavorites();
  if (Array.isArray(favs)) {
    favs.forEach((item) => {
      if (!item || !item.result) return;
      if (!String(item.result.name || '').trim()) return;
      const w = workFromFavoriteItem(item);
      if (!w) return;
      mapped.push(
        mapOcListItem(item.id, item.result.name || '未命名', w, item.chatRemark, {
          chatAvatarPath:
            item.chatAvatarPath || readStoredChatAvatarPath(item.id) || '',
          ocImagePath: item.ocImagePath,
          ocImages: item.ocImages
        })
      );
    });
  }

  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.result || !String(work.result.name || '').trim()) {
    return filterHiddenList(dedupeOcListByIdentity(mapped));
  }
  if (!isLayer3Ready(work) && mapped.length) {
    return filterHiddenList(dedupeOcListByIdentity(mapped));
  }

  const favId = work.notebookFavoriteId;
  if (favId && mapped.some((m) => m.id === favId)) {
    return filterHiddenList(dedupeOcListByIdentity(mapped));
  }
  const name = String(work.result.name || '').trim();
  if (
    name &&
    mapped.some((m) => {
      const n = String((m.work && m.work.result && m.work.result.name) || '').trim();
      return n === name || m.name === name;
    })
  ) {
    return filterHiddenList(dedupeOcListByIdentity(mapped));
  }

  mapped.unshift(
    mapOcListItem(
      favId || '__work__',
      work.result.name || '进行中 OC',
      work,
      work.chatRemark,
      {
        chatAvatarPath: work.chatAvatarPath,
        ocImagePath: work.ocImagePath,
        ocImages: work.ocImages
      }
    )
  );
  return filterHiddenList(dedupeOcListByIdentity(mapped));
}

function revealOcInChatList(ocId) {
  if (ocId) unhideOcFromChatList(ocId);
}

function resolveFavoriteId(ocId) {
  if (!ocId || ocId === '__work__') {
    const { ensureCurrentWorkInFavorites } = require('./favorite.js');
    return ensureCurrentWorkInFavorites() || '';
  }
  return ocId;
}

/** 群聊成员去重（同一设定本条目 / 同名只保留一项） */
function dedupeChatMembers(members) {
  const seen = {};
  const out = [];
  (members || []).forEach((m) => {
    if (!m) return;
    const fid = resolveFavoriteId(m.id) || m.id;
    const key = fid + '|' + (m.name || '');
    if (seen[key]) return;
    seen[key] = true;
    out.push(m);
  });
  return out;
}

/** 对话列表/顶栏显示名备注（不改设定本姓名） */
function renameOcChatRemark(ocId, remark) {
  const trimmed = String(remark || '').trim();
  if (!trimmed || !ocId) return false;
  const favId = resolveFavoriteId(ocId);
  if (favId) {
    let list = safeGetFavorites();
    const idx = list.findIndex((i) => i.id === favId);
    if (idx >= 0) {
      list[idx].chatRemark = trimmed;
      list[idx].time = Date.now();
      safeSetFavorites(list);
    }
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  const linked =
    ocId === '__work__' ||
    (favId && work.notebookFavoriteId === favId) ||
    (favId && work.notebookFavoriteId === ocId);
  if (linked && work.result) {
    work.chatRemark = trimmed;
    wx.setStorageSync(STORAGE_OC_WORK, work);
  }
  return true;
}

module.exports = {
  mapOcListItem,
  buildOcChatList,
  resolveFavoriteId,
  dedupeChatMembers,
  revealOcInChatList,
  renameOcChatRemark
};
