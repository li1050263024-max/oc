const STORAGE_FEED = 'oc_moments_feed';
const STORAGE_META = 'oc_moments_meta';
const STORAGE_LIKES = 'oc_moments_likes';
const STORAGE_COMMENTS = 'oc_moments_comments';
const STORAGE_COVER = 'oc_moments_cover_path';
const STORAGE_OC_DAILY = 'oc_moments_oc_daily';
const MAX_FEED = 200;

function getMeta() {
  const raw = wx.getStorageSync(STORAGE_META) || {};
  return {
    lastAppOpenAt: raw.lastAppOpenAt || 0,
    lastPageOpenAt: raw.lastPageOpenAt || 0,
    lastGeneratedAt: raw.lastGeneratedAt || 0,
    generating: !!raw.generating
  };
}

function setMeta(patch) {
  const prev = getMeta();
  wx.setStorageSync(STORAGE_META, Object.assign({}, prev, patch || {}));
}

function getMomentsFeed() {
  const raw = wx.getStorageSync(STORAGE_FEED) || [];
  if (!Array.isArray(raw)) return [];
  return raw.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function saveMomentsFeed(feed) {
  wx.setStorageSync(STORAGE_FEED, (feed || []).slice(0, MAX_FEED));
}

function appendMoments(posts) {
  const list = Array.isArray(posts) ? posts.filter(Boolean) : [];
  if (!list.length) return;
  const feed = getMomentsFeed();
  list.forEach((p) => feed.unshift(p));
  feed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  saveMomentsFeed(feed);
}

function newPostId() {
  return 'mp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function newCommentId() {
  return 'mc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function getLikesMap() {
  const raw = wx.getStorageSync(STORAGE_LIKES) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function saveLikesMap(map) {
  wx.setStorageSync(STORAGE_LIKES, map || {});
}

function getCommentsMap() {
  const raw = wx.getStorageSync(STORAGE_COMMENTS) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function saveCommentsMap(map) {
  wx.setStorageSync(STORAGE_COMMENTS, map || {});
}

function togglePostLike(postId) {
  if (!postId) return { liked: false, likeCount: 0 };
  const map = getLikesMap();
  const hit = map[postId] || { liked: false, count: 0 };
  if (hit.liked) {
    hit.liked = false;
    hit.count = Math.max(0, (hit.count || 1) - 1);
  } else {
    hit.liked = true;
    hit.count = (hit.count || 0) + 1;
  }
  map[postId] = hit;
  saveLikesMap(map);
  return { liked: hit.liked, likeCount: hit.count };
}

function normalizeCommentContent(text) {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (/^\s*\{/.test(raw) && raw.indexOf('"content"') >= 0) {
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.content != null) {
        raw = String(obj.content).trim();
      }
    } catch (e) {
      const m = raw.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m && m[1]) {
        try {
          raw = JSON.parse('"' + m[1] + '"');
        } catch (e2) {
          raw = m[1].replace(/\\"/g, '"');
        }
      }
    }
  }
  return raw.replace(/^[\s"'「『]+|[\s"'」』]+$/g, '').slice(0, 300);
}

function addPostComment(postId, content, authorName, extra) {
  const text = normalizeCommentContent(content);
  if (!postId || !text) return null;
  const opts = extra || {};
  const map = getCommentsMap();
  const list = Array.isArray(map[postId]) ? map[postId].slice() : [];
  const item = {
    id: newCommentId(),
    authorName: authorName || '我',
    authorType: opts.authorType || 'user',
    ocId: opts.ocId || '',
    content: text.slice(0, 300),
    createdAt: Date.now()
  };
  list.push(item);
  map[postId] = list;
  saveCommentsMap(map);
  return item;
}

function addOcPostComment(postId, content, oc) {
  if (!oc) return null;
  return addPostComment(postId, content, oc.name || 'OC', {
    authorType: 'oc',
    ocId: oc.id || ''
  });
}

function getCommentsForPost(postId) {
  if (!postId) return [];
  const map = getCommentsMap();
  return Array.isArray(map[postId]) ? map[postId].slice() : [];
}

function findPostById(postId) {
  if (!postId) return null;
  const feed = getMomentsFeed();
  for (let i = 0; i < feed.length; i++) {
    if (feed[i].id === postId) return feed[i];
  }
  return null;
}

function addUserMomentPost(content, invitedOcIds) {
  const text = String(content || '').trim();
  if (!text) return null;
  const ids = Array.isArray(invitedOcIds)
    ? invitedOcIds.filter(Boolean).slice(0, 5)
    : [];
  const post = {
    id: newPostId(),
    ocId: '',
    ocName: '我',
    authorType: 'user',
    avatarUrl: '',
    content: text.slice(0, 500),
    createdAt: Date.now(),
    source: 'user',
    invitedOcIds: ids
  };
  appendMoments([post]);
  return post;
}

function getCoverPath() {
  return wx.getStorageSync(STORAGE_COVER) || '';
}

function setCoverPath(path) {
  if (path) wx.setStorageSync(STORAGE_COVER, path);
  else {
    try {
      wx.removeStorageSync(STORAGE_COVER);
    } catch (e) {}
  }
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function localDateKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function countOcPostsToday(ocId, now) {
  const id = String(ocId || '').trim();
  if (!id) return 0;
  const key = localDateKey(now);
  const feed = getMomentsFeed();
  let n = 0;
  for (let i = 0; i < feed.length; i++) {
    const p = feed[i];
    if (!p || p.authorType === 'user' || p.ocId !== id) continue;
    if (localDateKey(p.createdAt) === key) n += 1;
  }
  return n;
}

function getOcDailyMap() {
  const raw = wx.getStorageSync(STORAGE_OC_DAILY) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function saveOcDailyMap(map) {
  wx.setStorageSync(STORAGE_OC_DAILY, map || {});
}

function getOcDailyMomentTarget(ocId, now) {
  const id = String(ocId || '').trim();
  if (!id) return 1;
  const key = localDateKey(now);
  const map = getOcDailyMap();
  const hit = map[id];
  if (hit && hit.dateKey === key) {
    const t = Number(hit.target) || 1;
    return t >= 1 && t <= 2 ? t : 1;
  }
  const target = 1 + Math.floor(Math.random() * 2);
  map[id] = { dateKey: key, target };
  saveOcDailyMap(map);
  return target;
}

function ocMomentsRemainingToday(ocId, now) {
  const target = getOcDailyMomentTarget(ocId, now);
  return Math.max(0, target - countOcPostsToday(ocId, now));
}

function getOcTodayPostContents(ocId, now) {
  const id = String(ocId || '').trim();
  if (!id) return [];
  const key = localDateKey(now);
  const out = [];
  const feed = getMomentsFeed();
  for (let i = 0; i < feed.length; i++) {
    const p = feed[i];
    if (!p || p.authorType === 'user' || p.ocId !== id) continue;
    if (localDateKey(p.createdAt) === key && p.content) {
      out.push(String(p.content).trim());
    }
  }
  return out;
}

function planOcsForMomentsGeneration(ocs, now) {
  const t = Number(now) || Date.now();
  return (ocs || [])
    .map((oc) => {
      if (!oc || !oc.id) return null;
      const count = ocMomentsRemainingToday(oc.id, t);
      return count > 0 ? { oc, count } : null;
    })
    .filter(Boolean);
}

function ocPostedToday(ocId, now) {
  return ocMomentsRemainingToday(ocId, now) <= 0;
}

function filterOcsNotPostedToday(ocs, now) {
  return planOcsForMomentsGeneration(ocs, now).map((x) => x.oc);
}

function buildTodayMomentTimestamps(count, now) {
  const n = Math.max(1, Number(count) || 1);
  const t = Number(now) || Date.now();
  const base = new Date(t);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const d = base.getDate();
  const end = Math.min(
    t - 60000,
    new Date(y, mo, d, 23, 30, 0).getTime()
  );
  let start = new Date(y, mo, d, 9, 0, 0).getTime();
  if (start >= end) {
    start = end - Math.max(3600000, n * 45 * 60000);
  }
  const span = Math.max(600000, end - start);
  const times = [];
  for (let i = 0; i < n; i++) {
    const frac = (i + 1) / (n + 1);
    const jitter = Math.floor(Math.random() * 120000) - 60000;
    times.push(Math.min(end, Math.max(start, start + Math.floor(span * frac) + jitter)));
  }
  times.sort((a, b) => b - a);
  for (let i = 1; i < times.length; i++) {
    if (times[i - 1] - times[i] < 30 * 60000) {
      times[i] = Math.max(start, times[i - 1] - 30 * 60000 - Math.floor(Math.random() * 600000));
    }
  }
  return times;
}

function formatMomentTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function buildFakeTimestamps(count, appOpenTime, lastOpenTime) {
  const n = Math.max(1, Number(count) || 1);
  const open = Number(appOpenTime) || Date.now();
  const last = Number(lastOpenTime) || open - 6 * 3600000;
  const end = open - 60000 - Math.floor(Math.random() * 180000);
  const windowMs = Math.min(14 * 3600000, Math.max(2 * 3600000, n * 25 * 60000));
  const start = Math.max(last + 120000, end - windowMs);
  if (start >= end) {
    return Array.from({ length: n }, (_, i) => end - i * 120000);
  }
  const span = end - start;
  const times = [];
  for (let i = 0; i < n; i++) {
    const base = start + Math.floor((span * (i + 1)) / (n + 1));
    const jitter = Math.floor(Math.random() * 240000) - 120000;
    times.push(Math.min(end, Math.max(start, base + jitter)));
  }
  times.sort((a, b) => b - a);
  for (let i = 1; i < times.length; i++) {
    if (times[i - 1] - times[i] < 90000) {
      times[i] = Math.max(start, times[i - 1] - 90000 - Math.floor(Math.random() * 60000));
    }
  }
  return times;
}

function prepareFeedForDisplay(feed, userAvatarUrl) {
  const likes = getLikesMap();
  const comments = getCommentsMap();
  return (feed || []).map((item) => {
    const name = item.authorType === 'user' ? '我' : item.ocName || 'OC';
    const likeHit = likes[item.id] || { liked: false, count: 0 };
    const commentList = (comments[item.id] || []).map((c) =>
      Object.assign({}, c, {
        content: normalizeCommentContent(c.content),
        timeLabel: formatMomentTime(c.createdAt)
      })
    );
    const isUser = item.authorType === 'user';
    return Object.assign({}, item, {
      timeLabel: formatMomentTime(item.createdAt),
      avatarLetter: name.slice(0, 1) || (isUser ? '我' : 'O'),
      displayName: name,
      isUserPost: isUser,
      likeCount: likeHit.count || 0,
      liked: !!likeHit.liked,
      comments: commentList,
      commentCount: commentList.length,
      avatarDisplay: isUser ? userAvatarUrl || '' : item.avatarDisplay || ''
    });
  });
}

module.exports = {
  getMeta,
  setMeta,
  getMomentsFeed,
  saveMomentsFeed,
  appendMoments,
  newPostId,
  formatMomentTime,
  buildFakeTimestamps,
  prepareFeedForDisplay,
  togglePostLike,
  addPostComment,
  addOcPostComment,
  getCommentsForPost,
  findPostById,
  normalizeCommentContent,
  addUserMomentPost,
  getCoverPath,
  setCoverPath,
  localDateKey,
  ocPostedToday,
  filterOcsNotPostedToday,
  planOcsForMomentsGeneration,
  countOcPostsToday,
  getOcTodayPostContents,
  buildTodayMomentTimestamps
};
