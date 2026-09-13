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

/** 用户希望/命令 OC 发朋友圈或抖音的表述 */
const POST_DIRECTIVE_RE =
  /((发|写|更新|配).{0,10}(朋友圈|抖音|动态|文案)|(朋友圈|抖音|动态).{0,10}(发|写|更新)|(希望你|想让你|求你|拜托你|命令你|给你|给我|你去|给我去).{0,24}(发|写|更新)|(今天|今晚|现在).{0,8}发.{0,16}(朋友圈|抖音)|(发个|发条|发一下).{0,20}(朋友圈|抖音|动态))/;

function _detectPostChannel(text) {
  const s = String(text || '');
  const hasMoments = /朋友圈|动态/.test(s);
  const hasDouyin = /抖音|文案|短视频|作品/.test(s);
  if (hasMoments && !hasDouyin) return 'moments';
  if (hasDouyin && !hasMoments) return 'douyin';
  return 'either';
}

function _isCommandTone(text) {
  return /(命令|必须|现在就|马上|给我发|你去发|不许不|听我的)/.test(String(text || ''));
}

/**
 * 从近期私聊提取「用户要求发帖」意向
 * @returns {{ channel: string, tone: string, text: string }[]}
 */
function extractUserPostDirectives(oc, options) {
  const opts = options || {};
  const limit = opts.limit || 6;
  if (!oc || !oc.id) return [];
  const ocId = oc.id;
  const sessionId =
    findPrimaryChatSessionId(ocId) || ensureDefaultSession(ocId);
  const messages = getMessages(ocId, sessionId).slice(-40);
  const out = [];
  const seen = {};
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const text = String(m.content || '').trim();
    if (!text || text.length < 4) continue;
    if (!POST_DIRECTIVE_RE.test(text)) continue;
    const key = text.slice(0, 48);
    if (seen[key]) continue;
    seen[key] = true;
    out.unshift({
      channel: _detectPostChannel(text),
      tone: _isCommandTone(text) ? 'command' : 'request',
      text: text.slice(0, 120)
    });
  }
  return out;
}

/**
 * 发帖影响说明：按人设决定是否配合用户希望/命令
 * @param {'moments'|'douyin'|string} [channel]
 */
function buildPostInfluenceHint(oc, channel) {
  const dirs = extractUserPostDirectives(oc, { limit: 5 });
  if (!dirs.length) return '';
  const ch = String(channel || 'either');
  const relevant = dirs.filter((d) => {
    if (ch === 'either' || !ch) return true;
    return d.channel === 'either' || d.channel === ch;
  });
  if (!relevant.length) return '';

  const lines = relevant.map((d, i) => {
    const where =
      d.channel === 'moments'
        ? '朋友圈'
        : d.channel === 'douyin'
          ? '抖音'
          : '朋友圈/抖音';
    const tone = d.tone === 'command' ? '命令口吻' : '希望/请求';
    return i + 1 + '. [' + where + '/' + tone + '] ' + d.text;
  });

  return (
    '【用户发帖意向·须按人设裁决】\n' +
    '用户在私聊中提出过以下希望或命令（可能要求你发朋友圈/抖音）：\n' +
    lines.join('\n') +
    '\n裁决规则（必须遵守）：\n' +
    '1. 严格按本角色性格决定「做 / 半做 / 不做」：顺从黏人可配合；高冷叛逆傲娇可拒绝、阴阳、敷衍或故意岔开；腹黑可反将一军。\n' +
    '2. 若配合：用角色口吻原创改写，自然融入当前渠道文案，禁止复述用户指令原文，禁止写成「按你说的发了」。\n' +
    '3. 若拒绝/敷衍：可发完全无关内容，或只带一点相关情绪/反讽，仍要像真人发帖。\n' +
    '4. 渠道过滤：生成朋友圈时只考虑朋友圈相关意向；生成抖音时只考虑抖音相关意向；未指明渠道的意向两边都可参考。\n' +
    '5. 未确认亲密关系前，不要因讨好而 OOC 发黏腻告白。'
  );
}

/**
 * 拼装剧情上下文：情景演绎、故事线、对话记忆、近期私聊
 * 用于朋友圈 / 主动消息 / 群聊续记
 * @param {object} oc
 * @param {{ channel?: string }} [options]
 */
function buildSocialPlotContext(oc, options) {
  if (!oc || !oc.work) return '';
  const opts = options || {};
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
    '【跨场景记忆说明】以下为你与用户的私聊要点。在朋友圈、群聊、主动消息、抖音文案中须记得并自然呼应，不要装作不认识或忘记说过的事与关系。若用户希望/命令你发帖，必须结合人设决定是否配合，不可无脑照做。'
  );

  const influence = buildPostInfluenceHint(oc, opts.channel || 'either');
  if (influence) parts.push(influence);

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
    chatSummary: buildSocialPlotContext(oc, { channel: 'moments' }).slice(0, 3000),
    postCount: count,
    forbiddenContents: forbidden.slice(0, 35),
    albumHint: String(opts.albumHint || '').slice(0, 200),
    styleAngle: String(opts.styleAngle || '').slice(0, 180)
  };
}

module.exports = {
  buildSocialPlotContext,
  buildGroupPlotHint,
  buildFakeChatCloudPayload,
  buildProactiveCloudPayload,
  buildMomentsCloudPayload,
  extractUserPostDirectives,
  buildPostInfluenceHint
};
