const { storyPreviewParagraphs, storyPreviewBlocks } = require('./storyStore.js');

const STORAGE_SCENARIO_PREFIX = 'oc_chat_scenario_';
const STORAGE_GROUP_SCENARIO_PREFIX = 'oc_group_chat_scenario_';

function scenarioKey(ocId, sessionId) {
  return STORAGE_SCENARIO_PREFIX + ocId + '_' + (sessionId || 'default');
}

function groupScenarioKey(roomId, sessionId) {
  return STORAGE_GROUP_SCENARIO_PREFIX + roomId + '_' + (sessionId || 'default');
}

function buildScenarioExcerpt(content, maxLen) {
  const t = String(content || '').trim();
  if (!t) return '';
  const max = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 1500;
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

function scenarioFromStory(story) {
  if (!story) return null;
  const content = String(story.content || '').trim();
  if (!content) return null;
  const previewBlocks = storyPreviewBlocks(content, 3);
  return {
    storyId: story.id || '',
    title: String(story.title || '').trim() || '未命名故事',
    excerpt: buildScenarioExcerpt(content, 1500),
    preview3: storyPreviewParagraphs(content, 3),
    previewBlocks: previewBlocks
  };
}

function loadScenario(ocId, sessionId) {
  if (!ocId) return null;
  const raw = wx.getStorageSync(scenarioKey(ocId, sessionId));
  if (!raw || !raw.excerpt) return null;
  if (!raw.previewBlocks && raw.preview3) {
    raw.previewBlocks = String(raw.preview3)
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

function saveScenario(ocId, sessionId, scenario) {
  if (!ocId) return;
  const key = scenarioKey(ocId, sessionId);
  if (!scenario || !scenario.excerpt) {
    wx.removeStorageSync(key);
    return;
  }
  wx.setStorageSync(key, scenario);
}

function loadGroupScenario(roomId, sessionId) {
  if (!roomId) return null;
  const raw = wx.getStorageSync(groupScenarioKey(roomId, sessionId));
  if (!raw || !raw.excerpt) return null;
  if (!raw.previewBlocks && raw.preview3) {
    raw.previewBlocks = String(raw.preview3)
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

function saveGroupScenario(roomId, sessionId, scenario) {
  if (!roomId) return;
  const key = groupScenarioKey(roomId, sessionId);
  if (!scenario || !scenario.excerpt) {
    wx.removeStorageSync(key);
    return;
  }
  wx.setStorageSync(key, scenario);
}

function migrateScenarioLegacy(ocId, sessionId) {
  if (!ocId) return;
  const oldKey = STORAGE_SCENARIO_PREFIX + ocId;
  const old = wx.getStorageSync(oldKey);
  if (old && old.excerpt && !loadScenario(ocId, sessionId)) {
    saveScenario(ocId, sessionId, old);
    try {
      wx.removeStorageSync(oldKey);
    } catch (e) {}
  }
}

function migrateGroupScenarioLegacy(roomId, sessionId) {
  if (!roomId) return;
  const oldKey = STORAGE_GROUP_SCENARIO_PREFIX + roomId;
  const old = wx.getStorageSync(oldKey);
  if (old && old.excerpt && !loadGroupScenario(roomId, sessionId)) {
    saveGroupScenario(roomId, sessionId, old);
    try {
      wx.removeStorageSync(oldKey);
    } catch (e) {}
  }
}

module.exports = {
  buildScenarioExcerpt,
  scenarioFromStory,
  loadScenario,
  saveScenario,
  loadGroupScenario,
  saveGroupScenario,
  migrateScenarioLegacy,
  migrateGroupScenarioLegacy
};
