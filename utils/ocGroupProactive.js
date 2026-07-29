const { buildOcPromptFromWork } = require('./ocContext.js');
const { personalityBlend, quirkBlend } = require('./ocResult.js');
const { getMessages } = require('./groupChatStore.js');
const {
  normalizeProactiveText,
  countHan,
  truncateToHanLimit
} = require('./ocProactive.js');

function groupProactiveStorageKey(roomId) {
  return 'oc_group_proactive_' + String(roomId || '').trim();
}

function getGroupProactiveMeta(roomId) {
  if (!roomId) {
    return { userReplyAt: 0, lastProactiveAt: 0 };
  }
  const raw = wx.getStorageSync(groupProactiveStorageKey(roomId)) || {};
  return {
    userReplyAt: Number(raw.userReplyAt) || 0,
    lastProactiveAt: Number(raw.lastProactiveAt) || 0
  };
}

function setGroupProactiveMeta(roomId, patch) {
  if (!roomId) return;
  const next = Object.assign({}, getGroupProactiveMeta(roomId), patch || {});
  try {
    wx.setStorageSync(groupProactiveStorageKey(roomId), next);
  } catch (e) {
    console.warn('[ocGroupProactive] storage write failed', e);
  }
}

function isGroupProactiveMessage(m) {
  return !!(
    m &&
    m.role === 'assistant' &&
    (m._proactive || m._fakeSocial) &&
    String(m.content || '').trim()
  );
}

function getLastGroupProactiveIndex(msgs) {
  let idx = -1;
  for (let i = 0; i < (msgs || []).length; i++) {
    if (isGroupProactiveMessage(msgs[i])) idx = i;
  }
  return idx;
}

function userRepliedAfterLastGroupProactive(roomId, sessionId) {
  const msgs = getMessages(roomId, sessionId) || [];
  const lastIdx = getLastGroupProactiveIndex(msgs);
  if (lastIdx < 0) return true;

  const lastFake = msgs[lastIdx];
  const fakeAt = Number(lastFake.fakeAt) || 0;
  const meta = getGroupProactiveMeta(roomId);
  if (meta.userReplyAt && (!fakeAt || meta.userReplyAt >= fakeAt)) {
    return true;
  }

  for (let j = lastIdx + 1; j < msgs.length; j++) {
    const m = msgs[j];
    if (m && m.role === 'user' && String(m.content || '').trim()) {
      return true;
    }
  }
  return false;
}

function markUserChattedInGroup(roomId, now) {
  if (!roomId) return;
  setGroupProactiveMeta(roomId, { userReplyAt: Number(now) || Date.now() });
}

function recordGroupProactiveSent(roomId, now) {
  if (!roomId) return;
  setGroupProactiveMeta(roomId, { lastProactiveAt: Number(now) || Date.now() });
}

/** 群聊主动消息：未回复前不再注入，且不随天数重置 */
function shouldInjectProactiveForGroup(roomId, sessionId, now) {
  const replied = userRepliedAfterLastGroupProactive(roomId, sessionId);
  if (!replied) return false;

  const msgs = getMessages(roomId, sessionId) || [];
  const lastIdx = getLastGroupProactiveIndex(msgs);
  if (lastIdx >= 0) {
    const meta = getGroupProactiveMeta(roomId);
    const fakeAt = Number(msgs[lastIdx].fakeAt) || 0;
    if (meta.userReplyAt < fakeAt) {
      for (let j = lastIdx + 1; j < msgs.length; j++) {
        const m = msgs[j];
        if (m && m.role === 'user' && String(m.content || '').trim()) {
          markUserChattedInGroup(roomId, now);
          break;
        }
      }
    }
  }
  return true;
}

const GROUP_BANNED =
  /AI|助手|小程序|上线|在吗|最近怎么样|想我了吗|今天过得怎么样|有空回我|找你说|作为|综上所述|该角色|南枝：|归舟：|吹雪：/i;

const GROUP_META =
  /群里安静|我来说一句|还没说完|插一句|扫了眼记录|我有话想说|刚上线|刚才的事|那个话题|还可以再聊聊|我还有个看法|我补一句|我这边有个想法|同意一半|有点意思|你也注意到了/i;

const GROUP_TEMPLATE =
  /这事，我琢磨了一下|有空回我|群里有活人吗|冒个泡|刚忙完一阵，想跟你说|冷静点说/i;

const ACTION_SNIPPETS = [
  '把杯子搁在窗台上，指节敲了两下玻璃',
  '顺手把外套搭在椅背上，低头看了眼手机',
  '把耳机摘下来挂在颈间，抬眼',
  '指尖在桌面敲了敲，像在打节拍',
  '把书页折了个角又展平，轻笑一声',
  '侧过身去拨了拨刘海，语气懒懒的',
  '把伞尖点地，发出一声轻响',
  '从口袋里摸出颗糖又塞回去，若有所思'
];

function stripSocialSuffix(text) {
  return normalizeProactiveText(text);
}

