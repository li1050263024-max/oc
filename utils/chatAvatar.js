const STORAGE_USER_AVATAR = 'oc_chat_user_avatar';
const STORAGE_OC_CHAT_AVATAR_MAP = 'oc_chat_avatar_map';
const { safeGetFavorites, safeSetFavorites } = require('./favoriteStore.js');
const STORAGE_OC_WORK = 'oc_work_in_progress';
const { resolveFavoriteId } = require('./ocChatList.js');
const ocImage = require('./ocImage.js');

function readChatAvatarMap() {
  const map = wx.getStorageSync(STORAGE_OC_CHAT_AVATAR_MAP);
  return map && typeof map === 'object' ? map : {};
}

function writeChatAvatarMapEntry(ocId, avatarPath) {
  if (!ocId) return;
  const map = readChatAvatarMap();
  const favId = resolveFavoriteId(ocId) || ocId;
  if (avatarPath) {
    map[favId] = avatarPath;
    if (ocId !== favId) map[ocId] = avatarPath;
  } else {
    delete map[favId];
    delete map[ocId];
  }
  try {
    wx.setStorageSync(STORAGE_OC_CHAT_AVATAR_MAP, map);
  } catch (err) {
    console.error('[chatAvatar] map write failed', err);
  }
}

function readChatAvatarMapPath(ocId) {
  if (!ocId) return '';
  const map = readChatAvatarMap();
  const favId = resolveFavoriteId(ocId) || ocId;
  return map[ocId] || map[favId] || '';
}

function pickAvatarPath(chatAvatarPath, ocImagePath, ocImages) {
  if (chatAvatarPath) return chatAvatarPath;
  const primary = ocImage.primaryImagePath(ocImages, ocImagePath);
  return primary || '';
}

