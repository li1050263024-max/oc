/**
 * AI 对话额度：
 * - 每周免费 30 轮（单聊 + 群聊共用）
 * - 分享续期 +10，每天最多 1 次
 * - 兑换码通用池无有效期限制
 * （已下线激励广告续期）
 */

/** 每周免费轮次（单聊群聊共用） */
const FREE_ROUNDS_WEEKLY = 30;
/** 兼容旧导出：按渠道查阅时统一返回周额度 */
const FREE_ROUNDS_BY_CHANNEL = {
  dm: FREE_ROUNDS_WEEKLY,
  group: FREE_ROUNDS_WEEKLY
};
/** 变更配额规则时递增，强制按新规则重建（上线周额度 30 时刷新一次） */
const QUOTA_SCHEMA_VERSION = 7;
/** 每天仅能分享续期 1 次 */
const MAX_SHARE_UNLOCK_PER_DAY = 1;
/** 每次分享续期增加的轮次 */
const SHARE_UNLOCK_ROUNDS = 10;
const SHARE_UNLOCK_TIMEOUT_MS = 120000;
/** @deprecated */
const FREE_ROUNDS_PER_BLOCK = FREE_ROUNDS_WEEKLY;
const QUOTA_CHANNEL_DM = 'dm';
const QUOTA_CHANNEL_GROUP = 'group';

const WEEKLY_STORAGE_KEY = 'oc_ai_chat_weekly_quota_v7';
const SHARE_STORAGE_KEY = 'oc_ai_chat_daily_share_unlock';
const EXTRA_STORAGE_KEY = 'oc_ai_chat_extra_rounds';
/** 规则升级后需把云端 freeUsed 强制刷成与本地一致（可降） */
const FORCE_CLOUD_FREE_RESET_KEY = 'oc_ai_quota_force_cloud_free_reset_v7';

const CHANNEL_LABELS = {
  [QUOTA_CHANNEL_DM]: '单聊',
  [QUOTA_CHANNEL_GROUP]: '群聊'
};

function localDateKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 本周标识：以当周周一的日期键为准（本地时区） */
function localWeekKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return localDateKey(monday.getTime());
}

function normalizeChannel(channel) {
  return channel === QUOTA_CHANNEL_GROUP ? QUOTA_CHANNEL_GROUP : QUOTA_CHANNEL_DM;
}

function freeRoundsPerBlock() {
  return FREE_ROUNDS_WEEKLY;
}

function defaultMeta(now) {
  return {
    weekKey: localWeekKey(now),
    roundCount: 0,
    allowedUntilRound: FREE_ROUNDS_WEEKLY,
    schemaVersion: QUOTA_SCHEMA_VERSION
  };
}

function defaultShareMeta(now) {
  return {
    dateKey: localDateKey(now),
    count: 0
  };
}

function readShareMeta(now) {
  const ts = Number(now) || Date.now();
  const today = localDateKey(ts);
  const raw = wx.getStorageSync(SHARE_STORAGE_KEY) || {};
  if (String(raw.dateKey || '') !== today) return defaultShareMeta(ts);
  return {
    dateKey: today,
    count: Math.max(0, Number(raw.count) || 0)
  };
}

function writeShareMeta(meta) {
  wx.setStorageSync(SHARE_STORAGE_KEY, meta);
}

