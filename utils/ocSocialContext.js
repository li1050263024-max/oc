const { buildOcPromptFromWork } = require('./ocContext.js');
const { resolveFavoriteId } = require('./ocChatList.js');
const { getFavoriteById } = require('./favorite.js');
const {
  listSessions,
  getMessages,
  getSessionMemory,
  findPrimaryChatSessionId,
  ensureDefaultSession
} = require('./chatSession.js');
const { loadScenario } = require('./chatScenario.js');
const { getStoriesFromItem, storyFirstParagraph } = require('./storyStore.js');
const { isMoneyMessage, formatMoneyForAiHistory } = require('./chatGames.js');

function _ocDisplayName(work, oc) {
  return (oc && oc.name) || (work && work.result && work.result.name) || 'OC';
}

function _recentStoriesForOc(oc) {
  const ocId = oc.id;
  const favId = resolveFavoriteId(ocId) || ocId;
  const item = getFavoriteById(favId);
  const fromFav = item ? getStoriesFromItem(item) : [];
  const fromWork = (oc.work && oc.work.ocStories) || [];
  const merged = fromFav.length ? fromFav : fromWork;
  return merged.slice(-2);
}

function _messageLineForPlot(m, ocName) {
  if (!m) return '';
  if (isMoneyMessage(m)) {
    return formatMoneyForAiHistory(m) || '';
  }
  const t = String(m.content || '').trim();
  if (!t) return '';
  const role = m.role === 'user' ? '用户' : ocName;
  return role + '：' + t.slice(0, 200);
}

/**
 * 拼装剧情上下文：情景演绎、故事线、对话记忆、近期私聊
 * 用于朋友圈 / 主动消息 / 群聊续记
 */
function buildSocialPlotContext(oc) {
  if (!oc || !oc.work) return '';
  const work = oc.work;
  const ocId = oc.id;
  const name = _ocDisplayName(work, oc);
  // 用「聊得最多/最近」的会话，而不是固定 default，避免换会话后失忆
  const sessionId =
    findPrimaryChatSessionId(ocId) || ensureDefaultSession(ocId);
  const messages = getMessages(ocId, sessionId).slice(-24);
  const memory = getSessionMemory(ocId, sessionId) || '';
  const scenario = loadScenario(ocId, sessionId);
  const sessions = listSessions(ocId);
  const sessionTitle = (sessions.find((s) => s.id === sessionId) || {}).title || '';

  const parts = [];

  parts.push(
    '【跨场景记忆说明】以下为你与用户的私聊要点。在朋友圈、群聊、主动消息中须记得并自然呼应，不要装作不认识或忘记说过的事与关系。'
  );

  if (scenario && scenario.excerpt) {
    parts.push(
      '【当前情景演绎·须与此氛围一致】\n' +
        (scenario.title ? '标题：' + scenario.title + '\n' : '') +
        String(scenario.excerpt).trim().slice(0, 900)
    );
  }

  const stories = _recentStoriesForOc(oc);
  if (stories.length) {
    let storyBlock = '【近期故事线·勿违背已发生情节】\n';
    stories.forEach((s) => {
      const title = String(s.title || '未命名').trim();
      const excerpt = storyFirstParagraph(s.content).slice(0, 220);
      if (excerpt) storyBlock += '《' + title + '》：' + excerpt + '\n';
    });
    parts.push(storyBlock.trim());
  }

  if (memory) {
    parts.push('【对话长期记忆·含关系】\n' + String(memory).trim().slice(0, 850));
  }

  if (messages.length) {
    let chatBlock = '【最近私聊记录·可自然续接】\n';
    if (sessionTitle) chatBlock += '（会话：' + sessionTitle + '）\n';
    messages.forEach((m) => {
      const line = _messageLineForPlot(m, name);
      if (line) chatBlock += line + '\n';
    });
    parts.push(chatBlock.trim());
  }

  return parts.join('\n\n');
}

