/**
 * AI 对话额度：
 * - 每周免费 30 轮（单聊 + 群聊共用，会员相同）
 * - 分享续期 +10，每天最多 1 次
 * - 看广告领额度 +30 点（会员免广告直接领）
 * - 额度商店永久通用池
 */

/** 每周免费轮次 */
const FREE_ROUNDS_WEEKLY = 30;
/** @deprecated 会员不再额外周额度 */
const VIP_ROUNDS_WEEKLY = FREE_ROUNDS_WEEKLY;
/** 兼容旧导出：按渠道查阅时统一返回周额度 */
const FREE_ROUNDS_BY_CHANNEL = {
  dm: FREE_ROUNDS_WEEKLY,
  group: FREE_ROUNDS_WEEKLY
};
/** 变更配额规则时递增，强制按新规则重建 */
const QUOTA_SCHEMA_VERSION = 10;
/** 每天仅能分享续期 1 次 */
const MAX_SHARE_UNLOCK_PER_DAY = 1;
/** 每次分享续期增加的轮次 */
const SHARE_UNLOCK_ROUNDS = 10;
/** 每次看完激励广告增加的轮次 */
const AD_UNLOCK_ROUNDS = 30;
/** 每日看广告成功领取次数上限（前端不展示剩余次数） */
const AD_CLAIM_DAILY_LIMIT = 10;
const AD_CLAIM_DAILY_STORAGE = 'oc_ad_credits_daily_v1';
const SHARE_UNLOCK_TIMEOUT_MS = 120000;
/** @deprecated */
const FREE_ROUNDS_PER_BLOCK = FREE_ROUNDS_WEEKLY;
const QUOTA_CHANNEL_DM = 'dm';
const QUOTA_CHANNEL_GROUP = 'group';

const WEEKLY_STORAGE_KEY = 'oc_ai_chat_weekly_quota_v9';
const SHARE_STORAGE_KEY = 'oc_ai_chat_daily_share_unlock';
const EXTRA_STORAGE_KEY = 'oc_ai_chat_extra_rounds';
/** 规则升级后需把云端 freeUsed 强制刷成与本地一致（可降） */
const FORCE_CLOUD_FREE_RESET_KEY = 'oc_ai_quota_force_cloud_free_reset_v9';

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
  const allowed = freeRoundsPerBlock();
  return {
    weekKey: localWeekKey(now),
    roundCount: 0,
    allowedUntilRound: allowed,
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
  try {
    wx.setStorageSync('oc_quota_epoch', Date.now());
  } catch (_) {}
  return v;
}

function addExtraRounds(delta) {
  const next = readExtraRounds() + Math.max(0, Math.floor(Number(delta) || 0));
  return writeExtraRounds(next);
}

function consumeExtraRound() {
  return consumeExtraRounds(1);
}

/** 一次性扣 n 点兑换额度（通用点池） */
function consumeExtraRounds(n) {
  const cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  const cur = readExtraRounds();
  if (cur < cost) return false;
  writeExtraRounds(cur - cost);
  scheduleQuotaSync(cost);
  return true;
}

let _quotaSyncTimer = null;
let _pendingExtraConsumed = 0;
let _pendingExtraAdded = 0;

function scheduleQuotaSync(deltaConsumed, deltaExtraAdded) {
  const d = Math.max(0, Math.floor(Number(deltaConsumed) || 0));
  const a = Math.max(0, Math.floor(Number(deltaExtraAdded) || 0));
  if (d > 0) _pendingExtraConsumed += d;
  if (a > 0) _pendingExtraAdded += a;
  if (_quotaSyncTimer) return;
  _quotaSyncTimer = setTimeout(() => {
    _quotaSyncTimer = null;
    flushQuotaToCloud().catch(() => {});
  }, 600);
}