function readExtraRounds() {
  const n = Number(wx.getStorageSync(EXTRA_STORAGE_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function writeExtraRounds(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  wx.setStorageSync(EXTRA_STORAGE_KEY, v);
  return v;
}

function addExtraRounds(delta) {
  const next = readExtraRounds() + Math.max(0, Math.floor(Number(delta) || 0));
  return writeExtraRounds(next);
}

function consumeExtraRound() {
  const cur = readExtraRounds();
  if (cur <= 0) return false;
  writeExtraRounds(cur - 1);
  scheduleQuotaSync(1);
  return true;
}

let _quotaSyncTimer = null;
let _pendingExtraConsumed = 0;

function scheduleQuotaSync(deltaConsumed) {
  const d = Math.max(0, Math.floor(Number(deltaConsumed) || 0));
  if (d > 0) _pendingExtraConsumed += d;
  if (_quotaSyncTimer) return;
  _quotaSyncTimer = setTimeout(() => {
    _quotaSyncTimer = null;
    flushQuotaToCloud().catch(() => {});
  }, 600);
}

/** 立即把本周免费用量推到云端（进入对话页 / 每轮对话后调用） */
function flushQuotaToCloud() {
  if (_quotaSyncTimer) {
    clearTimeout(_quotaSyncTimer);
    _quotaSyncTimer = null;
  }
  const consumed = _pendingExtraConsumed;
  _pendingExtraConsumed = 0;
  const meta = readMeta(QUOTA_CHANNEL_DM);
  const forceFreeReset = !!wx.getStorageSync(FORCE_CLOUD_FREE_RESET_KEY);
  try {
    const { callCloudFunction } = require('./cloudInit.js');
    return callCloudFunction({
      name: 'redeemCode',
      data: {
        action: 'syncBalance',
        deltaConsumed: consumed,
        weekKey: meta.weekKey,
        freeUsed: meta.roundCount,
        freeAllowed: Math.max(FREE_ROUNDS_WEEKLY, meta.allowedUntilRound),
        forceFreeReset: forceFreeReset
      }
    })
      .then((res) => {
        const data = (res && res.result) || {};
        if (forceFreeReset && data && data.ok) {
          try {
            wx.removeStorageSync(FORCE_CLOUD_FREE_RESET_KEY);
          } catch (_) {}
        }
        return data;
      })
      .catch(() => ({}));
  } catch (_) {
    return Promise.resolve({});
  }
}

/** 附带在 ocChat 请求里，供服务端直接写 user_quota */
function buildQuotaSyncPayload() {
  const meta = readMeta(QUOTA_CHANNEL_DM);
  const forceFreeReset = !!wx.getStorageSync(FORCE_CLOUD_FREE_RESET_KEY);
  return {
    reportQuota: true,
    weekKey: meta.weekKey,
    freeUsed: Math.max(0, Number(meta.roundCount) || 0),
    freeAllowed: Math.max(
      FREE_ROUNDS_WEEKLY,
      Number(meta.allowedUntilRound) || FREE_ROUNDS_WEEKLY
    ),
    forceFreeReset: forceFreeReset
  };
}

function getShareUnlockRemaining(now) {
  const meta = readShareMeta(now);
  return Math.max(0, MAX_SHARE_UNLOCK_PER_DAY - meta.count);
}

function canShareUnlock(now) {
  return getShareUnlockRemaining(now) > 0;
}

function readMeta(_channel, now) {
  const ts = Number(now) || Date.now();
  const weekKey = localWeekKey(ts);
  const raw = wx.getStorageSync(WEEKLY_STORAGE_KEY) || {};
  const schemaMismatch =
    Number(raw.schemaVersion) !== QUOTA_SCHEMA_VERSION;
  const weekMismatch = String(raw.weekKey || '') !== weekKey;
  if (weekMismatch || schemaMismatch) {
    const meta = defaultMeta(ts);
    // 持久化新周/新规则，避免反复重置
    writeMeta(_channel, meta);
    if (schemaMismatch) {
      // 上线新规则：本地重置后，强制把云端 freeUsed 也刷成一致（允许变少）
      try {
        wx.setStorageSync(FORCE_CLOUD_FREE_RESET_KEY, 1);
      } catch (_) {}
    }
    return meta;
  }
  return {
    weekKey,
    roundCount: Math.max(0, Number(raw.roundCount) || 0),
    allowedUntilRound: Math.max(
      FREE_ROUNDS_WEEKLY,
      Number(raw.allowedUntilRound) || FREE_ROUNDS_WEEKLY
    ),
    schemaVersion: QUOTA_SCHEMA_VERSION
  };
}

function writeMeta(_channel, meta) {
  wx.setStorageSync(WEEKLY_STORAGE_KEY, {
    weekKey: meta.weekKey,
    roundCount: meta.roundCount,
    allowedUntilRound: meta.allowedUntilRound,
    schemaVersion: QUOTA_SCHEMA_VERSION
  });
}

function getDailyRoundCount(channel, now) {
  return readMeta(channel, now).roundCount;
}

function needsQuotaUnlock(channel, now) {
  const meta = readMeta(channel, now);
  if (meta.roundCount < meta.allowedUntilRound) return false;
  return readExtraRounds() <= 0;
}

/** @deprecated 兼容旧名：是否需要解锁（已无广告） */
function needsRewardAd(channel, now) {
  return needsQuotaUnlock(channel, now);
}

function applyShareUnlock(channel, now) {
  const meta = readMeta(channel, now);
  meta.allowedUntilRound = Math.max(
    meta.allowedUntilRound + SHARE_UNLOCK_ROUNDS,
    meta.roundCount + SHARE_UNLOCK_ROUNDS
  );
  meta.schemaVersion = QUOTA_SCHEMA_VERSION;
  writeMeta(channel, meta);
  scheduleQuotaSync(0);
  return meta;
}

function recordShareUnlock(channel, now) {
  const share = readShareMeta(now);
  if (share.count >= MAX_SHARE_UNLOCK_PER_DAY) return null;
  share.count += 1;
  writeShareMeta(share);
  const meta = applyShareUnlock(channel, now);
  try {
    const { trackUnlock } = require('./usageReport.js');
    trackUnlock('share', SHARE_UNLOCK_ROUNDS, channel);
  } catch (_) {}
  // 写云端分享明细，供管理后台按用户查看
  try {
    reportShareUnlockLog(channel, SHARE_UNLOCK_ROUNDS);
  } catch (_) {}
  return meta;
}

function reportShareUnlockLog(channel, rounds) {
  let callFn;
  try {
    const cloudInit = require('./cloudInit.js');
    if (!cloudInit.ensureCloudReady()) return;
    callFn = cloudInit.callCloudFunction;
  } catch (_) {
    if (!wx.cloud) return;
    callFn = (opts) => wx.cloud.callFunction(opts);
  }
  callFn({
    name: 'usageStats',
    data: {
      action: 'logShare',
      rounds: Math.max(0, Number(rounds) || SHARE_UNLOCK_ROUNDS),
      channel: normalizeChannel(channel)
    }
  }).catch(() => {});
}

function recordAiChatRound(channel, now) {
  const meta = readMeta(channel, now);
  const freeLeft = Math.max(0, meta.allowedUntilRound - meta.roundCount);
  if (freeLeft > 0) {
    meta.roundCount += 1;
    meta.schemaVersion = QUOTA_SCHEMA_VERSION;
    writeMeta(channel, meta);
    // 立刻推云端，避免后台免费用量长期不更新
    flushQuotaToCloud().catch(() => {});
  } else if (!consumeExtraRound()) {
    meta.roundCount += 1;
    meta.schemaVersion = QUOTA_SCHEMA_VERSION;
    writeMeta(channel, meta);
    flushQuotaToCloud().catch(() => {});
  }
  try {
    const { trackChatRound } = require('./usageReport.js');
    trackChatRound(channel);
  } catch (_) {}
  return meta;
}

function buildQuotaHint(channel, meta) {
  const m = meta || readMeta(channel);
  const remaining = Math.max(0, m.allowedUntilRound - m.roundCount);
  const extraRounds = readExtraRounds();
  return {
    roundCount: m.roundCount,
    allowedUntilRound: m.allowedUntilRound,
    remaining,
    extraRounds,
    weekKey: m.weekKey,
    /** 本周已用（免费+分享续期计数） */
    used: Math.max(0, Number(m.roundCount) || 0),
    /** 还可聊：本周剩余 + 兑换通用池 */
    left: remaining + extraRounds,
    shareRemaining: getShareUnlockRemaining()
  };
}

function buildQuotaShareMessage(channel) {
  const label = CHANNEL_LABELS[normalizeChannel(channel)] || '对话';
  return {
    title: '来和我一起聊 OC 吧',
    path: '/pages/index/index?from=quota_share&ch=' + normalizeChannel(channel),
    label: label
  };
}

function clearSharePending(page) {
  if (!page || !page._aiQuotaSharePending) return;
  const pending = page._aiQuotaSharePending;
  page._aiQuotaSharePending = null;
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
}

function consumeQuotaShareIfPending(page) {
  if (!page || !page._aiQuotaSharePending) return false;
  const pending = page._aiQuotaSharePending;
  clearSharePending(page);
  const unlocked = recordShareUnlock(pending.channel, pending.now);
  if (!unlocked) {
    wx.showToast({ title: '今日分享续期次数已用完', icon: 'none' });
    if (typeof pending.resolve === 'function') pending.resolve(false);
    return true;
  }
  wx.showToast({
    title: '分享成功，已续期 +' + SHARE_UNLOCK_ROUNDS + ' 轮',
    icon: 'success'
  });
  if (typeof pending.resolve === 'function') pending.resolve(true);
  return true;
}

function beginShareUnlock(page, channel, now, label, resolve) {
  if (!page) {
    wx.showToast({ title: '无法发起分享，请稍后重试', icon: 'none' });
    resolve(false);
    return;
  }
  if (!canShareUnlock(now)) {
    wx.showToast({ title: '今日分享次数已用完', icon: 'none' });
    resolve(false);
    return;
  }

  clearSharePending(page);
  const pending = {
    channel: normalizeChannel(channel),
    now: now,
    resolve: resolve,
    timer: null
  };
  pending.timer = setTimeout(() => {
    if (page._aiQuotaSharePending !== pending) return;
    clearSharePending(page);
    wx.showToast({ title: '未完成分享，已取消', icon: 'none' });
    resolve(false);
  }, SHARE_UNLOCK_TIMEOUT_MS);
  page._aiQuotaSharePending = pending;
  page._aiQuotaShareMeta = buildQuotaShareMessage(channel);

  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage']
    });
  } catch (_) {}

  wx.showModal({
    title: '分享至群聊续期',
    content:
      '请点击右上角「···」→「转发」，选择一个微信群完成分享。成功后增加 ' +
      SHARE_UNLOCK_ROUNDS +
      ' 轮（今日还可分享 ' +
      getShareUnlockRemaining(now) +
      ' 次）。',
    confirmText: '我知道了',
    cancelText: '取消',
    success: (res) => {
      if (!res.confirm) {
        clearSharePending(page);
        resolve(false);
      }
    },
    fail: () => {
      clearSharePending(page);
      resolve(false);
    }
  });
}