function buildGroupPlotHint(roomId, sessionId, members) {
  if (!roomId) return '';
  const { getMessages: getGroupMessages } = require('./groupChatStore.js');
  const { loadGroupScenario } = require('./chatScenario.js');
  const msgs = getGroupMessages(roomId, sessionId).slice(-16);
  const scenario = loadGroupScenario(roomId, sessionId);
  const parts = [];

  if (scenario && scenario.excerpt) {
    parts.push(
      '【群聊情景】\n' +
        (scenario.title ? scenario.title + '\n' : '') +
        String(scenario.excerpt).trim().slice(0, 700)
    );
  }

  if (msgs.length) {
    let block = '【群聊近期记录·须衔接】\n';
    msgs.forEach((m) => {
      if (!m || !m.content) return;
      const who = m.role === 'user' ? '用户' : m.name || '成员';
      block += who + '：' + String(m.content).trim().slice(0, 160) + '\n';
    });
    parts.push(block.trim());
  }

  if (members && members.length) {
    parts.push(
      '【群成员】\n' +
        members
          .map((m) => m.name || '角色')
          .filter(Boolean)
          .join('、')
    );
  }

  return parts.join('\n\n');
}

function _bioForCloud(work, oc) {
  const bio = String((oc && oc.bioText) || (work && work.generatedBio) || '').trim();
  if (bio) return bio.slice(0, 2000);
  const setting = buildOcPromptFromWork(work);
  if (!setting) return '（暂无小传，请仅依据 OC 设定发挥）';
  return '（暂无人物小传，请严格依据 OC 设定、口癖与态度说话，勿 OOC）\n' + setting.slice(0, 1200);
}

function buildFakeChatCloudPayload(oc, count, options) {
  const opts = options || {};
  const work = oc.work;
  const ocSetting = buildOcPromptFromWork(work);
  const plotContext = buildSocialPlotContext(oc);
  const forbidden =
    Array.isArray(opts.forbiddenContents) && opts.forbiddenContents.length
      ? opts.forbiddenContents
      : String(opts.forbiddenContents || '')
          .split('\n')
          .map((s) => s.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean);

  return {
    ocName: oc.name || _ocDisplayName(work, oc),
    ocSetting: ocSetting.slice(0, 3200),
    ocBio: _bioForCloud(work, oc),
    plotContext: plotContext.slice(0, 2800),
    groupContext: String(opts.groupContext || '').slice(0, 1800),
    mode: opts.mode === 'group' ? 'group' : 'chat',
    postCount: count,
    forbiddenContents: forbidden.slice(0, 35)
  };
}

function buildProactiveCloudPayload(oc, topicDirection) {
  const {
    buildProactiveSystemPrompt,
    buildProactiveUserMessage
  } = require('./ocProactive.js');
  return {
    mode: 'proactive',
    ocName: oc.name || 'OC',
    systemPrompt: buildProactiveSystemPrompt(oc),
    userMessage: buildProactiveUserMessage(topicDirection),
    postCount: 1
  };
}

function buildMomentsCloudPayload(oc, count, options) {
  const opts = options || {};
  const work = oc.work;
  const forbidden =
    Array.isArray(opts.forbiddenContents) && opts.forbiddenContents.length
      ? opts.forbiddenContents
      : String(opts.forbiddenContents || '')
          .split('\n')
          .map((s) => s.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean);

  return {
    ocName: oc.name || _ocDisplayName(work, oc),
    ocSetting: buildOcPromptFromWork(work).slice(0, 3200),
    ocBio: _bioForCloud(work, oc),
    chatSummary: buildSocialPlotContext(oc).slice(0, 2800),
    postCount: count,
    forbiddenContents: forbidden.slice(0, 35)
  };
}

module.exports = {
  buildSocialPlotContext,
  buildGroupPlotHint,
  buildFakeChatCloudPayload,
  buildProactiveCloudPayload,
  buildMomentsCloudPayload
};
