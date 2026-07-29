const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_FAVORITES_BACKUP = 'oc_favorites_backup';
const STORAGE_FAVORITES_META = 'oc_favorites_meta';

function safeGetFavorites() {
  let list = wx.getStorageSync(STORAGE_FAVORITES);
  if (Array.isArray(list)) return list.slice();
  const backup = wx.getStorageSync(STORAGE_FAVORITES_BACKUP);
  if (Array.isArray(backup) && backup.length) {
    try {
      wx.setStorageSync(STORAGE_FAVORITES, backup);
    } catch (e) {}
    return backup.slice();
  }
  return [];
}

/**
 * @param {object} [options]
 * @param {boolean} [options.allowShrink] 允许条目变少（删除时）
 */
function safeSetFavorites(list, options) {
  if (!Array.isArray(list)) return false;
  const opts = options || {};
  const prev = safeGetFavorites();
  if (!opts.allowShrink && prev.length > 0 && list.length < prev.length) {
    console.warn('[favoriteStore] blocked shrink write', prev.length, '->', list.length);
    return false;
  }
  try {
    if (prev.length) {
      wx.setStorageSync(STORAGE_FAVORITES_BACKUP, prev);
    }
    wx.setStorageSync(STORAGE_FAVORITES, list);
    wx.setStorageSync(STORAGE_FAVORITES_META, {
      count: list.length,
      updatedAt: Date.now()
    });
    return true;
  } catch (err) {
    console.error('[favoriteStore] setStorage failed', err);
    const msg = String((err && (err.errMsg || err.message)) || err || '');
    if (/exceed|quota|limit|最大|上限|space|storage/i.test(msg)) {
      try {
        wx.showToast({
          title: '本地存储已满，请删除不用的 OC 或图片后重试',
          icon: 'none',
          duration: 3200
        });
      } catch (_) {}
    }
    return false;
  }
}

function repairFavoritesOnLaunch() {
  const list = safeGetFavorites();
  if (!Array.isArray(list)) return;
  const valid = list.filter((item) => item && item.id && item.result);
  if (valid.length !== list.length) {
    safeSetFavorites(valid, { allowShrink: true });
  }
}

module.exports = {
  STORAGE_FAVORITES,
  safeGetFavorites,
  safeSetFavorites,
  repairFavoritesOnLaunch
};
