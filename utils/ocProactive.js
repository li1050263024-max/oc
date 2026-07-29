const { buildOcPromptFromWork } = require('./ocContext.js');
const { listSessions, getMessages } = require('./chatSession.js');
const { normalizeForDedupe } = require('./ocSocialDedupe.js');
const {
  buildProactiveSceneContext,
  pickThemedProactiveScenes,
  inferThemeTags,
  extractProactiveSceneSignature,
  isSceneSignatureConflict,
  buildDoingNowTexts,
  buildGreetingTexts,
  assignMessageKindsForBatch,
  MESSAGE_KIND_LABELS
} = require('./ocProactiveScenes.js');

const TOPIC_BY_KIND = {
  morning: [
    '早安问候（刚起床或刚开始一天）',
    '提醒吃早饭、开始新一天'
  ],
  evening: [
    '晚安或睡前关心',
    '提醒早点休息、别熬夜'
  ],
  greeting: [
    '日常打招呼、轻轻喊一声',
    '用角色习惯的方式开口问候'
  ],
  care: [
    '关心对方吃饭休息、别太累',
    '提醒注意冷暖、照顾身体'
  ],
  checkin: [
    '轻问近况、来聊两句',
    '用口头禅或性格特点开头问候'
  ],
  miss: [
    '贴合性格表达想念或盼对方找来',
    '傲娇/活泼可口硬催促，温柔/粘人可软语想念'
  ]
};

const TOPIC_DIRECTIONS = [
  '早安问候（刚起床或刚开始一天）',
  '晚安或睡前关心',
  '日常打招呼、轻轻喊一声',
  '关心对方吃饭休息、别太累',
  '轻问近况、来聊两句',
  '用角色习惯的方式开口问候',
  '结合世界观/身份的特有问候'
];

const OPENING_STYLES = [
  '短句直球，像随手发的',
  '先半句性格化吐槽或自嘲，再接问候',
  '用角色口吻称呼对方',
  '疑问句或祈使句结尾',
  '带一点克制的小情绪',
  '傲娇式明明想找却嘴硬',
  '温柔一句不加理由',
  '结合世界观/身份的特有语气'
];

const PROACTIVE_ACTION_SNIPPETS = [
  '把耳机从耳朵上摘下来，垂在领口',
  '两手捧着刚加热的外卖盒，烫得换了个手',
  '低头划了两下手机屏幕又锁屏',
  '把笔帽扣上，往桌角一推',
  '顺手把椅子往桌边挪了半寸',
  '用袖口擦了擦杯沿上的水渍',
  '单膝跪在地板上找掉落的扣子',
  '把快递盒侧过来，找剪刀',
  '站在洗手池前拧开水龙头',
  '把伞上的水珠甩在台阶边'
];

function pickProactiveAction(seed) {
  const list = PROACTIVE_ACTION_SNIPPETS;
  if (!list.length) return '把手里的东西搁下';
  return list[Math.abs(Number(seed) || 0) % list.length];
}

const BANNED_PATTERN =
  /AI|助手|小程序|上线|作为|综上所述|该角色|很高兴认识你|用户近期/i;

const LIFE_SNIPPET_PATTERN =
  /外卖|快递|拆袋|微波炉|等电梯|没拆的|筷子找|加载圈|胶带扯|耳机线绕|洗衣机的节奏|关东煮|便利店的|垃圾袋系紧|削苹果|公交卡贴|猫开罐头|绿植浇完/i;

const TEMPLATE_PATTERN =
  /刚才又路过|街角那家店还亮着灯|买了杯热的站了一会儿|今天状态还是老样子|又犯了老毛病|脑子里突然蹦出一句|今天在外面撞见点|今天没什么大事，就是刚才整理桌子|翻到一个旧笔记|翻相册时撞见|旧笔记|字都糊了|塑料袋勒|手里的塑料袋|缩在便利店门口把关东煮/i;

function proactiveStorageKey(ocId) {
  return 'oc_proactive_' + String(ocId || '').trim();
}

function localDateKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getProactiveMeta(ocId) {
  if (!ocId) {
    return {
      lastDate: '',
      lastMessage: '',
      recentMessages: [],
      recentTopics: [],
      pauseDate: '',
      userReplyDate: ''
    };
  }
  const raw = wx.getStorageSync(proactiveStorageKey(ocId)) || {};
  return {
    lastDate: String(raw.lastDate || ''),
    lastMessage: String(raw.lastMessage || ''),
    recentMessages: Array.isArray(raw.recentMessages)
      ? raw.recentMessages.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 5)
      : [],
    recentTopics: Array.isArray(raw.recentTopics)
      ? raw.recentTopics.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 5)
      : [],
    pauseDate: String(raw.pauseDate || ''),
    userReplyDate: String(raw.userReplyDate || '')
  };
}

