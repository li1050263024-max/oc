const STORAGE_HIDDEN_OC = 'oc_chat_hidden_ids';
const STORAGE_SESSIONS_PREFIX = 'oc_chat_sessions_';
const STORAGE_CHAT_LEGACY = 'oc_chat_';
const STORAGE_SCENARIO_PREFIX = 'oc_chat_scenario_';

function getHiddenOcIds() {
  const raw = wx.getStorageSync(STORAGE_HIDDEN_OC) || [];
  return Array.isArray(raw) ? raw.slice() : [];
}

function hideOcFromChatList(ocId) {
  if (!ocId) return;
  const ids = getHiddenOcIds();
  if (ids.indexOf(ocId) < 0) {
    ids.push(ocId);
    wx.setStorageSync(STORAGE_HIDDEN_OC, ids);
  }
}

function unhideOcFromChatList(ocId) {
  if (!ocId) return;
  const ids = getHiddenOcIds().filter((id) => id !== ocId);
  wx.setStorageSync(STORAGE_HIDDEN_OC, ids);
}

function isOcHidden(ocId) {
  return getHiddenOcIds().indexOf(ocId) >= 0;
}

function _sessionsKey(ocId) {
  return STORAGE_SESSIONS_PREFIX + ocId;
}

function _messagesKey(ocId, sessionId) {
  return STORAGE_CHAT_LEGACY + ocId + '_' + (sessionId || 'default');
}

function _scenarioKey(ocId, sessionId) {
  return STORAGE_SCENARIO_PREFIX + ocId + '_' + (sessionId || 'default');
}

/** 删除该 OC 全部对话并从对话列表隐藏 */
function removeOcFromChatList(ocId) {
  if (!ocId) return;
  const sessions = wx.getStorageSync(_sessionsKey(ocId)) || [];
  if (Array.isArray(sessions)) {
    sessions.forEach((s) => {
      if (!s || !s.id) return;
      try {
        wx.removeStorageSync(_messagesKey(ocId, s.id));
        wx.removeStorageSync(_scenarioKey(ocId, s.id));
      } catch (e) {}
    });
  }
  try {
    wx.removeStorageSync(_sessionsKey(ocId));
    wx.removeStorageSync(STORAGE_CHAT_LEGACY + ocId);
    const oldScenario = STORAGE_SCENARIO_PREFIX + ocId;
    wx.removeStorageSync(oldScenario);
  } catch (e) {}
  hideOcFromChatList(ocId);
}

module.exports = {
  getHiddenOcIds,
  hideOcFromChatList,
  unhideOcFromChatList,
  isOcHidden,
  removeOcFromChatList
};