/** 立即把本周免费用量 / 广告加额推到云端（进入对话页 / 每轮对话后调用） */
function flushQuotaToCloud() {
  if (_quotaSyncTimer) {
    clearTimeout(_quotaSyncTimer);
    _quotaSyncTimer = null;
  }
  const consumed = _pendingExtraConsumed;
  const added = _pendingExtraAdded;
  _pendingExtraConsumed = 0;
  _pendingExtraAdded = 0;
  const meta = readMeta(QUOTA_CHANNEL_DM);
  const forceFreeReset = !!wx.getStorageSync(FORCE_CLOUD_FREE_RESET_KEY);
  try {
    const { callCloudFunction } = require('./cloudInit.js');
    return callCloudFunction({
      name: 'redeemCode',
      data: {
        action: 'syncBalance',
        deltaConsumed: consumed,
        deltaExtraAdded: added,
        weekKey: meta.weekKey,
        freeUsed: meta.roundCount,
        freeAllowed: Math.max(freeRoundsPerBlock(), meta.allowedUntilRound),
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
        if (data && data.ok && data.extraRounds != null) {
          writeExtraRounds(data.extraRounds);
        }
        return data;
      })
      .catch(() => {
        // 失败时回挂，避免广告加额丢失
        if (consumed > 0) _pendingExtraConsumed += consumed;
        if (added > 0) _pendingExtraAdded += added;
        return {};
      });
  } catch (_) {
    if (consumed > 0) _pendingExtraConsumed += consumed;
    if (added > 0) _pendingExtraAdded += added;
    return Promise.resolve({});
  }
}

/** 附带在 ocChat 请求里，供服务端直接写 user_quota */
function buildQuotaSyncPayload() {
  const meta = readMeta(QUOTA_CHANNEL_DM);
  const forceFreeReset = !!wx.getStorageSync(FORCE_CLOUD_FREE_RESET_KEY);
  const weeklyCap = freeRoundsPerBlock();
  return {
    reportQuota: true,
    weekKey: meta.weekKey,
    freeUsed: Math.max(0, Number(meta.roundCount) || 0),
    freeAllowed: Math.max(weeklyCap, Number(meta.allowedUntilRound) || weeklyCap),
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
  const weeklyCap = freeRoundsPerBlock();
  let allowed = Math.max(
    weeklyCap,
    Number(raw.allowedUntilRound) || weeklyCap
  );
  const meta = {
    weekKey,
    roundCount: Math.max(0, Number(raw.roundCount) || 0),
    allowedUntilRound: allowed,
    schemaVersion: QUOTA_SCHEMA_VERSION
  };
  if (allowed !== Number(raw.allowedUntilRound)) {
    writeMeta(_channel, meta);
  }
  return meta;
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

function isMemberNoAd() {
  try {
    return require('./ocMembership.js').isMember();
  } catch (_) {
    return false;
  }
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

function applyAdUnlock(channel, now) {
  const meta = readMeta(channel, now);
  meta.allowedUntilRound = Math.max(
    meta.allowedUntilRound + AD_UNLOCK_ROUNDS,
    meta.roundCount + AD_UNLOCK_ROUNDS
  );
  meta.schemaVersion = QUOTA_SCHEMA_VERSION;
  writeMeta(channel, meta);
  scheduleQuotaSync(0);
  try {
    const { trackUnlock } = require('./usageReport.js');
    trackUnlock('ad', AD_UNLOCK_ROUNDS, channel);
  } catch (_) {}
  return meta;
}

function recordAdUnlock(channel, now) {
  return applyAdUnlock(channel, now);
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
  let isVip = false;
  try {
    isVip = require('./ocMembership.js').isMember();
  } catch (_) {}

  return new Promise((resolve) => {
    if (page && typeof page.setData === 'function') {
      page._quotaUnlockResolve = resolve;
      page._quotaUnlockChannel = channel;
      page._quotaUnlockNow = now;
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: shareLeft,
        quotaOaQrVisible: false,
        isVip: isVip
      });
      // 抽屉弹出时预加载激励视频，减少点「看广告」时无填充
      try {
        require('./rewardedVideoAd.js').preloadRewardedVideoAd({ force: false });
      } catch (_) {}
      return;
    }

    // 无页面上下文时降级
    const items =
      shareLeft > 0
        ? ['分享至群聊续期（+10 轮）', '去额度商店']
        : ['去额度商店'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const t = items[res.tapIndex] || '';
        if (t.indexOf('分享') === 0) {
          beginShareUnlock(null, channel, now, CHANNEL_LABELS[channel], resolve);
          return;
        }
        if (t.indexOf('额度商店') >= 0) {
          wx.navigateTo({ url: '/pages/redeemCode/redeemCode' });
          resolve(false);
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

function getAdClaimDailyState(now) {
  const dayKey = localDateKey(now || Date.now());
  let raw = {};
  try {
    raw = wx.getStorageSync(AD_CLAIM_DAILY_STORAGE) || {};
  } catch (_) {
    raw = {};
  }
  if (String(raw.dayKey || '') !== dayKey) {
    return { dayKey: dayKey, count: 0 };
  }
  return {
    dayKey: dayKey,
    count: Math.max(0, Math.floor(Number(raw.count) || 0))
  };
}

function writeAdClaimDailyState(state) {
  try {
    wx.setStorageSync(AD_CLAIM_DAILY_STORAGE, {
      dayKey: state.dayKey,
      count: Math.max(0, Math.floor(Number(state.count) || 0))
    });
  } catch (_) {}
}

function isAdClaimDailyLimitReached(now) {
  return getAdClaimDailyState(now).count >= AD_CLAIM_DAILY_LIMIT;
}

function bumpAdClaimDailySuccess(now) {
  const state = getAdClaimDailyState(now);
  writeAdClaimDailyState({
    dayKey: state.dayKey,
    count: state.count + 1
  });
}

function grantAdCreditsLocal() {
  const left = addExtraRounds(AD_UNLOCK_ROUNDS);
  bumpAdClaimDailySuccess(Date.now());
  try {
    const { trackUnlock } = require('./usageReport.js');
    trackUnlock('ad_credits', AD_UNLOCK_ROUNDS, 'extra');
  } catch (_) {}
  scheduleQuotaSync(0, AD_UNLOCK_ROUNDS);
  return flushQuotaToCloud().then(() => ({
    ok: true,
    added: AD_UNLOCK_ROUNDS,
    left: readExtraRounds() || left
  }));
}

/**
 * 激励视频看完后弹出底部领取抽屉（可补点）；拉取失败不发奖。
 * 每日成功领取上限 10 次（达上限前不提示次数）。
 */
function claimAdCredits() {
  if (isMemberNoAd()) {
    if (isAdClaimDailyLimitReached(Date.now())) {
      return Promise.resolve({
        ok: false,
        dailyLimit: true,
        errMsg: '已达今日上限，请明天再来吧'
      });
    }
    return grantAdCreditsLocal().then((r) =>
      Object.assign({}, r, { memberSkipAd: true })
    );
  }

  if (isAdClaimDailyLimitReached(Date.now())) {
    return Promise.resolve({
      ok: false,
      dailyLimit: true,
      errMsg: '已达今日上限，请明天再来吧'
    });
  }

  let showRewardedVideoAd;
  let formatAdLoadErrMsg;
  let MIN_WATCH_MS = 30000;
  try {
    require('./appRelaunch.js').markSkipAppRelaunch();
  } catch (_) {}
  try {
    const ad = require('./rewardedVideoAd.js');
    showRewardedVideoAd = ad.showRewardedVideoAd;
    formatAdLoadErrMsg = ad.formatAdLoadErrMsg;
    if (ad.MIN_WATCH_MS) MIN_WATCH_MS = ad.MIN_WATCH_MS;
    if (typeof ad.preloadRewardedVideoAd === 'function') {
      ad.preloadRewardedVideoAd({ force: false });
    }
  } catch (_) {
    return Promise.resolve({ ok: false, errMsg: '广告模块不可用' });
  }

  try {
    wx.showLoading({ title: '加载激励广告…', mask: true });
  } catch (_) {}

  return showRewardedVideoAd().then((result) => {
    try {
      require('./appRelaunch.js').markSkipAppRelaunch();
    } catch (_) {}
    try {
      wx.hideLoading();
    } catch (_) {}

    if (!result || result.loadFailed || result.errCode === 'unsupported') {
      const msg =
        (typeof formatAdLoadErrMsg === 'function' && formatAdLoadErrMsg(result)) ||
        '广告加载失败，未赠送额度';
      return { ok: false, loadFailed: true, errMsg: msg };
    }
    if (!result.rewarded) {
      return {
        ok: false,
        earlyClose: !!(result && result.earlyClose),
        errMsg:
          (result.earlyClose && '需观看满 30 秒才能领取') ||
          result.errMsg ||
          '广告未完成'
      };
    }
    const watchedMs = Number(result.watchedMs) || 0;
    if (!result.isEnded && watchedMs < MIN_WATCH_MS) {
      return { ok: false, errMsg: '需观看满 30 秒才能领取' };
    }

    // 播放结束后立刻用底部抽屉确认/补点（不再用关闭后的 Modal）
    const drawer = require('./adClaimDrawer.js');
    return drawer
      .promptAdClaimDrawer({
        clicked: !!result.clicked,
        rounds: AD_UNLOCK_ROUNDS
      })
      .then((choice) => {
        if (!choice || !choice.claim) {
          return { ok: false, errMsg: '未领取' };
        }
        if (isAdClaimDailyLimitReached(Date.now())) {
          return {
            ok: false,
            dailyLimit: true,
            errMsg: '已达今日上限，请明天再来吧'
          };
        }
        return grantAdCreditsLocal();
      });
  });
}

function onQuotaSheetAd(page) {
  if (!page) return;
  const now = page._quotaUnlockNow || Date.now();
  const resolve = page._quotaUnlockResolve;
  if (typeof resolve !== 'function') return;

  page.setData({ quotaSheetVisible: false, quotaOaQrVisible: false });
  claimAdCredits()
    .then((result) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      if (result && result.ok) {
        wx.showToast({
          title: '已领取 +' + (result.added || AD_UNLOCK_ROUNDS) + ' 点',
          icon: 'none'
        });
        page._quotaUnlockResolve = null;
        page._quotaUnlockChannel = null;
        page._quotaUnlockNow = null;
        closeQuotaSheet(page);
        resolve(true);
        return;
      }
      const msg = (result && result.errMsg) || '广告未完成';
      if (msg && msg !== '已取消' && msg !== '未领取') {
        wx.showToast({ title: String(msg).slice(0, 28), icon: 'none' });
      }
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: getShareUnlockRemaining(now),
        quotaOaQrVisible: false
      });
    })
    .catch((err) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      wx.showToast({
        title: (err && err.message) || '广告加载失败',
        icon: 'none'
      });
      page.setData({
        quotaSheetVisible: true,
        quotaSheetShareLeft: getShareUnlockRemaining(now)
      });
    });
}

function onQuotaSheetRedeem(page) {
  if (!page) return;
  page.setData({ quotaSheetVisible: false, quotaOaQrVisible: false });
  wx.navigateTo({
    url: '/pages/redeemCode/redeemCode',
    fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
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
      placeholderText: '请输入会员兑换码',
      confirmText: '兑换',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          resolve(false);
          return;
        }
        const code = String(res.content || '').trim();
        if (!code) {
          wx.showToast({ title: '请输入会员兑换码', icon: 'none' });
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
    try {
      if (data.isVip != null || data.vipExpireAt != null) {
        const membership = require('./ocMembership.js');
        if (typeof membership.writeCache === 'function') {
          membership.writeCache({
            isVip: !!data.isVip,
            vipPaused: !!data.vipPaused,
            vipExpireAt: Number(data.vipExpireAt) || 0,
            syncedAt: Date.now()
          });
        } else if (typeof membership.syncMembership === 'function') {
          membership.syncMembership();
        }
        try {
          const now = Date.now();
          const meta = readMeta(QUOTA_CHANNEL_DM, now);
          const cap = freeRoundsPerBlock();
          if (meta.allowedUntilRound < cap) {
            meta.allowedUntilRound = cap;
            meta.schemaVersion = QUOTA_SCHEMA_VERSION;
            writeMeta(QUOTA_CHANNEL_DM, meta);
          }
        } catch (_) {}
      }
    } catch (_) {}
    scheduleQuotaSync(0);
    return data;
  });
}

function syncExtraRoundsFromServer() {
  const { callCloudFunction } = require('./cloudInit.js');
  // 先推送本地待同步的加额/消耗，再拉云端，避免广告刚加的额度被覆盖
  return flushQuotaToCloud()
    .then(() =>
      callCloudFunction({
        name: 'redeemCode',
        data: { action: 'balance' }
      })
    )
    .then((res) => {
      const data = (res && res.result) || {};
      if (data.ok && data.extraRounds != null) {
        writeExtraRounds(data.extraRounds);
      }
      if (data.ok) {
        applyCloudFreeQuotaToLocal(data);
        try {
          require('./ocMembership.js').writeCache({
            isVip: !!data.isVip,
            vipPaused: !!data.vipPaused,
            vipExpireAt: Number(data.vipExpireAt) || 0,
            syncedAt: Date.now()
          });
        } catch (_) {}
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
  const weeklyCap = freeRoundsPerBlock();
  const cloudAllowed = Math.max(
    weeklyCap,
    Math.floor(Number(data.freeAllowed) || 0) || weeklyCap
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
  VIP_ROUNDS_WEEKLY,
  AD_UNLOCK_ROUNDS,
  AD_CLAIM_DAILY_LIMIT,
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
  consumeExtraRounds,
  syncExtraRoundsFromServer,
  flushQuotaToCloud,
  buildQuotaSyncPayload,
  claimAdCredits,
  onQuotaSheetShare,
  onQuotaSheetAd,
  onQuotaSheetRedeem,
  onQuotaSheetFollowOa,
  onQuotaSheetCloseOa,
  onQuotaSheetClose,
  applyAdUnlock,
  recordAdUnlock,
  getShareUnlockRemaining,
  localWeekKey
};
