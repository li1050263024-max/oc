const STORAGE_FEED = 'oc_douyin_feed';
const STORAGE_META = 'oc_douyin_meta';
const STORAGE_LIKES = 'oc_douyin_likes';
const STORAGE_FAVS = 'oc_douyin_favs';
const STORAGE_COMMENTS = 'oc_douyin_comments';
const STORAGE_DAILY = 'oc_douyin_daily';
const STORAGE_PROFILES = 'oc_douyin_profiles';
/** 已发图册台账：非会员信息流只留 10 条时，仍据此判断「图册是否更新」 */
const STORAGE_ALBUM_LEDGER = 'oc_douyin_album_ledger';
const MAX_FEED = 120;
/** 非会员抖音信息流最多展示/保存条数 */
const FREE_FEED_LIMIT = 10;
/** 会员抖音信息流最多展示/保存条数 */
const VIP_FEED_LIMIT = 50;
const MAX_COMMENTS_PER_CLIP = 80;

const ocDouyinIp = require('./ocDouyinIp.js');

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded01(seed) {
  const x = Math.sin(hashStr(seed) + 0.5) * 10000;
  return x - Math.floor(x);
}

/** 获赞：约两千～两百五十万，对数均匀，结果稳定可复现 */
function seedLikeBase(clipId) {
  const r = seeded01(String(clipId || '') + '_like');
  const min = Math.log(2000);
  const max = Math.log(2500000);
  return Math.max(2000, Math.floor(Math.exp(min + r * (max - min))));
}

/**
 * 评论基数 = 获赞 / 缩减倍数；倍数 15～50，获赞越高倍数越大
 */
function commentBaseFromLikes(likeBase, clipId) {
  const likes = Math.max(1, Number(likeBase) || 1);
  const t = Math.min(
    1,
    Math.max(0, (Math.log(likes) - Math.log(2000)) / (Math.log(2500000) - Math.log(2000)))
  );
  const divisor = 15 + Math.floor(t * 35);
  const jitter = 0.85 + seeded01(String(clipId || '') + '_cmt') * 0.3;
  return Math.max(1, Math.floor((likes / divisor) * jitter));
}

function favBaseFromLikes(likeBase, clipId) {
  const likes = Math.max(1, Number(likeBase) || 1);
  const div = 25 + Math.floor(seeded01(String(clipId || '') + '_fav') * 45);
  return Math.max(1, Math.floor(likes / div));
}

function seedEngagement(clipId) {
  const likeBase = seedLikeBase(clipId);
  return {
    likeBase: likeBase,
    commentBase: commentBaseFromLikes(likeBase, clipId),
    favBase: favBaseFromLikes(likeBase, clipId)
  };
}

/** 旧数据获赞过小时升级为抖音量级，并按规则重算评论 */
function ensureClipEngagement(clip) {
  if (!clip || !clip.id) return clip;
  const likeBase = Number(clip.likeBase) || 0;
  if (likeBase >= 2000 && Number(clip.commentBase) > 0) {
    return clip;
  }
  const eng = seedEngagement(clip.id);
  return Object.assign({}, clip, {
    likeBase: eng.likeBase,
    commentBase: eng.commentBase,
    favBase: Number(clip.favBase) >= 1 ? Number(clip.favBase) : eng.favBase
  });
}

