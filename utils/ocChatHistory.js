const { listSessions, getMessages } = require('./chatSession.js');

const { buildOcChatList, resolveFavoriteId } = require('./ocChatList.js');

const { getOcsForSocial } = require('./ocSocialEligible.js');

const { getHiddenOcIds } = require('./chatListTrash.js');
const { getFavoriteById } = require('./favorite.js');
const { workFromFavoriteItem } = require('./favorite.js');
const { mapOcListItem } = require('./ocChatList.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';



function migrateLegacyMessages(ocId) {

  const legacy = wx.getStorageSync('oc_chat_' + ocId);

  if (legacy && Array.isArray(legacy) && legacy.length) {

    return legacy;

  }

  return null;

}



function resolveOcChatStorageIds(ocId) {

  if (!ocId) return [];

  const ids = [ocId];

  const push = (id) => {

    if (id && ids.indexOf(id) < 0) ids.push(id);

  };

  if (ocId === '__work__') {

    push(resolveFavoriteId('__work__'));

  } else {

    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};

    if (work.notebookFavoriteId === ocId) push('__work__');

  }

  return ids;

}



function hasUserMsgInStorage(ocId) {

  if (!ocId) return false;

  const sessions = listSessions(ocId);

  for (let i = 0; i < sessions.length; i++) {

    const msgs = getMessages(ocId, sessions[i].id);

    for (let j = 0; j < msgs.length; j++) {

      const m = msgs[j];

      if (m && m.role === 'user' && String(m.content || '').trim()) {

        return true;

      }

    }

  }

  const legacy = migrateLegacyMessages(ocId);

  if (legacy) {

    for (let k = 0; k < legacy.length; k++) {

      const m = legacy[k];

      if (m && m.role === 'user' && String(m.content || '').trim()) {

        return true;

      }

    }

  }

  return false;

}



/** 用户是否与该 OC 有过对话（至少一条用户发送的消息） */

function hasUserChattedWithOc(ocId) {

  return resolveOcChatStorageIds(ocId).some(hasUserMsgInStorage);

}



/** 聊天记录实际所在的 ocId（兼容 __work__ 与设定本 id 别名） */

function primaryChatOcId(ocId) {

  const ids = resolveOcChatStorageIds(ocId);

  for (let i = 0; i < ids.length; i++) {

    if (hasUserMsgInStorage(ids[i])) return ids[i];

  }

  return ids[0] || ocId;

}



function filterOcsUserHasChattedWith(ocList) {

  return (ocList || []).filter((oc) => oc && oc.id && hasUserChattedWithOc(oc.id));

}



/** 从本地 storage 扫描所有有会话记录的 ocId */
function listStorageOcIdsWithSessions() {
  const ids = {};
  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach((key) => {
      const m = /^oc_chat_sessions_(.+)$/.exec(String(key || ''));
      if (m && m[1]) ids[m[1]] = true;
    });
  } catch (e) {}
  return Object.keys(ids);
}

function resolveListOcIdForStorage(storageId, socialById) {
  if (!storageId) return '';
  if (socialById[storageId]) return storageId;
  if (storageId === '__work__') {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.notebookFavoriteId && socialById[work.notebookFavoriteId]) {
      return work.notebookFavoriteId;
    }
    if (socialById.__work__) return '__work__';
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (work.notebookFavoriteId === storageId && socialById.__work__) {
    return '__work__';
  }
  return storageId;
}

function buildOcFromStorageId(storageId, socialById) {
  const listId = resolveListOcIdForStorage(storageId, socialById);
  if (listId && socialById[listId]) return socialById[listId];

  const fav = getFavoriteById(storageId);
  if (fav && fav.result) {
    const work = workFromFavoriteItem(fav);
    if (work && work.result) {
      return mapOcListItem(fav.id, fav.result.name || '未命名', work, fav.chatRemark, {
        chatAvatarPath: fav.chatAvatarPath,
        ocImagePath: fav.ocImagePath,
        ocImages: fav.ocImages
      });
    }
  }

  if (storageId === '__work__') {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.result && String(work.result.name || '').trim()) {
      return mapOcListItem(
        work.notebookFavoriteId || '__work__',
        work.result.name || '进行中 OC',
        work,
        work.chatRemark,
        {
          chatAvatarPath: work.chatAvatarPath,
          ocImagePath: work.ocImagePath,
          ocImages: work.ocImages
        }
      );
    }
  }
  return null;
}