function extractRecentLines(groupContext) {
  const ctx = String(groupContext || '');
  const block = ctx.match(/【群聊近期记录[^】]*】([\s\S]*?)(?=【|$)/);
  const body = block ? block[1] : ctx;
  const lines = body
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.indexOf('：') > 0);
  return lines.slice(-8);
}

function pickOtherMemberName(members, ocId) {
  const list = (members || []).filter((m) => m && m.id && m.id !== ocId && m.name);
  if (!list.length) return '';
  return list[Math.floor(Math.random() * list.length)].name;
}

function pickActionSnippet() {
  return ACTION_SNIPPETS[Math.floor(Math.random() * ACTION_SNIPPETS.length)];
}

function buildGroupProactiveSystemPrompt(oc, groupContext, members) {
  const work = (oc && oc.work) || {};
  const name = (oc && oc.name) || (work.result && work.result.name) || '该角色';
  const setting = buildOcPromptFromWork(work) || '（设定待补充）';
  const bio = String((work && work.generatedBio) || (oc && oc.bioText) || '').trim();
  const r = (work && work.result) || {};
  const personality = String(oc.personalityText || personalityBlend(r) || '').trim();
  const memberNames = (members || [])
    .map((m) => m.name)
    .filter(Boolean)
    .join('、');

  let prompt =
    '你是【' +
    name +
    '】，正在 OC 群聊里发 **一条** 角色扮演式消息。你不是 AI，不要提及模型、程序、用户、上线等。\n' +
    '【格式 — 必须遵守】\n' +
    '一条消息 = **动作描写** + **接话台词**，必要时再加半句神态。\n' +
    '- 动作用中文全角括号（）包裹，写具体小动作/神态/环境细节，如：（将伞尖轻轻点地，发出清脆的声响）\n' +
    '- 括号外写口语台词，必须 **回应群里最近话题**，可带一个生活化细节（刚发生的事、手里东西、天气、食物等）。\n' +
    '- 可参考范例：（将伞尖轻轻点地，发出清脆的声响）拍卖会？什么玩意儿能让你这么上心。（微微挑眉）\n' +
    '【禁止】\n' +
    '- 不要「在吗」、不要「群里安静了会儿我来说一句」这类 **元叙述/填空白**。\n' +
    '- 不要「名字：」开头，不要复述上句原文，不要列表、不要换行。\n' +
    '- 禁止：插一句、扫了眼记录、刚才的事还没说完、那个话题还可以聊 等空泛套话。\n' +
    '【与群聊的关系】\n' +
    '- 必须接【群聊上下文】里最近对话的话题或情绪；可 @ 式提到「' +
    (memberNames || '某成员') +
    '」或用户，但要自然。\n' +
    '- 生活片段要 **嵌在动作或台词里**，不要写成与群聊无关的独立日记。\n' +
    '【篇幅】25～110 汉字；只输出 1 条正文。\n' +
    '【角色设定】\n' +
    setting.slice(0, 3600);

  if (bio) {
    prompt += '\n【人物小传·补全经历与关系；可据此改口吻】\n' + bio.slice(0, 1500);
  }
  if (personality) {
    prompt += '\n【性格参考】' + personality.slice(0, 120);
  }

  try {
    const { buildSocialPlotContext } = require('./ocSocialContext.js');
    const plot = buildSocialPlotContext(oc);
    if (plot) {
      prompt +=
        '\n【与用户的私聊记忆·可自然呼应】\n' + plot.slice(0, 1200);
    }
  } catch (_) {}

  if (groupContext) {
    prompt += '\n\n【群聊上下文（必须衔接）】\n' + String(groupContext).slice(0, 3200);
  }

  return prompt;
}

function buildGroupProactiveUserMessage(groupContext) {
  const lines = extractRecentLines(groupContext);
  const tail = lines.length ? lines.slice(-4).join('\n') : '（暂无，可写带动作的开场并提及群成员）';
  return (
    '根据以下群聊最近对话，写唯一一条发言。\n' +
    '硬性要求：至少一处（动作描写），且台词要回应话题；带一个小的生活细节。\n' +
    '最近对话：\n' +
    tail +
    '\n\n只输出一条正文，不要 JSON，不要编号，不要「角色名：」前缀。'
  );
}

function hasActionParenthesis(text) {
  return /（[^）]{2,36}）/.test(String(text || ''));
}

