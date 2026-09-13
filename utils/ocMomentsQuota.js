/**
 * 朋友圈 AI 调用日配额：每日免费 15 次；超出后看激励广告 +5 次
 * 会员仅免广告（达上限时自动补次数，无需看广告）
 */
const STORAGE_KEY = 'oc_moments_ai_daily_v1';
const FREE_DAILY_CALLS = 15;
/** 每成功看完一条激励广告额外解锁的次数 */
const AD_BONUS_CALLS = 5;

function isVipMember() {
  try {
    return !!require('./ocMembership.js').isMember();
  } catch (_) {
    return false;
  }
}

function localDateKey(now) {
  try {
    return require('./ocMomentsStore.js').localDateKey(now);
  } catch (_) {
    const d = new Date(Number(now) || Date.now());
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
}

function readState(now) {
  const key = localDateKey(now);
  let raw = null;
  try {
    raw = wx.getStorageSync(STORAGE_KEY);
  } catch (_) {}
  if (!raw || typeof raw !== 'object' || raw.dateKey !== key) {
    return { dateKey: key, used: 0, bonus: 0 };
  }
  return {
    dateKey: key,
    used: Math.max(0, Math.floor(Number(raw.used) || 0)),
    bonus: Math.max(0, Math.floor(Number(raw.bonus) || 0))
  };
}

function writeState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, {
      dateKey: state.dateKey,
      used: state.used,
      bonus: state.bonus,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.warn('[ocMomentsQuota] write', err);
  }
}

function getLimit(now) {
  const s = readState(now);
  return FREE_DAILY_CALLS + s.bonus;
}

function getUsed(now) {
  return readState(now).used;
}

function getRemaining(now) {
  return Math.max(0, getLimit(now) - getUsed(now));
}

function getQuotaInfo(now) {
  const s = readState(now);
  const limit = FREE_DAILY_CALLS + s.bonus;
  const remaining = Math.max(0, limit - s.used);
  return {
    dateKey: s.dateKey,
    used: s.used,
    bonus: s.bonus,
    freeDaily: FREE_DAILY_CALLS,
    limit: limit,
    remaining: remaining,
    needAd: remaining <= 0,
    isVip: isVipMember()
  };
}

function ensureMemberAdBypass(now) {
  if (!isVipMember()) return false;
  const info = getQuotaInfo(now);
  if (!info.needAd) return true;
  grantAdBonus(AD_BONUS_CALLS, now);
  return !getQuotaInfo(now).needAd;
}

/**
 * 尝试占用 1 次 AI 调用
 * @returns {{ ok: boolean, needAd?: boolean, remaining?: number, errMsg?: string }}
 */
function tryConsumeCall(now) {
  ensureMemberAdBypass(now);
  const s = readState(now);
  const limit = FREE_DAILY_CALLS + s.bonus;
  if (s.used >= limit) {
    return {
      ok: false,
      needAd: true,
      remaining: 0,
      errMsg: '今日朋友圈 AI 已达 ' + limit + ' 次，看广告可解锁更多'
    };
  }
  s.used += 1;
  writeState(s);
  return {
    ok: true,
    needAd: false,
    remaining: Math.max(0, limit - s.used)
  };
}

/** 云调用失败时退回占用的次数 */
function refundCall(now) {
  const s = readState(now);
  if (s.used > 0) {
    s.used -= 1;
    writeState(s);
  }
  return getQuotaInfo(now);
}

/** 看完激励广告后增加可用次数 */
function grantAdBonus(count, now) {
  const n = Math.max(1, Math.floor(Number(count) || AD_BONUS_CALLS));
  const s = readState(now);
  s.bonus += n;
  writeState(s);
  return getQuotaInfo(now);
}

/**
 * 播放激励视频解锁更多朋友圈 AI 次数
 * @returns {Promise<{ ok: boolean, info?: object, errMsg?: string }>}
 */
function unlockMoreByRewardedAd() {
  if (isVipMember()) {
    return Promise.resolve({ ok: true, info: grantAdBonus(AD_BONUS_CALLS), memberSkipAd: true });
  }
  let showRewardedVideoAd;
  try {
    showRewardedVideoAd = require('./rewardedVideoAd.js').showRewardedVideoAd;
  } catch (_) {
    return Promise.resolve({ ok: false, errMsg: '广告组件不可用' });
  }
  try {
    wx.showLoading({ title: '加载广告…', mask: true });
  } catch (_) {}
  return showRewardedVideoAd()
    .then((result) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      if (!result || result.loadFailed) {
        return { ok: false, errMsg: '广告加载失败，请稍后再试' };
      }
      if (result.earlyClose || !result.rewarded) {
        return { ok: false, errMsg: '需看完激励广告才能解锁' };
      }
      const info = grantAdBonus(AD_BONUS_CALLS);
      return { ok: true, info: info, unlocked: AD_BONUS_CALLS };
    })
    .catch((err) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      return {
        ok: false,
        errMsg: (err && err.message) || '广告播放失败'
      };
    });
}

module.exports = {
  FREE_DAILY_CALLS,
  AD_BONUS_CALLS,
  getQuotaInfo,
  getRemaining,
  getUsed,
  getLimit,
  tryConsumeCall,
  refundCall,
  grantAdBonus,
  ensureMemberAdBypass,
  unlockMoreByRewardedAd
};
