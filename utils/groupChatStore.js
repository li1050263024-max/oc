const INDEX_KEY = 'oc_group_chat_index';
const STORAGE_GROUP_LEGACY = 'oc_group_chat_';
const STORAGE_GROUP_SESSIONS = 'oc_group_sessions_';
const { saveGroupScenario } = require('./chatScenario.js');

function messagesKey(roomId, sessionId) {
  return STORAGE_GROUP_LEGACY + roomId + '_' + (sessionId || 'default');
}

function legacyMessagesKey(roomId) {
  return STORAGE_GROUP_LEGACY + roomId;
}

function sessionsKey(roomId) {
  return STORAGE_GROUP_SESSIONS + roomId;
}

function _previewFromMessages(messages) {
  const list = messages || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || !m.content) continue;
    const who = m.role === 'user' ? '我' : m.name || '角色';
    const t = String(m.content).trim();
    if (t) return who + '：' + t.slice(0, 36) + (t.length > 36 ? '…' : '');
  }
  return '';
}

function loadIndex() {
  const raw = wx.getStorageSync(INDEX_KEY) || [];
  return Array.isArray(raw) ? raw : [];
}

function saveIndex(list) {
  wx.setStorageSync(INDEX_KEY, list || []);
}

function migrateRoomLegacy(roomId) {
  const sessions = wx.getStorageSync(sessionsKey(roomId)) || [];
  if (Array.isArray(sessions) && sessions.length) return;
  const legacy = wx.getStorageSync(legacyMessagesKey(roomId));
  if (!legacy || !Array.isArray(legacy) || !legacy.length) return;
  const sid = 'default';
  wx.setStorageSync(messagesKey(roomId, sid), legacy);
  wx.setStorageSync(sessionsKey(roomId), [
    {
      id: sid,
      title: '群聊',
      updatedAt: Date.now(),
      preview: _previewFromMessages(legacy)
    }
  ]);
}