function setProactiveMeta(ocId, patch) {
  if (!ocId) return;
  const prev = getProactiveMeta(ocId);
  const next = Object.assign({}, prev, patch || {});
  if (Array.isArray(next.recentMessages)) {
    next.recentMessages = next.recentMessages.slice(0, 5);
  }
  if (Array.isArray(next.recentTopics)) {
    next.recentTopics = next.recentTopics.slice(0, 5);
  }
  try {
    wx.setStorageSync(proactiveStorageKey(ocId), next);
  } catch (e) {
    console.warn('[ocProactive] storage write failed', e);
  }
}

function shouldGenerateProactiveToday(ocId, now) {
  const meta = getProactiveMeta(ocId);
  return meta.lastDate !== localDateKey(now);
}

function ocDiversitySeed(oc, salt) {
  const id = String((oc && oc.id) || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) + (Number(salt) || 0);
}

function pickFromPoolBySeed(pool, seed) {
  const list = pool && pool.length ? pool : [];
  if (!list.length) return '';
  return list[Math.abs(Number(seed) || 0) % list.length];
}

function pickTopicDirectionForKind(oc, recentTopics, salt, messageKind) {
  const kind = messageKind || 'greeting';
  const pool = (TOPIC_BY_KIND[kind] || TOPIC_DIRECTIONS).slice();
  const used = {};
  (recentTopics || []).forEach((t) => {
    if (t) used[t] = true;
  });
  const fresh = pool.filter((d) => !used[d]);
  const list = fresh.length ? fresh : pool;
  return pickFromPoolBySeed(list, ocDiversitySeed(oc, salt) + kind.length * 7);
}

function pickTopicDirectionForOc(oc, recentTopics, salt, messageKind) {
  if (messageKind) {
    return pickTopicDirectionForKind(oc, recentTopics, salt, messageKind);
  }
  const used = {};
  (recentTopics || []).forEach((t) => {
    if (t) used[t] = true;
  });
  const fresh = TOPIC_DIRECTIONS.filter((d) => !used[d]);
  const pool = fresh.length ? fresh : TOPIC_DIRECTIONS.slice();
  const work = (oc && oc.work) || {};
  const tags = inferThemeTags(work, oc);
  const weighted = pool.slice().sort((a, b) => {
    const score = (topic) => {
      let s = 0;
      if (tags.lifeEvent && topic.indexOf('人生事件') >= 0) s += 3;
      if (tags.bio && topic.indexOf('小传') >= 0) s += 3;
      if (tags.worldview && topic.indexOf('世界观') >= 0) s += 3;
      if (tags.personality && topic.indexOf('性格') >= 0) s += 2;
      return s;
    };
    return score(b) - score(a);
  });
  return pickFromPoolBySeed(weighted, ocDiversitySeed(oc, salt));
}

function pickOpeningStyleForOc(oc, recentMessages, salt) {
  const starts = {};
  (recentMessages || []).forEach((m) => {
    const t = normalizeProactiveText(m);
    if (t.length >= 2) starts[t.slice(0, 2)] = true;
  });
  const fresh = OPENING_STYLES.filter((s) => {
    const hint = s.slice(0, 2);
    return !starts[hint];
  });
  const pool = fresh.length ? fresh : OPENING_STYLES.slice();
  return pickFromPoolBySeed(pool, ocDiversitySeed(oc, salt + 17));
}