function formatDouyinDate(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

function getProfilesMap() {
  const raw = wx.getStorageSync(STORAGE_PROFILES) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function setProfilesMap(map) {
  wx.setStorageSync(STORAGE_PROFILES, map || {});
}

/**
 * @param {string} ocId
 * @param {object} [ocHint] 可选：带 work/bio 的 OC，用于按世界观校正 IP
 */
function getOcProfileCard(ocId, ocHint) {
  const id = String(ocId || '');
  if (!id) {
    return {
      following: 0,
      fans: 0,
      douyinId: '',
      ipRegion: '',
      followed: false,
      followsYou: false,
      mutual: false
    };
  }
  const map = getProfilesMap();
  let row = map[id];
  let dirty = false;
  const loreIp = ocHint ? ocDouyinIp.resolveIpFromOc(ocHint) : '';

  if (!row || typeof row !== 'object') {
    const r1 = seeded01(id + '_follow');
    const r2 = seeded01(id + '_fans');
    row = {
      following: 12 + Math.floor(r1 * 488),
      fans: 80 + Math.floor(r2 * 98000),
      douyinId: String(10000000000 + (hashStr(id) % 89999999999)),
      ipRegion: loreIp || '未知之地',
      ipFromLore: !!loreIp,
      followed: false,
      // 约一半 OC「关注了你」，关注后可变成互关/朋友
      followsYou: seeded01(id + '_follows_you') > 0.45
    };
    dirty = true;
  } else {
    if (typeof row.followsYou === 'undefined') {
      row.followsYou = seeded01(id + '_follows_you') > 0.45;
      dirty = true;
    }
    // 有人设时：始终按世界观/小传校正 IP（可覆盖旧版乱抽的省份）
    if (loreIp && String(row.ipRegion || '') !== loreIp) {
      row.ipRegion = loreIp;
      row.ipFromLore = true;
      dirty = true;
    }
  }
  if (dirty) {
    map[id] = row;
    setProfilesMap(map);
  }
  const followed = !!row.followed;
  const followsYou = !!row.followsYou;
  return {
    following: Number(row.following) || 0,
    fans: Number(row.fans) || 0,
    douyinId: String(row.douyinId || ''),
    ipRegion: String(row.ipRegion || loreIp || '未知之地'),
    followed: followed,
    followsYou: followsYou,
    mutual: followed && followsYou
  };
}

function toggleOcFollow(ocId) {
  const card = getOcProfileCard(ocId);
  return setOcFollow(ocId, !card.followed);
}

function setOcFollow(ocId, followed) {
  const id = String(ocId || '');
  if (!id) return getOcProfileCard('');
  getOcProfileCard(id);
  const map = getProfilesMap();
  const row = Object.assign({}, map[id] || {});
  row.followed = !!followed;
  map[id] = row;
  setProfilesMap(map);
  return getOcProfileCard(id);
}

function getClipsByOcId(ocId) {
  const id = String(ocId || '');
  return getStoredFeed()
    .filter(
      (c) =>
        c &&
        String(c.ocId) === id &&
        !(c.isUserPost || c.authorType === 'user')
    )
    .slice()
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map(ensureClipEngagement);
}

function getUserPosts() {
  return getStoredFeed()
    .filter((c) => c && (c.isUserPost || c.authorType === 'user'))
    .slice()
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map(ensureClipEngagement);
}

function removeClip(clipId) {
  const id = String(clipId || '');
  if (!id) return false;
  const feed = getStoredFeed();
  const next = feed.filter((c) => c && String(c.id) !== id);
  if (next.length === feed.length) return false;
  saveFeed(next);
  try {
    const likes = wx.getStorageSync(STORAGE_LIKES) || {};
    if (likes[id] != null) {
      delete likes[id];
      wx.setStorageSync(STORAGE_LIKES, likes);
    }
  } catch (_) {}
  try {
    const favs = wx.getStorageSync(STORAGE_FAVS) || {};
    if (favs[id] != null) {
      delete favs[id];
      wx.setStorageSync(STORAGE_FAVS, favs);
    }
  } catch (_) {}
  try {
    const comments = wx.getStorageSync(STORAGE_COMMENTS) || {};
    if (comments[id] != null) {
      delete comments[id];
      wx.setStorageSync(STORAGE_COMMENTS, comments);
    }
  } catch (_) {}
  return true;
}

function getOcTotalLikes(ocId) {
  return getClipsByOcId(ocId).reduce((sum, c) => sum + getLikeCount(c.id), 0);
}

function getFeedDisplayLimit() {
  return FREE_FEED_LIMIT;
}

function getMeta() {
  const raw = wx.getStorageSync(STORAGE_META) || {};
  return {
    lastGeneratedAt: Number(raw.lastGeneratedAt) || 0,
    lastPageOpenAt: Number(raw.lastPageOpenAt) || 0,
    generating: !!raw.generating,
    needPageResync: !!raw.needPageResync
  };
}

function setMeta(patch) {
  const prev = wx.getStorageSync(STORAGE_META) || {};
  const next = Object.assign({}, prev, getMeta(), patch || {});
  wx.setStorageSync(STORAGE_META, next);
  return next;
}

/** 按封面图 / 路径去掉重复抖音条（保留靠前的一条） */
function dedupeFeedClips(list) {
  const out = [];
  const seenId = {};
  const seenImg = {};
  const seenPath = {};
  (list || []).forEach((c) => {
    if (!c || !c.id) return;
    const id = String(c.id);
    if (seenId[id]) return;
    const imgId = String(c.imageId || '').trim();
    const imgPath = String(c.imagePath || '').trim().toLowerCase();
    if (imgId && seenImg[imgId]) return;
    if (imgPath && seenPath[imgPath]) return;
    seenId[id] = true;
    if (imgId) seenImg[imgId] = true;
    if (imgPath) seenPath[imgPath] = true;
    out.push(c);
  });
  return out;
}

function sortFeedNewestFirst(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

/** 本地完整信息流（生成/去重用），始终新在前 */
function getStoredFeed() {
  const raw = wx.getStorageSync(STORAGE_FEED) || [];
  return sortFeedNewestFirst(dedupeFeedClips(Array.isArray(raw) ? raw : []));
}

/** 按会员档截断后的展示列表：非会员 10 / 会员 50（新在前） */
function getFeed() {
  return getStoredFeed().slice(0, getFeedDisplayLimit());
}

function albumLedgerKey(ocId, albumId) {
  return String(ocId || '') + '|' + String(albumId || '');
}

function getAlbumLedger() {
  const raw = wx.getStorageSync(STORAGE_ALBUM_LEDGER) || {};
  return raw && typeof raw === 'object' ? raw : {};
}

function getAlbumLedgerEntry(ocId, albumId) {
  const key = albumLedgerKey(ocId, albumId);
  if (!key || key === '|') return null;
  const entry = getAlbumLedger()[key];
  return entry && typeof entry === 'object' ? entry : null;
}

function ocHasAlbumLedger(ocId) {
  const oid = String(ocId || '');
  if (!oid) return false;
  const led = getAlbumLedger();
  const prefix = oid + '|';
  return Object.keys(led).some((k) => k.indexOf(prefix) === 0);
}

function rememberAlbumPost(ocId, albumId, imageIds, at) {
  const key = albumLedgerKey(ocId, albumId);
  if (!key || key === '|') return;
  const prev = getAlbumLedger();
  const old = prev[key] || { at: 0, ids: [] };
  const idSet = {};
  (old.ids || []).concat(imageIds || []).forEach((id) => {
    const s = String(id || '').trim();
    if (s) idSet[s] = true;
  });
  prev[key] = {
    at: Math.max(Number(old.at) || 0, Number(at) || 0),
    ids: Object.keys(idSet).slice(0, 80)
  };
  wx.setStorageSync(STORAGE_ALBUM_LEDGER, prev);
}

function rememberAlbumPostsFromClips(clips) {
  (clips || []).forEach((c) => {
    if (!c || !c.ocId || !c.albumId) return;
    const ids = (c.images || [])
      .map((im) => im && im.id)
      .filter(Boolean)
      .concat(c.imageId ? [c.imageId] : []);
    rememberAlbumPost(c.ocId, c.albumId, ids, c.createdAt);
  });
}

function saveFeed(list) {
  // 非会员只保存最新 10 条，会员最多 50；被裁掉的写入图册台账
  const sorted = sortFeedNewestFirst(dedupeFeedClips(list || []));
  const limit = Math.min(MAX_FEED, getFeedDisplayLimit());
  if (sorted.length > limit) {
    rememberAlbumPostsFromClips(sorted.slice(limit));
  }
  const next = sorted.slice(0, limit);
  wx.setStorageSync(STORAGE_FEED, next);
  return next;
}

/** 当前身份可完整观看的作品 id 集合（非会员=信息流前 N 条） */
function getUnlockedClipIdMap() {
  const map = {};
  getFeed().forEach((c) => {
    if (c && c.id) map[String(c.id)] = true;
  });
  return map;
}

/** 仅信息流当前展示条数内的作品可回看 */
function isClipUnlocked(clipId) {
  const id = String(clipId || '');
  if (!id) return false;
  return !!getUnlockedClipIdMap()[id];
}

function newClipId() {
  return 'dy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function appendClips(clips) {
  const list = getStoredFeed();
  const next = (clips || []).concat(list).slice(0, MAX_FEED);
  saveFeed(next);
  return next;
}

function findClipById(clipId) {
  const id = String(clipId || '');
  return getStoredFeed().find((c) => c && c.id === id) || null;
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
  const clip = ensureClipEngagement(findClipById(clipId));
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
  const clip = ensureClipEngagement(findClipById(clipId));
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
    authorType: 'user',
    content: content,
    createdAt: Date.now()
  };
  list.unshift(item);
  all[id] = list.slice(0, MAX_COMMENTS_PER_CLIP);
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return item;
}

function addOcComment(clipId, text, oc, options) {
  const id = String(clipId || '');
  const content = String(text || '').trim().slice(0, 200);
  if (!id || !content || !oc) return null;
  const opts = options || {};
  const all = getAllComments();
  const list = Array.isArray(all[id]) ? all[id].slice() : [];
  const item = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    author: oc.name || 'OC',
    authorType: 'oc',
    ocId: oc.id || '',
    groupMate: !!opts.groupMate,
    reply: !!opts.reply,
    replyToName: opts.replyToName ? String(opts.replyToName).slice(0, 40) : '',
    replyToOcId: opts.replyToOcId ? String(opts.replyToOcId) : '',
    replyToCommentId: opts.replyToCommentId
      ? String(opts.replyToCommentId)
      : '',
    content: content,
    createdAt: Date.now()
  };
  list.unshift(item);
  all[id] = list.slice(0, MAX_COMMENTS_PER_CLIP);
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return item;
}

/** 首次灌入评论：按给定顺序写入（上到下），不 unshift 打乱群友+回复结构 */
function replaceComments(clipId, comments) {
  const id = String(clipId || '');
  if (!id) return [];
  const all = getAllComments();
  const list = (Array.isArray(comments) ? comments : [])
    .filter((c) => c && String(c.content || '').trim())
    .slice(0, MAX_COMMENTS_PER_CLIP)
    .map((c, i) => ({
      id: c.id || 'c_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 5),
      author: String(c.author || '用户').slice(0, 40),
      authorType: c.authorType || 'stranger',
      ocId: c.ocId || '',
      groupMate: !!c.groupMate,
      reply: !!c.reply,
      replyToName: c.replyToName ? String(c.replyToName).slice(0, 40) : '',
      replyToOcId: c.replyToOcId ? String(c.replyToOcId) : '',
      replyToCommentId: c.replyToCommentId ? String(c.replyToCommentId) : '',
      content: String(c.content || '').trim().slice(0, 200),
      likeCount: Number(c.likeCount) || 0,
      // 灌入评论默认未点赞，只展示点赞数
      liked: false,
      createdAt: Number(c.createdAt) || Date.now() + i
    }));
  all[id] = list;
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return list;
}

function addStrangerComment(clipId, text, authorName) {
  const id = String(clipId || '');
  const content = String(text || '').trim().slice(0, 200);
  if (!id || !content) return null;
  const all = getAllComments();
  const list = Array.isArray(all[id]) ? all[id].slice() : [];
  const item = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    author: String(authorName || '云端路过').slice(0, 20),
    authorType: 'stranger',
    content: content,
    createdAt: Date.now()
  };
  list.unshift(item);
  all[id] = list.slice(0, MAX_COMMENTS_PER_CLIP);
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return item;
}

