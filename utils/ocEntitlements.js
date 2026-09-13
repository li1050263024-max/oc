/**
 * 额度兑换型权益：视频提取、观看 OC 扩容等
 */
const WATCH_BONUS_KEY = 'oc_social_watch_bonus_v1';
const VIDEO_FREE_USED_KEY = 'oc_video_extract_free_used_v1';

const BASE_WATCH = 10;
const WATCH_SLOT_COST = 10;
const VIDEO_EXTRACT_FREE = 3;
const VIDEO_EXTRACT_COST = 10;

function readWatchBonus() {
  try {
    const raw = wx.getStorageSync(WATCH_BONUS_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function getWatchBonus(appKey) {
  const k = String(appKey || '').trim();
  const raw = readWatchBonus();
  return Math.max(0, Math.floor(Number(raw[k]) || 0));
}

function getWatchLimitWithBonus(appKey, isVip) {
  return BASE_WATCH + getWatchBonus(appKey);
}

function purchaseWatchSlot(appKey) {
  const k = String(appKey || '').trim();
  if (k !== 'moments' && k !== 'douyin') {
    return { ok: false, errMsg: '未知 APP' };
  }
  const credits = require('./ocCredits.js');
  if (!credits.canAfford(WATCH_SLOT_COST)) {
    return {
      ok: false,
      errMsg: '需要 ' + WATCH_SLOT_COST + ' 点额度（当前 ' + credits.getBalance() + ' 点）'
    };
  }
  const pay = credits.consume(WATCH_SLOT_COST, 'WATCH_SLOT');
  if (!pay || !pay.ok) {
    return { ok: false, errMsg: (pay && pay.errMsg) || '扣点失败' };
  }
  const raw = readWatchBonus();
  const next = Math.max(0, Math.floor(Number(raw[k]) || 0)) + 1;
  raw[k] = next;
  try {
    wx.setStorageSync(WATCH_BONUS_KEY, raw);
  } catch (e) {
    credits.refund(WATCH_SLOT_COST);
    return { ok: false, errMsg: '保存失败' };
  }
  return {
    ok: true,
    bonus: next,
    limit: BASE_WATCH + next,
    left: credits.getBalance()
  };
}

function getVideoExtractFreeUsed() {
  try {
    return Math.max(0, Math.floor(Number(wx.getStorageSync(VIDEO_FREE_USED_KEY)) || 0));
  } catch (_) {
    return 0;
  }
}

function markVideoExtractFreeUsed() {
  const n = getVideoExtractFreeUsed() + 1;
  try {
    wx.setStorageSync(VIDEO_FREE_USED_KEY, n);
  } catch (_) {}
  return n;
}

function getVideoExtractFreeLeft() {
  return Math.max(0, VIDEO_EXTRACT_FREE - getVideoExtractFreeUsed());
}

/** @returns {{ ok: boolean, free?: boolean, spent?: number, left?: number, errMsg?: string }} */
function reserveVideoExtract() {
  const freeLeft = getVideoExtractFreeLeft();
  if (freeLeft > 0) {
    markVideoExtractFreeUsed();
    return { ok: true, free: true, spent: 0, freeLeft: freeLeft - 1 };
  }
  const credits = require('./ocCredits.js');
  if (!credits.canAfford(VIDEO_EXTRACT_COST)) {
    return {
      ok: false,
      errMsg:
        '免费 ' +
        VIDEO_EXTRACT_FREE +
        ' 次已用完，继续提取需 ' +
        VIDEO_EXTRACT_COST +
        ' 点（当前 ' +
        credits.getBalance() +
        ' 点）'
    };
  }
  const pay = credits.consume(VIDEO_EXTRACT_COST, 'VIDEO_EXTRACT');
  if (!pay || !pay.ok) {
    return { ok: false, errMsg: (pay && pay.errMsg) || '扣点失败' };
  }
  return {
    ok: true,
    free: false,
    spent: VIDEO_EXTRACT_COST,
    left: credits.getBalance()
  };
}

function refundVideoExtract(reservation) {
  if (!reservation || !reservation.ok) return;
  if (reservation.free) {
    const used = getVideoExtractFreeUsed();
    if (used > 0) {
      try {
        wx.setStorageSync(VIDEO_FREE_USED_KEY, used - 1);
      } catch (_) {}
    }
    return;
  }
  if (reservation.spent > 0) {
    require('./ocCredits.js').refund(reservation.spent);
  }
}

function ensureWatchSlot(appKey) {
  const socialWatch = require('./ocSocialWatch.js');
  const summary = socialWatch.getWatchSummary(appKey);
  if (summary.limit <= 0 || summary.count < summary.limit) {
    return Promise.resolve(true);
  }
  const credits = require('./ocCredits.js');
  return credits.ensure(WATCH_SLOT_COST, 'WATCH_SLOT').then((ok) => {
    if (!ok) return false;
    const r = purchaseWatchSlot(appKey);
    if (!r.ok) {
      wx.showToast({ title: r.errMsg || '扩容失败', icon: 'none' });
      return false;
    }
    wx.showToast({
      title: '已永久 +1 人（上限 ' + r.limit + '）',
      icon: 'none'
    });
    return true;
  });
}

function ensureVideoExtract() {
  const freeLeft = getVideoExtractFreeLeft();
  if (freeLeft > 0) return Promise.resolve(true);
  return require('./ocCredits.js').ensure(VIDEO_EXTRACT_COST, 'VIDEO_EXTRACT');
}

module.exports = {
  BASE_WATCH,
  WATCH_SLOT_COST,
  VIDEO_EXTRACT_FREE,
  VIDEO_EXTRACT_COST,
  getWatchBonus,
  getWatchLimitWithBonus,
  purchaseWatchSlot,
  ensureWatchSlot,
  getVideoExtractFreeLeft,
  reserveVideoExtract,
  refundVideoExtract,
  ensureVideoExtract
};
