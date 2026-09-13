/**
 * OC 抖音评论专用云函数（混元 hy3-preview）
 * mode:
 *   - seed  打开评论区：一次生成群友/路人/发帖OC跟评
 *   - reply 用户评论后：发帖 OC 回复
 *   - comment 单条评论（备用）
 */
const { chatCompletions } = require('./aiText.js');

const SEED_SYSTEM =
  '你在模拟【抖音互动性很强的热门评论区】。每条要像真热评：短、口语、有梗/有暧昧张力/有夸张情绪，5～40 字（个别玩梗可到 48 字）。\n' +
  '总原则：紧扣【视频文案】的内容/氛围/槽点发挥，禁止空泛「好好看」刷屏，禁止复述全文。\n' +
  '路人评论请混用这些热评套路（每次换着来，不要条条同一套路）：\n' +
  '1) 互动撩：半认真邀约/要联系方式梗（点到为止，别低俗）；\n' +
  '2) 玩梗夸：谐音/网络梗，但不要照搬同一句金句；\n' +
  '3) 夸张黏：一秒没回、读这句话时属于我等，同屏最多用一次；\n' +
  '4) 萌系表情：可少量，同屏不要重复同一表情梗；\n' +
  '5) 代入感/夸氛围/夸情绪值/锁算法等角度轮换。\n' +
  '【去重要求】多条路人评论之间禁止重复或高度相似：禁止同句、同梗、同开头、同收尾；每条换角度。\n' +
  '身份差异：\n' +
  '- 路人：上述热评风，像陌生人随手评，梗要新鲜且互不撞车。\n' +
  '- 群友：熟人随口聊，可点文案细节，比路人更私密一点，少用过度发疯。\n' +
  '- 发帖者跟评：必须回「回复对象」那条群友，像作者回熟人，贴文案情绪。\n' +
  '禁止：AI 腔、「作为」、说明书分析、政治/真实明星点名、露骨色情。\n' +
  '只输出 JSON：{"comments":[{"key":"发言人key","content":"..."}]}，' +
  'comments 长度必须等于发言人数量，key 必须与输入一一对应。';

const REPLY_SYSTEM =
  '你是抖音博主本人（OC）。用户在评论区留言，请用该角色口吻写一条热评区跟评，5～36 字。\n' +
  '要接住用户话头，可轻度玩梗/调侃/接住暧昧，同时呼应【视频文案】，像热门作者回复。\n' +
  '只输出 JSON：{"content":"..."}';

const COMMENT_SYSTEM =
  '你是抖音评论区里的 OC。用该角色口吻写一条互动热评风短评，5～40 字。\n' +
  '必须根据【视频文案】接话：可玩梗、可夸张共鸣、可轻度撩，不要空夸。\n' +
  '只输出 JSON：{"content":"..."}';

async function chat(system, userContent, maxTokens) {
  const result = await chatCompletions(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(userContent || '').slice(0, 6000) }
    ],
    {
      temperature: maxTokens && maxTokens >= 800 ? 0.95 : 0.85,
      maxTokens: maxTokens || 400
    }
  );
  return (result && result.text) || '';
}

function unwrapJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function parsePlainContent(text) {
  const obj = unwrapJson(text);
  if (obj && obj.content != null) return String(obj.content).trim().slice(0, 80);
  const raw = String(text || '').trim();
  return raw.replace(/^[\s"'「『]+|[\s"'」』]+$/g, '').slice(0, 80);
}

function parseSeedComments(text, keys) {
  const obj = unwrapJson(text);
  const map = {};
  if (obj && Array.isArray(obj.comments)) {
    obj.comments.forEach((c) => {
      if (!c) return;
      const k = String(c.key || '').trim();
      const content = String(c.content || '').trim().slice(0, 80);
      if (k && content) map[k] = content;
    });
  }
  if (obj && Array.isArray(obj.comments) && keys && keys.length) {
    keys.forEach((k, i) => {
      if (map[k]) return;
      const c = obj.comments[i];
      const content = c && String(c.content || '').trim().slice(0, 80);
      if (content) map[k] = content;
    });
  }
  return map;
}

function normalizeSpeakers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 24)
    .map((s, i) => {
      if (!s || typeof s !== 'object') return null;
      const key = String(s.key || 's' + i).trim().slice(0, 40);
      const kind = String(s.kind || 'stranger').trim();
      const name = String(s.name || '用户').trim().slice(0, 40);
      return {
        key: key || 's' + i,
        kind: kind,
        name: name || '用户',
        replyToName: String(s.replyToName || '').trim().slice(0, 40),
        setting: String(s.setting || '').trim().slice(0, 700),
        bio: String(s.bio || '').trim().slice(0, 280),
        chatSummary: String(s.chatSummary || '').trim().slice(0, 360)
      };
    })
    .filter(Boolean);
}

