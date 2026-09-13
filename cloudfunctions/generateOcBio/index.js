const { chatCompletions } = require('./aiText.js');

exports.main = async (event) => {
  const hints = event && event.hints != null ? String(event.hints).trim() : '';
  if (!hints) {
    return { ok: false, errMsg: '请先输入关键词或设定描述' };
  }
  if (hints.length > 2000) {
    return { ok: false, errMsg: '描述请控制在 2000 字以内' };
  }

  const systemPrompt =
    '你是中文二次元 OC 设定助手。根据用户给的关键词或简略设定，写一段 300～600 字的角色小传，包含出身、性格成因、当前处境与一个小悬念或钩子，文风自然有画面感，避免机械列表堆砌，少用「该角色」「综上所述」等套话。';

  try {
    const result = await chatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请为以下 OC 写人物小传：\n${hints}` }
      ],
      { temperature: 0.85, maxTokens: 900 }
    );

    const text = result && result.text;
    if (!text || !String(text).trim()) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, bio: String(text).trim() };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
