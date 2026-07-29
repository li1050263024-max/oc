const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_OC_WORK = 'oc_work_in_progress';
const { normalizeResult } = require('./ocResult.js');
const { isLayer3Ready } = require('./ocWork.js');
const ocImage = require('./ocImage.js');
const ocAlbum = require('./ocAlbum.js');
const { safeGetFavorites, safeSetFavorites } = require('./favoriteStore.js');
const {
  normalizeRelationships,
  normalizeRelationEdges,
  normalizeTimelineEvents,
  normalizeProfileScene
} = require('./ocProfileData.js');

function buildFavoriteItem(work, id) {
  const synced = Object.assign({}, work || {});
  if (Array.isArray(synced.ocAlbums) || Array.isArray(synced.ocImages)) {
    ocAlbum.syncWorkImagesFromAlbums(synced);
  }
  const ocAlbums = ocAlbum.normalizeOcAlbums(synced);
  const ocImages = ocImage.normalizeOcImageList(synced.ocImages);
  return {
    id: id || Date.now() + '' + Math.random().toString(36).slice(2),
    time: Date.now(),
    source: work.source || 'notebook',
    result: normalizeResult(work.result),
    background: work.background
      ? {
          worldview: work.background.worldview || '',
          lifeEvents: (work.background.lifeEvents || []).slice(),
          origins: (work.background.origins || []).slice()
        }
      : null,
    catchphrases: (work.catchphrases || []).slice(),
    attitudes: (work.attitudes || []).map((a) => ({ ...a })),
    generatedBio: work.generatedBio || '',
    ocAlbums,
    ocImages,
    ocImagePath: ocImage.primaryImagePath(ocImages, work.ocImagePath || ''),
    chatAvatarPath: work.chatAvatarPath || '',
    chatBackgroundPath: work.chatBackgroundPath || '',
    ocStories: Array.isArray(work.ocStories) ? work.ocStories.map((s) => ({ ...s })) : [],
    relationships: Array.isArray(work.relationships)
      ? normalizeRelationships(work.relationships)
      : [],
    relationEdges: Array.isArray(work.relationEdges)
      ? normalizeRelationEdges(work.relationEdges)
      : [],
    timelineEvents: Array.isArray(work.timelineEvents)
      ? normalizeTimelineEvents(work.timelineEvents)
      : [],
    profileScene: normalizeProfileScene(work.profileScene)
  };
}

function preserveFavoriteImages(item, existingItem, work) {
  if (!sameOcName(item, existingItem)) return item;
  if (work && Array.isArray(work.ocAlbums)) {
    ocAlbum.syncWorkImagesFromAlbums(item);
    return item;
  }
  if (work && Array.isArray(work.ocImages) && work.ocImages.length > 0) return item;
  const existingAlbums =
    existingItem && Array.isArray(existingItem.ocAlbums) ? existingItem.ocAlbums : [];
  if (existingAlbums.length) {
    item.ocAlbums = existingAlbums.map((a) => ocAlbum.normalizeAlbum(a));
    ocAlbum.syncWorkImagesFromAlbums(item);
    return item;
  }
  const existing =
    existingItem && Array.isArray(existingItem.ocImages) ? existingItem.ocImages : [];
  if (existing.length) {
    item.ocImages = existing.map((g) => ({ ...g }));
    item.ocImagePath = ocImage.primaryImagePath(item.ocImages, existingItem.ocImagePath || '');
    item.ocAlbums = ocAlbum.normalizeOcAlbums(item);
  }
  return item;
}

function sameOcName(a, b) {
  const na = String((a && a.result && a.result.name) || '').trim();
  const nb = String((b && b.result && b.result.name) || '').trim();
  return !!(na && nb && na === nb);
}

function preserveFavoriteStories(item, existingItem, work) {
  if (!sameOcName(item, existingItem)) return item;
  const existing = existingItem && Array.isArray(existingItem.ocStories) ? existingItem.ocStories : [];
  const incoming = work && Array.isArray(work.ocStories) ? work.ocStories : null;
  if (incoming && incoming.length) return item;
  if (existing.length) {
    item.ocStories = existing.map((s) => ({ ...s }));
  }
  return item;
}

function preserveFavoriteChatBackground(item, existingItem, work) {
  if (work && work.chatBackgroundPath) return item;
  if (existingItem && existingItem.chatBackgroundPath) {
    item.chatBackgroundPath = existingItem.chatBackgroundPath;
  }
  return item;
}