function validateGroupProactiveMessage(text, forbiddenList) {
  let t = stripSocialSuffix(text);
  if (!t) return { ok: false, reason: 'empty' };
  if (GROUP_BANNED.test(t) || GROUP_TEMPLATE.test(t) || GROUP_META.test(t)) {
    return { ok: false, reason: 'banned' };
  }
  if (/\n/.test(t)) return { ok: false, reason: 'multiline' };
  if (/^[「『"\s]*[\u4e00-\u9fff]{1,4}：/.test(t)) {
    return { ok: false, reason: 'name_prefix' };
  }
  if (!hasActionParenthesis(t)) {
    return { ok: false, reason: 'no_action', text: t };
  }

  let han = countHan(t);
  if (han > 110) {
    t = truncateToHanLimit(t, 110);
    han = countHan(t);
  }
  if (han < 22) return { ok: false, reason: 'length', text: t };

  const forbidden = forbiddenList || [];
  for (let i = 0; i < forbidden.length; i++) {
    const f = stripSocialSuffix(forbidden[i]);
    if (!f) continue;
    if (t === f) return { ok: false, reason: 'duplicate', text: t };
    if (t.slice(0, 12) === f.slice(0, 12)) {
      return { ok: false, reason: 'same_start', text: t };
    }
  }

  return { ok: true, text: t };
}

function fallbackGroupProactiveMessage(oc, groupContext, members, forbiddenList) {
  const lines = extractRecentLines(groupContext);
  const lastLine = lines.length ? lines[lines.length - 1] : '';
  const lastColon = lastLine.indexOf('：');
  const lastWho = lastColon > 0 ? lastLine.slice(0, lastColon).trim() : '';
  const lastText = lastColon > 0 ? lastLine.slice(lastColon + 1).trim() : lastLine;
  const other = pickOtherMemberName(members, oc && oc.id);
  const work = (oc && oc.work) || {};
  const r = (work && work.result) || {};
  const quirk = String(oc.quirkText || quirkBlend(r) || '').trim();
  const action = pickActionSnippet();
  const action2 = quirk
    ? '（' + quirk.slice(0, 14) + '，不自觉暴露在脸上）'
    : '（' + action + '）';

  const topic = lastText ? lastText.replace(/^[（(][^）)]*[）)]\s*/, '').slice(0, 16) : '';

  const builders = [];
  if (topic) {
    builders.push(
      () =>
        '（' +
        action +
        '）' +
        (lastWho ? lastWho + '，' : '') +
        '你说的「' +
        topic +
        '」……我这边刚巧也碰上点相关的。',
      () =>
        action2 +
        (lastWho ? '回' + lastWho + '，' : '') +
        topic +
        '？听着就麻烦，不过倒有点意思。',
      () =>
        '（把刚买的咖啡搁在桌上，杯壁还烫手）' +
        (lastWho ? lastWho : '你') +
        '刚提的那件事，我脑子里第一个想到的是雨声。'
    );
  }
  if (other && topic) {
    builders.push(
      () =>
        '（' +
        action +
        '）' +
        other +
        '，你那边怎么看？我手边还摊着刚才没写完的笔记。',
      () =>
        '（侧头看了眼群消息，指尖在屏幕上停了一秒）' +
        other +
        '说的我听到了，就是窗外风有点大。'
    );
  }
  builders.push(
    () =>
      '（' +
      action +
      '）刚路过楼下便利店买了关东煮，还热着——群里刚才聊的，我觉得可以再挖深一点。',
    () =>
      action2 +
      '我这边刚把耳机摘了，你们说的那个点，我记下了。'
  );

  const pool = builders.slice();
  for (let n = 0; n < pool.length + 3; n++) {
    const idx = Math.floor(Math.random() * pool.length);
    const fn = pool.splice(idx, 1)[0];
    if (!fn) break;
    const check = validateGroupProactiveMessage(fn(), forbiddenList);
    if (check.ok) return check.text;
  }

  return (
    '（' +
    pickActionSnippet() +
    '）刚把伞上的水甩了甩，群里刚才说的……我倒是想起一件小事。'
  );
}

function callGroupProactiveCloud(payload) {
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

async function generateGroupProactiveMessageForOc(oc, options) {
  const opts = options || {};
  const groupContext = String(opts.groupContext || '');
  const members = opts.members || [];
  const forbidden = (opts.forbidden || []).slice();

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const payload = {
        mode: 'proactive',
        ocName: oc.name || 'OC',
        systemPrompt: buildGroupProactiveSystemPrompt(oc, groupContext, members),
        userMessage: buildGroupProactiveUserMessage(groupContext),
        postCount: 1
      };
      const raw = await callGroupProactiveCloud(payload);
      const check = validateGroupProactiveMessage(raw, forbidden);
      if (check.ok) {
        return { content: check.text, source: 'cloud' };
      }
      lastErr = new Error(check.reason || 'validate failed');
    } catch (e) {
      lastErr = e;
    }
  }

  const fb = fallbackGroupProactiveMessage(oc, groupContext, members, forbidden);
  const check = validateGroupProactiveMessage(fb, forbidden);
  if (check.ok) {
    return { content: check.text, source: 'fallback' };
  }

  throw lastErr || new Error('群聊主动消息生成失败');
}

function sanitizeSocialMessageContent(text) {
  return stripSocialSuffix(text);
}

module.exports = {
  groupProactiveStorageKey,
  getGroupProactiveMeta,
  setGroupProactiveMeta,
  isGroupProactiveMessage,
  userRepliedAfterLastGroupProactive,
  markUserChattedInGroup,
  recordGroupProactiveSent,
  shouldInjectProactiveForGroup,
  buildGroupProactiveSystemPrompt,
  buildGroupProactiveUserMessage,
  validateGroupProactiveMessage,
  generateGroupProactiveMessageForOc,
  fallbackGroupProactiveMessage,
  sanitizeSocialMessageContent,
  stripSocialSuffix,
  hasActionParenthesis
};