function pickTopicDirection(recentTopics) {
  const used = {};
  (recentTopics || []).forEach((t) => {
    if (t) used[t] = true;
  });
  const fresh = TOPIC_DIRECTIONS.filter((d) => !used[d]);
  const pool = fresh.length ? fresh : TOPIC_DIRECTIONS.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickOpeningStyle(recentMessages) {
  const starts = {};
  (recentMessages || []).forEach((m) => {
    const t = normalizeProactiveText(m);
    if (t.length >= 2) starts[t.slice(0, 2)] = true;
  });
  const fresh = OPENING_STYLES.filter((s) => {
    const hint = s.slice(0, 2);
    return !starts[hint];
  });
  const pool = fresh.length ? fresh : OPENING_STYLES.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildProactiveSystemPrompt(oc, storageId) {
  const work = (oc && oc.work) || {};
  const name =
    (oc && oc.name) || (work.result && work.result.name) || '该角色';
  const setting = buildOcPromptFromWork(work) || '（设定待补充）';
  const bio = String(
    (work && work.generatedBio) || (oc && oc.bioText) || ''
  ).trim();
  const meta = getProactiveMeta(oc && oc.id);
  const historyBlock = meta.recentMessages.length
    ? meta.recentMessages.map((s, i) => i + 1 + '. ' + s).join('\n')
    : '无';

  let prompt =
    '你是【' +
    name +
    '】，正在用即时通讯软件给熟人发一条消息。你不是 AI，不要提及模型、程序、用户、上线、打开小程序等。\n' +
    '【身份与口吻】\n' +
    '- 常用语是口吻基础；小传可改写、细化说话方式。小传与常用语冲突时以小传口吻为准。\n' +
    '- 严格按下方设定与小传行事；口语化像真人打字。\n' +
    '【这条消息在写什么 — 必须遵守】\n' +
    '- 只写一条：打招呼、早安晚安、关怀体贴、轻问近况、或贴合性格的想念/嘴硬催促之一。\n' +
    '- 必须贴合角色性格与【已有关系阶段】：未确认恋人/亲密关系前，禁止「想你了」「宝贝」等强亲密；可友好问候、嘴硬催回复。\n' +
    '- 禁止生活琐事（外卖/快递/做饭/通勤等）。\n' +
    '- 若有私聊记忆，可自然带一点共同话题，但不要复述整段聊天。\n' +
    '- 不要接用户上一句具体聊天内容、不要提「你上次说过」、不要解释为什么发消息。\n' +
    '【格式范例】\n' +
    '早安，今天记得吃早饭。\n' +
    '嗨，在吗？来打个招呼。\n' +
    '夜深了，早点休息别熬夜。\n' +
    '别太累了，忙完歇一歇。\n' +
    '……别装看不见，回我一句。\n' +
    '最近怎么样？\n' +
    '【句式多样性】\n' +
    '- 每条消息的开头、句式须不同；禁止套用固定模板；与【近期已发】前 12 字不得相同。\n' +
    '【输出格式】\n' +
    '- 只输出 1 条正文；12～55 汉字；禁止换行、编号、引号包裹。\n' +
    '【角色设定】\n' +
    setting.slice(0, 4200);

  if (bio) {
    prompt += '\n【人物小传（补全经历与关系；可据此改口吻，勿照抄原句）】\n' + bio.slice(0, 2000);
  }

  try {
    const { buildSocialPlotContext } = require('./ocSocialContext.js');
    const plot = buildSocialPlotContext(oc);
    if (plot) {
      prompt +=
        '\n【与用户的私聊记忆·须遵守关系节奏】\n' +
        plot.slice(0, 1600) +
        '\n未在记忆中确认亲密关系前，问候保持克制友好，勿默认恋爱口吻。';
    }
  } catch (_) {}

  if (storageId) {
    const ctx = buildProactiveSceneContext(oc, storageId, Date.now());
    if (ctx.likes) {
      prompt += '\n- 问候时可自然带出「' + ctx.likes + '」相关的小细节，但不要写成生活流水账。';
    }
    if (ctx.worldviewShort) {
      prompt += '\n- 称呼与语气须贴合「' + ctx.worldviewShort + '」世界观，勿写成通用现代都市琐事。';
    }
    if (ctx.personality) {
      prompt += '\n- 问候方式要体现「' + ctx.personality + '」式性格。';
    }
    if (ctx.phrase) {
      prompt += '\n- 可化用口头禅「' + ctx.phrase + '」，须改写勿照抄。';
    }
  }

  prompt +=
    '\n【近期已发过的主动消息（必须避开相同开头与句式）】\n' + historyBlock;

  return prompt;
}

function buildProactiveUserMessage(
  topicDirection,
  openingStyle,
  forbiddenList,
  tagHint,
  sceneBrief,
  batchSceneBriefs,
  preferMissUser,
  messageKind
) {
  const kind = messageKind || 'greeting';
  const kindLabel = MESSAGE_KIND_LABELS[kind] || '日常问候';
  const topic =
    topicDirection ||
    pickFromPoolBySeed(TOPIC_BY_KIND[kind] || TOPIC_DIRECTIONS, Date.now());
  const opening =
    openingStyle ||
    OPENING_STYLES[Math.floor(Math.random() * OPENING_STYLES.length)];
  let msg =
    '请生成唯一一条主动消息。\n' +
    '【本条类型】' +
    kindLabel +
    '\n' +
    '主题方向：' +
    topic +
    '\n' +
    '开头方式：' +
    opening +
    '\n' +
    '硬性要求：必须属于本条类型且贴合角色性格；' +
    '温柔/粘人可表达想念，傲娇/活泼可口硬催促，冷淡克制者保持简短；' +
    '禁止生活琐事；' +
    '不要编号、不要引号、不要列表。只输出一条正文。';
  if (tagHint) {
    msg += '\n【题材标签（仅定方向，勿抄任何已有句子）】' + String(tagHint).slice(0, 40);
  }
  if (sceneBrief) {
    msg +=
      '\n【本角色建议问候方向（须全新改写，语气须贴合人设且不得与同批其他角色雷同）】' +
      String(sceneBrief).slice(0, 80);
  }
  if (batchSceneBriefs && batchSceneBriefs.length) {
    msg +=
      '\n\n【同批次其他 OC 已发内容，本条必须完全不同类型与开头】\n' +
      batchSceneBriefs
        .slice(0, 8)
        .map((s, i) => i + 1 + '. ' + String(s).slice(0, 48))
        .join('\n');
  }
  const forbidden = (forbiddenList || []).filter(Boolean).slice(0, 24);
  if (forbidden.length) {
    msg +=
      '\n\n【禁止重复·以下文案已出现过，不得相同或高度雷同】\n' +
      forbidden
        .map((s, i) => i + 1 + '. ' + String(s).trim().slice(0, 72))
        .join('\n');
  }
  return msg;
}

function countHan(text) {
  const m = String(text || '').match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

function normalizeProactiveText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r?\n+/g, '')
    .replace(/^[\s"'「『【]+|[\s"'」』】]+$/g, '')
    .replace(/^\d+[\.\、\)\]]\s*/, '')
    .replace(/·[a-z0-9]{3,12}\d*$/i, '')
    .replace(/在吗[·.\s]*[a-z0-9]{2,}$/i, '')
    .replace(/\s+/g, '')
    .trim();
}

function truncateToHanLimit(text, maxHan) {
  const s = String(text || '');
  let han = 0;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/[\u4e00-\u9fff]/.test(ch)) han += 1;
    out += ch;
    if (han >= maxHan) break;
  }
  const period = out.indexOf('。');
  if (period >= 20 && han > maxHan) {
    return out.slice(0, period + 1);
  }
  return out;
}