/** 单聊主动消息：所有与用户聊过的 OC（含列表隐藏项），沿用单聊规则 */
function getChattedOcsForProactive() {
  const out = [];
  const seen = {};
  const socialById = {};
  getOcsForSocial().forEach((oc) => {
    if (oc && oc.id) socialById[oc.id] = oc;
  });

  const add = (oc) => {
    if (!oc || !oc.id || seen[oc.id]) return;
    if (!hasUserChattedWithOc(oc.id)) return;
    seen[oc.id] = true;
    const storageId = primaryChatOcId(oc.id);
    out.push(
      Object.assign({}, oc, {
        chatStorageId: storageId
      })
    );
  };

  buildOcChatList().forEach(add);
  getOcsForSocial().forEach(add);
  getHiddenOcIds().forEach((id) => {
    if (socialById[id]) add(socialById[id]);
  });

  listStorageOcIdsWithSessions().forEach((storageId) => {
    if (!hasUserMsgInStorage(storageId)) return;
    const oc = buildOcFromStorageId(storageId, socialById);
    if (oc) add(oc);
  });

  return out;
}

/** 统计单聊用户发言条数（每条用户消息计为一轮互动） */
function countUserMessagesInStorage(ocId) {
  if (!ocId) return 0;
  let count = 0;
  const sessions = listSessions(ocId);
  for (let i = 0; i < sessions.length; i++) {
    const msgs = getMessages(ocId, sessions[i].id);
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j];
      if (m && m.role === 'user' && String(m.content || '').trim()) {
        count += 1;
      }
    }
  }
  const legacy = migrateLegacyMessages(ocId);
  if (legacy) {
    for (let k = 0; k < legacy.length; k++) {
      const m = legacy[k];
      if (m && m.role === 'user' && String(m.content || '').trim()) {
        count += 1;
      }
    }
  }
  return count;
}

function countChatRoundsForOc(ocId) {
  if (!ocId) return 0;
  return countUserMessagesInStorage(primaryChatOcId(ocId));
}

function parseOcIdTimestamp(id) {
  const m = String(id || '').match(/^(\d{13})/);
  return m ? Number(m[1]) : 0;
}

/** OC 创建时间：设定本 time 字段，或 id 前缀时间戳 */
function getOcCreatedAtMs(ocId) {
  if (!ocId) return 0;
  if (ocId === '__work__') {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.notebookFavoriteId) {
      const linked = getFavoriteById(work.notebookFavoriteId);
      if (linked && linked.time) return Number(linked.time) || 0;
    }
    return parseOcIdTimestamp(ocId);
  }
  const fav = getFavoriteById(ocId);
  if (fav && fav.time) return Number(fav.time) || 0;
  return parseOcIdTimestamp(ocId);
}

/**
 * 单聊主动消息：互动量前三（按用户发言轮次；相同则创建时间更早者优先）
 * @param {number} [limit=3]
 */
function getTopChattedOcsForProactive(limit) {
  const cap = Math.max(1, Number(limit) || 3);
  const all = getChattedOcsForProactive();
  const ranked = all
    .map((oc) =>
      Object.assign({}, oc, {
        chatRounds: countChatRoundsForOc(oc.id),
        createdAtMs: getOcCreatedAtMs(oc.id)
      })
    )
    .sort((a, b) => {
      if (b.chatRounds !== a.chatRounds) return b.chatRounds - a.chatRounds;
      return a.createdAtMs - b.createdAtMs;
    });
  return ranked.slice(0, cap);
}

module.exports = {
  resolveOcChatStorageIds,
  primaryChatOcId,
  hasUserChattedWithOc,
  filterOcsUserHasChattedWith,
  getChattedOcsForProactive,
  countChatRoundsForOc,
  getOcCreatedAtMs,
  getTopChattedOcsForProactive
};


