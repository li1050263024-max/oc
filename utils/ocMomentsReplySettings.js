/**
 * 朋友圈 / 抖音 OC 回复模式：同时控制节奏 + 回复文风提示词
 * - instant: 秒回
 * - delayed: 不定时
 * - random: 随机
 */
const STORAGE_KEY_MOMENTS = 'oc_moments_reply_mode_v1';
const STORAGE_KEY_DOUYIN = 'oc_douyin_reply_mode_v1';

const MODES = {
  instant: 'instant',
  delayed: 'delayed',
  random: 'random'
};

const MODE_LABELS = {
  instant: '秒回',
  delayed: '不定时回复',
  random: '随机回复'
};

/** 设置面板说明（书面语） */
const MODE_HINTS = {
  instant: '即时回复，语句简短、语气热络',
  delayed: '稍作停顿后再回复，更贴近日常交流节奏',
  random: '回复时机不定，偶有延迟，亦可能不予回复'
};

/** 传给云函数的文风说明（改的是 OC 怎么回，不只是延迟） */
const MODE_PROMPT_HINTS = {
  instant:
    '【回复模式：秒回】像刚刷到立刻回：反应快、短、热乎、口语碎；5～28 字；可带一点点亲昵或调侃，不要长篇分析。',
  delayed:
    '【回复模式：不定时】像忙完才回：语气松一点、可先接一句再补半句；可略带延迟感（「刚看到」「才刷到」）；5～40 字，仍要口语自然。',
  random:
    '【回复模式：随机】语气飘忽：可冷可热可敷衍可调侃，偶尔只回两三个字，但仍要接住用户话头；禁止说教；5～36 字。'
};

function storageKeyForApp(appKey) {
  return appKey === 'douyin' ? STORAGE_KEY_DOUYIN : STORAGE_KEY_MOMENTS;
}

function normalizeMode(mode) {
  const m = String(mode || '').trim();
  if (m === MODES.delayed || m === MODES.random || m === MODES.instant) return m;
  return MODES.instant;
}

function getReplyMode(appKey) {
  try {
    return normalizeMode(wx.getStorageSync(storageKeyForApp(appKey)));
  } catch (_) {
    return MODES.instant;
  }
}

function setReplyMode(mode, appKey) {
  const next = normalizeMode(mode);
  try {
    wx.setStorageSync(storageKeyForApp(appKey), next);
  } catch (_) {}
  return next;
}

function getReplyModeOptions() {
  return [
    { key: MODES.instant, label: MODE_LABELS.instant, hint: MODE_HINTS.instant },
    { key: MODES.delayed, label: MODE_LABELS.delayed, hint: MODE_HINTS.delayed },
    { key: MODES.random, label: MODE_LABELS.random, hint: MODE_HINTS.random }
  ];
}

function getReplyPromptHint(mode) {
  const m = normalizeMode(mode);
  return MODE_PROMPT_HINTS[m] || MODE_PROMPT_HINTS.instant;
}

/** @returns {{ skip: boolean, delayMs: number, mode: string }} */
function planReplyTiming(mode) {
  const m = normalizeMode(mode);
  if (m === MODES.instant) {
    // 秒回：几乎立刻进入生成（云请求本身仍需时间）
    return { skip: false, delayMs: 80 + Math.floor(Math.random() * 220), mode: m };
  }
  if (m === MODES.delayed) {
    return { skip: false, delayMs: 4000 + Math.floor(Math.random() * 26000), mode: m };
  }
  // random：约 30% 不回；否则 2～35 秒
  if (Math.random() < 0.3) {
    return { skip: true, delayMs: 0, mode: m };
  }
  return { skip: false, delayMs: 2000 + Math.floor(Math.random() * 33000), mode: m };
}

module.exports = {
  MODES,
  MODE_LABELS,
  MODE_HINTS,
  MODE_PROMPT_HINTS,
  getReplyMode,
  setReplyMode,
  getReplyModeOptions,
  getReplyPromptHint,
  planReplyTiming
};