function isDuplicateOfForbidden(text, forbiddenList) {
  const t = normalizeForDedupe(normalizeProactiveText(text));
  if (!t || t.length < 4) return false;
  for (let i = 0; i < (forbiddenList || []).length; i++) {
    const nf = normalizeForDedupe(forbiddenList[i]);
    if (!nf || nf.length < 4) continue;
    if (t === nf) return true;
    if (t.slice(0, 10) === nf.slice(0, 10) && t.slice(0, 10).length >= 8) return true;
    if (t.slice(0, 8) === nf.slice(0, 8) && t.slice(0, 8).length >= 6) return true;
    if (nf.length >= 14 && t.length >= 14 && (nf.includes(t) || t.includes(nf))) return true;
  }
  return false;
}

function hasActionParenthesis(text) {
  return /（[^）]{2,40}）/.test(String(text || ''));
}

function validateProactiveMessage(
  text,
  recentMessages,
  forbiddenList,
  forbiddenSceneSignatures,
  batchOpeners,
  messageKind
) {
  let t = normalizeProactiveText(text);
  if (!t) return { ok: false, reason: 'empty' };

  if (BANNED_PATTERN.test(t)) return { ok: false, reason: 'banned' };
  if (LIFE_SNIPPET_PATTERN.test(t)) return { ok: false, reason: 'life_snippet' };
  if (TEMPLATE_PATTERN.test(t)) return { ok: false, reason: 'template' };
  if (/\n/.test(t)) return { ok: false, reason: 'multiline' };
  if (isDuplicateOfForbidden(t, forbiddenList)) {
    return { ok: false, reason: 'forbidden', text: t };
  }
  const opener = t.slice(0, 6);
  for (let i = 0; i < (batchOpeners || []).length; i++) {
    const o = String(batchOpeners[i] || '');
    if (o && opener && opener === o) {
      return { ok: false, reason: 'batch_opener', text: t };
    }
  }
  const sig = extractProactiveSceneSignature(t, messageKind);
  if (isSceneSignatureConflict(sig, forbiddenSceneSignatures)) {
    return { ok: false, reason: 'scene_conflict', text: t };
  }

  let han = countHan(t);
  if (han > 55) {
    t = truncateToHanLimit(t, 55);
    han = countHan(t);
  }
  if (han < 8) return { ok: false, reason: 'length', text: t };
  if (han > 55) return { ok: false, reason: 'length', text: t };

  const recents = Array.isArray(recentMessages)
    ? recentMessages
    : recentMessages
      ? [recentMessages]
      : [];
  for (let i = 0; i < recents.length; i++) {
    const last = normalizeProactiveText(recents[i]);
    if (!last) continue;
    if (t.slice(0, 12) === last.slice(0, 12)) {
      return { ok: false, reason: 'same_start', text: t };
    }
    if (t.slice(0, 6) === last.slice(0, 6)) {
      return { ok: false, reason: 'same_start', text: t };
    }
    if (t === last) return { ok: false, reason: 'duplicate', text: t };
  }

  return { ok: true, text: t };
}

