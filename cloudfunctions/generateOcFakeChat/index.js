const { chatCompletions } = require('./aiText.js');
const SYSTEM_PROMPT =
  '你是中文二次元 OC 角色扮演写作助手。用户会提供【OC 设定】【人物小传】【剧情上下文】。' +
  '你要以该角色第一人称，写 **恰好 1 条** 发给用户的微信私聊消息（或群聊发言）。' +
  '硬性要求：\n' +
  '1. 严格符合角色性格、口癖、态度；\n' +
  '2. 必须与【剧情上下文】中的情景、故事、近期聊天 **直接衔接**，不得 OOC、不得编造矛盾情节；\n' +
  '3. 若上下文有未完结话题，必须续接该话题；\n' +
  '4. 口语化，10～80 字；只输出 JSON：{"messages":[{"content":"..."}]}，messages 长度必须为 1。\n' +
  '5. 不得与【禁止重复】列表中的文案相同或高度雷同；不同角色、不同场景也不能复用同一句。';


function parseMessages(text, postCount) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) {
      return obj.map((x) => ({ content: String(x.content || x.text || x).trim() })).filter((x) => x.content);
    }
    if (obj && Array.isArray(obj.messages)) {
      return obj.messages
        .map((x) => ({ content: String((x && x.content) || x || '').trim() }))
        .filter((x) => x.content);
    }
  } catch (e) {
    /* fall through */
  }
  const lines = raw
    .split(/\n+/)
    .map((s) => s.replace(/^[\d\.\-\*、\s]+/, '').trim())
    .filter(Boolean);
  if (lines.length) {
    return lines.slice(0, postCount).map((content) => ({ content }));
  }
  return [{ content: raw.slice(0, 80) }];
}

function normalizeProactivePlain(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r?\n+/g, '')
    .replace(/^[\s"'「『【]+|[\s"'」』】]+$/g, '')
    .trim();
}

exports.main = async (event) => {

  const modeRaw = event && event.mode != null ? String(event.mode).trim() : 'chat';
  const mode = modeRaw === 'proactive' ? 'proactive' : modeRaw === 'group' ? 'group' : 'chat';

  if (mode === 'proactive') {
    const systemPrompt =
      event && event.systemPrompt != null ? String(event.systemPrompt).trim() : '';
    let userMessage =
      event && event.userMessage != null ? String(event.userMessage).trim() : '';
    if (!systemPrompt || !userMessage) {
      return { ok: false, errMsg: '缺少 proactive 提示词' };
    }
    const forbidden = Array.isArray(event && event.forbiddenContents)
      ? event.forbiddenContents
      : [];
    if (forbidden.length && userMessage.indexOf('【禁止重复') < 0) {
      userMessage +=
        '\n\n【禁止重复·以下文案已出现过，不得相同或高度雷同】\n' +
        forbidden
          .slice(0, 30)
          .map((s, i) => i + 1 + '. ' + String(s).trim().slice(0, 72))
          .join('\n');
    }
    const temperature = Number(event && event.temperature);
    try {
      const result = await chatCompletions([
            { role: 'system', content: systemPrompt.slice(0, 5800) },
            { role: 'user', content: userMessage.slice(0, 2000) }
          ], { temperature: temperature > 0.5 && temperature < 1.2 ? temperature : 0.88, maxTokens: 200 });

      const text = result && result.text;

      let content = normalizeProactivePlain(text);
      if (!content) {
        const parsed = parseMessages(text, 1);
        content = parsed.length ? parsed[0].content : '';
      }
      if (!content) {
        return { ok: false, errMsg: '模型未返回有效内容' };
      }
      return { ok: true, messages: [{ content }] };
    } catch (e) {
      return { ok: false, errMsg: e.message || '调用失败' };
    }
  }

  const ocSetting = event && event.ocSetting != null ? String(event.ocSetting).trim() : '';
  const ocBio = event && event.ocBio != null ? String(event.ocBio).trim() : '';
  const plotContext = event && event.plotContext != null ? String(event.plotContext).trim() : '';
  const groupContext = event && event.groupContext != null ? String(event.groupContext).trim() : '';
  const ocName = event && event.ocName != null ? String(event.ocName).trim() : 'OC';
  const chatMode = modeRaw === 'group' ? 'group' : 'chat';
  let postCount = Number(event && event.postCount);
  if (!postCount || postCount < 1) postCount = 1;
  if (postCount > 1) postCount = 1;

  if (!ocSetting) {
    return { ok: false, errMsg: '缺少 OC 设定' };
  }

  let userContent =
    '角色名：' +
    ocName +
    '\n场景：' +
    (chatMode === 'group' ? '群聊发言（对群成员和用户）' : '私聊（对用户）') +
    '\npostCount=' +
    postCount +
    '\n\n【OC 设定】\n' +
    ocSetting.slice(0, 3200) +
    '\n\n【人物小传 / 设定补充】\n' +
    (ocBio || '（暂无小传）').slice(0, 2000);

  if (plotContext) {
    userContent += '\n\n【剧情上下文】\n' + plotContext.slice(0, 2800);
  }
  if (groupContext) {
    userContent += '\n\n【群聊上下文】\n' + groupContext.slice(0, 1800);
  }
  const forbidden = Array.isArray(event && event.forbiddenContents) ? event.forbiddenContents : [];
  if (forbidden.length) {
    userContent +=
      '\n\n【禁止重复·以下文案已出现过，不得相同或高度雷同】\n' +
      forbidden
        .slice(0, 30)
        .map((s, i) => i + 1 + '. ' + String(s).trim().slice(0, 72))
        .join('\n');
  }

  try {
    const result = await chatCompletions([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ], { temperature: 0.82, maxTokens: 480 });

    const text = result && result.text;

    let messages = parseMessages(text, postCount);
    if (messages.length > postCount) messages = messages.slice(0, postCount);
    if (!messages.length) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
