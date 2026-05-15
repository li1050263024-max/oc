/**
 * 将 OC 工作数据拼成给模型用的纯文本设定（小传提示 / 对话 system 等）
 */
const gacha = require('./gacha.js');

function buildOcPromptFromWork(work) {
  if (!work || !work.result) return '';
  let t = gacha.toCopyText(work.result);
  const bg = work.background;
  if (bg) {
    t += '\n\n【背景】\n世界观：' + (bg.worldview || '');
    const ev = bg.lifeEvents || [];
    if (ev.length) {
      t += '\n人生大事件：\n' + ev.map((e, i) => `${i + 1}. ${e || ''}`).join('\n');
    }
  }
  const cp = work.catchphrases || [];
  if (cp.length) {
    t += '\n\n【常用语】\n' + cp.filter(Boolean).join('\n');
  }
  const ad = work.attitudes || [];
  if (ad.length) {
    t +=
      '\n\n【态度】\n' +
      ad.map((x) => `${x.event || ''} → ${x.attitude || ''}`).join('\n');
  }
  return t.trim();
}

function buildChatSystemPrompt(work) {
  const block = buildOcPromptFromWork(work);
  let prompt =
    '你是中文角色扮演助手。请严格扮演这名 OC：只用角色的口吻与视角回复，使用中文；不要提及你是 AI，不要跳出角色。若设定有缺省可合理脑补但需自洽。\n\n【角色设定】\n';
  prompt += block || '（设定由玩家在对话中补充）';
  if (work && work.generatedBio && String(work.generatedBio).trim()) {
    prompt += '\n\n【人物小传参考】\n' + String(work.generatedBio).trim();
  }
  return prompt;
}

module.exports = {
  buildOcPromptFromWork,
  buildChatSystemPrompt
};