function preserveFavoriteProfileFields(item, existingItem, work) {
  // 姓名已变说明是新 OC，禁止继承旧小传/关系网/时间线
  if (!sameOcName(item, existingItem)) return item;
  if (!(work && work.relationships != null) && existingItem && Array.isArray(existingItem.relationships)) {
    item.relationships = existingItem.relationships.map((r) => ({ ...r }));
  }
  if (!(work && work.relationEdges != null) && existingItem && Array.isArray(existingItem.relationEdges)) {
    item.relationEdges = existingItem.relationEdges.map((e) => ({ ...e }));
  }
  if (!(work && work.timelineEvents != null) && existingItem && Array.isArray(existingItem.timelineEvents)) {
    item.timelineEvents = existingItem.timelineEvents.map((e) => ({ ...e }));
  }
  if (!(work && work.profileScene != null) && existingItem && existingItem.profileScene) {
    item.profileScene = normalizeProfileScene(existingItem.profileScene);
  }
  if (!(work && work.generatedBio) && existingItem && existingItem.generatedBio) {
    item.generatedBio = existingItem.generatedBio;
  }
  return item;
}

/**
 * 设定本保存：更新已有收藏或按姓名合并，否则新增
 * @returns {string|false} 收藏项 id
 */
function upsertOcToFavorites(work) {
  if (!work || !work.result) return false;
  const name = String(work.result.name || '').trim() || '未命名';
  if (!work.result.name || !String(work.result.name).trim()) {
    work.result = Object.assign({}, work.result, { name: name });
  }

  let list = safeGetFavorites();

  let idx = -1;
  if (work.notebookFavoriteId) {
    idx = list.findIndex((i) => i.id === work.notebookFavoriteId);
  }
  // 无绑定 id 时按姓名合并，避免同一 OC 被反复存成多条
  if (idx < 0 && name) {
    idx = list.findIndex((i) => {
      const n = String((i && i.result && i.result.name) || '').trim();
      return n && n === name;
    });
    if (idx >= 0) {
      work.notebookFavoriteId = list[idx].id;
    }
  }

  ocImage.syncPrimaryImagePath(work);
  const item = buildFavoriteItem(work, idx >= 0 ? list[idx].id : '');
  if (idx >= 0) {
    preserveFavoriteStories(item, list[idx], work);
    preserveFavoriteImages(item, list[idx], work);
    preserveFavoriteChatBackground(item, list[idx], work);
    preserveFavoriteProfileFields(item, list[idx], work);
    if (list[idx].chatRemark && !item.chatRemark) {
      item.chatRemark = list[idx].chatRemark;
    }
    if (list[idx].chatAvatarPath && !item.chatAvatarPath) {
      item.chatAvatarPath = list[idx].chatAvatarPath;
    }
    item.time = Date.now();
    list[idx] = item;
  } else {
    list.unshift(item);
  }
  if (!safeSetFavorites(list)) return false;
  return item.id;
}

/**
 * 将完整 OC 存档写入收藏列表（新增一条）
 */
function saveOcToFavorites(work) {
  if (!work || !work.result) return false;
  let list = safeGetFavorites();
  const item = buildFavoriteItem(work);
  list.unshift(item);
  return safeSetFavorites(list);
}

function workFromFavoriteItem(item) {
  if (!item || !item.result) return null;
  const seed = {
    ocAlbums: item.ocAlbums,
    ocImages: item.ocImages,
    ocImagePath: item.ocImagePath || ''
  };
  ocAlbum.syncWorkImagesFromAlbums(seed);
  return {
    result: { ...item.result },
    background: item.background
      ? {
          worldview: item.background.worldview || '',
          lifeEvents: (item.background.lifeEvents || []).slice(),
          origins: (item.background.origins || []).slice()
        }
      : null,
    catchphrases: (item.catchphrases || []).slice(),
    attitudes: (item.attitudes || []).map((a) => ({ ...a })),
    generatedBio: item.generatedBio || '',
    ocAlbums: seed.ocAlbums,
    ocImages: seed.ocImages,
    ocImagePath: seed.ocImagePath,
    chatAvatarPath: item.chatAvatarPath || '',
    chatBackgroundPath: item.chatBackgroundPath || '',
    ocStories: Array.isArray(item.ocStories) ? item.ocStories.map((s) => ({ ...s })) : [],
    relationships: normalizeRelationships(item.relationships),
    relationEdges: normalizeRelationEdges(item.relationEdges),
    timelineEvents: normalizeTimelineEvents(item.timelineEvents),
    profileScene: normalizeProfileScene(item.profileScene),
    notebookFavoriteId: item.id,
    layer2Done: true,
    layer3Done: true,
    layer3Confirmed: true
  };
}

/** 将收藏项载入进行中存档，供小传/对话等页使用 */
function loadFavoriteToWork(favoriteId) {
  if (!favoriteId) return null;
  const list = wx.getStorageSync(STORAGE_FAVORITES) || [];
  const item = list.find((i) => i.id === favoriteId);
  const work = workFromFavoriteItem(item);
  if (!work) return null;
  wx.setStorageSync(STORAGE_OC_WORK, work);
  return work;
}

