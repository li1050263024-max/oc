/**
 * 合并默认选项池与本地自定义（抽卡 / AI 共用）
 */
const defaultPools = require('../data/pools.js');

const STORAGE_CUSTOM_POOLS = 'oc_custom_pools';
const STORAGE_POOL_HIDDEN = 'oc_pool_item_hidden';
const DEFAULT_POOLS_VERSION = 5;

const POOL_KEYS = [
  'names',
  'races',
  'genders',
  'ages',
  'hairColors',
  'eyeColors',
  'personalities',
  'likes',
  'quirks',
  'worldviews',
  'lifeEvents',
  'origins',
  'catchphrases',
  'presetEvents',
  'attitudes'
];

function clonePools(source) {
  const out = {};
  POOL_KEYS.forEach((key) => {
    out[key] = Array.isArray(source[key]) ? source[key].slice() : [];
  });
  return out;
}

/** 内置默认池（不受本地自定义覆盖） */
function getDefaultPools() {
  return clonePools(defaultPools);
}

/** 完整选项池：默认 + 自定义覆盖 */
function getFullPools() {
  const base = getDefaultPools();
  const custom = wx.getStorageSync(STORAGE_CUSTOM_POOLS);
  if (!custom || typeof custom !== 'object') return base;
  POOL_KEYS.forEach((key) => {
    if (Array.isArray(custom[key]) && custom[key].length > 0) {
      base[key] = custom[key].slice();
    }
  });
  return base;
}

/** 清除自定义与隐藏标记，恢复内置默认 */
function resetToDefaults() {
  wx.removeStorageSync(STORAGE_CUSTOM_POOLS);
  wx.removeStorageSync(STORAGE_POOL_HIDDEN);
  try {
    wx.setStorageSync('oc_pools_version', DEFAULT_POOLS_VERSION);
  } catch (e) {
    /* ignore */
  }
}

function hiddenItemKey(poolKey, text) {
  return `${poolKey}::${text}`;
}

/** 抽卡用池：排除在选项库中标记为隐藏的项 */
function getDrawPools() {
  const full = getFullPools();
  const hiddenMap = wx.getStorageSync(STORAGE_POOL_HIDDEN);
  if (!hiddenMap || typeof hiddenMap !== 'object') return full;
  const out = clonePools(full);
  POOL_KEYS.forEach((key) => {
    out[key] = (out[key] || []).filter((text) => !hiddenMap[hiddenItemKey(key, text)]);
  });
  return out;
}

/** 仅持久化有改动的维度 */
function saveCustomPools(partial) {
  const current = wx.getStorageSync(STORAGE_CUSTOM_POOLS) || {};
  const next = { ...current };
  POOL_KEYS.forEach((key) => {
    if (Array.isArray(partial[key])) {
      next[key] = partial[key].slice();
    }
  });
  wx.setStorageSync(STORAGE_CUSTOM_POOLS, next);
}

/** 向某维度追加不重复项，写入自定义池 */
function appendToPool(key, items) {
  if (!key || !Array.isArray(items) || !items.length) return getFullPools();
  const full = getFullPools();
  const set = new Set(full[key] || []);
  items.forEach((t) => {
    const v = String(t || '').trim();
    if (v) set.add(v);
  });
  full[key] = Array.from(set);
  saveCustomPools({ [key]: full[key] });
  return full;
}

module.exports = {
  POOL_KEYS,
  STORAGE_CUSTOM_POOLS,
  STORAGE_POOL_HIDDEN,
  DEFAULT_POOLS_VERSION,
  getDefaultPools,
  getFullPools,
  getDrawPools,
  resetToDefaults,
  saveCustomPools,
  appendToPool,
  clonePools,
  hiddenItemKey
};