function closeQuotaSheet(page) {
  if (!page || !page.setData) return;
  page.setData({
    quotaSheetVisible: false,
    quotaOaQrVisible: false
  });
}

function finishQuotaSheet(page, ok) {
  const resolve = page && page._quotaUnlockResolve;
  page._quotaUnlockResolve = null;
  page._quotaUnlockChannel = null;
  page._quotaUnlockNow = null;
  closeQuotaSheet(page);
  if (typeof resolve === 'function') resolve(!!ok);
}

function ensureAiChatAllowed(options) {
  const opts = options || {};
  const channel = normalizeChannel(opts.channel);
  const now = opts.now || Date.now();
  const page = opts.page || null;

  if (!needsQuotaUnlock(channel, now)) {
    return Promise.resolve(true);
  }

  const shareLeft = getShareUnlockRemaining(now);

  return new Promise((resolve) => {
    if (page && typeof page.setData === 'function') {
      page._quotaUnlockResolve = resolve;
      page._quotaUnlockChannel = channel;
      page._quotaUnlockNow = now;
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: shareLeft,
        quotaOaQrVisible: false
      });
      return;
    }

    // 无页面上下文时降级
    const items =
      shareLeft > 0
        ? ['分享至群聊续期（+10 轮）', '输入兑换码']
        : ['输入兑换码'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const t = items[res.tapIndex] || '';
        if (t.indexOf('分享') === 0) {
          beginShareUnlock(null, channel, now, CHANNEL_LABELS[channel], resolve);
          return;
        }
        if (t.indexOf('兑换码') >= 0) {
          promptRedeemCode()
            .then((ok) => resolve(ok && !needsQuotaUnlock(channel, now)))
            .catch(() => resolve(false));
          return;
        }
        resolve(false);
      },
      fail: () => resolve(false)
    });
  });
}