function readOcAvatarPathsFromStorage(ocId) {
  const mapPath = readChatAvatarMapPath(ocId);
  if (mapPath) return mapPath;
  const favId = resolveFavoriteId(ocId);
  if (favId) {
    const list = safeGetFavorites();
    const item = Array.isArray(list) ? list.find((i) => i.id === favId) : null;
    if (item) {
      return pickAvatarPath(item.chatAvatarPath, item.ocImagePath, item.ocImages);
    }
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  const linked =
    ocId === '__work__' ||
    (favId && work.notebookFavoriteId === favId) ||
    (favId && work.notebookFavoriteId === ocId);
  if (linked && work.result) {
    return pickAvatarPath(work.chatAvatarPath, work.ocImagePath, work.ocImages);
  }
  return '';
}

function setOcChatAvatarPath(ocId, avatarPath) {
  if (!ocId) return false;
  let saved = false;
  const favId = resolveFavoriteId(ocId) || ocId;
  let list = safeGetFavorites();
  let idx = list.findIndex((i) => i.id === favId);
  if (idx < 0 && ocId !== favId) {
    idx = list.findIndex((i) => i.id === ocId);
  }
  if (idx >= 0) {
    list[idx].chatAvatarPath = avatarPath || '';
    list[idx].time = Date.now();
    if (safeSetFavorites(list)) saved = true;
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  const linked =
    ocId === '__work__' ||
    (favId && work.notebookFavoriteId === favId) ||
    (favId && work.notebookFavoriteId === ocId) ||
    ocId === work.notebookFavoriteId;
  if (linked && work.result) {
    work.chatAvatarPath = avatarPath || '';
    try {
      wx.setStorageSync(STORAGE_OC_WORK, work);
      saved = true;
    } catch (err) {
      console.error('[chatAvatar] work write failed', err);
    }
  }
  if (avatarPath) {
    writeChatAvatarMapEntry(ocId, avatarPath);
    saved = true;
  } else {
    writeChatAvatarMapEntry(ocId, '');
  }
  return saved;
}

function getStoredUserAvatarPath() {
  return wx.getStorageSync(STORAGE_USER_AVATAR) || '';
}

function setStoredUserAvatarPath(path) {
  if (path) wx.setStorageSync(STORAGE_USER_AVATAR, path);
  else wx.removeStorageSync(STORAGE_USER_AVATAR);
}

async function resolveStoredPath(storedPath) {
  if (!storedPath) return '';
  if (await ocImage.fileExists(storedPath)) return storedPath;
  return '';
}

async function resolveUserAvatar() {
  const stored = getStoredUserAvatarPath();
  const ok = await resolveStoredPath(stored);
  if (!ok && stored) setStoredUserAvatarPath('');
  return ok;
}

async function resolveOcAvatar(ocId, fallbackPath) {
  const stored = readOcAvatarPathsFromStorage(ocId) || fallbackPath || '';
  if (!stored) return '';
  if (await ocImage.fileExists(stored)) return stored;
  return '';
}

async function saveUserAvatarFromTemp(tempFilePath) {
  if (!tempFilePath) throw new Error('未获取到图片');
  const oldPath = getStoredUserAvatarPath();
  const ext = ocImage.extractImageExt(tempFilePath);
  const dest = ocImage.getVersionedChatAssetPath('oc_chat_user_avatar', ext);
  const saved = await ocImage.saveImageFromTempToDest(tempFilePath, dest);
  if (!saved) throw new Error('保存图片失败');
  setStoredUserAvatarPath(saved);
  if (oldPath && oldPath !== saved) await unlinkQuiet(oldPath);
  const legacy = ocImage.getUserChatAvatarPath();
  if (legacy && legacy !== saved && legacy !== oldPath) await unlinkQuiet(legacy);
  return saved;
}

async function saveOcAvatarFromTemp(tempFilePath, ocId) {
  if (!tempFilePath) throw new Error('未获取到图片');
  let targetId = ocId;
  if (!targetId || targetId === '__work__') {
    const { ensureCurrentWorkInFavorites } = require('./favorite.js');
    const ensured = ensureCurrentWorkInFavorites();
    if (ensured) targetId = ensured;
  }
  const favId = resolveFavoriteId(targetId) || targetId;
  const oldPath = readChatOnlyAvatarPath(targetId) || readChatOnlyAvatarPath(ocId) || '';
  const ext = ocImage.extractImageExt(tempFilePath);
  const dest = ocImage.getVersionedChatAssetPath(`oc_chat_avatar_${favId}`, ext);
  const saved = await ocImage.saveImageFromTempToDest(tempFilePath, dest);
  if (!saved) throw new Error('保存图片失败');
  setOcChatAvatarPath(targetId, saved);
  if (ocId && ocId !== targetId) setOcChatAvatarPath(ocId, saved);
  if (oldPath && oldPath !== saved) await unlinkQuiet(oldPath);
  const legacy = ocImage.getChatOcAvatarPath(favId);
  if (legacy && legacy !== saved && legacy !== oldPath) await unlinkQuiet(legacy);
  return saved;
}

async function buildMemberAvatarMap(members) {
  const map = {};
  await Promise.all(
    (members || []).map(async (m) => {
      if (!m || !m.id) return;
      map[m.id] = await resolveOcAvatar(m.id, m.avatarUrl || '');
    })
  );
  return map;
}

function readChatOnlyAvatarPath(ocId) {
  const mapPath = readChatAvatarMapPath(ocId);
  if (mapPath) return mapPath;
  const favId = resolveFavoriteId(ocId);
  if (favId) {
    const list = safeGetFavorites();
    const item = Array.isArray(list) ? list.find((i) => i.id === favId) : null;
    if (item && item.chatAvatarPath) return item.chatAvatarPath;
  }
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  const linked =
    ocId === '__work__' ||
    (favId && work.notebookFavoriteId === favId) ||
    (favId && work.notebookFavoriteId === ocId);
  if (linked && work.chatAvatarPath) return work.chatAvatarPath;
  return '';
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

async function removeUserAvatar() {
  const path = getStoredUserAvatarPath();
  await unlinkQuiet(path);
  const legacy = ocImage.getUserChatAvatarPath();
  if (legacy && legacy !== path) await unlinkQuiet(legacy);
  setStoredUserAvatarPath('');
}

async function removeOcChatAvatar(ocId) {
  const path = readChatOnlyAvatarPath(ocId) || '';
  await unlinkQuiet(path);
  const favId = resolveFavoriteId(ocId) || ocId;
  const legacy = ocImage.getChatOcAvatarPath(favId);
  if (legacy && legacy !== path) await unlinkQuiet(legacy);
  setOcChatAvatarPath(ocId, '');
}

module.exports = {
  pickAvatarPath,
  resolveUserAvatar,
  resolveOcAvatar,
  saveUserAvatarFromTemp,
  saveOcAvatarFromTemp,
  buildMemberAvatarMap,
  readOcAvatarPathsFromStorage,
  readChatOnlyAvatarPath,
  removeUserAvatar,
  removeOcChatAvatar,
  getStoredUserAvatarPath
};
