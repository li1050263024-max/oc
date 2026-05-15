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
    return { ok: false, errMsg: '请配置云函数环境变量 DEEPSEEK_API_KEY' };
  }

  const systemPrompt =
    event && event.systemPrompt != null ? String(event.systemPrompt).trim() : '';
  const userMessage =
    event && event.userMessage != null ? String(event.userMessage).trim() : '';
  const history = Array.isArray(event && event.history) ? event.history : [];

  if (!userMessage) {
    return { ok: false, errMsg: '消息不能为空' };
  }
  if (userMessage.length > 800) {
    return { ok: false, errMsg: '单条消息请控制在 800 字以内' };
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt.slice(0, 6000) });
  }
  const recent = history.slice(-12);
  recent.forEach((m) => {
    if (!m || !m.content) return;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content: String(m.content).slice(0, 1200) });
  });
  messages.push({ role: 'user', content: userMessage });

  try {
    const result = await postJson(
      'api.deepseek.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model: 'deepseek-chat',
        messages,
        temperature: 0.9,
        max_tokens: 600
      }
    );

    const reply =
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content;

    if (!reply || !String(reply).trim()) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    return { ok: true, reply: String(reply).trim() };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