/** 追加评论到末尾（用于加路人，不打乱已有群友/回复结构） */
function appendComments(clipId, comments) {
  const id = String(clipId || '');
  if (!id) return [];
  const all = getAllComments();
  const list = Array.isArray(all[id]) ? all[id].slice() : [];
  const baseLen = list.length;
  const added = (Array.isArray(comments) ? comments : [])
    .filter((c) => c && String(c.content || '').trim())
    .map((c, i) => ({
      id: c.id || 'c_' + Date.now() + '_' + (baseLen + i) + '_' + Math.random().toString(36).slice(2, 5),
      author: String(c.author || '用户').slice(0, 40),
      authorType: c.authorType || 'stranger',
      ocId: c.ocId || '',
      groupMate: !!c.groupMate,
      reply: !!c.reply,
      replyToName: c.replyToName ? String(c.replyToName).slice(0, 40) : '',
      replyToOcId: c.replyToOcId ? String(c.replyToOcId) : '',
      content: String(c.content || '').trim().slice(0, 200),
      likeCount: Number(c.likeCount) || 0,
      liked: false,
      createdAt: Number(c.createdAt) || Date.now() + i
    }));
  all[id] = list.concat(added).slice(0, MAX_COMMENTS_PER_CLIP);
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return all[id];
}

