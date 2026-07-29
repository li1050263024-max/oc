const PACK_VERSION = 1;
const {
  getFavoriteById,
  getFavorites,
  buildFavoriteItem,
  upsertOcToFavorites,
  workFromFavoriteItem
} = require('./favorite.js');
const { safeSetFavorites, safeGetFavorites } = require('./favoriteStore.js');
const { newStoryId } = require('./storyStore.js');
const {
  listSessions,
  getMessages,
  saveSessions,
  setMessages,
  getSessionMemory,
  setSessionMemory
} = require('./chatSession.js');
const { loadScenario, saveScenario } = require('./chatScenario.js');
const gacha = require('./gacha.js');
const { buildOcPromptFromWork } = require('./ocContext.js');
const {
  normalizeRelationships,
  normalizeTimelineEvents
} = require('./ocProfileData.js');

function _stripItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    time: item.time,
    source: item.source,
    result: item.result,
    background: item.background,
    catchphrases: item.catchphrases,
    attitudes: item.attitudes,
    generatedBio: item.generatedBio || '',
    ocStories: Array.isArray(item.ocStories) ? item.ocStories.map((s) => ({ ...s })) : [],
    relationships: normalizeRelationships(item.relationships),
    timelineEvents: normalizeTimelineEvents(item.timelineEvents),
    chatRemark: item.chatRemark || ''
  };
}

function _collectChats(ocId) {
  const sessions = listSessions(ocId);
  const chats = {
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      preview: s.preview || ''
    })),
    messages: {},
    scenarios: {},
    memories: {}
  };
  sessions.forEach((s) => {
    chats.messages[s.id] = getMessages(ocId, s.id);
    const sc = loadScenario(ocId, s.id);
    if (sc) chats.scenarios[s.id] = sc;
    const mem = getSessionMemory(ocId, s.id);
    if (mem) chats.memories[s.id] = mem;
  });
  return chats;
}

function buildOcFullPack(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return null;
  return {
    packVersion: PACK_VERSION,
    type: 'oc_full',
    exportedAt: Date.now(),
    oc: _stripItem(item),
    chats: _collectChats(favoriteId)
  };
}

function buildNotebookPack() {
  return {
    packVersion: PACK_VERSION,
    type: 'notebook',
    exportedAt: Date.now(),
    items: getFavorites().map(_stripItem).filter(Boolean)
  };
}

function buildStoryPack(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return null;
  return {
    packVersion: PACK_VERSION,
    type: 'story',
    exportedAt: Date.now(),
    ocName: (item.result && item.result.name) || '未命名',
    ocId: favoriteId,
    stories: Array.isArray(item.ocStories) ? item.ocStories.map((s) => ({ ...s })) : []
  };
}

function buildSingleStoryPack(favoriteId, storyId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return null;
  const story = (item.ocStories || []).find((s) => s.id === storyId);
  if (!story) return null;
  return {
    packVersion: PACK_VERSION,
    type: 'story_single',
    exportedAt: Date.now(),
    ocName: (item.result && item.result.name) || '未命名',
    story: { ...story }
  };
}

function buildChatPack(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return null;
  return {
    packVersion: PACK_VERSION,
    type: 'chat',
    exportedAt: Date.now(),
    ocName: (item.result && item.result.name) || '未命名',
    ocId: favoriteId,
    chats: _collectChats(favoriteId)
  };
}

function buildSettingShareText(item) {
  const work = workFromFavoriteItem(item);
  if (!work) return '';
  let text = gacha.toCopyText(work.result);
  const block = buildOcPromptFromWork(work);
  if (block && block.length > text.length) {
    text += '\n\n' + block;
  }
  if (work.generatedBio) {
    text += '\n\n【人物小传】\n' + String(work.generatedBio).trim().slice(0, 2000);
  }
  return text.trim();
}

function buildChatShareText(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return '';
  const ocName = (item.result && item.result.name) || '未命名';
  const sessions = listSessions(favoriteId);
  if (!sessions.length) return '【' + ocName + ' 对话记录】\n\n（暂无对话）';
  let text = '【' + ocName + ' 对话记录】\n\n';
  sessions.forEach((s) => {
    text += '--- ' + (s.title || '对话') + ' ---\n';
    const msgs = getMessages(favoriteId, s.id) || [];
    msgs.forEach((m) => {
      if (!m || !m.content) return;
      const who = m.role === 'user' ? '用户' : ocName;
      text += who + '：' + String(m.content).trim() + '\n';
    });
    text += '\n';
  });
  return text.trim();
}

function buildOcFullShareText(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) return '';
  let text = buildSettingShareText(item);
  const chatText = buildChatShareText(favoriteId);
  if (chatText && chatText.indexOf('暂无对话') === -1) {
    text += '\n\n' + chatText;
  }
  return text.trim();
}

function buildNotebookShareText() {
  const items = getFavorites();
  if (!items.length) return '';
  return items
    .map((item) => buildSettingShareText(item))
    .filter(Boolean)
    .join('\n\n════════\n\n');
}

function buildStoryShareText(story) {
  if (!story) return '';
  return (story.title || '未命名故事') + '\n\n' + String(story.content || '').trim();
}

function _importChats(ocId, chats) {
  if (!chats || !ocId) return;
  if (Array.isArray(chats.sessions) && chats.sessions.length) {
    saveSessions(ocId, chats.sessions);
  }
  Object.keys(chats.messages || {}).forEach((sid) => {
    setMessages(ocId, sid, chats.messages[sid] || []);
  });
  Object.keys(chats.scenarios || {}).forEach((sid) => {
    saveScenario(ocId, sid, chats.scenarios[sid]);
  });
  Object.keys(chats.memories || {}).forEach((sid) => {
    setSessionMemory(ocId, sid, chats.memories[sid]);
  });
}

