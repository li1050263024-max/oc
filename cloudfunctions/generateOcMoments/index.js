const { chatCompletions } = require('./aiText.js');
const SYSTEM_PROMPT =
  '你是【独立的中文二次元 OC 角色】，正在发微信朋友圈。' +
  '你必须严格扮演 user 消息里给出的「角色名」那一人，与其他任何 OC 都是不同个体，不得共用同一条文案、不得串人设。' +
  '根据【OC 设定】【人物小传】写该角色第一人称朋友圈。' +
  '若提供了【与用户的私聊记忆】，须体现你们已互动过的关系与情绪基调（可含蓄带过共同话题），不要写成完全陌生路人。' +
  '硬性要求：\n' +
  '1. 严格符合本角色性格、口癖；绝不 OOC、绝不模仿其他角色；\n' +
  '2. 写生活片段/心情/小见闻，不要像回复聊天、不要「在吗」式问候；\n' +
  '3. 每条 15～90 字；可含少量 emoji；\n' +
  '4. 不要标题、不要元话语；只输出 JSON。\n' +
  '5. 不得与【禁止重复】列表相同或高度雷同；同一角色多条之间开头、句式、主题必须明显不同。\n' +
  '6. 禁止套路句：「今天在旧货市场翻到糖纸」「冷静点说」「刚才又路过那家店」等模板化写法。\n' +
  '7. postCount>1 时，每条必须是不同场景、不同情绪，不能写同一事件的两种版本。\n' +
  '输出格式：{"posts":[{"content":"..."}]}，posts 长度等于 postCount。';

const COMMENT_SYSTEM =
  '你是微信朋友圈里的 OC 角色。以该角色口吻写一条评论，口语化，5～45 字，像真人回复朋友圈。' +
  '若有私聊记忆，评论语气应符合你们已有的关系阶段（未确认恋人前不要过分亲密）。' +
  '不要 AI、不要「作为」、不要复述原帖全文。只输出 JSON：{"content":"..."}';

const REPLY_SYSTEM =
  '你是微信朋友圈里的 OC 角色。用户在评论里回复了你或与你互动，请写一条评论区跟评，5～45 字，口语自然。' +
  '只输出 JSON：{"content":"..."}';


function parsePostsFromText(text, postCount) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) {
      return obj.map((x) => ({ content: String(x.content || x.text || x).trim() })).filter((x) => x.content);
    }
    if (obj && Array.isArray(obj.posts)) {
      return obj.posts
        .map((x) => ({ content: String((x && x.content) || x || '').trim() }))
        .filter((x) => x.content);
    }
    if (obj && obj.content != null) {
      const c = String(obj.content).trim();
      if (c) return [{ content: c }];
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
  return [{ content: raw.slice(0, 120) }];
}