async function handleSeed(event) {
  const postContent = event && event.postContent != null ? String(event.postContent).trim() : '';
  const posterName = event && event.posterName != null ? String(event.posterName).trim() : '博主';
  const speakers = normalizeSpeakers(event && event.speakers);
  if (!postContent) return { ok: false, errMsg: '缺少视频文案' };
  if (!speakers.length) return { ok: false, errMsg: '缺少发言人' };

  let userContent =
    '【抖音视频文案·评论必须围绕它发挥】\n' +
    postContent.slice(0, 400) +
    '\n\n【发帖者】' +
    posterName +
    '\n\n【风格】写成抖音会置顶的互动热评：撩/梗/夸张黏人/萌表情混搭，禁止水评刷屏。\n' +
    '【路人去重】所有路人 content 必须互不相同、互不近似；不要两条都用反诈/恋爱脑/微信同款梗。\n' +
    '\n【请为以下发言人各写一条评论】\n';

  speakers.forEach((s, i) => {
    userContent += '\n' + (i + 1) + '. key=' + s.key + '；身份=';
    if (s.kind === 'groupMate') userContent += '群友（熟人，可点文案细节）';
    else if (s.kind === 'authorReply') {
      userContent +=
        '发帖者本人跟评，必须回复群友「' + (s.replyToName || '群友') + '」';
    } else userContent += '路人（互动热评：撩/梗/夸张/萌，紧扣文案）';
    userContent += '；显示名=' + s.name;
    if (s.replyToName && s.kind === 'authorReply') {
      userContent += '；回复对象=' + s.replyToName;
    }
    if (s.setting) {
      userContent += '\n   设定摘要：' + s.setting.slice(0, 500);
    }
    if (s.bio) {
      userContent += '\n   小传：' + s.bio.slice(0, 220);
    }
    if (s.chatSummary) {
      userContent += '\n   与用户私聊记忆：' + s.chatSummary.slice(0, 280);
    }
  });
  userContent += '\n\n只输出 JSON。';

  const text = await chat(SEED_SYSTEM, userContent, 1400);
  const map = parseSeedComments(text, speakers.map((s) => s.key));
  const comments = speakers
    .map((s) => {
      const content = map[s.key] || '';
      return content ? { key: s.key, content: content } : null;
    })
    .filter(Boolean);

  if (!comments.length) {
    return { ok: false, errMsg: '模型未返回有效评论' };
  }
  return { ok: true, comments: comments };
}

async function handleSingle(event, isReply) {
  const postContent = event && event.postContent != null ? String(event.postContent).trim() : '';
  const userComment = event && event.userComment != null ? String(event.userComment).trim() : '';
  const ocName = event && event.ocName != null ? String(event.ocName).trim() : 'OC';
  const ocSetting = event && event.ocSetting != null ? String(event.ocSetting).trim() : '';
  const ocBio = event && event.ocBio != null ? String(event.ocBio).trim() : '';
  const chatSummary = event && event.chatSummary != null ? String(event.chatSummary).trim() : '';
  if (!ocSetting || !postContent) {
    return { ok: false, errMsg: '缺少评论参数' };
  }
  let userContent =
    '角色名：' +
    ocName +
    '\n\n【OC 设定】\n' +
    ocSetting.slice(0, 2200) +
    '\n\n【人物小传】\n' +
    (ocBio || '（暂无）').slice(0, 800) +
    '\n\n【视频文案】\n' +
    postContent.slice(0, 400);
  if (chatSummary) {
    userContent += '\n\n【与用户的私聊记忆】\n' + chatSummary.slice(0, 800);
  }
  if (isReply && userComment) {
    userContent += '\n\n【用户刚发的评论】\n' + userComment.slice(0, 200);
  }
  const replyStyleHint =
    event && event.replyStyleHint != null
      ? String(event.replyStyleHint).trim().slice(0, 240)
      : '';
  if (isReply && replyStyleHint) {
    userContent += '\n\n【回复节奏/文风】\n' + replyStyleHint;
  }
  userContent +=
    '\n\n请写一条抖音热门评论区风格短评（紧扣视频文案），只输出 JSON。';

  const text = await chat(
    isReply ? REPLY_SYSTEM : COMMENT_SYSTEM,
    userContent,
    isReply && String((event && event.replyMode) || '') === 'instant' ? 90 : 120
  );
  const content = parsePlainContent(text);
  if (!content) return { ok: false, errMsg: '模型未返回有效内容' };
  return { ok: true, content: content };
}

exports.main = async (event) => {
  const mode = event && event.mode != null ? String(event.mode).trim() : 'seed';
  try {
    if (mode === 'seed') return await handleSeed(event);
    if (mode === 'reply') return await handleSingle(event, true);
    if (mode === 'comment') return await handleSingle(event, false);
    return { ok: false, errMsg: '未知 mode：' + mode };
  } catch (e) {
    return { ok: false, errMsg: (e && e.message) || '调用失败' };
  }
};