function recordProactiveSuccess(ocId, message, topicDirection, now) {
  const meta = getProactiveMeta(ocId);
  const recentMessages = [message]
    .concat(meta.recentMessages || [])
    .filter(Boolean)
    .slice(0, 5);
  const recentTopics = topicDirection
    ? [topicDirection]
        .concat(meta.recentTopics || [])
        .filter((t, i, arr) => t && arr.indexOf(t) === i)
        .slice(0, 5)
    : meta.recentTopics || [];

  setProactiveMeta(ocId, {
    lastDate: localDateKey(now),
    lastOpenAt: Number(now) || Date.now(),
    lastMessage: message,
    recentMessages,
    recentTopics,
    pauseDate: ''
  });
}

function collectOcChatMessages(ocId) {
  const { resolveOcChatStorageIds } = require('./ocChatHistory.js');
  const ids = resolveOcChatStorageIds(ocId);
  let msgs = [];
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const sessions = listSessions(id);
    for (let i = 0; i < sessions.length; i++) {
      msgs = msgs.concat(getMessages(id, sessions[i].id) || []);
    }
    if (!msgs.length) {
      try {
        const legacy = wx.getStorageSync('oc_chat_' + id);
        if (Array.isArray(legacy)) msgs = legacy;
      } catch (e) {}
    }
  }
  return msgs;
}

function isTodayFakeAssistantMessage(m, todayKey) {
  if (!m || m.role !== 'assistant') return false;
  if (!m._proactive && !m._fakeSocial) return false;
  const ts = Number(m.fakeAt) || 0;
  if (!ts) return false;
  return localDateKey(ts) === todayKey;
}

function getTodayLastProactiveIndex(msgs, todayKey) {
  let lastFakeIdx = -1;
  for (let i = 0; i < (msgs || []).length; i++) {
    if (isTodayFakeAssistantMessage(msgs[i], todayKey)) {
      lastFakeIdx = i;
    }
  }
  return lastFakeIdx;
}

function hasTodayProactiveMessage(ocId, now) {
  const todayKey = localDateKey(now || Date.now());
  const msgs = collectOcChatMessages(ocId);
  for (let i = 0; i < msgs.length; i++) {
    if (isTodayFakeAssistantMessage(msgs[i], todayKey)) return true;
  }
  return false;
}

function hasUnrepliedTodayProactive(ocId, now) {
  const todayKey = localDateKey(now);
  const msgs = collectOcChatMessages(ocId);
  const lastFakeIdx = getTodayLastProactiveIndex(msgs, todayKey);
  if (lastFakeIdx < 0) return false;

  for (let j = lastFakeIdx + 1; j < msgs.length; j++) {
    const m = msgs[j];
    if (m && m.role === 'user' && String(m.content || '').trim()) {
      return false;
    }
  }
  return true;
}

function userRepliedAfterTodayProactive(ocId, now) {
  const todayKey = localDateKey(now);
  const { resolveOcChatStorageIds } = require('./ocChatHistory.js');
  if (
    resolveOcChatStorageIds(ocId).some(
      (id) => getProactiveMeta(id).userReplyDate === todayKey
    )
  ) {
    return true;
  }

  return !hasUnrepliedTodayProactive(ocId, now);
}

function markUserChattedToday(ocId, now) {
  if (!ocId) return;
  const t = Number(now) || Date.now();
  const todayKey = localDateKey(t);
  if (!hasTodayProactiveMessage(ocId, t)) return;
  const { resolveOcChatStorageIds } = require('./ocChatHistory.js');
  resolveOcChatStorageIds(ocId).forEach((id) => {
    setProactiveMeta(id, {
      userReplyDate: todayKey,
      pauseDate: ''
    });
  });
}

