const STORAGE_FEED = 'oc_douyin_feed';
const STORAGE_META = 'oc_douyin_meta';
const STORAGE_LIKES = 'oc_douyin_likes';
const STORAGE_FAVS = 'oc_douyin_favs';
const STORAGE_COMMENTS = 'oc_douyin_comments';
const STORAGE_DAILY = 'oc_douyin_daily';
const MAX_FEED = 120;
const MAX_COMMENTS_PER_CLIP = 80;

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

function findClipById(clipId) {
  const id = String(clipId || '');
  return getFeed().find((c) => c && c.id === id) || null;
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

function getLikeCount(clipId) {
  // 本地仅记录自己是否点赞；展示用伪计数 + 自己
  const clip = findClipById(clipId);
  const base = clip && Number(clip.likeBase) > 0 ? Number(clip.likeBase) : 0;
  return base + (isLiked(clipId) ? 1 : 0);
}

function getFavsMap() {
  const raw = wx.getStorageSync(STORAGE_FAVS) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function toggleFavorite(clipId) {
  const id = String(clipId || '');
  if (!id) return false;
  const map = getFavsMap();
  const fav = !map[id];
  if (fav) map[id] = Date.now();
  else delete map[id];
  wx.setStorageSync(STORAGE_FAVS, map);
  return fav;
}

function isFavorited(clipId) {
  return !!getFavsMap()[String(clipId || '')];
}

function getFavoriteCount(clipId) {
  const clip = findClipById(clipId);
  const base = clip && Number(clip.favBase) > 0 ? Number(clip.favBase) : 0;
  return base + (isFavorited(clipId) ? 1 : 0);
}

function getAllComments() {
  const raw = wx.getStorageSync(STORAGE_COMMENTS) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function getComments(clipId) {
  const list = getAllComments()[String(clipId || '')] || [];
  return Array.isArray(list) ? list : [];
}

function addComment(clipId, text) {
  const id = String(clipId || '');
  const content = String(text || '').trim().slice(0, 200);
  if (!id || !content) return null;
  const all = getAllComments();
  const list = Array.isArray(all[id]) ? all[id].slice() : [];
  const item = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    author: '我',
    content: content,
    createdAt: Date.now()
  };
  list.unshift(item);
  all[id] = list.slice(0, MAX_COMMENTS_PER_CLIP);
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return item;
}

function getCommentCount(clipId) {
  const clip = findClipById(clipId);
  const base = clip && Number(clip.commentBase) > 0 ? Number(clip.commentBase) : 0;
  return base + getComments(clipId).length;
}

function formatCount(n) {
  const num = Math.max(0, Number(n) || 0);
  if (num < 10000) return String(num || '');
  return (num / 10000).toFixed(1).replace(/\.0$/, '') + '万';
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
  const keys = Object.keys(map).sort();
  while (keys.length > 3) {
    delete map[keys.shift()];
  }
  setDailyMap(map);
}

function prepareFeedForDisplay(feed) {
  return (feed || []).map((item) => {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const likeCount = getLikeCount(item.id);
    const commentCount = getCommentCount(item.id);
    const favCount = getFavoriteCount(item.id);
    return Object.assign({}, item, {
      liked: isLiked(item.id),
      favorited: isFavorited(item.id),
      likeCount: likeCount,
      commentCount: commentCount,
      favCount: favCount,
      likeCountText: formatCount(likeCount) || '点赞',
      commentCountText: formatCount(commentCount) || '评论',
      favCountText: formatCount(favCount) || '收藏',
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
  findClipById,
  toggleLike,
  isLiked,
  getLikeCount,
  toggleFavorite,
  isFavorited,
  getFavoriteCount,
  getComments,
  addComment,
  getCommentCount,
  formatCount,
  getOcUsedImageIdsToday,
  markOcImagesUsed,
  prepareFeedForDisplay,
  MAX_FEED
};
