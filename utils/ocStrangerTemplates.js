/**
 * 路人评论热梗模板：云端定期更新，本地缓存
 */
const STORAGE_KEY = 'oc_stranger_templates_cache_v1';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let _inflight = null;

function readCache() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (_) {}
  return null;
}

function writeCache(data) {
  try {
    wx.setStorageSync(STORAGE_KEY, data || {});
  } catch (_) {}
}

function getCachedLists() {
  const c = readCache() || {};
  return {
    comments: Array.isArray(c.comments) ? c.comments : [],
    replies: Array.isArray(c.replies) ? c.replies : []
  };
}

function syncTemplates(force) {
  const cached = readCache();
  const age = cached && cached.syncedAt ? Date.now() - Number(cached.syncedAt) : Infinity;
  if (!force && age < CACHE_TTL_MS && cached && cached.comments && cached.comments.length) {
    return Promise.resolve(getCachedLists());
  }
  if (_inflight) return _inflight;
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve(getCachedLists());
  }
  _inflight = wx.cloud
    .callFunction({
      name: 'manageStrangerTemplates',
      data: { action: 'list' },
      timeout: 12000
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) return getCachedLists();
      const next = {
        comments: Array.isArray(r.comments) ? r.comments : [],
        replies: Array.isArray(r.replies) ? r.replies : [],
        weekTag: r.weekTag || '',
        syncedAt: Date.now()
      };
      writeCache(next);
      return {
        comments: next.comments,
        replies: next.replies
      };
    })
    .catch(() => getCachedLists())
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

function commentDedupeKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、…~.!~*（）()【】\[\]「」""''：:；;·\-—_❤♡💕🔥😂🤣😆]/g, '')
    .slice(0, 28);
}

function isNearDupComment(text, usedMap) {
  const key = commentDedupeKey(text);
  if (!key || key.length < 4) return true;
  if (!usedMap) return false;
  if (usedMap[key]) return true;
  const prefix = key.slice(0, Math.min(10, key.length));
  const keys = Object.keys(usedMap);
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    if (!a) continue;
    if (a.indexOf(prefix) === 0 || key.indexOf(a.slice(0, Math.min(10, a.length))) === 0) {
      return true;
    }
  }
  return false;
}

function markUsedComment(text, usedMap) {
  if (!usedMap) return;
  const key = commentDedupeKey(text);
  if (key) usedMap[key] = true;
}

/**
 * @param {string[]} list
 * @param {string[]} fallbackPool
 * @param {Record<string, boolean>} [usedMap] 已用文案去重表
 */
function pickFrom(list, fallbackPool, usedMap) {
  const primary = (list && list.length ? list : []) || [];
  const fallback = (fallbackPool && fallbackPool.length ? fallbackPool : []) || [];
  const pools = primary.length ? [primary, fallback] : [fallback];
  for (let p = 0; p < pools.length; p++) {
    const pool = pools[p];
    if (!pool.length) continue;
    const unused = usedMap
      ? pool.filter((x) => x && !isNearDupComment(x, usedMap))
      : pool.filter(Boolean);
    const pickPool = unused.length ? unused : pool;
    if (!pickPool.length) continue;
    const line = pickPool[Math.floor(Math.random() * pickPool.length)];
    if (line) {
      markUsedComment(line, usedMap);
      return line;
    }
  }
  return '';
}

module.exports = {
  syncTemplates,
  getCachedLists,
  pickFrom,
  commentDedupeKey,
  isNearDupComment,
  markUsedComment
};