function shouldInjectProactiveForOc(ocId, todayOpenCount, now) {
  const t = Number(now) || Date.now();
  const todayKey = localDateKey(t);
  const { resolveOcChatStorageIds } = require('./ocChatHistory.js');
  const aliasIds = resolveOcChatStorageIds(ocId);

  aliasIds.forEach((id) => {
    const meta = getProactiveMeta(id);
    const patch = {};
    if (meta.lastDate === todayKey && !hasTodayProactiveMessage(ocId, t)) {
      patch.lastDate = '';
      patch.pauseDate = '';
    }
    if (meta.userReplyDate && meta.userReplyDate !== todayKey) {
      patch.userReplyDate = '';
    }
    if (meta.pauseDate && meta.pauseDate !== todayKey) {
      patch.pauseDate = '';
    }
    if (Object.keys(patch).length) setProactiveMeta(id, patch);
  });

  if (hasUnrepliedTodayProactive(ocId, t)) {
    return false;
  }

  if (hasTodayProactiveMessage(ocId, t)) {
    return aliasIds.some((id) => getProactiveMeta(id).userReplyDate === todayKey);
  }

  return true;
}

/** @returns {string} 空字符串表示可注入；否则为跳过原因 */
function getProactiveInjectBlockReason(ocId, now) {
  const t = Number(now) || Date.now();
  const todayKey = localDateKey(t);
  if (hasUnrepliedTodayProactive(ocId, t)) {
    return 'unreplied_today';
  }
  if (hasTodayProactiveMessage(ocId, t)) {
    const { resolveOcChatStorageIds } = require('./ocChatHistory.js');
    const aliasIds = resolveOcChatStorageIds(ocId);
    if (aliasIds.some((id) => getProactiveMeta(id).userReplyDate === todayKey)) {
      return '';
    }
    return 'already_sent_today';
  }
  return '';
}

function buildProactiveCloudPayload(
  oc,
  topicDirection,
  openingStyle,
  forbiddenList,
  storageId,
  seed,
  batchIndex,
  forbiddenSceneSignatures,
  batchSceneBriefs,
  messageKind,
  batchOpeners
) {
  const s = Number(seed) || Date.now();
  const divSeed = ocDiversitySeed(oc, s);
  const kind = messageKind || 'greeting';
  const sceneCandidates = storageId
    ? pickThemedProactiveScenes(
        oc,
        storageId,
        s,
        20,
        forbiddenList,
        batchIndex,
        forbiddenSceneSignatures,
        false,
        kind
      )
    : [];
  const pickIdx =
    sceneCandidates.length > 1
      ? (divSeed + (Number(batchIndex) || 0) * 37) % sceneCandidates.length
      : 0;
  const picked = sceneCandidates[pickIdx];
  const tagHint =
    picked && picked.sceneTags ? picked.sceneTags.join('、') : MESSAGE_KIND_LABELS[kind];
  const sceneBrief = picked && picked.text ? picked.text : '';
  return {
    mode: 'proactive',
    ocName: oc.name || 'OC',
    systemPrompt: buildProactiveSystemPrompt(oc, storageId),
    userMessage: buildProactiveUserMessage(
      topicDirection,
      openingStyle,
      forbiddenList,
      tagHint,
      sceneBrief,
      batchSceneBriefs,
      false,
      kind
    ),
    forbiddenContents: (forbiddenList || []).slice(0, 30),
    temperature: 0.84 + (divSeed % 13) / 100,
    postCount: 1
  };
}

