const https = require('https');

function postJson(hostname, path, headers, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => {
          chunks += d;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(chunks);
            if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(chunks.slice(0, 200) || e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(57000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.write(data);
    req.end();
  });
}

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
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, errMsg: '请配置云函数环境变量 DEEPSEEK_API_KEY' };
  }

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
    const result = await postJson(
      'api.deepseek.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9,
        max_tokens: 600
      }
    );

    const text =
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content;

    const arr = parseJsonArray(text);
    if (!arr || !arr.length) {
      return { ok: false, errMsg: '模型未返回有效选项列表' };
    }

    const items = [];
    arr.forEach((x) => {
      const v = String(x || '').trim();
      if (v && !existSet.has(v) && items.indexOf(v) < 0) {
        items.push(v);
        existSet.add(v);
      }
    });

    if (!items.length) {
      return { ok: false, errMsg: '没有生成可用的新选项（可能全部重复）' };
    }

    return { ok: true, items };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
