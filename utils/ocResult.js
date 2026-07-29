function pad3(arr) {
  const a = Array.isArray(arr) ? arr.slice(0, 3) : [];
  while (a.length < 3) a.push('');
  return a;
}

function defaultResult() {
  return {
    name: '',
    race: '',
    gender: '',
    age: '',
    hairColor: '',
    eyeColor: '',
    personalities: ['', '', ''],
    quirks: ['', '', ''],
    likes: ''
  };
}

/** 兼容旧存档的单字段 personality / quirk */
function normalizeResult(raw) {
  if (!raw) return defaultResult();
  const out = { ...defaultResult(), ...raw };

  if (raw.personalities && Array.isArray(raw.personalities)) {
    out.personalities = pad3(raw.personalities);
  } else if (raw.personality && String(raw.personality).trim()) {
    out.personalities = pad3([String(raw.personality), '', '']);
  } else {
    out.personalities = pad3(out.personalities);
  }

  if (raw.quirks && Array.isArray(raw.quirks)) {
    out.quirks = pad3(raw.quirks);
  } else if (raw.quirk && String(raw.quirk).trim()) {
    out.quirks = pad3([String(raw.quirk), '', '']);
  } else {
    out.quirks = pad3(out.quirks);
  }

  delete out.personality;
  delete out.quirk;
  out.gender = String(raw.gender || out.gender || '').trim();
  out.age = String(raw.age || out.age || '').trim();
  out.likes = String(raw.likes || out.likes || '').trim();
  return out;
}

function personalityBlend(result) {
  return normalizeResult(result).personalities.filter(Boolean).join('、');
}

function quirkBlend(result) {
  return normalizeResult(result).quirks.filter(Boolean).join('、');
}

function defaultBackground() {
  return {
    worldview: '',
    lifeEvents: ['', '', ''],
    origins: ['', '', '']
  };
}

function normalizeBackground(bg) {
  if (!bg) return defaultBackground();
  const lifeEvents = pad3(bg.lifeEvents);
  const origins = pad3(bg.origins);
  return {
    worldview: bg.worldview || '',
    lifeEvents,
    origins
  };
}

module.exports = {
  pad3,
  defaultResult,
  normalizeResult,
  personalityBlend,
  quirkBlend,
  defaultBackground,
  normalizeBackground
};