function shuffleList(arr) {
  const a = (arr || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function buildGuaranteedProactiveMessage(
  oc,
  seed,
  storageId,
  forbiddenList,
  batchIndex,
  forbiddenSceneSignatures,
  messageKind,
  batchOpeners
) {
  const sid = storageId || (oc && oc.id);
  const kind = messageKind || 'greeting';
  const candidates = pickThemedProactiveScenes(
    oc,
    sid,
    seed,
    32,
    forbiddenList,
    batchIndex,
    forbiddenSceneSignatures,
    false,
    kind
  );
  for (let i = 0; i < candidates.length; i++) {
    const check = validateProactiveMessage(
      candidates[i].text,
      [],
      forbiddenList,
      forbiddenSceneSignatures,
      batchOpeners,
      kind
    );
    if (check.ok) return check.text;
  }
  const ctx = buildProactiveSceneContext(oc, sid, seed);
  const texts = buildGreetingTexts(ctx, ocDiversitySeed(oc, seed + batchIndex * 991), { kind: kind });
  const idx = (ocDiversitySeed(oc, seed + batchIndex * 113) + batchIndex * 7) % texts.length;
  return texts[idx] || texts[0];
}

function lastResortProactiveFallback(
  oc,
  seed,
  storageId,
  forbiddenList,
  batchIndex,
  forbiddenSceneSignatures,
  messageKind,
  batchOpeners
) {
  const kind = messageKind || 'greeting';
  const candidates = pickThemedProactiveScenes(
    oc,
    storageId || oc.id,
    seed + 701,
    24,
    forbiddenList,
    batchIndex,
    forbiddenSceneSignatures,
    false,
    kind
  );
  for (let i = 0; i < candidates.length; i++) {
    const check = validateProactiveMessage(
      candidates[i].text,
      [],
      forbiddenList,
      forbiddenSceneSignatures,
      batchOpeners,
      kind
    );
    if (check.ok) return check.text;
  }
  return buildGuaranteedProactiveMessage(
    oc,
    seed + 701,
    storageId,
    forbiddenList,
    batchIndex,
    forbiddenSceneSignatures,
    kind,
    batchOpeners
  );
}

function fallbackProactiveMessage(
  oc,
  topicDirection,
  recentMessages,
  forbiddenList,
  seed,
  storageId,
  batchIndex,
  forbiddenSceneSignatures,
  messageKind,
  batchOpeners
) {
  const recents = recentMessages || [];
  const rngSeed = ocDiversitySeed(oc, seed || Date.now());
  const sid = storageId || oc.id;
  const kind = messageKind || 'greeting';
  const candidates = pickThemedProactiveScenes(
    oc,
    sid,
    rngSeed,
    40,
    forbiddenList,
    batchIndex,
    forbiddenSceneSignatures,
    false,
    kind
  );

  for (let i = 0; i < candidates.length; i++) {
    const text = candidates[i].text;
    const check = validateProactiveMessage(
      text,
      recents,
      forbiddenList,
      forbiddenSceneSignatures,
      batchOpeners,
      kind
    );
    if (check.ok) return check.text;
  }

  return lastResortProactiveFallback(
    oc,
    rngSeed + candidates.length,
    sid,
    forbiddenList,
    batchIndex,
    forbiddenSceneSignatures,
    kind,
    batchOpeners
  );
}

function callProactiveCloud(payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('no cloud'));
      return;
    }
    wx.cloud.callFunction({
      name: 'generateOcFakeChat',
      data: payload,
      timeout: 45000,
      success: (res) => {
        const r = (res && res.result) || {};
        if (r.ok && Array.isArray(r.messages) && r.messages.length) {
          const content = String(
            (r.messages[0] && r.messages[0].content) || r.messages[0] || ''
          ).trim();
          if (content) {
            resolve(content);
            return;
          }
        }
        reject(new Error(r.errMsg || '生成失败'));
      },
      fail: (err) => reject(err || new Error('云函数失败'))
    });
  });
}

function pickUltimateGreeting(oc, storageId, seed, recentMessages, messageKind, batchOpeners) {
  const sid = storageId || (oc && oc.id);
  const kind = messageKind || 'greeting';
  const ctx = buildProactiveSceneContext(oc, sid, seed);
  const texts = buildGreetingTexts(ctx, seed, { kind: kind });
  const recents = recentMessages || [];
  for (let i = 0; i < texts.length; i++) {
    const raw = texts[(Math.abs(Number(seed) || 0) + i) % texts.length];
    const t = normalizeProactiveText(raw);
    if (countHan(t) < 8) continue;
    if (BANNED_PATTERN.test(t) || LIFE_SNIPPET_PATTERN.test(t) || TEMPLATE_PATTERN.test(t)) {
      continue;
    }
    const check = validateProactiveMessage(
      t,
      recents,
      [],
      [],
      batchOpeners,
      kind
    );
    if (check.ok) return check.text;
  }
  const fallback = normalizeProactiveText(texts[0] || '嗨，在吗？');
  return countHan(fallback) >= 8 ? fallback : '嗨，在吗？来打个招呼。';
}

