const STORAGE_FEED = 'oc_douyin_feed';
const STORAGE_META = 'oc_douyin_meta';
const STORAGE_LIKES = 'oc_douyin_likes';
const STORAGE_DAILY = 'oc_douyin_daily';
const MAX_FEED = 120;

function getMeta() {
  const raw = wx.getStorageSync(STORAGE_META) || {};
  return {
    lastGeneratedAt: Number(raw.lastGeneratedAt) || 0,
    lastPageOpenAt: Number(raw.lastPageOpenAt) || 0,
    generating: !!raw.generating
  };
}

function setMeta(patch) {
  const next = Object.assign({}, getMeta(), patch || {});
  wx.setStorageSync(STORAGE_META, next);
  return next;
}

function getFeed() {
  const raw = wx.getStorageSync(STORAGE_FEED) || [];
  return Array.isArray(raw) ? raw : [];
}

function saveFeed(list) {
  const next = (list || []).slice(0, MAX_FEED);
  wx.setStorageSync(STORAGE_FEED, next);
  return next;
}

function newClipId() {
  return 'dy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function appendClips(clips) {
  const list = getFeed();
  const next = (clips || []).concat(list).slice(0, MAX_FEED);
  saveFeed(next);
  return next;
}

function getLikesMap() {
  const raw = wx.getStorageSync(STORAGE_LIKES) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function toggleLike(clipId) {
  const id = String(clipId || '');
  if (!id) return false;
  const map = getLikesMap();
  const liked = !map[id];
  if (liked) map[id] = Date.now();
  else delete map[id];
  wx.setStorageSync(STORAGE_LIKES, map);
  return liked;
}

function isLiked(clipId) {
  return !!getLikesMap()[String(clipId || '')];
}

function getDailyMap() {
  const raw = wx.getStorageSync(STORAGE_DAILY) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function setDailyMap(map) {
  wx.setStorageSync(STORAGE_DAILY, map || {});
}

function getOcUsedImageIdsToday(ocId, dateKey) {
  const map = getDailyMap();
  const day = map[dateKey] || {};
  const row = day[ocId] || {};
  return Array.isArray(row.imageIds) ? row.imageIds.slice() : [];
}

function markOcImagesUsed(ocId, imageIds, dateKey) {
  const map = getDailyMap();
  if (!map[dateKey]) map[dateKey] = {};
  const prev = map[dateKey][ocId] || { imageIds: [], count: 0 };
  const set = {};
  (prev.imageIds || []).forEach((id) => {
    set[id] = true;
  });
  (imageIds || []).forEach((id) => {
    if (id) set[id] = true;
  });
  const ids = Object.keys(set);
  map[dateKey][ocId] = { imageIds: ids, count: ids.length };
  // 只留近 3 天
  const keys = Object.keys(map).sort();
  while (keys.length > 3) {
    delete map[keys.shift()];
  }
  setDailyMap(map);
}

function prepareFeedForDisplay(feed) {
  return (feed || []).map((item) => {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    return Object.assign({}, item, {
      liked: isLiked(item.id),
      tagText: tags.map((t) => (String(t).indexOf('#') === 0 ? t : '#' + t)).join(' ')
    });
  });
}

module.exports = {
  getMeta,
  setMeta,
  getFeed,
  saveFeed,
  appendClips,
  newClipId,
  toggleLike,
  isLiked,
  getOcUsedImageIdsToday,
  markOcImagesUsed,
  prepareFeedForDisplay,
  MAX_FEED
};