function listGroupRooms() {
  return loadIndex()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getRoomMeta(roomId) {
  return loadIndex().find((r) => r.roomId === roomId) || null;
}

function upsertRoomMeta(meta) {
  if (!meta || !meta.roomId) return;
  let list = loadIndex();
  const idx = list.findIndex((r) => r.roomId === meta.roomId);
  const entry = Object.assign(
    {
      updatedAt: Date.now(),
      preview: '',
      activeSessionId: 'default'
    },
    idx >= 0 ? list[idx] : {},
    meta
  );
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  saveIndex(list);
  return entry;
}

function removeRoom(roomId) {
  let list = loadIndex().filter((r) => r.roomId !== roomId);
  saveIndex(list);
  try {
    const ocImage = require('./ocImage.js');
    const fs = wx.getFileSystemManager();
    fs.unlink({
      filePath: ocImage.getGroupChatBackgroundPath(roomId),
      fail: () => {}
    });
  } catch (e) {}
  try {
    wx.removeStorageSync(legacyMessagesKey(roomId));
  } catch (e) {}
  const sessions = listSessions(roomId);
  sessions.forEach((s) => {
    try {
      wx.removeStorageSync(messagesKey(roomId, s.id));
    } catch (e) {}
  });
  try {
    wx.removeStorageSync(sessionsKey(roomId));
  } catch (e) {}
}

function buildRoomTitle(memberNames) {
  const names = (memberNames || []).filter(Boolean);
  if (!names.length) return '群聊';
  if (names.length <= 3) return names.join('、');
  return names.slice(0, 2).join('、') + ' 等' + names.length + '人';
}

function registerRoom(members, roomId) {
  const memberIds = members.map((m) => m.id);
  const memberNames = members.map((m) => m.name);
  const title = buildRoomTitle(memberNames);
  const existing = getRoomMeta(roomId);
  let activeSessionId = existing && existing.activeSessionId;
  if (!activeSessionId) {
    const sessions = listSessions(roomId);
    activeSessionId =
      (sessions[0] && sessions[0].id) || createGroupSession(roomId, '群聊');
  }
  upsertRoomMeta({
    roomId: roomId,
    memberIds: memberIds,
    memberNames: memberNames,
    title: title,
    activeSessionId: activeSessionId,
    updatedAt: Date.now()
  });
  migrateRoomLegacy(roomId);
  return activeSessionId;
}

function listSessions(roomId) {
  migrateRoomLegacy(roomId);
  const raw = wx.getStorageSync(sessionsKey(roomId)) || [];
  if (!Array.isArray(raw)) return [];
  return raw.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function saveSessions(roomId, sessions) {
  wx.setStorageSync(sessionsKey(roomId), sessions || []);
}

function getMessages(roomId, sessionId) {
  migrateRoomLegacy(roomId);
  const sid = sessionId || 'default';
  const msgs = wx.getStorageSync(messagesKey(roomId, sid)) || [];
  return Array.isArray(msgs) ? msgs : [];
}

function setMessages(roomId, sessionId, messages) {
  const sid = sessionId || 'default';
  wx.setStorageSync(messagesKey(roomId, sid), messages || []);
  touchGroupSession(roomId, sid, messages);
  const preview = _previewFromMessages(messages);
  upsertRoomMeta({
    roomId: roomId,
    preview: preview,
    updatedAt: Date.now(),
    activeSessionId: sid
  });
}

function touchGroupSession(roomId, sessionId, messages) {
  const sid = sessionId || 'default';
  let sessions = listSessions(roomId);
  const preview = _previewFromMessages(messages);
  const now = Date.now();
  const idx = sessions.findIndex((s) => s.id === sid);
  if (idx >= 0) {
    sessions[idx].updatedAt = now;
    if (preview) sessions[idx].preview = preview;
  } else {
    sessions.unshift({
      id: sid,
      title: '群聊 ' + new Date(now).toLocaleDateString(),
      updatedAt: now,
      preview: preview
    });
  }
  saveSessions(roomId, sessions);
}

function createGroupSession(roomId, title) {
  migrateRoomLegacy(roomId);
  const id = 'gs_' + Date.now();
  const sessions = listSessions(roomId);
  sessions.unshift({
    id: id,
    title: title || '新对话',
    updatedAt: Date.now(),
    preview: ''
  });
  saveSessions(roomId, sessions);
  wx.setStorageSync(messagesKey(roomId, id), []);
  upsertRoomMeta({ roomId: roomId, activeSessionId: id });
  return id;
}

function renameRoomTitle(roomId, title) {
  if (!roomId) return false;
  const t = String(title || '').trim();
  if (!t) return false;
  upsertRoomMeta({ roomId: roomId, title: t.slice(0, 40) });
  return true;
}

function renameGroupSession(roomId, sessionId, title) {
  if (!roomId || !sessionId) return false;
  const t = String(title || '').trim();
  if (!t) return false;
  let sessions = listSessions(roomId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return false;
  sessions[idx].title = t.slice(0, 40);
  saveSessions(roomId, sessions);
  return true;
}

/** @returns {{ ok: boolean, last?: boolean }} */
function deleteGroupSession(roomId, sessionId) {
  return deleteGroupSessionsBatch(roomId, [sessionId]);
}

/** @returns {{ ok: boolean, last?: boolean, deleted?: number, recreated?: boolean }} */
function deleteGroupSessionsBatch(roomId, sessionIds) {
  if (!roomId || !sessionIds || !sessionIds.length) {
    return { ok: false, deleted: 0 };
  }
  migrateRoomLegacy(roomId);
  let sessions = listSessions(roomId);
  const idSet = {};
  sessionIds.forEach((id) => {
    if (id) idSet[id] = true;
  });
  const toDelete = sessions.filter((s) => idSet[s.id]).map((s) => s.id);
  if (!toDelete.length) return { ok: false, deleted: 0 };
  let remaining = sessions.filter((s) => !idSet[s.id]);
  toDelete.forEach((id) => {
    try {
      wx.removeStorageSync(messagesKey(roomId, id));
    } catch (e) {}
    saveGroupScenario(roomId, id, null);
  });
  let recreated = false;
  if (remaining.length < 1) {
    const freshId = 'gs_' + Date.now();
    remaining = [
      {
        id: freshId,
        title: '新对话',
        updatedAt: Date.now(),
        preview: ''
      }
    ];
    try {
      wx.setStorageSync(messagesKey(roomId, freshId), []);
    } catch (_) {}
    recreated = true;
  }
  saveSessions(roomId, remaining);
  const meta = getRoomMeta(roomId);
  if (meta && idSet[meta.activeSessionId]) {
    upsertRoomMeta({
      roomId: roomId,
      activeSessionId: remaining[0] ? remaining[0].id : ''
    });
  } else if (recreated && remaining[0]) {
    upsertRoomMeta({
      roomId: roomId,
      activeSessionId: remaining[0].id
    });
  }
  return { ok: true, deleted: toDelete.length, recreated: recreated };
}

function resolveMembersFromMeta(meta, ocList) {
  if (!meta || !meta.memberIds) return [];
  const map = {};
  (ocList || []).forEach((o) => {
    map[o.id] = o;
  });
  return meta.memberIds
    .map((id, i) => {
      if (map[id]) return map[id];
      return {
        id: id,
        name: (meta.memberNames && meta.memberNames[i]) || '角色',
        work: null
      };
    })
    .filter((m) => m.work || map[m.id]);
}

module.exports = {
  listGroupRooms,
  getRoomMeta,
  upsertRoomMeta,
  removeRoom,
  registerRoom,
  buildRoomTitle,
  listSessions,
  getMessages,
  setMessages,
  createGroupSession,
  renameGroupSession,
  renameRoomTitle,
  deleteGroupSession,
  deleteGroupSessionsBatch,
  resolveMembersFromMeta
};
