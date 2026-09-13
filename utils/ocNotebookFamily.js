/**
 * 设定本：收藏 / 置顶 / OC 家族（与关系网无关）
 */
const { safeGetFavorites, safeSetFavorites } = require('./favoriteStore.js');

const STORAGE_FAMILIES = 'oc_notebook_families';

function genId() {
  return Date.now() + '' + Math.random().toString(36).slice(2, 8);
}

function normalizeFamily(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const name = String(raw.name || '').trim() || '未命名家族';
  const memberIds = [];
  const seen = {};
  (Array.isArray(raw.memberIds) ? raw.memberIds : []).forEach((mid) => {
    const s = String(mid || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    memberIds.push(s);
  });
  const familyPinned = !!raw.familyPinned;
  return {
    id,
    name,
    memberIds,
    familyPinned,
    familyPinnedAt: familyPinned ? Number(raw.familyPinnedAt) || 0 : 0,
    time: Number(raw.time) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.time) || Date.now()
  };
}

function sortFamilies(list) {
  const arr = (list || []).slice();
  arr.sort((a, b) => {
    const ap = a && a.familyPinned ? 1 : 0;
    const bp = b && b.familyPinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (ap && bp) {
      return (Number(b.familyPinnedAt) || 0) - (Number(a.familyPinnedAt) || 0);
    }
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  return arr;
}

function getFamilies() {
  const raw = wx.getStorageSync(STORAGE_FAMILIES);
  if (!Array.isArray(raw)) return [];
  return sortFamilies(raw.map(normalizeFamily).filter(Boolean));
}

function setFamilies(list) {
  if (!Array.isArray(list)) return false;
  try {
    wx.setStorageSync(
      STORAGE_FAMILIES,
      list.map(normalizeFamily).filter(Boolean)
    );
    return true;
  } catch (err) {
    console.error('[ocNotebookFamily] setFamilies', err);
    return false;
  }
}

function createFamily(name) {
  const n = String(name || '').trim() || '未命名家族';
  const list = getFamilies();
  const item = {
    id: genId(),
    name: n,
    memberIds: [],
    familyPinned: false,
    familyPinnedAt: 0,
    time: Date.now(),
    updatedAt: Date.now()
  };
  list.unshift(item);
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, family: item };
}

function toggleFamilyPinned(familyId) {
  const id = String(familyId || '').trim();
  if (!id) return { ok: false, errMsg: '无效家族' };
  const list = getFamilies();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, errMsg: '未找到家族' };
  const next = !list[idx].familyPinned;
  list[idx].familyPinned = next;
  list[idx].familyPinnedAt = next ? Date.now() : 0;
  list[idx].updatedAt = Date.now();
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, familyPinned: next, family: list[idx] };
}

function renameFamily(familyId, name) {
  const id = String(familyId || '').trim();
  const n = String(name || '').trim();
  if (!id) return { ok: false, errMsg: '无效家族' };
  if (!n) return { ok: false, errMsg: '名称不能为空' };
  const list = getFamilies();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, errMsg: '未找到家族' };
  list[idx].name = n;
  list[idx].updatedAt = Date.now();
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, family: list[idx] };
}

function deleteFamily(familyId) {
  const id = String(familyId || '').trim();
  if (!id) return false;
  const next = getFamilies().filter((f) => f.id !== id);
  return setFamilies(next);
}

function setFamilyMembers(familyId, memberIds) {
  const id = String(familyId || '').trim();
  if (!id) return { ok: false, errMsg: '无效家族' };
  const list = getFamilies();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, errMsg: '未找到家族' };
  const seen = {};
  const ids = [];
  (memberIds || []).forEach((mid) => {
    const s = String(mid || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    ids.push(s);
  });
  list[idx].memberIds = ids;
  list[idx].updatedAt = Date.now();
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, family: list[idx] };
}

function addMemberToFamily(familyId, ocId) {
  const id = String(familyId || '').trim();
  const oc = String(ocId || '').trim();
  if (!id || !oc) return { ok: false, errMsg: '参数无效' };
  const list = getFamilies();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, errMsg: '未找到家族' };
  if (list[idx].memberIds.indexOf(oc) >= 0) {
    return { ok: true, family: list[idx], already: true };
  }
  list[idx].memberIds = list[idx].memberIds.concat([oc]);
  list[idx].updatedAt = Date.now();
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, family: list[idx] };
}

