const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_OC_WORK = 'oc_work_in_progress';
const { resolveFavoriteId } = require('./ocChatList.js');
const { getRoomMeta, upsertRoomMeta } = require('./groupChatStore.js');
const { safeGetFavorites, safeSetFavorites } = require('./favoriteStore.js');
const ocImage = require('./ocImage.js');

function readChatBackgroundPathFromStorage(ocId) {
  const favId = resolveFavoriteId(ocId);
  if (favId) {
    const list = safeGetFavorites();
    const item = list.find((i) => i.id === favId);
    if (item && item.chatBackgroundPath) return item.chatBackgroundPath;
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  const linked =
    ocId === '__work__' ||
    (favId && work.notebookFavoriteId === favId) ||
    (favId && work.notebookFavoriteId === ocId);
  if (linked && work.chatBackgroundPath) return work.chatBackgroundPath;
  return '';
}

function setChatBackgroundPath(ocId, bgPath) {
  if (!ocId) return false;
  const favId = resolveFavoriteId(ocId);
  if (favId) {
    let list = safeGetFavorites();
    const idx = list.findIndex((i) => i.id === favId);
    if (idx >= 0) {
      list[idx].chatBackgroundPath = bgPath || '';
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
    work.chatBackgroundPath = bgPath || '';
    wx.setStorageSync(STORAGE_OC_WORK, work);
  }
  return true;
}

async function resolveChatBackground(ocId) {
  const stored = readChatBackgroundPathFromStorage(ocId) || '';
  if (!stored) return '';
  if (await ocImage.fileExists(stored)) return stored;
  return '';
}

async function saveChatBackgroundFromTemp(tempFilePath, ocId) {
  const favId = resolveFavoriteId(ocId) || ocId;
  const oldPath = readChatBackgroundPathFromStorage(ocId) || '';
  const ext = ocImage.extractImageExt(tempFilePath);
  const dest = ocImage.getVersionedChatAssetPath(`oc_chat_bg_${favId}`, ext);
  const saved = await ocImage.saveImageFromTempToDest(tempFilePath, dest);
  setChatBackgroundPath(ocId, saved);
  if (oldPath && oldPath !== saved) await unlinkQuiet(oldPath);
  const legacy = ocImage.getChatBackgroundPath(favId);
  if (legacy && legacy !== saved && legacy !== oldPath) await unlinkQuiet(legacy);
  return saved;
}

function unlinkQuiet(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve();
      return;
    }
    const fs = wx.getFileSystemManager();
    fs.unlink({ filePath, success: () => resolve(), fail: () => resolve() });
  });
}

async function removeChatBackground(ocId) {
  const path = readChatBackgroundPathFromStorage(ocId) || '';
  await unlinkQuiet(path);
  const favId = resolveFavoriteId(ocId) || ocId;
  const legacy = ocImage.getChatBackgroundPath(favId);
  if (legacy && legacy !== path) await unlinkQuiet(legacy);
  setChatBackgroundPath(ocId, '');
}

function hasChatBackground(ocId) {
  return !!readChatBackgroundPathFromStorage(ocId);
}

function readGroupChatBackgroundPath(roomId) {
  if (!roomId) return '';
  const meta = getRoomMeta(roomId);
  return (meta && meta.chatBackgroundPath) || '';
}

function setGroupChatBackgroundPath(roomId, bgPath) {
  if (!roomId) return false;
  upsertRoomMeta({ roomId, chatBackgroundPath: bgPath || '' });
  return true;
}

async function resolveGroupChatBackground(roomId) {
  const stored = readGroupChatBackgroundPath(roomId) || '';
  if (!stored) return '';
  if (await ocImage.fileExists(stored)) return stored;
  return '';
}

async function saveGroupChatBackgroundFromTemp(tempFilePath, roomId) {
  const oldPath = readGroupChatBackgroundPath(roomId) || '';
  const ext = ocImage.extractImageExt(tempFilePath);
  const dest = ocImage.getVersionedChatAssetPath(`oc_group_chat_bg_${roomId}`, ext);
  const saved = await ocImage.saveImageFromTempToDest(tempFilePath, dest);
  setGroupChatBackgroundPath(roomId, saved);
  if (oldPath && oldPath !== saved) await unlinkQuiet(oldPath);
  const legacy = ocImage.getGroupChatBackgroundPath(roomId);
  if (legacy && legacy !== saved && legacy !== oldPath) await unlinkQuiet(legacy);
  return saved;
}

async function removeGroupChatBackground(roomId) {
  const path = readGroupChatBackgroundPath(roomId) || '';
  await unlinkQuiet(path);
  const legacy = ocImage.getGroupChatBackgroundPath(roomId);
  if (legacy && legacy !== path) await unlinkQuiet(legacy);
  setGroupChatBackgroundPath(roomId, '');
}

function hasGroupChatBackground(roomId) {
  return !!readGroupChatBackgroundPath(roomId);
}

module.exports = {
  resolveChatBackground,
  saveChatBackgroundFromTemp,
  removeChatBackground,
  hasChatBackground,
  readChatBackgroundPathFromStorage,
  resolveGroupChatBackground,
  saveGroupChatBackgroundFromTemp,
  removeGroupChatBackground,
  hasGroupChatBackground,
  readGroupChatBackgroundPath
};
