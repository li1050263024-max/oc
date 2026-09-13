/**
 * 云端功能开关（oc_app_config / app_features）
 * 目前：图片内容审核 imgSecCheckEnabled
 */
const STORAGE_KEY = 'oc_app_features_cache_v1';

const DEFAULT_FEATURES = {
  /** 默认关闭，避免上传变慢；后台可打开 */
  imgSecCheckEnabled: false
};

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    imgSecCheckEnabled:
      src.imgSecCheckEnabled === true ||
      src.imgSecCheckEnabled === 1 ||
      src.imgSecCheckEnabled === '1'
  };
}

function readCache() {
  try {
    return normalize(wx.getStorageSync(STORAGE_KEY));
  } catch (_) {
    return normalize(DEFAULT_FEATURES);
  }
}

function writeCache(row) {
  const next = normalize(row);
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (_) {}
  return next;
}

function getFeatures() {
  return readCache();
}

function isImgSecCheckEnabled() {
  return !!readCache().imgSecCheckEnabled;
}

/** 与 getAppConfig 一并拉取；也可单独调 */
function syncFeatures() {
  const { callCloudFunction } = require('./cloudInit.js');
  return callCloudFunction({
    name: 'redeemCode',
    data: { action: 'getAppConfig' },
    timeout: 15000
  })
    .then((res) => {
      const data = (res && res.result) || {};
      if (!data.ok) return getFeatures();
      if (data.features) return writeCache(data.features);
      // 旧云函数无 features 字段时保持关闭，避免误开拖慢上传
      return writeCache({ imgSecCheckEnabled: false });
    })
    .catch(() => getFeatures());
}

module.exports = {
  DEFAULT_FEATURES,
  getFeatures,
  writeCache,
  syncFeatures,
  isImgSecCheckEnabled,
  normalize
};
