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

function parseJsonBlock(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function pad3(arr) {
  const a = Array.isArray(arr) ? arr.slice(0, 3).map((x) => String(x || '').trim()) : [];
  while (a.length < 3) a.push('');
  return a;
}

function str(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeAttitudes(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 3) : [];
  const out = list.map((item) => {
    if (item && typeof item === 'object') {
      return { event: str(item.event), attitude: str(item.attitude) };
    }
    return { event: '', attitude: str(item) };
  });
  while (out.length < 3) out.push({ event: '', attitude: '' });
  return out;
}

function normalizeWorldExpand(data) {
  const d = data && typeof data === 'object' ? data : {};
  const list = Array.isArray(d.worldTimeline) ? d.worldTimeline.slice(0, 3) : [];
  const worldTimeline = list
    .map((item, index) => {
      const row = item && typeof item === 'object' ? item : {};
      const dateLabel = str(row.dateLabel);
      const title = str(row.title);
      const description = str(row.description);
      if (!dateLabel && !title && !description) return null;
      return {
        dateLabel,
        title: title || '未命名节点',
        description,
        sortKey: index,
        category: 'world'
      };
    })
    .filter(Boolean);
  return {
    worldview: str(d.worldview),
    worldTimeline,
    keywordsUsed: Array.isArray(d.keywordsUsed)
      ? d.keywordsUsed.map((x) => str(x)).filter(Boolean)
      : [],
    confidence: str(d.confidence) || 'medium'
  };
}

function normalizeParsed(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    name: str(d.name),
    race: str(d.race),
    gender: str(d.gender),
    age: str(d.age),
    hairColor: str(d.hairColor),
    eyeColor: str(d.eyeColor),
    personalities: pad3(d.personalities),
    quirks: pad3(d.quirks),
    likes: str(d.likes),
    worldview: str(d.worldview),
    origins: pad3(d.origins),
    lifeEvents: pad3(d.lifeEvents),
    catchphrases: pad3(d.catchphrases),
    attitudes: normalizeAttitudes(d.attitudes)
  };
}

exports.main = async (event) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, errMsg: '请为云函数配置环境变量 DEEPSEEK_API_KEY' };
  }

  const text = event && event.text != null ? String(event.text).trim() : '';
  if (!text) {
    return { ok: false, errMsg: '请先输入或粘贴 OC 设定文本' };
  }
  if (text.length > 6000) {
    return { ok: false, errMsg: '文本请控制在 6000 字以内' };
  }

  const mode =
    event && event.mode === 'knownCharacter'
      ? 'knownCharacter'
      : event && event.mode === 'expandWorldview'
        ? 'expandWorldview'
        : 'parse';
  if (mode === 'expandWorldview') {
    const context = (event && event.context) || {};
    const systemPrompt =
      '你是 OC 世界观设定助手。用户会给出关键词、短语或零散概念，请扩写成完整可用的世界观设定。' +
      '只输出一个 JSON 对象，不要 markdown。字段：worldview(字符串，150~400字)、' +
      'worldTimeline(数组，最多3项，每项含 dateLabel/title/description)、keywordsUsed(字符串数组)、confidence(high|medium|low)。' +
      '要求：以用户关键词为核心；设定集/百科客观语气；不写角色个人身世；若已有世界观则补充润色而非完全覆盖；无时间轴则 worldTimeline 返回 []。';
    const userContent =
      '【角色名】' +
      str(context.ocName) +
      '\n【种族/身份】' +
      str(context.race) +
      '\n【用户输入】\n' +
      text +
      '\n【已有世界观】\n' +
      str(context.existingWorldview) +
      '\n请扩写并输出 JSON。';
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
            { role: 'user', content: userContent }
          ],
          temperature: 0.65,
          max_tokens: 1600
        }
      );
      const raw =
        result &&
        result.choices &&
        result.choices[0] &&
        result.choices[0].message &&
        result.choices[0].message.content;
      const parsed = parseJsonBlock(raw);
      if (!parsed) {
        return { ok: false, errMsg: '模型返回格式无法解析，请精简文本后重试' };
      }
      const expand = normalizeWorldExpand(parsed);
      if (!expand.worldview) {
        return { ok: false, errMsg: '未能扩写出有效世界观' };
      }
      return { ok: true, expand };
    } catch (e) {
      return { ok: false, errMsg: (e && e.message) || '扩写失败' };
    }
  }

  const systemPrompt =
    mode === 'knownCharacter'
      ? '你是 OC 设定助手。用户会提供一个已知人物名称（如二次元角色、明星、虚拟偶像、影视人物等）。' +
        '请根据大众认知中该人物的公开形象，整理一份 OC 设定，只输出一个 JSON 对象，不要 markdown 说明。字段如下：' +
        'name,race,gender,age,hairColor,eyeColor,personalities(字符串数组最多3条),quirks(字符串数组最多3条),likes,' +
        'worldview,origins(字符串数组最多3条),lifeEvents(字符串数组最多3条),catchphrases(字符串数组最多3条),' +
        'attitudes(数组，每项为 {"event":"情境","attitude":"态度"}，最多3条)。' +
        'name 字段请使用用户给出的人物名称或常用称呼；可合理推断缺失项，但不要输出与用户输入无关的原创剧情。'
      : '你是 OC 设定整理助手。用户会粘贴一段角色设定（可能是零散描述、表格、小传或混合格式）。' +
        '请从中提取并梳理信息，只输出一个 JSON 对象，不要 markdown 说明。字段如下：' +
        'name,race,gender,age,hairColor,eyeColor,personalities(字符串数组最多3条),quirks(字符串数组最多3条),likes,' +
        'worldview,origins(字符串数组最多3条),lifeEvents(字符串数组最多3条),catchphrases(字符串数组最多3条),' +
        'attitudes(数组，每项为 {"event":"情境","attitude":"态度"}，最多3条)。' +
        '缺失项用空字符串或空数组；能从原文合理推断的可简要归纳；不要编造与原文无关的大段内容。';

  const userContent =
    mode === 'knownCharacter'
      ? '已知人物名称：' + text
      : '请解析以下 OC 设定并输出 JSON：\n' + text;

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
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: 1800
      }
    );

    const raw =
      result &&
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content;
    const parsed = parseJsonBlock(raw);
    if (!parsed) {
      return { ok: false, errMsg: '模型返回格式无法解析，请精简文本后重试' };
    }
    const setting = normalizeParsed(parsed);
    if (
      !setting.name &&
      !setting.race &&
      !setting.worldview &&
      !setting.personalities.some(Boolean)
    ) {
      return { ok: false, errMsg: '未能从文本中识别出有效设定' };
    }
    return { ok: true, setting };
  } catch (e) {
    return { ok: false, errMsg: (e && e.message) || '识别失败' };
  }
};
