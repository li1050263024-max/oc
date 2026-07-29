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

exports.main = async (event) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, errMsg: '请为云函数配置环境变量 DEEPSEEK_API_KEY（勿写入小程序代码）' };
  }

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
    const result = await postJson(
      'api.deepseek.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请为以下 OC 写人物小传：\n${hints}` }
        ],
        temperature: 0.85,
        max_tokens: 900
      }
    );

    const text =
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content;

    if (!text || !String(text).trim()) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, bio: String(text).trim() };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