function _normalizeImportPack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.packVersion === PACK_VERSION) return raw;
  if (raw.type === 'notebook' && Array.isArray(raw.items)) {
    return Object.assign({}, raw, { packVersion: PACK_VERSION });
  }
  if (raw.type === 'oc_full' && raw.oc) {
    return Object.assign({}, raw, { packVersion: PACK_VERSION });
  }
  if (Array.isArray(raw.items)) {
    return { packVersion: PACK_VERSION, type: 'notebook', items: raw.items };
  }
  if (raw.result) {
    return { packVersion: PACK_VERSION, type: 'oc_full', oc: _stripItem(raw) || raw };
  }
  return null;
}

function _normalizeOcImportData(ocData) {
  if (!ocData || typeof ocData !== 'object') return null;
  if (ocData.result) return ocData;
  return null;
}

function _importOcEntry(ocData, options) {
  const normalized = _normalizeOcImportData(ocData);
  if (!normalized || !normalized.result) return false;
  const opts = options || {};
  const work = {
    result: normalized.result,
    background: normalized.background,
    catchphrases: normalized.catchphrases || [],
    attitudes: normalized.attitudes || [],
    generatedBio: normalized.generatedBio || '',
    ocStories: (normalized.ocStories || []).map((s) =>
      Object.assign({}, s, { id: newStoryId() })
    ),
    relationships: normalized.relationships || [],
    timelineEvents: normalized.timelineEvents || [],
    source: 'import',
    chatRemark: normalized.chatRemark || ''
  };
  if (opts.notebookFavoriteId) {
    work.notebookFavoriteId = opts.notebookFavoriteId;
  }
  const id = upsertOcToFavorites(work);
  return id;
}

function _mergeStoriesToFavorite(favoriteId, stories) {
  const item = getFavoriteById(favoriteId);
  if (!item) return false;
  const list = safeGetFavorites();
  const idx = list.findIndex((i) => i.id === favoriteId);
  if (idx < 0) return false;
  const existing = Array.isArray(list[idx].ocStories) ? list[idx].ocStories.slice() : [];
  (stories || []).forEach((s) => {
    existing.unshift(Object.assign({}, s, { id: newStoryId(), time: Date.now() }));
  });
  list[idx].ocStories = existing;
  list[idx].time = Date.now();
  return safeSetFavorites(list);
}

function importPack(pack, options) {
  const opts = options || {};
  const normalized = _normalizeImportPack(pack);
  if (!normalized) {
    return { ok: false, errMsg: '不支持的备份格式' };
  }
  pack = normalized;

  if (pack.type === 'oc_full' && pack.oc) {
    const id = _importOcEntry(pack.oc, opts);
    if (!id) return { ok: false, errMsg: '导入 OC 失败' };
    if (pack.chats) _importChats(id, pack.chats);
    return { ok: true, favoriteId: id, message: '已导入 OC 与对话' };
  }

  if (pack.type === 'notebook' && Array.isArray(pack.items)) {
    let count = 0;
    let lastId = '';
    pack.items.forEach((oc) => {
      const id = _importOcEntry(oc, opts);
      if (id) {
        count++;
        lastId = id;
      }
    });
    return { ok: count > 0, favoriteId: lastId, message: '已导入 ' + count + ' 个 OC' };
  }

  if (pack.type === 'story' && Array.isArray(pack.stories)) {
    let favId = opts.targetFavoriteId;
    if (!favId && pack.ocName) {
      const found = getFavorites().find(
        (i) => i.result && String(i.result.name).trim() === String(pack.ocName).trim()
      );
      favId = found && found.id;
    }
    if (!favId) {
      return { ok: false, errMsg: '请先选择要导入故事的 OC' };
    }
    if (!_mergeStoriesToFavorite(favId, pack.stories)) {
      return { ok: false, errMsg: '导入故事失败' };
    }
    return { ok: true, favoriteId: favId, message: '已导入故事' };
  }

  if (pack.type === 'story_single' && pack.story) {
    let favId = opts.targetFavoriteId;
    if (!favId && pack.ocName) {
      const found = getFavorites().find(
        (i) => i.result && String(i.result.name).trim() === String(pack.ocName).trim()
      );
      favId = found && found.id;
    }
    if (!favId) {
      return { ok: false, errMsg: '请先选择要导入故事的 OC' };
    }
    if (!_mergeStoriesToFavorite(favId, [pack.story])) {
      return { ok: false, errMsg: '导入故事失败' };
    }
    return { ok: true, favoriteId: favId, message: '已导入故事' };
  }

  if (pack.type === 'chat' && pack.chats) {
    let favId = opts.targetFavoriteId || pack.ocId;
    if (!favId) {
      return { ok: false, errMsg: '请先选择要导入对话的 OC' };
    }
    if (!getFavoriteById(favId)) {
      return { ok: false, errMsg: '目标 OC 不存在' };
    }
    _importChats(favId, pack.chats);
    return { ok: true, favoriteId: favId, message: '已导入对话记录' };
  }

  return { ok: false, errMsg: '未知备份类型' };
}

module.exports = {
  PACK_VERSION,
  buildOcFullPack,
  buildNotebookPack,
  buildStoryPack,
  buildSingleStoryPack,
  buildChatPack,
  buildSettingShareText,
  buildStoryShareText,
  buildChatShareText,
  buildOcFullShareText,
  buildNotebookShareText,
  importPack
};
