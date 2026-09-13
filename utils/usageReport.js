/**
 * 用量上报：对话轮次 / 解锁 / 云函数(API)调用
 * 批量写入云函数 usageStats → 集合 usage_daily
 */

const FLUSH_MS = 2000;
const MAX_QUEUE_WAIT = 8;
const RETRY_MS = 5000;

/** 计为「模型 API 调用」的云函数名 */
const LLM_CLOUD_FUNCS = {
  ocChat: true,
  generateOcBio: true,
  generateOcStory: true,
  generateOcMoments: true,
  generateOcDouyinComment: true,
  generateOcFakeChat: true,
  generatePoolItem: true,
  expandOcPool: true,
  drawOcCoherent: true,
  parseOcSetting: true
};

const queue = {
  chatRounds: 0,
  chatRoundsDm: 0,
  chatRoundsGroup: 0,
  apiCalls: 0,
  apiByName: {},
  unlockAd: 0,
  unlockShare: 0,
  unlockFailOpen: 0,
  unlockRoundsAd: 0,
  unlockRoundsShare: 0,
  unlockRoundsFailOpen: 0
};

let flushTimer = null;
let retryTimer = null;
let flushing = false;
let queuedEvents = 0;

function isLlmCloudFunction(name) {
  return !!(name && LLM_CLOUD_FUNCS[name]);
}

function bump(field, n) {
  const v = Number(n);
  if (!v || v <= 0) return;
  queue[field] = (queue[field] || 0) + v;
  queuedEvents += 1;
  scheduleFlush();
}

function bumpApiName(name, n) {
  const key = String(name || '').trim();
  if (!key) return;
  const v = Number(n) || 1;
  if (!queue.apiByName[key]) queue.apiByName[key] = 0;
  queue.apiByName[key] += v;
}

function scheduleFlush(delay) {
  if (flushTimer) return;
  const wait =
    delay != null
      ? delay
      : queuedEvents >= MAX_QUEUE_WAIT
        ? 400
        : FLUSH_MS;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, wait);
}

function scheduleRetry() {
  if (retryTimer || flushTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flush().catch(() => {});
  }, RETRY_MS);
}

function takeSnapshot() {
  const snap = {
    chatRounds: queue.chatRounds,
    chatRoundsDm: queue.chatRoundsDm,
    chatRoundsGroup: queue.chatRoundsGroup,
    apiCalls: queue.apiCalls,
    apiByName: Object.assign({}, queue.apiByName),
    unlockAd: queue.unlockAd,
    unlockShare: queue.unlockShare,
    unlockFailOpen: queue.unlockFailOpen,
    unlockRoundsAd: queue.unlockRoundsAd,
    unlockRoundsShare: queue.unlockRoundsShare,
    unlockRoundsFailOpen: queue.unlockRoundsFailOpen
  };
  queue.chatRounds = 0;
  queue.chatRoundsDm = 0;
  queue.chatRoundsGroup = 0;
  queue.apiCalls = 0;
  queue.apiByName = {};
  queue.unlockAd = 0;
  queue.unlockShare = 0;
  queue.unlockFailOpen = 0;
  queue.unlockRoundsAd = 0;
  queue.unlockRoundsShare = 0;
  queue.unlockRoundsFailOpen = 0;
  queuedEvents = 0;
  return snap;
}

function restoreSnapshot(snap) {
  if (!snap) return;
  Object.keys(snap).forEach((k) => {
    if (k === 'apiByName') {
      Object.keys(snap.apiByName || {}).forEach((name) => {
        bumpApiName(name, snap.apiByName[name]);
      });
    } else if (typeof snap[k] === 'number' && snap[k] > 0) {
      queue[k] = (queue[k] || 0) + snap[k];
      queuedEvents += 1;
    }
  });
}

function hasPayload(snap) {
  if (!snap) return false;
  if (snap.chatRounds || snap.apiCalls) return true;
  if (snap.unlockAd || snap.unlockShare || snap.unlockFailOpen) return true;
  const names = snap.apiByName || {};
  return Object.keys(names).some((k) => names[k] > 0);
}

function trackChatRound(channel) {
  bump('chatRounds', 1);
  if (channel === 'group') bump('chatRoundsGroup', 1);
  else bump('chatRoundsDm', 1);
}

function trackApiCall(name) {
  const key = String(name || '').trim();
  if (!key || key === 'usageStats') return;
  if (!isLlmCloudFunction(key)) return;
  bump('apiCalls', 1);
  bumpApiName(key, 1);
}

function trackUnlock(type, rounds, channel) {
  const r = Math.max(0, Number(rounds) || 0);
  if (type === 'ad') {
    bump('unlockAd', 1);
    bump('unlockRoundsAd', r);
  } else if (type === 'share') {
    bump('unlockShare', 1);
    bump('unlockRoundsShare', r);
  } else if (type === 'fail_open') {
    bump('unlockFailOpen', 1);
    bump('unlockRoundsFailOpen', r);
  }
}

function flush() {
  if (flushing) return Promise.resolve(false);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const snap = takeSnapshot();
  if (!hasPayload(snap)) return Promise.resolve(false);

  let callFn;
  try {
    const cloudInit = require('./cloudInit.js');
    if (!cloudInit.ensureCloudReady()) {
      restoreSnapshot(snap);
      scheduleRetry();
      return Promise.resolve(false);
    }
    callFn = cloudInit.callCloudFunction;
  } catch (_) {
    if (!wx.cloud) {
      restoreSnapshot(snap);
      scheduleRetry();
      return Promise.resolve(false);
    }
    callFn = (opts) => wx.cloud.callFunction(opts);
  }

  flushing = true;
  let quotaMeta = {};
  try {
    const { buildQuotaSyncPayload } = require('./aiChatQuota.js');
    quotaMeta = buildQuotaSyncPayload() || {};
  } catch (_) {}

  return callFn({
    name: 'usageStats',
    data: Object.assign({ action: 'report' }, snap, {
      weekKey: quotaMeta.weekKey,
      freeUsed: quotaMeta.freeUsed,
      freeAllowed: quotaMeta.freeAllowed,
      forceFreeReset: !!quotaMeta.forceFreeReset
    })
  })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) {
        console.warn('[usageReport] report not ok', r);
        restoreSnapshot(snap);
        scheduleRetry();
        return false;
      }
      if (quotaMeta.forceFreeReset && r.ok) {
        try {
          wx.removeStorageSync('oc_ai_quota_force_cloud_free_reset_v7');
        } catch (_) {}
      }
      return true;
    })
    .catch((err) => {
      console.warn('[usageReport] flush fail', err);
      restoreSnapshot(snap);
      scheduleRetry();
      return false;
    })
    .finally(() => {
      flushing = false;
    });
}

module.exports = {
  LLM_CLOUD_FUNCS,
  isLlmCloudFunction,
  trackChatRound,
  trackApiCall,
  trackUnlock,
  flush
};