function onQuotaSheetShare(page) {
  if (!page) return;
  const channel = page._quotaUnlockChannel || QUOTA_CHANNEL_DM;
  const now = page._quotaUnlockNow || Date.now();
  const resolve = page._quotaUnlockResolve;
  if (typeof resolve !== 'function') return;
  if (!canShareUnlock(now)) {
    wx.showToast({ title: '今日分享次数已用完', icon: 'none' });
    return;
  }
  page._quotaUnlockResolve = null;
  page.setData({ quotaSheetVisible: false, quotaOaQrVisible: false });
  beginShareUnlock(page, channel, now, CHANNEL_LABELS[channel] || '对话', (ok) => {
    page._quotaUnlockChannel = null;
    page._quotaUnlockNow = null;
    closeQuotaSheet(page);
    resolve(!!ok);
  });
}

function onQuotaSheetRedeem(page) {
  if (!page) return;
  const channel = page._quotaUnlockChannel || QUOTA_CHANNEL_DM;
  const now = page._quotaUnlockNow || Date.now();
  promptRedeemCode()
    .then((ok) => {
      if (ok && !needsQuotaUnlock(channel, now)) {
        finishQuotaSheet(page, true);
        return;
      }
      // 兑换失败或仍不足：重新打开抽屉
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: getShareUnlockRemaining(now),
        quotaOaQrVisible: false
      });
    })
    .catch(() => {
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: getShareUnlockRemaining(now)
      });
    });
}

