const STORAGE_SESSIONS_PREFIX = 'oc_chat_sessions_';
const STORAGE_CHAT_LEGACY = 'oc_chat_';
const STORAGE_MEMORY_PREFIX = 'oc_chat_memory_';
const { saveScenario } = require('./chatScenario.js');

function sessionsKey(ocId) {
  return STORAGE_SESSIONS_PREFIX + (ocId || '');
}

function messagesKey(ocId, sessionId) {
  return STORAGE_CHAT_LEGACY + ocId + '_' + (sessionId || 'default');
}

function memoryKey(ocId, sessionId) {
  return STORAGE_MEMORY_PREFIX + ocId + '_' + (sessionId || 'default');
}

function getSessionMemory(ocId, sessionId) {
  return wx.getStorageSync(memoryKey(ocId, sessionId)) || '';
}

function setSessionMemory(ocId, sessionId, text) {
  const key = memoryKey(ocId, sessionId);
  const t = String(text || '').trim();
  if (!t) {
    try {
      wx.removeStorageSync(key);
    } catch (e) {}
    return;
  }
  wx.setStorageSync(key, t.slice(0, 900));
}

function clearSessionMemory(ocId, sessionId) {
  try {
    wx.removeStorageSync(memoryKey(ocId, sessionId));
  } catch (e) {}
}

function legacyMessagesKey(ocId) {
  return STORAGE_CHAT_LEGACY + ocId;
}

function _previewFromMessages(messages) {
  const list = messages || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.content) {
      const t = String(m.content).trim();
      if (t) return t.slice(0, 48) + (t.length > 48 ? '…' : '');
    }
  }
  return '';
}

function migrateLegacyIfNeeded(ocId) {
  if (!ocId) return;
  const sessions = wx.getStorageSync(sessionsKey(ocId)) || [];
  if (Array.isArray(sessions) && sessions.length) return;
  const legacy = wx.getStorageSync(legacyMessagesKey(ocId));
  if (!legacy || !Array.isArray(legacy) || !legacy.length) {
    return;
  }
  const sid = 'default';
  wx.setStorageSync(messagesKey(ocId, sid), legacy);
  wx.setStorageSync(sessionsKey(ocId), [
    {
      id: sid,
      title: '对话',
      updatedAt: Date.now(),
      preview: _previewFromMessages(legacy)
    }
  ]);
}

function listSessions(ocId) {
  migrateLegacyIfNeeded(ocId);
  const raw = wx.getStorageSync(sessionsKey(ocId)) || [];
  if (!Array.isArray(raw)) return [];
  let list = raw.slice();
  try {
    list = require('./ocDeletedIds.js').filterSessions(ocId, list);
  } catch (_) {}
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function saveSessions(ocId, sessions) {
  wx.setStorageSync(sessionsKey(ocId), sessions || []);
}

function getMessages(ocId, sessionId) {
  migrateLegacyIfNeeded(ocId);
  const sid = sessionId || 'default';
  const msgs = wx.getStorageSync(messagesKey(ocId, sid)) || [];
  return Array.isArray(msgs) ? msgs : [];
}

function setMessages(ocId, sessionId, messages) {
  const sid = sessionId || 'default';
  wx.setStorageSync(messagesKey(ocId, sid), messages || []);
  touchSession(ocId, sid, messages);
  try {
    const sync = require('./userDataSync.js');
    if (!sync.isApplyingCloud()) sync.schedulePushChatSession(ocId, sid);
  } catch (_) {}
}

function touchSession(ocId, sessionId, messages) {
  const sid = sessionId || 'default';
  let sessions = listSessions(ocId);
  const preview = _previewFromMessages(messages);
  const now = Date.now();
  const idx = sessions.findIndex((s) => s.id === sid);
  if (idx >= 0) {
    sessions[idx].updatedAt = now;
    if (preview) sessions[idx].preview = preview;
  } else {
    sessions.unshift({
      id: sid,
      title: '对话 ' + new Date(now).toLocaleDateString(),
      updatedAt: now,
      preview: preview
    });
  }
  saveSessions(ocId, sessions);
}

function createSession(ocId, title) {
  migrateLegacyIfNeeded(ocId);
  const id = 's_' + Date.now();
  const sessions = listSessions(ocId);
  sessions.unshift({
    id: id,
    title: title || '新对话',
    updatedAt: Date.now(),
    preview: ''
  });
  saveSessions(ocId, sessions);
  wx.setStorageSync(messagesKey(ocId, id), []);
  return id;
}

function ensureDefaultSession(ocId) {
  migrateLegacyIfNeeded(ocId);
  const sessions = listSessions(ocId);
  if (sessions.length) return sessions[0].id;
  return createSession(ocId, '对话');
}

/** 用户实际聊过天的会话（按用户消息条数、最近发言时间） */
function findPrimaryChatSessionId(ocId) {
  if (!ocId) return 'default';
  migrateLegacyIfNeeded(ocId);
  const sessions = listSessions(ocId);
  let bestId = '';
  let bestUserCount = -1;
  let bestLastUserAt = 0;

  for (let i = 0; i < sessions.length; i++) {
    const sid = sessions[i].id;
    const msgs = getMessages(ocId, sid);
    let userCount = 0;
    let lastUserAt = 0;
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j];
      if (m && m.role === 'user' && String(m.content || '').trim()) {
        userCount += 1;
        const ts = Number(m.createdAt) || Number(m.fakeAt) || 0;
        if (ts >= lastUserAt) lastUserAt = ts;
      }
    }
    if (
      userCount > bestUserCount ||
      (userCount === bestUserCount && lastUserAt > bestLastUserAt)
    ) {
      bestUserCount = userCount;
      bestLastUserAt = lastUserAt;
      bestId = sid;
    }
  }

  if (bestId) return bestId;
  if (sessions.length) return sessions[0].id;
  return ensureDefaultSession(ocId);
}

