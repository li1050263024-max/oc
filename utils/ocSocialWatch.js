/**
 * 各 OC APP（朋友圈 / 抖音…）独立「观看 OC」名单
 * 基础 10 人；超出后 10 额度永久 +1（会员与非会员相同）
 */
const { getOcsForSocial } = require('./ocSocialEligible.js');
const { isMember } = require('./ocMembership.js');

const STORAGE_PREFIX = 'oc_social_watch_v1_';
/** 基础观看 OC 上限（不含额度扩容） */
const FREE_WATCH_LIMIT = 10;

const APP_KEYS = {
  moments: 'moments',
  douyin: 'douyin'
};

function normalizeAppKey(appKey) {
  const k = String(appKey || '').trim();
  if (k === 'moments' || k === 'douyin') return k;
  return '';
}

function storageKey(appKey) {
  return STORAGE_PREFIX + normalizeAppKey(appKey);
}

/** @param {boolean=} member 已废弃，会员不再额外扩容 */
function getWatchLimit(member) {
  try {
    const ent = require('./ocEntitlements.js');
    return ent.getWatchLimitWithBonus('', false);
  } catch (_) {}
  return FREE_WATCH_LIMIT;
}

function getWatchLimitForApp(appKey, member) {
  const key = normalizeAppKey(appKey);
  try {
    const ent = require('./ocEntitlements.js');
    return ent.getWatchLimitWithBonus(key, false);
  } catch (_) {}
  return FREE_WATCH_LIMIT;
}

function readWatchIds(appKey) {
  const key = normalizeAppKey(appKey);
  if (!key) return [];
  try {
    const raw = wx.getStorageSync(storageKey(key));
    if (Array.isArray(raw)) return raw.map((id) => String(id || '').trim()).filter(Boolean);
    if (raw && Array.isArray(raw.ocIds)) {
      return raw.ocIds.map((id) => String(id || '').trim()).filter(Boolean);
    }
  } catch (_) {}
  return [];
}

function writeWatchIds(appKey, ocIds) {
  const key = normalizeAppKey(appKey);
  if (!key) return false;
  const ids = [];
  const seen = {};
  (ocIds || []).forEach((id) => {
    const s = String(id || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    ids.push(s);
  });
  try {
    wx.setStorageSync(storageKey(key), { ocIds: ids, updatedAt: Date.now() });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @returns {{ ok: boolean, ocIds: string[], truncated: boolean, limit: number, errMsg?: string }}
 */
function setWatchIds(appKey, ocIds, options) {
  const key = normalizeAppKey(appKey);
  if (!key) {
    return { ok: false, ocIds: [], truncated: false, limit: FREE_WATCH_LIMIT, errMsg: '未知 APP' };
  }
  const limit = getWatchLimitForApp(key, false);
  let ids = [];
  const seen = {};
  (ocIds || []).forEach((id) => {
    const s = String(id || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    ids.push(s);
  });
  let truncated = false;
  if (limit > 0 && ids.length > limit) {
    ids = ids.slice(0, limit);
    truncated = true;
  }
  writeWatchIds(key, ids);
  // 保存观看名单后清冷却，下次进朋友圈/抖音会为新勾选的 OC 补内容
  try {
    if (key === 'douyin') {
      require('./ocDouyinStore.js').setMeta({
        lastGeneratedAt: 0,
        needPageResync: true
      });
    } else if (key === 'moments') {
      require('./ocMomentsStore.js').setMeta({ lastGeneratedAt: 0 });
    }
  } catch (_) {}
  return { ok: true, ocIds: ids, truncated: truncated, limit: limit };
}

function hasWatchConfig(appKey) {
  return readWatchIds(appKey).length > 0;
}

function defaultWatchSlice(list, limit) {
  if (limit > 0 && list.length > limit) return list.slice(0, limit);
  return list;
}

/**
 * 尚未配置时默认前 N 人；已配置时若名单全失效则回退默认。
 */
function filterOcsByWatch(appKey, ocs, options) {
  const list = Array.isArray(ocs) ? ocs : [];
  const key = normalizeAppKey(appKey);
  if (!key || !list.length) return list;
  const configured = readWatchIds(key);
  const limit = getWatchLimitForApp(key, false);
  if (!configured.length) {
    return defaultWatchSlice(list, limit);
  }
  const allow = {};
  configured.forEach((id) => {
    allow[id] = true;
  });
  const filtered = list.filter((oc) => oc && allow[oc.id]);
  if (!filtered.length) {
    return defaultWatchSlice(list, limit);
  }
  return filtered;
}

/**
 * 有小传的新 OC：在观看名单未满时自动勾选，避免「加了 OC 朋友圈不加载」
 */
function syncWatchWithBioOcs(appKey) {
  const key = normalizeAppKey(appKey);
  if (!key) return false;
  const configured = readWatchIds(key);
  if (!configured.length) return false;
  const limit = getWatchLimitForApp(key, false);
  const bioOcs = getOcsForSocial().filter((oc) => oc && oc.hasBio && oc.id);
  const valid = {};
  bioOcs.forEach((oc) => {
    valid[oc.id] = true;
  });
  let next = configured.filter((id) => valid[id]);
  const have = {};
  next.forEach((id) => {
    have[id] = true;
  });
  for (let i = 0; i < bioOcs.length; i++) {
    const id = bioOcs[i].id;
    if (have[id]) continue;
    if (limit > 0 && next.length >= limit) break;
    next.push(id);
    have[id] = true;
  }
  if (next.length === configured.length && next.every((id, i) => id === configured[i])) {
    return false;
  }
  return writeWatchIds(key, next);
}

function getWatchSummary(appKey) {
  const ids = readWatchIds(appKey);
  const limit = getWatchLimitForApp(appKey, false);
  return {
    appKey: normalizeAppKey(appKey),
    count: ids.length,
    ocIds: ids,
    isMember: isMember(),
    limit: limit,
    limitText: limit > 0 ? '最多 ' + limit + ' 人' : '不限人数',
    bonus: (function () {
      try {
        return require('./ocEntitlements.js').getWatchBonus(normalizeAppKey(appKey));
      } catch (_) {
        return 0;
      }
    })()
  };
}

/** 列表展示全部社交 OC；无小传由页面置灰且不可选（再按 id 去重一次） */
function listSelectableOcs(_appKey) {
  const list = getOcsForSocial() || [];
  const seen = {};
  const out = [];
  list.forEach((oc) => {
    if (!oc || !oc.id || seen[oc.id]) return;
    seen[oc.id] = true;
    out.push(oc);
  });
  return out;
}

module.exports = {
  APP_KEYS,
  FREE_WATCH_LIMIT,
  getWatchLimit,
  getWatchLimitForApp,
  readWatchIds,
  writeWatchIds,
  setWatchIds,
  hasWatchConfig,
  filterOcsByWatch,
  syncWatchWithBioOcs,
  getWatchSummary,
  listSelectableOcs
};