function onQuotaSheetFollowOa(page) {
  if (!page || !page.setData) return;
  page.setData({ quotaOaQrVisible: true });
}

function onQuotaSheetCloseOa(page) {
  if (!page || !page.setData) return;
  page.setData({ quotaOaQrVisible: false });
}

function onQuotaSheetClose(page) {
  finishQuotaSheet(page, false);
}

function promptRedeemCode() {
  return new Promise((resolve) => {
    wx.showModal({
      title: '兑换码',
      editable: true,
      placeholderText: '请输入兑换码',
      confirmText: '兑换',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          resolve(false);
          return;
        }
        const code = String(res.content || '').trim();
        if (!code) {
          wx.showToast({ title: '请输入兑换码', icon: 'none' });
          resolve(false);
          return;
        }
        redeemCodeOnServer(code)
          .then((data) => {
            wx.showToast({
              title: '已兑换 +' + (data.rounds || 0) + ' 轮',
              icon: 'success'
            });
            resolve(true);
          })
          .catch((err) => {
            wx.showToast({
              title: (err && err.message) || '兑换失败',
              icon: 'none'
            });
            resolve(false);
          });
      },
      fail: () => resolve(false)
    });
  });
}

function redeemCodeOnServer(code) {
  const { callCloudFunction } = require('./cloudInit.js');
  return callCloudFunction({
    name: 'redeemCode',
    data: { action: 'redeem', code: code }
  }).then((res) => {
    const data = (res && res.result) || {};
    if (!data.ok) {
      throw new Error(data.err || '兑换失败');
    }
    if (data.extraRounds != null) {
      writeExtraRounds(data.extraRounds);
    } else if (data.rounds) {
      addExtraRounds(data.rounds);
    }
    scheduleQuotaSync(0);
    return data;
  });
}

function syncExtraRoundsFromServer() {
  const { callCloudFunction } = require('./cloudInit.js');
  return callCloudFunction({
    name: 'redeemCode',
    data: { action: 'balance' }
  })
    .then((res) => {
      const data = (res && res.result) || {};
      if (data.ok && data.extraRounds != null) {
        writeExtraRounds(data.extraRounds);
      }
      if (data.ok) {
        applyCloudFreeQuotaToLocal(data);
      }
      return readExtraRounds();
    })
    .catch(() => readExtraRounds());
}