function parseCommentPlainText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    const obj = JSON.parse(candidate);
    if (obj && obj.content != null) {
      return String(obj.content).trim();
    }
  } catch (e) {
    /* fall through */
  }
  if (/^\s*\{\s*"content"\s*:/.test(raw)) {
    const m = raw.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m && m[1]) {
      try {
        return JSON.parse('"' + m[1] + '"');
      } catch (e2) {
        return m[1].replace(/\\"/g, '"').trim();
      }
    }
  }
  return raw.replace(/^[\s"'「『]+|[\s"'」』]+$/g, '').slice(0, 120);
}

function parseDouyinPostsFromText(text, postCount) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : raw;
  const normalizeOne = (x) => {
    if (!x) return null;
    if (typeof x === 'string') {
      const c = x.trim();
      return c ? { content: c, tags: [] } : null;
    }
    const content = String(x.content || x.caption || x.text || '').trim();
    if (!content) return null;
    let tags = [];
    if (Array.isArray(x.tags)) {
      tags = x.tags.map((t) => String(t || '').replace(/^#/, '').trim()).filter(Boolean);
    }
    return { content: content.slice(0, 80), tags: tags.slice(0, 4) };
  };
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) {
      return obj.map(normalizeOne).filter(Boolean).slice(0, postCount || 3);
    }
    if (obj && Array.isArray(obj.posts)) {
      return obj.posts.map(normalizeOne).filter(Boolean).slice(0, postCount || 3);
    }
    const one = normalizeOne(obj);
    return one ? [one] : [];
  } catch (e) {
    const plain = parseCommentPlainText(raw);
    return plain ? [{ content: plain, tags: [] }] : [];
  }
}

exports.main = async (event) => {

  const mode = event && event.mode != null ? String(event.mode).trim() : 'posts';
  const ocSetting = event && event.ocSetting != null ? String(event.ocSetting).trim() : '';
  const ocBio = event && event.ocBio != null ? String(event.ocBio).trim() : '';
  const chatSummary = event && event.chatSummary != null ? String(event.chatSummary).trim() : '';
  const ocName = event && event.ocName != null ? String(event.ocName).trim() : 'OC';

  if (mode === 'comment' || mode === 'reply') {
    const postContent = event && event.postContent != null ? String(event.postContent).trim() : '';
    const userComment = event && event.userComment != null ? String(event.userComment).trim() : '';
    const posterName = event && event.posterName != null ? String(event.posterName).trim() : '';
    const groupMate = !!(event && event.groupMate);
    if (!ocSetting || !postContent) {
      return { ok: false, errMsg: '缺少评论参数' };
    }
    let userContent =
      '角色名：' +
      ocName +
      '\n\n【OC 设定】\n' +
      ocSetting.slice(0, 2800) +
      '\n\n【人物小传】\n' +
      (ocBio || '（暂无）').slice(0, 1200) +
      '\n\n【朋友圈正文】\n' +
      postContent.slice(0, 500);
    if (groupMate && posterName) {
      userContent +=
        '\n\n【关系】你与发帖者「' +
        posterName +
        '」在同一个群聊里，像熟人随手评论对方朋友圈，口语自然。';
    }
    if (chatSummary) {
      userContent +=
        '\n\n【与用户的私聊记忆·须记得】\n' + chatSummary.slice(0, 1200);
    }
    if (mode === 'reply' && userComment) {
      userContent += '\n\n【用户刚发的评论】\n' + userComment.slice(0, 200);
    }
    userContent += '\n\n请写一条评论，只输出 JSON。';
    try {
      const result = await chatCompletions([
            { role: 'system', content: mode === 'reply' ? REPLY_SYSTEM : COMMENT_SYSTEM },
            { role: 'user', content: userContent.slice(0, 4500) }
          ], { temperature: 0.78, maxTokens: 120 });
      const text = result && result.text;
      const posts = parsePostsFromText(text, 1);
      let content = posts.length ? posts[0].content : '';
      if (!content) content = parseCommentPlainText(text);
      content = String(content || '').trim();
      if (!content) return { ok: false, errMsg: '模型未返回有效内容' };
      return { ok: true, content };
    } catch (e) {
      return { ok: false, errMsg: e.message || '调用失败' };
    }
  }

  // OC 抖音：短视频感图文配文
  if (mode === 'douyin' || mode === 'tiktok' || mode === 'caption') {
    if (!ocSetting) {
      return { ok: false, errMsg: '缺少 OC 设定' };
    }
    const topicHint =
      event && event.topicHint != null ? String(event.topicHint).trim() : '';
    const albumHint =
      event && event.albumHint != null ? String(event.albumHint).trim() : '';
    let postCount = Number(event && event.postCount);
    if (!postCount || postCount < 1) postCount = 1;
    if (postCount > 3) postCount = 3;

    const DOUYIN_SYSTEM =
      '你是【独立的中文二次元 OC 角色】，正在发短视频平台（类似抖音）的出镜图文。' +
      '必须扮演 user 给出的角色名那一人。' +
      '文案要短、口语、有出镜感；可带 1～3 个话题标签。' +
      '硬性要求：\n' +
      '1. 严格符合性格与小传，绝不 OOC；\n' +
      '2. 12～55 字正文；不要「在吗」式聊天；不要解释自己在拍短视频；\n' +
      '3. 未确认亲密关系前不要过度黏腻告白；\n' +
      '4. 不要提真实明星/政治热搜专有名；可用题材池口吻；\n' +
      '5. 只输出 JSON：{"posts":[{"content":"...","tags":["标签1","标签2"]}]}，posts 长度等于 postCount。';

    let userContent =
      '角色名：' +
      ocName +
      '\n\n【OC 设定】\n' +
      ocSetting.slice(0, 2800) +
      '\n\n【人物小传】\n' +
      (ocBio || '（暂无）').slice(0, 1200) +
      '\n\n需要条数 postCount=' +
      postCount;
    if (topicHint) userContent += '\n\n【本条题材】\n' + topicHint.slice(0, 400);
    if (albumHint) userContent += '\n\n【图片来源】\n' + albumHint.slice(0, 120);
    if (chatSummary) {
      userContent +=
        '\n\n【与用户的私聊记忆·可含蓄呼应】\n' + chatSummary.slice(0, 1000);
    }
    userContent += '\n\n请生成抖音风出镜文案，只输出 JSON。';

    try {
      const result = await chatCompletions([
            { role: 'system', content: DOUYIN_SYSTEM },
            { role: 'user', content: userContent.slice(0, 4800) }
          ], { temperature: 0.85, maxTokens: 320 });
      const text = result && result.text;
      let posts = parseDouyinPostsFromText(text, postCount);
      if (!posts.length) {
        const plain = parseCommentPlainText(text);
        if (plain) posts = [{ content: plain, tags: [] }];
      }
      if (!posts.length) return { ok: false, errMsg: '模型未返回有效内容' };
      return { ok: true, posts: posts.slice(0, postCount) };
    } catch (e) {
      return { ok: false, errMsg: e.message || '调用失败' };
    }
  }

  let postCount = Number(event && event.postCount);
  if (!postCount || postCount < 1) postCount = 1;
  if (postCount > 3) postCount = 3;

  if (!ocSetting) {
    return { ok: false, errMsg: '缺少 OC 设定' };
  }

  let userContent =
    '【重要】你现在只扮演角色「' +
    ocName +
    '」，与其他 OC 完全不同。\n' +
    '需要生成条数 postCount=' +
    postCount +
    '\n\n【OC 设定】\n' +
    ocSetting.slice(0, 3200) +
    '\n\n【人物小传 / 设定补充】\n' +
    (ocBio || '（暂无小传，请依据设定）').slice(0, 2000);
  if (chatSummary) {
    userContent +=
      '\n\n【与用户的私聊记忆·必须记得并自然呼应，勿装作不认识或忘记】\n' +
      chatSummary.slice(0, 2200);
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
        ], { temperature: 0.78, maxTokens: 420 });

    const text = result && result.text;

    let posts = parsePostsFromText(text, postCount);
    if (posts.length > postCount) posts = posts.slice(0, postCount);
    if (!posts.length) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, posts };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