function removeMemberFromFamily(familyId, ocId) {
  const id = String(familyId || '').trim();
  const oc = String(ocId || '').trim();
  if (!id || !oc) return { ok: false, errMsg: '参数无效' };
  const list = getFamilies();
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, errMsg: '未找到家族' };
  list[idx].memberIds = list[idx].memberIds.filter((m) => m !== oc);
  list[idx].updatedAt = Date.now();
  if (!setFamilies(list)) return { ok: false, errMsg: '保存失败' };
  return { ok: true, family: list[idx] };
}

/** 删除 OC 时从所有家族中移除 */
function removeOcFromAllFamilies(ocId) {
  const oc = String(ocId || '').trim();
  if (!oc) return false;
  const list = getFamilies();
  let changed = false;
  list.forEach((f) => {
    const next = f.memberIds.filter((m) => m !== oc);
    if (next.length !== f.memberIds.length) {
      f.memberIds = next;
      f.updatedAt = Date.now();
      changed = true;
    }
  });
  if (!changed) return true;
  return setFamilies(list);
}

function removeOcIdsFromAllFamilies(ocIds) {
  (ocIds || []).forEach((id) => removeOcFromAllFamilies(id));
  return true;
}

function patchFavoriteFlags(favoriteId, patch) {
  const id = String(favoriteId || '').trim();
  if (!id || !patch || typeof patch !== 'object') return false;
  const list = safeGetFavorites();
  const idx = list.findIndex((i) => i && i.id === id);
  if (idx < 0) return false;
  const item = Object.assign({}, list[idx]);
  if (Object.prototype.hasOwnProperty.call(patch, 'notebookStarred')) {
    item.notebookStarred = !!patch.notebookStarred;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notebookPinned')) {
    item.notebookPinned = !!patch.notebookPinned;
    item.notebookPinnedAt = item.notebookPinned ? Date.now() : 0;
  }
  list[idx] = item;
  return safeSetFavorites(list);
}

function toggleNotebookStarred(favoriteId) {
  const id = String(favoriteId || '').trim();
  if (!id) return { ok: false };
  const list = safeGetFavorites();
  const idx = list.findIndex((i) => i && i.id === id);
  if (idx < 0) return { ok: false };
  const next = !list[idx].notebookStarred;
  if (!patchFavoriteFlags(id, { notebookStarred: next })) return { ok: false };
  return { ok: true, notebookStarred: next };
}

function toggleNotebookPinned(favoriteId) {
  const id = String(favoriteId || '').trim();
  if (!id) return { ok: false };
  const list = safeGetFavorites();
  const idx = list.findIndex((i) => i && i.id === id);
  if (idx < 0) return { ok: false };
  const next = !list[idx].notebookPinned;
  if (!patchFavoriteFlags(id, { notebookPinned: next })) return { ok: false };
  return { ok: true, notebookPinned: next };
}

function sortNotebookList(list) {
  const arr = (list || []).slice();
  arr.sort((a, b) => {
    const ap = a && a.notebookPinned ? 1 : 0;
    const bp = b && b.notebookPinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (ap && bp) {
      return (Number(b.notebookPinnedAt) || 0) - (Number(a.notebookPinnedAt) || 0);
    }
    const as = a && a.notebookStarred ? 1 : 0;
    const bs = b && b.notebookStarred ? 1 : 0;
    if (as !== bs) return bs - as;
    return (Number(b.time) || 0) - (Number(a.time) || 0);
  });
  return arr;
}

module.exports = {
  STORAGE_FAMILIES,
  getFamilies,
  setFamilies,
  sortFamilies,
  createFamily,
  renameFamily,
  deleteFamily,
  toggleFamilyPinned,
  setFamilyMembers,
  addMemberToFamily,
  removeMemberFromFamily,
  removeOcFromAllFamilies,
  removeOcIdsFromAllFamilies,
  patchFavoriteFlags,
  toggleNotebookStarred,
  toggleNotebookPinned,
  sortNotebookList
};
