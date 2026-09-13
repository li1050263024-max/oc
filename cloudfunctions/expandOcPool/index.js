const { chatCompletions } = require('./aiText.js');

function parseJsonArray(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (e) {
      /* fall through */
    }
  }
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) return obj;
    if (obj && Array.isArray(obj.items)) return obj.items;
  } catch (e) {
    return null;
  }
  return null;
}

exports.main = async (event) => {
  const poolKey = event && event.poolKey != null ? String(event.poolKey) : '';
  const label = event && event.label != null ? String(event.label) : poolKey;
  const theme = event && event.theme != null ? String(event.theme).trim() : '';
  const count = Math.min(15, Math.max(3, Number(event && event.count) || 8));
  const existing = Array.isArray(event && event.existing) ? event.existing : [];

  if (!poolKey) {
    return { ok: false, errMsg: '缺少 poolKey' };
  }

  const existSet = new Set(existing.map((x) => String(x).trim()).filter(Boolean));
  const sample = existing.slice(0, 40).join('、') || '（暂无）';

  const systemPrompt =
    '你是中文二次元 OC 设定选项库编辑。只输出 JSON 数组，例如 ["选项1","选项2"]。每项 2～12 字，风格与已有选项一致，不要与已有重复，不要编号，不要解释。';

  const userPrompt =
    `维度：${label}（字段名 ${poolKey}）\n` +
    (theme ? `主题/风格：${theme}\n` : '主题：与现有列表风格统一，多样化\n') +
    `已有选项（请勿重复）：${sample}\n` +
    `请再生成 ${count} 个新选项，输出 JSON 数组。`;

  try {
    const result = await chatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0.85, maxTokens: 700 }
    );
    const text = result && result.text;
    const arr = parseJsonArray(text);
    if (!arr || !arr.length) {
      return { ok: false, errMsg: '模型未返回有效选项列表' };
    }

    const items = [];
    arr.forEach((x) => {
      const s = String(x == null ? '' : x).trim();
      if (!s || s.length > 24 || existSet.has(s)) return;
      existSet.add(s);
      items.push(s);
    });
    if (!items.length) {
      return { ok: false, errMsg: '生成结果均重复或无效' };
    }
    return { ok: true, items: items.slice(0, count), poolKey: poolKey };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