function countStrangerComments(clipId) {
  const list = getComments(clipId);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].authorType === 'stranger') n += 1;
  }
  return n;
}

function getCommentCount(clipId) {
  const clip = ensureClipEngagement(findClipById(clipId));
  const base = clip && Number(clip.commentBase) > 0 ? Number(clip.commentBase) : 0;
  return base + getComments(clipId).length;
}

function formatCount(n) {
  const num = Math.max(0, Number(n) || 0);
  if (num < 10000) return String(num || 0);
  if (num < 100000000) {
    return (num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
  }
  return (num / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
}

function formatCommentTime(ts) {
  const t = Number(ts) || Date.now();
  const diff = Math.max(0, Date.now() - t);
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 48 * 60 * 60 * 1000) return '昨天';
  const d = new Date(t);
  return d.getMonth() + 1 + '-' + d.getDate();
}

/**
 * 评论展示树：路人/群友/用户为一级；发帖 OC 回复挂到对应一级评论的 replies
 * （修复：对用户「我」的回复此前只挂在 groupMate 上，导致用户评论后看不到作者回复）
 */
function prepareCommentsForDisplay(clipId) {
  const raw = getComments(clipId);
  const tops = [];
  const replyByCommentId = {};
  const replyBuckets = {};
  raw.forEach((c) => {
    if (!c) return;
    if (c.reply && c.replyToCommentId) {
      const cid = String(c.replyToCommentId);
      if (!replyByCommentId[cid]) replyByCommentId[cid] = [];
      replyByCommentId[cid].push(c);
      return;
    }
    if (c.reply && (c.replyToOcId || c.replyToName)) {
      const key = String(c.replyToOcId || c.replyToName);
      if (!replyBuckets[key]) replyBuckets[key] = [];
      replyBuckets[key].push(c);
      return;
    }
    tops.push(c);
  });

  const usedBucketKeys = {};

  return tops.map((c, idx) => {
    const letter = String(c.author || '?').slice(0, 1);
    let replies = replyByCommentId[String(c.id || '')] || [];
    if (!replies.length && c.groupMate) {
      const k1 = String(c.ocId || '');
      const k2 = String(c.author || '');
      replies = replyBuckets[k1] || replyBuckets[k2] || [];
      if (k1) usedBucketKeys[k1] = true;
      if (k2) usedBucketKeys[k2] = true;
    }
    if (
      !replies.length &&
      (c.authorType === 'user' || c.author === '我')
    ) {
      const k = '我';
      replies = replyBuckets[k] || replyBuckets[String(c.author || '')] || [];
      // 多条用户评论时，每条只挂尚未用过的回复（按时间一对一）
      if (replies.length > 1 && !usedBucketKeys[k + '_split']) {
        usedBucketKeys[k + '_split'] = true;
      }
      if (replies.length) {
        const pool = replyBuckets[k] || [];
        const next = pool.shift();
        replyBuckets[k] = pool;
        replies = next ? [next] : [];
      }
    }
    replies = (replies || []).map((r) => {
      const rc =
        Number(r.likeCount) > 0
          ? Number(r.likeCount)
          : 1 + Math.floor(Math.random() * 20);
      return Object.assign({}, r, {
        avatarLetter: String(r.author || '?').slice(0, 1),
        timeText: formatCommentTime(r.createdAt),
        // 打开评论区默认未点赞；仅用户点过才为 true
        liked: r.liked === true,
        likeCount: rc,
        likeCountText: formatCount(rc) || String(rc)
      });
    });
    const likeCount =
      Number(c.likeCount) > 0 ? Number(c.likeCount) : 3 + ((idx * 17) % 40);
    return Object.assign({}, c, {
      avatarLetter: letter,
      timeText: formatCommentTime(c.createdAt),
      regionText: c.groupMate ? '群聊' : '',
      likeCount: likeCount,
      likeCountText: formatCount(likeCount) || String(likeCount),
      // 打开时默认空心；勿把生成数据里的真值误当成已点赞
      liked: c.liked === true,
      replies: replies,
      replyCount: replies.length,
      repliesExpanded: replies.length <= 2
    });
  });
}

function toggleCommentLike(clipId, commentId) {
  const id = String(clipId || '');
  const cid = String(commentId || '');
  if (!id || !cid) return null;
  const all = getAllComments();
  const list = Array.isArray(all[id]) ? all[id].slice() : [];
  let hit = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === cid) {
      const liked = !list[i].liked;
      const base = Number(list[i].likeCount) || 0;
      list[i] = Object.assign({}, list[i], {
        liked: liked,
        likeCount: Math.max(0, base + (liked ? 1 : -1))
      });
      hit = list[i];
      break;
    }
  }
  if (!hit) return null;
  all[id] = list;
  wx.setStorageSync(STORAGE_COMMENTS, all);
  return hit;
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
  return (feed || []).map((raw) => {
    const item = ensureClipEngagement(raw);
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const likeCount = getLikeCount(item.id);
    // 展示评论数以「获赞缩减」为主，再叠加真实评论条数
    const commentCount = Math.max(
      commentBaseFromLikes(item.likeBase, item.id),
      getCommentCount(item.id)
    );
    const favCount = getFavoriteCount(item.id);
    const content = String(item.content || '');
    const isUserPost = !!(item.isUserPost || item.authorType === 'user');
    const displayName = isUserPost
      ? String(item.authorName || item.displayName || '我')
      : String(item.ocName || item.authorName || 'OC');
    return Object.assign({}, item, {
      isUserPost: isUserPost,
      displayName: displayName,
      liked: isLiked(item.id),
      favorited: isFavorited(item.id),
      likeCount: likeCount,
      commentCount: commentCount,
      favCount: favCount,
      likeCountText: formatCount(likeCount) || '点赞',
      commentCountText: formatCount(commentCount) || '评论',
      favCountText: formatCount(favCount) || '收藏',
      dateLabel: formatDouyinDate(item.createdAt),
      tagText: tags.map((t) => (String(t).indexOf('#') === 0 ? t : '#' + t)).join(' '),
      contentLong: content.replace(/\s+/g, '').length > 48 || content.split('\n').length > 3
    });
  });
}

