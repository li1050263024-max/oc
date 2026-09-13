const { chatCompletions } = require('./aiText.js');
function trimList(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map((x) => String(x).trim()).filter(Boolean);
}

function pickFromPool(value, pool, exclude) {
  const list = trimList(pool, 500).filter((x) => !(exclude && exclude.has(x)));
  if (!list.length) return String(value || '').trim();
  const v = String(value || '').trim();
  if (v && list.includes(v)) return v;
  const fuzzy = v && list.find((p) => p.includes(v) || v.includes(p));
  if (fuzzy) return fuzzy;
  return list[Math.floor(Math.random() * list.length)];
}

function pickNonEmpty(value, pool, exclude) {
  let out = String(pickFromPool(value, pool, exclude) || '').trim();
  if (!out) out = String(pickFromPool('', pool, exclude) || '').trim();
  return out;
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

function sampleList(arr, max) {
  const list = trimList(arr, 500);
  if (list.length <= max) return list;
  const copy = list.slice();
  const out = [];
  for (let i = 0; i < max && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

function buildPoolText(pools, keys, maxPerKey) {
  const cap = maxPerKey || 16;
  return keys
    .map((key) => {
      const list = sampleList(pools[key], cap);
      return `${key}:${list.join('|') || '-'}`;
    })
    .join('\n');
}

function validateLayer1(data, pools, locked, current) {
  const poolMap = {
    name: 'names',
    race: 'races',
    hairColor: 'hairColors',
    eyeColor: 'eyeColors',
    personality: 'personalities',
    quirk: 'quirks'
  };
  const out = {};
  Object.keys(poolMap).forEach((field) => {
    if (locked && locked[field] === true && current && current[field] != null) {
      out[field] = current[field];
    } else {
      out[field] = pickFromPool(data && data[field], pools[poolMap[field]]);
    }
  });
  return out;
}

function validateLayer2(data, pools, locked, current) {
  const bg = current
    ? {
        worldview: current.worldview || '',
        lifeEvents: (current.lifeEvents || []).slice(),
        origins: (current.origins || []).slice()
      }
    : { worldview: '', lifeEvents: ['', '', ''], origins: ['', '', ''] };
  const events = bg.lifeEvents;
  const origins = bg.origins;
  while (events.length < 3) events.push('');
  while (origins.length < 3) origins.push('');

  if (!(locked && locked.worldview === true)) {
    bg.worldview = pickNonEmpty(data && data.worldview, pools.worldviews);
  } else if (!String(bg.worldview).trim()) {
    bg.worldview = pickNonEmpty('', pools.worldviews);
  }

  const usedEvents = new Set();
  const usedOrigins = new Set();
  for (let i = 0; i < 3; i++) {
    const key = 'lifeEvent' + i;
    if (!(locked && locked[key] === true)) {
      const src = data && Array.isArray(data.lifeEvents) ? data.lifeEvents[i] : '';
      events[i] = pickNonEmpty(src, pools.lifeEvents, usedEvents);
      usedEvents.add(events[i]);
    } else if (!String(events[i]).trim()) {
      events[i] = pickNonEmpty('', pools.lifeEvents, usedEvents);
      usedEvents.add(events[i]);
    } else {
      usedEvents.add(events[i]);
    }
  }
  for (let i = 0; i < 3; i++) {
    const key = 'origin' + i;
    if (!(locked && locked[key] === true)) {
      const src = data && Array.isArray(data.origins) ? data.origins[i] : '';
      origins[i] = pickNonEmpty(src, pools.origins, usedOrigins);
      usedOrigins.add(origins[i]);
    } else if (!String(origins[i]).trim()) {
      origins[i] = pickNonEmpty('', pools.origins, usedOrigins);
      usedOrigins.add(origins[i]);
    } else {
      usedOrigins.add(origins[i]);
    }
  }
  bg.lifeEvents = events.slice(0, 3);
  bg.origins = origins.slice(0, 3);
  return bg;
}

function validateLayer3(data, pools, locked, current) {
  const cp = (current && current.catchphrases) ? current.catchphrases.slice() : ['', '', ''];
  const ad = (current && current.attitudes)
    ? current.attitudes.map((a) => ({ event: a.event || '', attitude: a.attitude || '' }))
    : [];

  const usedCp = new Set();
  const nextCp = [];
  for (let i = 0; i < 3; i++) {
    const key = 'catchphrase' + i;
    if (locked && locked[key] === true) {
      nextCp[i] = String(cp[i] != null ? cp[i] : '').trim();
      if (nextCp[i]) usedCp.add(nextCp[i]);
      else {
        nextCp[i] = pickNonEmpty('', pools.catchphrases, usedCp);
        usedCp.add(nextCp[i]);
      }
    } else {
      const src = data && Array.isArray(data.catchphrases) ? data.catchphrases[i] : '';
      nextCp[i] = pickNonEmpty(src, pools.catchphrases, usedCp);
      usedCp.add(nextCp[i]);
    }
  }

  const eventPool = pools.presetEvents || [];
  const attitudePool = pools.attitudes || [];
  const usedEvents = new Set();
  const nextAd = [];
  for (let i = 0; i < 3; i++) {
    const key = 'attitude' + i;
    if (locked && locked[key] === true && ad[i]) {
      nextAd[i] = {
        event: String(ad[i].event || '').trim(),
        attitude: String(ad[i].attitude || '').trim()
      };
      if (nextAd[i].event) usedEvents.add(nextAd[i].event);
      if (!nextAd[i].event) {
        nextAd[i].event = pickNonEmpty('', eventPool, usedEvents);
        usedEvents.add(nextAd[i].event);
      }
      if (!nextAd[i].attitude) {
        nextAd[i].attitude = pickNonEmpty('', attitudePool);
      }
    } else {
      const row = data && Array.isArray(data.attitudes) ? data.attitudes[i] : null;
      const partialEvent =
        (row && row.event) || (lockedRow && ad[i].event) || (ad[i] && ad[i].event) || '';
      let event = pickNonEmpty(partialEvent, eventPool, usedEvents);
      let guard = 0;
      while (usedEvents.has(event) && guard < 12) {
        event = pickNonEmpty('', eventPool, usedEvents);
        guard++;
      }
      usedEvents.add(event);
      nextAd[i] = {
        event,
        attitude: pickNonEmpty(row && row.attitude, attitudePool)
      };
    }
  }

  return { catchphrases: nextCp, attitudes: nextAd };
}

exports.main = async (event) => {

  const layer = event && event.layer != null ? Number(event.layer) : 1;
  const pools = (event && event.pools) || {};
  const locked = (event && event.locked) || {};
  const current = (event && event.current) || null;
  const contextText = event && event.contextText != null ? String(event.contextText).trim() : '';

  const ctxCap = layer === 2 ? 520 : layer === 3 ? 960 : 600;
  const ctxShort = contextText ? contextText.slice(0, ctxCap) : '';

  const systemByLayer = {
    1: 'OC助手。只输出JSON。值从候选原样复制。',
    2: 'OC助手。只输出JSON。背景须与人设一致；身世/大事件互不重复，值从候选原样复制。',
    3: 'OC助手。只输出JSON。常用语与态度须符合人设；事件互不重复，值从候选原样复制。'
  };
  const systemPrompt = systemByLayer[layer] || systemByLayer[3];

  const hasLock = locked && Object.keys(locked).some((k) => locked[k] === true);
  let userContent = '';

  if (layer === 1) {
    userContent =
      (ctxShort ? ctxShort + '\n须严格符合上述抽卡方向，从候选中原样复制。\n' : '') +
      '候选:\n' +
      buildPoolText(pools, ['names', 'races', 'hairColors', 'eyeColors', 'personalities', 'quirks'], 12) +
      '\n{"name":"","race":"","hairColor":"","eyeColor":"","personality":"","quirk":""}';
    if (current && hasLock) {
      userContent += '\n锁:' + JSON.stringify(locked);
    }
  } else if (layer === 2) {
    userContent =
      (ctxShort ? ctxShort + '\n背景须与人设及抽卡方向一致。\n' : '') +
      '候选:\n' +
      buildPoolText(pools, ['worldviews', 'origins', 'lifeEvents'], 10) +
      '\n{"worldview":"","origins":["","",""],"lifeEvents":["","",""]}';
    if (current && hasLock) {
      userContent += '\n锁:' + JSON.stringify(locked);
    }
  } else if (layer === 3) {
    userContent =
      (ctxShort ? ctxShort + '\n常用语与态度须符合人设及抽卡方向。\n' : '') +
      '候选:\n' +
      buildPoolText(pools, ['catchphrases', 'presetEvents', 'attitudes'], 12) +
      '\n{"catchphrases":["","",""],"attitudes":[{"event":"","attitude":""},{"event":"","attitude":""},{"event":"","attitude":""}]}';
    if (current && hasLock) {
      userContent += '\n锁:' + JSON.stringify(locked);
    }
  } else {
    return { ok: false, errMsg: '无效的 layer 参数' };
  }

  try {
    const result = await chatCompletions([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ], { temperature: 0.55, maxTokens: layer === 2 ? 300 : layer === 3 ? 360 : 380 });

    const text = result && result.text;

    const parsed = parseJsonBlock(text);
    if (!parsed) {
      return { ok: false, errMsg: '模型返回格式无法解析' };
    }

    let data;
    if (layer === 1) data = validateLayer1(parsed, pools, locked, current);
    else if (layer === 2) data = validateLayer2(parsed, pools, locked, current);
    else data = validateLayer3(parsed, pools, locked, current);

    return { ok: true, data };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