/** 把小传写回收藏列表 */
function getFavorites() {
  return safeGetFavorites();
}

function getFavoriteById(favoriteId) {
  if (!favoriteId) return null;
  return getFavorites().find((i) => i.id === favoriteId) || null;
}

function updateFavoriteItem(favoriteId, work) {
  if (!favoriteId || !work || !work.result) return false;
  try {
    let list = getFavorites();
    const idx = list.findIndex((i) => i.id === favoriteId);
    if (idx < 0) return false;
    ocImage.syncPrimaryImagePath(work);
    const item = buildFavoriteItem(work, favoriteId);
    if (!Array.isArray(work.ocStories) && Array.isArray(list[idx].ocStories)) {
      item.ocStories = list[idx].ocStories.map((s) => ({ ...s }));
    }
    if (Array.isArray(work.ocAlbums)) {
      ocAlbum.syncWorkImagesFromAlbums(item);
    } else if (!Array.isArray(work.ocImages) && Array.isArray(list[idx].ocImages)) {
      item.ocImages = list[idx].ocImages.map((g) => ({ ...g }));
      item.ocImagePath = ocImage.primaryImagePath(item.ocImages, list[idx].ocImagePath || '');
      item.ocAlbums = Array.isArray(list[idx].ocAlbums)
        ? list[idx].ocAlbums.map((a) => ocAlbum.normalizeAlbum(a))
        : ocAlbum.normalizeOcAlbums(item);
    } else if (
      Array.isArray(work.ocImages) &&
      work.ocImages.length === 0 &&
      Array.isArray(list[idx].ocImages) &&
      !Array.isArray(work.ocAlbums)
    ) {
      item.ocImages = list[idx].ocImages.map((g) => ({ ...g }));
      item.ocImagePath = ocImage.primaryImagePath(item.ocImages, list[idx].ocImagePath || '');
      item.ocAlbums = Array.isArray(list[idx].ocAlbums)
        ? list[idx].ocAlbums.map((a) => ocAlbum.normalizeAlbum(a))
        : ocAlbum.normalizeOcAlbums(item);
    }
    if (list[idx].chatRemark && !work.chatRemark) {
      item.chatRemark = list[idx].chatRemark;
    }
    if (list[idx].chatAvatarPath && !work.chatAvatarPath) {
      item.chatAvatarPath = list[idx].chatAvatarPath;
    }
    if (list[idx].chatBackgroundPath && !work.chatBackgroundPath) {
      item.chatBackgroundPath = list[idx].chatBackgroundPath;
    }
    if (list[idx].profileScene && !work.profileScene) {
      item.profileScene = normalizeProfileScene(list[idx].profileScene);
    }
    if (work.chatRemark) {
      item.chatRemark = work.chatRemark;
    }
    item.time = Date.now();
    list[idx] = item;
    return safeSetFavorites(list);
  } catch (err) {
    console.error('[favorite] updateFavoriteItem fail', err);
    return false;
  }
}

function deleteFavoriteItem(favoriteId) {
  if (!favoriteId) return false;
  const list = getFavorites().filter((i) => i.id !== favoriteId);
  return safeSetFavorites(list, { allowShrink: true });
}

function deleteFavoriteItems(favoriteIds) {
  const idSet = {};
  (favoriteIds || []).forEach((id) => {
    if (id) idSet[id] = true;
  });
  const keys = Object.keys(idSet);
  if (!keys.length) return false;
  const list = getFavorites().filter((i) => i && !idSet[i.id]);
  return safeSetFavorites(list, { allowShrink: true });
}

/**
 * 合并同名重复收藏：同名只留一条（优先有小传、时间更新者），写回存储。
 * @returns {number} 删除条数
 */
function consolidateFavoriteDuplicatesByName() {
  const list = safeGetFavorites();
  if (!Array.isArray(list) || list.length < 2) return 0;
  const bestByName = {};
  const order = [];
  list.forEach((item) => {
    if (!item || !item.result) return;
    const name = String(item.result.name || '').trim() || '未命名';
    const prev = bestByName[name];
    if (!prev) {
      bestByName[name] = item;
      order.push(name);
      return;
    }
    const prevBio = !!(prev.generatedBio && String(prev.generatedBio).trim());
    const curBio = !!(item.generatedBio && String(item.generatedBio).trim());
    const prevTime = Number(prev.time) || 0;
    const curTime = Number(item.time) || 0;
    let preferCur = false;
    if (curBio && !prevBio) preferCur = true;
    else if (curBio === prevBio && curTime >= prevTime) preferCur = true;
    if (preferCur) bestByName[name] = item;
  });
  const next = order.map((n) => bestByName[n]).filter(Boolean);
  if (next.length >= list.length) return 0;
  const removed = list.length - next.length;
  if (!safeSetFavorites(next, { allowShrink: true })) return 0;
  return removed;
}