async function generateProactiveMessageForOc(oc, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const storageId = opts.storageId || oc.chatStorageId || oc.id;
  const batchIndex = Number(opts.batchIndex) || 0;
  const meta = getProactiveMeta(storageId);
  const forbidden = (opts.forbidden || []).slice();
  const forbiddenSceneSignatures = (opts.forbiddenSceneSignatures || []).slice();
  const batchSceneBriefs = (opts.batchSceneBriefs || []).slice();
  const batchOpeners = (opts.batchOpeners || []).slice();
  const messageKind = opts.messageKind || 'greeting';
  const localOnly = !!opts.localOnly;
  const usedTopics = opts.excludeTopics || meta.recentTopics || [];
  let topic = pickTopicDirectionForOc(oc, usedTopics, now, messageKind);
  let opening = pickOpeningStyleForOc(oc, meta.recentMessages, now);
  let lastErr = null;

  const validateOpts = [
    meta.recentMessages,
    forbidden,
    forbiddenSceneSignatures,
    batchOpeners,
    messageKind
  ];

  if (!localOnly) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        topic = pickTopicDirectionForOc(
          oc,
          usedTopics.concat([topic]),
          now + attempt * 31,
          messageKind
        );
        opening = pickOpeningStyleForOc(oc, meta.recentMessages, now + attempt * 47);
      }
      try {
        const payload = buildProactiveCloudPayload(
          oc,
          topic,
          opening,
          forbidden,
          storageId,
          now + attempt,
          batchIndex + attempt,
          forbiddenSceneSignatures,
          batchSceneBriefs,
          messageKind,
          batchOpeners
        );
        const raw = await callProactiveCloud(payload);
        const check = validateProactiveMessage(raw, ...validateOpts);
        if (check.ok) {
          return { content: check.text, topicDirection: topic, source: 'cloud' };
        }
        lastErr = new Error(check.reason || 'validate failed');
      } catch (e) {
        lastErr = e;
      }
    }
  }

  for (let fbAttempt = 0; fbAttempt < 8; fbAttempt++) {
    const fb = fallbackProactiveMessage(
      oc,
      topic,
      meta.recentMessages,
      forbidden,
      now + fbAttempt * 59,
      storageId,
      batchIndex + fbAttempt,
      forbiddenSceneSignatures,
      messageKind,
      batchOpeners
    );
    const check = validateProactiveMessage(fb, ...validateOpts);
    if (check.ok) {
      return { content: check.text, topicDirection: topic, source: 'fallback' };
    }
  }

  const last = lastResortProactiveFallback(
    oc,
    now,
    storageId,
    forbidden,
    batchIndex,
    forbiddenSceneSignatures,
    messageKind,
    batchOpeners
  );
  const check = validateProactiveMessage(last, ...validateOpts);
  if (check.ok) {
    return { content: check.text, topicDirection: topic, source: 'fallback_last' };
  }

  const relaxed = truncateToHanLimit(normalizeProactiveText(last), 55);
  if (
    countHan(relaxed) >= 8 &&
    !BANNED_PATTERN.test(relaxed) &&
    !LIFE_SNIPPET_PATTERN.test(relaxed) &&
    !TEMPLATE_PATTERN.test(relaxed) &&
    !isDuplicateOfForbidden(relaxed, forbidden) &&
    !isSceneSignatureConflict(
      extractProactiveSceneSignature(relaxed, messageKind),
      forbiddenSceneSignatures
    )
  ) {
    return { content: relaxed, topicDirection: topic, source: 'fallback_relaxed' };
  }

  const guaranteed = buildGuaranteedProactiveMessage(
    oc,
    now + batchIndex,
    storageId,
    forbidden,
    batchIndex,
    forbiddenSceneSignatures,
    messageKind,
    batchOpeners
  );
  const guaranteedCheck = validateProactiveMessage(guaranteed, ...validateOpts);
  if (guaranteedCheck.ok) {
    return { content: guaranteedCheck.text, topicDirection: topic, source: 'guaranteed' };
  }

  const ultimate = pickUltimateGreeting(
    oc,
    storageId,
    now + batchIndex * 17,
    meta.recentMessages,
    messageKind,
    batchOpeners
  );
  if (ultimate) {
    return { content: ultimate, topicDirection: topic, source: 'guaranteed' };
  }

  throw lastErr || new Error('主动消息生成失败');
}

module.exports = {
  TOPIC_DIRECTIONS,
  OPENING_STYLES,
  localDateKey,
  getProactiveMeta,
  setProactiveMeta,
  shouldGenerateProactiveToday,
  shouldInjectProactiveForOc,
  getProactiveInjectBlockReason,
  hasTodayProactiveMessage,
  userRepliedAfterTodayProactive,
  markUserChattedToday,
  pickTopicDirection,
  pickTopicDirectionForOc,
  pickOpeningStyleForOc,
  shuffleList,
  pickOpeningStyle,
  buildProactiveSystemPrompt,
  buildProactiveUserMessage,
  buildProactiveCloudPayload,
  validateProactiveMessage,
  recordProactiveSuccess,
  generateProactiveMessageForOc,
  fallbackProactiveMessage,
  extractProactiveSceneSignature,
  countHan,
  normalizeProactiveText,
  hasActionParenthesis,
  pickProactiveAction,
  PROACTIVE_ACTION_SNIPPETS
};
