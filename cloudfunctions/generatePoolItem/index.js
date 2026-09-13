const { chatCompletions } = require('./aiText.js');

function parseItem(text) {
  if (!text) return '';
  const raw = String(text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const obj = JSON.parse(candidate);
    if (obj && obj.item) return String(obj.item).trim();
  } catch (e) {
    /* ignore */
  }
  const m = candidate.match(/"item"\s*:\s*"([^"]+)"/);
  if (m) return m[1].trim();
  const line = candidate.replace(/^["'{\[]+|["'}\]]+$/g, '').trim();
  return line.slice(0, 48);
}

exports.main = async (event) => {
  const poolKey = event && event.poolKey != null ? String(event.poolKey) : '';
  const label = event && event.label != null ? String(event.label) : poolKey;
  const slotHint = event && event.slotHint != null ? String(event.slotHint) : label;
  const contextText =
    event && event.contextText != null ? String(event.contextText).slice(0, 900) : '';
  const reason = event && event.reason != null ? String(event.reason) : '漏填或与角色不符';
  const existing = Array.isArray(event && event.existing) ? event.existing : [];
  const existSet = new Set(existing.map((x) => String(x).trim()).filter(Boolean));
  const sample = existing.slice(0, 25).join('、') || '（暂无）';

  if (!poolKey) {
    return { ok: false, errMsg: '缺少 poolKey' };
  }

  const systemPrompt =
    '你是中文 OC 设定编辑。只输出 JSON：{"item":"一条选项"}。选项须符合角色设定，2～24 字，勿与已有重复，勿解释。';

  const userPrompt =
    `维度：${label}\n槽位：${slotHint}\n原因：${reason}\n` +
    (contextText ? `角色设定：\n${contextText}\n` : '') +
    `已有候选（勿重复）：${sample}\n` +
    '请生成 1 条新选项。';

  try {
    const result = await chatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.8, maxTokens: 200 }
    );
    const text = result && result.text;
    let item = parseItem(text);
    if (!item) {
      return { ok: false, errMsg: '模型未返回有效选项' };
    }
    if (item.length > 48) item = item.slice(0, 48);
    if (existSet.has(item)) {
      return { ok: false, errMsg: '生成项与已有重复' };
    }
    return { ok: true, item: item, poolKey: poolKey };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
