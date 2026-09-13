const { chatCompletions } = require('./aiText.js');

const CONTINUE_SYSTEM_PROMPT =
  '你是中文二次元 OC 故事续写助手。用户会提供【OC 设定】【人物小传】【已写故事全文】与【续写方向】。' +
  '你必须先在内心完成两步（不要输出）：① 用 3～6 句整理上文梗概、人物状态与未解悬念；② 结合续写方向列出下文 3～5 条情节要点作为大纲。' +
  '然后只输出续写正文（300～700 字）：必须紧接上文末句语气与情节自然衔接，不得重复已写内容，不得写「梗概」「大纲」等元说明，' +
  '不得重置时间线或改写已发生事实；保持角色性格、口癖与叙事风格一致；可含场景与对话；直接输出正文。';

const REVISE_SYSTEM_PROMPT =
  '你是中文二次元 OC 故事润色助手。用户会提供【OC 设定】【人物小传】【故事正文】与【修改意见】。' +
  '请根据修改意见对全文进行润色、增删或改写，输出完整修订后的正文（不是仅输出改动片段）。' +
  '保持角色性格、口癖与叙事风格一致；不得输出「修改说明」「润色如下」等元话语；直接输出修订后全文。';

exports.main = async (event) => {
  const ocSetting = event && event.ocSetting != null ? String(event.ocSetting).trim() : '';
  const ocBio = event && event.ocBio != null ? String(event.ocBio).trim() : '';
  const userInput = event && event.userInput != null ? String(event.userInput).trim() : '';
  const mode = event && event.mode != null ? String(event.mode).trim() : 'new';
  const previousStory =
    event && event.previousStory != null ? String(event.previousStory).trim() : '';
  const continueDirection =
    event && event.continueDirection != null ? String(event.continueDirection).trim() : '';
  const reviseDirection =
    event && event.reviseDirection != null ? String(event.reviseDirection).trim() : '';
  const storyBody =
    event && event.storyBody != null ? String(event.storyBody).trim() : '';

  if (!ocSetting || !ocBio) {
    return { ok: false, errMsg: '缺少 OC 设定或小传' };
  }

  const isContinue = mode === 'continue';
  const isRevise = mode === 'revise';
  const direction = isContinue
    ? continueDirection
    : isRevise
      ? reviseDirection
      : userInput;

  if (!direction) {
    return {
      ok: false,
      errMsg: isContinue ? '请输入续写方向' : isRevise ? '请输入修改意见' : '请输入故事方向或情节'
    };
  }
  if (direction.length > 1200) {
    return { ok: false, errMsg: '输入请控制在 1200 字以内' };
  }
  if (isContinue && !previousStory) {
    return { ok: false, errMsg: '缺少已有故事正文' };
  }
  if (isContinue && previousStory.length > 12000) {
    return { ok: false, errMsg: '故事过长，请先保存并新开一章' };
  }
  if (isRevise && !storyBody) {
    return { ok: false, errMsg: '缺少故事正文' };
  }
  if (isRevise && storyBody.length > 12000) {
    return { ok: false, errMsg: '故事过长，请分段修改' };
  }

  const systemPrompt = isContinue
    ? CONTINUE_SYSTEM_PROMPT
    : isRevise
      ? REVISE_SYSTEM_PROMPT
      : '你是中文二次元 OC 故事创作助手。根据【OC 设定】【人物小传】与【用户希望的方向】写一篇 400～900 字的独立短篇故事。要求：文风有画面感、符合角色性格；可虚构具体场景与对话；不要写成设定复述或条目列表；少用「综上所述」「该角色」等套话；直接输出正文，不要标题以外的多余说明。';

  let userContent =
    '【OC 设定】\n' +
    ocSetting.slice(0, 3500) +
    '\n\n【人物小传】\n' +
    ocBio.slice(0, 2500);

  if (isContinue) {
    userContent +=
      '\n\n【已写故事全文】\n' +
      previousStory.slice(0, 12000) +
      '\n\n【续写方向】\n' +
      direction;
  } else if (isRevise) {
    userContent +=
      '\n\n【故事正文】\n' +
      storyBody.slice(0, 12000) +
      '\n\n【修改意见】\n' +
      direction;
  } else {
    userContent += '\n\n【用户希望的方向】\n' + direction;
  }

  try {
    const result = await chatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      { temperature: 0.85, maxTokens: 1400 }
    );
    const text = result && result.text;
    if (!text || !String(text).trim()) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, story: String(text).trim() };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