function getLastMessageTimestamp(msgs) {
  let max = 0;
  for (let i = 0; i < (msgs || []).length; i++) {
    const m = msgs[i];
    if (!m) continue;
    const ts = Number(m.createdAt) || Number(m.fakeAt) || 0;
    if (ts > max) max = ts;
  }
  return max;
}

function renameSession(ocId, sessionId, title) {
  if (!ocId || !sessionId) return false;
  const t = String(title || '').trim();
  if (!t) return false;
  let sessions = listSessions(ocId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return false;
  sessions[idx].title = t.slice(0, 40);
  saveSessions(ocId, sessions);
  return true;
}

/** @returns {{ ok: boolean, last?: boolean }} */
function deleteSession(ocId, sessionId) {
  return deleteSessionsBatch(ocId, [sessionId]);
}

/** @returns {{ ok: boolean, last?: boolean, deleted?: number, recreated?: boolean }} */
function deleteSessionsBatch(ocId, sessionIds) {
  if (!ocId || !sessionIds || !sessionIds.length) {
    return { ok: false, deleted: 0 };
  }
  migrateLegacyIfNeeded(ocId);
  let sessions = listSessions(ocId);
  const idSet = {};
  sessionIds.forEach((id) => {
    if (id) idSet[id] = true;
  });
  const toDelete = sessions.filter((s) => idSet[s.id]).map((s) => s.id);
  if (!toDelete.length) return { ok: false, deleted: 0 };
  let remaining = sessions.filter((s) => !idSet[s.id]);
  toDelete.forEach((id) => {
    try {
      wx.removeStorageSync(messagesKey(ocId, id));
    } catch (e) {}
    clearSessionMemory(ocId, id);
    saveScenario(ocId, id, null);
  });
  let recreated = false;
  if (remaining.length < 1) {
    // 允许删光：自动建一个空对话，避免「部分失败」误报
    const freshId = 's_' + Date.now();
    remaining = [
      {
        id: freshId,
        title: '新对话',
        updatedAt: Date.now(),
        preview: ''
      }
    ];
    try {
      wx.setStorageSync(messagesKey(ocId, freshId), []);
    } catch (_) {}
    recreated = true;
  }
  saveSessions(ocId, remaining);
  try {
    require('./ocDeletedIds.js').addDeletedSessions(ocId, toDelete);
  } catch (_) {}
  try {
    const sync = require('./userDataSync.js');
    if (!sync.isApplyingCloud() && typeof sync.flushChatAfterDelete === 'function') {
      sync.flushChatAfterDelete(ocId, toDelete).catch(() => {});
    }
  } catch (_) {}
  return { ok: true, deleted: toDelete.length, recreated: recreated };
}

module.exports = {
  listSessions,
  getMessages,
  setMessages,
  saveSessions,
  createSession,
  ensureDefaultSession,
  findPrimaryChatSessionId,
  getLastMessageTimestamp,
  touchSession,
  renameSession,
  deleteSession,
  deleteSessionsBatch,
  getSessionMemory,
  setSessionMemory,
  clearSessionMemory
};