/**
 * 把云端免费用量同步到本地，避免：
 * - 管理端强制清空后，小程序仍显示本地剩余
 * - 多端 / 服务端已记账，本地偏少
 */
function applyCloudFreeQuotaToLocal(data) {
  if (!data || data.ok === false) return;
  // 规则升级强制刷新期间，禁止用旧的云端 freeUsed 盖回本地
  if (wx.getStorageSync(FORCE_CLOUD_FREE_RESET_KEY)) return;
  const cloudUsed = Math.max(0, Math.floor(Number(data.freeUsed) || 0));
  const cloudAllowed = Math.max(
    FREE_ROUNDS_WEEKLY,
    Math.floor(Number(data.freeAllowed) || 0) || FREE_ROUNDS_WEEKLY
  );
  const cloudWeek = String(data.weekKey || '');
  const clearedAt = Math.max(0, Number(data.adminClearedAt) || 0);
  const now = Date.now();
  const meta = readMeta(QUOTA_CHANNEL_DM, now);

  // 不同周：以本地周为准，不把上周云端用量硬盖过来（换周会重置）
  if (cloudWeek && meta.weekKey && cloudWeek !== meta.weekKey && !clearedAt) {
    return;
  }

  let changed = false;
  if (clearedAt > 0) {
    // 管理端强制清空：本地视为本周免费已用尽，并清掉分享续期抬高的上限
    const nextUsed = Math.max(cloudUsed, cloudAllowed, meta.roundCount);
    if (
      meta.roundCount !== nextUsed ||
      meta.allowedUntilRound !== cloudAllowed ||
      (cloudWeek && meta.weekKey !== cloudWeek)
    ) {
      meta.roundCount = nextUsed;
      meta.allowedUntilRound = cloudAllowed;
      if (cloudWeek) meta.weekKey = cloudWeek;
      meta.schemaVersion = QUOTA_SCHEMA_VERSION;
      changed = true;
    }
    try {
      wx.setStorageSync('oc_ai_chat_admin_cleared_at', clearedAt);
    } catch (_) {}
  } else if (cloudUsed > meta.roundCount) {
    // 云端已用更多：本地跟上（只增不减）
    meta.roundCount = cloudUsed;
    meta.allowedUntilRound = Math.max(meta.allowedUntilRound, cloudAllowed);
    if (cloudWeek) meta.weekKey = cloudWeek;
    meta.schemaVersion = QUOTA_SCHEMA_VERSION;
    changed = true;
  }

  if (changed) writeMeta(QUOTA_CHANNEL_DM, meta);
}

module.exports = {
  FREE_ROUNDS_PER_BLOCK,
  FREE_ROUNDS_BY_CHANNEL,
  FREE_ROUNDS_WEEKLY,
  SHARE_UNLOCK_ROUNDS,
  getFreeRoundsPerBlock: freeRoundsPerBlock,
  QUOTA_CHANNEL_DM,
  QUOTA_CHANNEL_GROUP,
  QUOTA_SCHEMA_VERSION,
  MAX_SHARE_UNLOCK_PER_DAY,
  getDailyRoundCount,
  needsRewardAd,
  needsQuotaUnlock,
  recordAiChatRound,
  recordShareUnlock,
  buildQuotaHint,
  buildQuotaShareMessage,
  consumeQuotaShareIfPending,
  ensureAiChatAllowed,
  promptRedeemCode,
  redeemCodeOnServer,
  writeExtraRounds,
  addExtraRounds,
  readExtraRounds,
  syncExtraRoundsFromServer,
  flushQuotaToCloud,
  buildQuotaSyncPayload,
  onQuotaSheetShare,
  onQuotaSheetRedeem,
  onQuotaSheetFollowOa,
  onQuotaSheetCloseOa,
  onQuotaSheetClose,
  getShareUnlockRemaining,
  localWeekKey
};
