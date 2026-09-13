const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_FAVORITES_BACKUP = 'oc_favorites_backup';
const STORAGE_FAVORITES_META = 'oc_favorites_meta';

function readRawFavorites() {
  let list = wx.getStorageSync(STORAGE_FAVORITES);
  if (Array.isArray(list)) return list.slice();
  const backup = wx.getStorageSync(STORAGE_FAVORITES_BACKUP);
  if (Array.isArray(backup) && backup.length) {
    let restored = backup.slice();
    try {
      restored = require('./ocDeletedIds.js').filterFavorites(restored);
    } catch (_) {}
    try {
      wx.setStorageSync(STORAGE_FAVORITES, restored);
    } catch (e) {}
    return restored;
  }
  return [];
}

function safeGetFavorites() {
  let list = readRawFavorites();
  try {
    const tomb = require('./ocDeletedIds.js');
    list = tomb.filterFavorites(list);
  } catch (_) {}
  return list;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.allowShrink] 允许条目变少（删除时）
 */
function persistFavoritesList(list) {
  // 覆盖大 key 时微信按「旧+新」计容量。先尝试直接覆盖；失败再腾出备份/主 key。
  try {
    wx.setStorageSync(STORAGE_FAVORITES, list);
  } catch (e1) {
    try {
      wx.removeStorageSync(STORAGE_FAVORITES_BACKUP);
    } catch (_) {}
    try {
      wx.setStorageSync(STORAGE_FAVORITES, list);
    } catch (e2) {
      try {
        wx.removeStorageSync(STORAGE_FAVORITES);
      } catch (_) {}
      wx.setStorageSync(STORAGE_FAVORITES, list);
    }
  }
  wx.setStorageSync(STORAGE_FAVORITES_META, {
    count: list.length,
    updatedAt: Date.now()
  });
  try {
    wx.setStorageSync(STORAGE_FAVORITES_BACKUP, list);
  } catch (_) {}
}

function safeSetFavorites(list, options) {
  if (!Array.isArray(list)) return false;
  const opts = options || {};
  let next = list;
  try {
    next = require('./ocDeletedIds.js').filterFavorites(list);
  } catch (_) {}
  const prevRaw = readRawFavorites();
  let prevVisible = prevRaw;
  try {
    prevVisible = require('./ocDeletedIds.js').filterFavorites(prevRaw);
  } catch (_) {}
  if (!opts.allowShrink && prevVisible.length > 0 && next.length < prevVisible.length) {
    console.warn('[favoriteStore] blocked shrink write', prevVisible.length, '->', next.length);
    return false;
  }
  try {
    persistFavoritesList(next);
    try {
      const sync = require('./userDataSync.js');
      if (!sync.isApplyingCloud()) {
        if (typeof sync.markNotebookDirty === 'function') sync.markNotebookDirty();
        sync.schedulePushNotebook();
      }
    } catch (_) {}
    return true;
  } catch (err) {
    console.error('[favoriteStore] setStorage failed', err);
    try {
      persistFavoritesList(next);
      return true;
    } catch (e2) {
      console.error('[favoriteStore] retry failed', e2);
    }
    const msg = String((err && (err.errMsg || err.message)) || err || '');
    if (/exceed|quota|limit|最大|上限|space|storage/i.test(msg)) {
      try {
        const clean = require('./ocLocalStorageClean.js');
        if (typeof clean.promptStorageCleanup === 'function') {
          clean.promptStorageCleanup({
            message:
              '设定本数据写入失败：本地存储已满。请清理自定义 BGM、未引用缓存，或删除不用的立绘/OC 后重试。'
          });
        } else {
          wx.showToast({
            title: '本地存储已满，请删除不用的 OC 或图片后重试',
            icon: 'none',
            duration: 3200
          });
        }
      } catch (_) {
        try {
          wx.showToast({
            title: '本地存储已满，请删除不用的 OC 或图片后重试',
            icon: 'none',
            duration: 3200
          });
        } catch (__) {}
      }
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
  // 启动时合并设定本同名重复项（同一角色被反复存成多条）
  try {
    const fav = require('./favorite.js');
    if (typeof fav.consolidateFavoriteDuplicatesByName === 'function') {
      fav.consolidateFavoriteDuplicatesByName();
    }
  } catch (_) {}
}

function restoreFavoritesFromBackup(options) {
  const opts = options || {};
  let backup = [];
  try {
    backup = wx.getStorageSync(STORAGE_FAVORITES_BACKUP);
  } catch (_) {
    backup = [];
  }
  if (!Array.isArray(backup) || !backup.length) {
    return { ok: false, errMsg: '没有可用的本地备份' };
  }
  try {
    backup = require('./ocDeletedIds.js').filterFavorites(backup);
  } catch (_) {}
  const cur = safeGetFavorites();
  if (!opts.force && cur.length >= backup.length) {
    return {
      ok: false,
      errMsg: '当前设定本条目不少于备份（' + cur.length + '/' + backup.length + '），无需恢复'
    };
  }
  const ok = safeSetFavorites(backup, { allowShrink: true });
  if (!ok) {
    return { ok: false, errMsg: '恢复失败：本地存储不足' };
  }
  return { ok: true, count: backup.length };
}

function getFavoritesBackupMeta() {
  let backup = [];
  try {
    backup = wx.getStorageSync(STORAGE_FAVORITES_BACKUP);
  } catch (_) {
    backup = [];
  }
  const meta = wx.getStorageSync(STORAGE_FAVORITES_META) || {};
  return {
    backupCount: Array.isArray(backup) ? backup.length : 0,
    currentCount: safeGetFavorites().length,
    updatedAt: meta && meta.updatedAt ? Number(meta.updatedAt) || 0 : 0
  };
}

module.exports = {
  STORAGE_FAVORITES,
  STORAGE_FAVORITES_BACKUP,
  readRawFavorites,
  safeGetFavorites,
  safeSetFavorites,
  repairFavoritesOnLaunch,
  restoreFavoritesFromBackup,
  getFavoritesBackupMeta
};
