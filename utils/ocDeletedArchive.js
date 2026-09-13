/**
 * 已删除 OC 快照（本地 + 随设定本上云）
 * 仅保留 7 天，供「恢复备份」找回。
 */
const KEY = 'oc_deleted_archive_v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX = 80;

function readRaw() {
  try {
    const raw = wx.getStorageSync(KEY);
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return [];
}

function prune(list) {
  const now = Date.now();
  const seen = {};
  const out = [];
  (list || []).forEach((e) => {
    if (!e || !e.id || !e.item) return;
    const id = String(e.id);
    if (seen[id]) return;
    const deletedAt = Number(e.deletedAt) || 0;
    if (deletedAt && now - deletedAt >= TTL_MS) return;
    seen[id] = true;
    out.push({
      id: id,
      deletedAt: deletedAt || now,
      item: e.item
    });
  });
  return out.slice(-MAX);
}

function write(list) {
  const next = prune(list);
  try {
    wx.setStorageSync(KEY, next);
    return true;
  } catch (_) {
    try {
      wx.removeStorageSync(KEY);
      wx.setStorageSync(KEY, next);
      return true;
    } catch (__) {
      return false;
    }
  }
}

function getArchive() {
  return prune(readRaw());
}

function addDeletedItems(items) {
  const map = {};
  getArchive().forEach((e) => {
    map[e.id] = e;
  });
  const now = Date.now();
  (items || []).forEach((item) => {
    if (!item || !item.id) return;
    const id = String(item.id);
    map[id] = { id: id, deletedAt: now, item: item };
  });
  write(Object.keys(map).map((k) => map[k]));
  return getArchive();
}

function removeIds(ids) {
  const drop = {};
  (ids || []).forEach((id) => {
    const s = String(id || '').trim();
    if (s) drop[s] = true;
  });
  if (!Object.keys(drop).length) return getArchive();
  write(getArchive().filter((e) => e && !drop[e.id]));
  return getArchive();
}

function getById(ocId) {
  const id = String(ocId || '').trim();
  if (!id) return null;
  return getArchive().find((e) => e && e.id === id) || null;
}

function daysLeft(deletedAt) {
  const left = TTL_MS - (Date.now() - (Number(deletedAt) || 0));
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

function mergeFromCloud(entries) {
  const map = {};
  getArchive().forEach((e) => {
    map[e.id] = e;
  });
  (entries || []).forEach((e) => {
    if (!e || !e.id || !e.item) return;
    const id = String(e.id);
    const prev = map[id];
    const deletedAt = Number(e.deletedAt) || Date.now();
    if (!prev || deletedAt >= Number(prev.deletedAt || 0)) {
      map[id] = { id: id, deletedAt: deletedAt, item: e.item };
    }
  });
  write(Object.keys(map).map((k) => map[k]));
  return getArchive();
}

module.exports = {
  TTL_MS,
  getArchive,
  addDeletedItems,
  removeIds,
  getById,
  daysLeft,
  prune,
  mergeFromCloud
};
