/**
 * 本地删除墓碑：设定本 OC / 私聊会话
 * 内存 + 磁盘双写；磁盘满时本会话仍能挡住复活。
 */
const OC_KEY = 'oc_deleted_oc_ids_v1';
const SESSION_KEY = 'oc_deleted_sessions_v1';
const MAX = 400;

const _memOc = {};
const _memOcNames = {};
const _memSession = {};

function readList(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  } catch (_) {}
  return [];
}

function writeList(key, list) {
  const next = [];
  const seen = {};
  (list || []).forEach((id) => {
    const s = String(id || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    next.push(s);
  });
  try {
    wx.setStorageSync(key, next.slice(-MAX));
    return true;
  } catch (_) {
    try {
      wx.removeStorageSync(key);
      wx.setStorageSync(key, next.slice(-MAX));
      return true;
    } catch (__) {
      return false;
    }
  }
}

function addOcIds(ids, names) {
  const cur = readList(OC_KEY);
  (ids || []).forEach((id) => {
    const s = String(id || '').trim();
    if (!s) return;
    _memOc[s] = true;
    if (cur.indexOf(s) < 0) cur.push(s);
  });
  (names || []).forEach((name) => {
    const n = String(name || '').trim();
    if (n) _memOcNames[n] = true;
  });
  writeList(OC_KEY, cur);
  return cur;
}

function getDeletedOcIds() {
  const set = {};
  readList(OC_KEY).forEach((id) => {
    set[id] = true;
  });
  Object.keys(_memOc).forEach((id) => {
    set[id] = true;
  });
  return Object.keys(set);
}

function isOcDeleted(ocId) {
  const id = String(ocId || '').trim();
  if (!id) return false;
  if (_memOc[id]) return true;
  return getDeletedOcIds().indexOf(id) >= 0;
}

function isOcNameDeleted(name) {
  const n = String(name || '').trim();
  return !!(n && _memOcNames[n]);
}

function filterFavorites(list) {
  const del = {};
  getDeletedOcIds().forEach((id) => {
    del[id] = true;
  });
  if (!Object.keys(del).length) return list || [];
  return (list || []).filter((f) => f && f.id && !del[String(f.id)]);
}

function sessionKey(ocId, sessionId) {
  return String(ocId || '').trim() + '::' + String(sessionId || '').trim();
}

function addDeletedSessions(ocId, sessionIds) {
  const cur = readList(SESSION_KEY);
  (sessionIds || []).forEach((sid) => {
    const k = sessionKey(ocId, sid);
    if (k === '::') return;
    _memSession[k] = true;
    if (cur.indexOf(k) < 0) cur.push(k);
  });
  writeList(SESSION_KEY, cur);
  return cur;
}

function isSessionDeleted(ocId, sessionId) {
  const k = sessionKey(ocId, sessionId);
  if (_memSession[k]) return true;
  return readList(SESSION_KEY).indexOf(k) >= 0;
}

function filterSessions(ocId, sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.filter((s) => s && s.id && !isSessionDeleted(ocId, s.id));
}

function removeOcIds(ids) {
  const drop = {};
  (ids || []).forEach((id) => {
    const s = String(id || '').trim();
    if (!s) return;
    drop[s] = true;
    delete _memOc[s];
  });
  if (!Object.keys(drop).length) return getDeletedOcIds();
  const cur = readList(OC_KEY).filter((id) => !drop[id]);
  writeList(OC_KEY, cur);
  return getDeletedOcIds();
}

module.exports = {
  addOcIds,
  removeOcIds,
  getDeletedOcIds,
  isOcDeleted,
  isOcNameDeleted,
  filterFavorites,
  addDeletedSessions,
  isSessionDeleted,
  filterSessions
};