function addUserPost(opts) {
  const text = String((opts && opts.text) || '').trim().slice(0, 500);
  const imagePaths = [];
  if (Array.isArray(opts && opts.imagePaths)) {
    opts.imagePaths.forEach((p) => {
      const s = String(p || '').trim();
      if (s) imagePaths.push(s);
    });
  }
  const single = String((opts && opts.imagePath) || '').trim();
  if (single && imagePaths.indexOf(single) < 0) imagePaths.unshift(single);
  if (!text && !imagePaths.length) return null;
  const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const images = imagePaths.slice(0, 9).map((path, i) => ({
    id: 'uimg_' + id + '_' + i,
    path: path,
    src: path
  }));
  const clip = ensureClipEngagement({
    id: id,
    ocId: '',
    ocName: '',
    authorType: 'user',
    isUserPost: true,
    authorName: '我',
    displayName: '我',
    content: text,
    images: images,
    imagePath: images.length ? images[0].path : '',
    imageId: images.length ? images[0].id : '',
    createdAt: Date.now(),
    tags: (opts && opts.tags) || []
  });
  const feed = getStoredFeed();
  feed.unshift(clip);
  saveFeed(feed);
  return clip;
}

module.exports = {
  getMeta,
  setMeta,
  getStoredFeed,
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
  addOcComment,
  addStrangerComment,
  replaceComments,
  appendComments,
  countStrangerComments,
  getCommentCount,
  formatCount,
  formatDouyinDate,
  seedEngagement,
  ensureClipEngagement,
  commentBaseFromLikes,
  getOcUsedImageIdsToday,
  markOcImagesUsed,
  prepareFeedForDisplay,
  prepareCommentsForDisplay,
  addUserPost,
  getUserPosts,
  removeClip,
  toggleCommentLike,
  getOcProfileCard,
  toggleOcFollow,
  setOcFollow,
  getClipsByOcId,
  getOcTotalLikes,
  getFeedDisplayLimit,
  getUnlockedClipIdMap,
  isClipUnlocked,
  getAlbumLedgerEntry,
  ocHasAlbumLedger,
  rememberAlbumPost,
  rememberAlbumPostsFromClips,
  FREE_FEED_LIMIT,
  VIP_FEED_LIMIT,
  MAX_FEED
};