/** 将进行中且 layer3 完整的 OC 写入/更新收藏，供故事/小传/对话与导航使用 */
function ensureCurrentWorkInFavorites() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.result || !isLayer3Ready(work)) return null;
  if (work.notebookFavoriteId) {
    const existing = getFavoriteById(work.notebookFavoriteId);
    const samePerson = existing && sameOcName(work, existing);
    if (!samePerson) {
      // 旧绑定已指向别的角色：断开，避免把哈利波特小传等灌进新抽卡
      delete work.notebookFavoriteId;
    } else {
      if (
        existing &&
        Array.isArray(existing.ocStories) &&
        existing.ocStories.length &&
        (!Array.isArray(work.ocStories) || !work.ocStories.length)
      ) {
        work.ocStories = existing.ocStories.map((s) => ({ ...s }));
      }
      if (existing && Array.isArray(existing.ocAlbums) && !Array.isArray(work.ocAlbums)) {
        work.ocAlbums = existing.ocAlbums.map((a) => ocAlbum.normalizeAlbum(a));
        ocAlbum.syncWorkImagesFromAlbums(work);
      } else if (
        existing &&
        Array.isArray(existing.ocImages) &&
        existing.ocImages.length &&
        (!Array.isArray(work.ocImages) || !work.ocImages.length)
      ) {
        work.ocImages = existing.ocImages.map((g) => ({ ...g }));
        work.ocImagePath = ocImage.primaryImagePath(work.ocImages, existing.ocImagePath || '');
        work.ocAlbums = ocAlbum.normalizeOcAlbums(work);
      }
      if (existing && existing.generatedBio && !work.generatedBio) {
        work.generatedBio = existing.generatedBio;
      }
      if (
        existing &&
        Array.isArray(existing.relationships) &&
        existing.relationships.length &&
        (!Array.isArray(work.relationships) || !work.relationships.length)
      ) {
        work.relationships = existing.relationships.map((r) => ({ ...r }));
      }
      if (
        existing &&
        Array.isArray(existing.relationEdges) &&
        existing.relationEdges.length &&
        (!Array.isArray(work.relationEdges) || !work.relationEdges.length)
      ) {
        work.relationEdges = existing.relationEdges.map((e) => ({ ...e }));
      }
    }
  }
  const id = upsertOcToFavorites(work);
  if (!id) return null;
  work.notebookFavoriteId = id;
  wx.setStorageSync(STORAGE_OC_WORK, work);
  return id;
}

function hasLocalOcSetting() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (work && work.result) return true;
  const list = getFavorites();
  return list.some((i) => i && i.result);
}

function syncBioToFavorite(favoriteId, generatedBio) {
  if (!favoriteId) return false;
  let list = safeGetFavorites();
  const idx = list.findIndex((i) => i.id === favoriteId);
  if (idx < 0) return false;
  list[idx].generatedBio = generatedBio || '';
  list[idx].time = Date.now();
  return safeSetFavorites(list);
}

/** 新抽卡前断开与旧收藏的绑定，避免 upsert 覆盖已有 OC */
function detachWorkFromFavoriteLink() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.notebookFavoriteId) return work;
  delete work.notebookFavoriteId;
  try {
    wx.setStorageSync(STORAGE_OC_WORK, work);
  } catch (e) {}
  return work;
}

/**
 * 开始全新抽卡：断开收藏绑定，并清掉上一角色的小传/关系网等档案字段，防止串档
 */
function beginFreshGachaWork() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  delete work.notebookFavoriteId;
  delete work.generatedBio;
  delete work.relationships;
  delete work.relationEdges;
  delete work.timelineEvents;
  delete work.profileScene;
  delete work.ocStories;
  delete work.chatRemark;
  try {
    wx.setStorageSync(STORAGE_OC_WORK, work);
  } catch (e) {}
  return work;
}

module.exports = {
  STORAGE_FAVORITES,
  buildFavoriteItem,
  upsertOcToFavorites,
  saveOcToFavorites,
  workFromFavoriteItem,
  loadFavoriteToWork,
  getFavorites,
  getFavoriteById,
  updateFavoriteItem,
  deleteFavoriteItem,
  deleteFavoriteItems,
  consolidateFavoriteDuplicatesByName,
  ensureCurrentWorkInFavorites,
  hasLocalOcSetting,
  syncBioToFavorite,
  detachWorkFromFavoriteLink,
  beginFreshGachaWork
};
