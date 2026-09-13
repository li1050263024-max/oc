/**
 * OC APP 内额度提醒条：可收起 / 叉掉；叉掉后从 OCAPP 管理重新打开
 */
const DISMISS_PREFIX = 'oc_quota_banner_dismiss_v1_';
const COLLAPSE_PREFIX = 'oc_quota_banner_collapse_v1_';
const PAGE_KEYS = ['moments', 'douyin'];

function normalizePageKey(pageKey) {
  const k = String(pageKey || '').trim();
  return PAGE_KEYS.indexOf(k) >= 0 ? k : '';
}

function isDismissed(pageKey) {
  const key = normalizePageKey(pageKey);
  if (!key) return true;
  try {
    return !!wx.getStorageSync(DISMISS_PREFIX + key);
  } catch (_) {
    return false;
  }
}

function dismiss(pageKey) {
  const key = normalizePageKey(pageKey);
  if (!key) return;
  try {
    wx.setStorageSync(DISMISS_PREFIX + key, Date.now());
  } catch (_) {}
}

function resetDismiss(pageKey) {
  const key = normalizePageKey(pageKey);
  if (!key) return;
  try {
    wx.removeStorageSync(DISMISS_PREFIX + key);
  } catch (_) {}
}

function resetAllDismiss() {
  PAGE_KEYS.forEach(resetDismiss);
}

function isCollapsed(pageKey) {
  const key = normalizePageKey(pageKey);
  if (!key) return false;
  try {
    return !!wx.getStorageSync(COLLAPSE_PREFIX + key);
  } catch (_) {
    return false;
  }
}

function setCollapsed(pageKey, collapsed) {
  const key = normalizePageKey(pageKey);
  if (!key) return;
  try {
    if (collapsed) wx.setStorageSync(COLLAPSE_PREFIX + key, 1);
    else wx.removeStorageSync(COLLAPSE_PREFIX + key);
  } catch (_) {}
}

function buildBannerState(pageKey) {
  const key = normalizePageKey(pageKey);
  let weeklyLeft = 0;
  let extra = 0;
  let totalLeft = 0;
  try {
    const quota = require('./aiChatQuota.js');
    const hint = quota.buildQuotaHint(quota.QUOTA_CHANNEL_DM);
    weeklyLeft = Math.max(0, Number(hint.remaining) || 0);
    extra = Math.max(0, Number(hint.extraRounds) || 0);
    totalLeft = Math.max(0, Number(hint.left) || weeklyLeft + extra);
  } catch (_) {}
  const dismissed = isDismissed(key);
  const collapsed = isCollapsed(key);
  return {
    pageKey: key,
    visible: !!key && !dismissed,
    collapsed: collapsed,
    weeklyLeft: weeklyLeft,
    extraRounds: extra,
    totalLeft: totalLeft,
    summaryText: '本周免费 ' + weeklyLeft + ' · 通用 ' + extra + ' 点',
    detailText: '还可使用约 ' + totalLeft + '（周免费剩余 + 通用额度）'
  };
}

module.exports = {
  PAGE_KEYS,
  isDismissed,
  dismiss,
  resetDismiss,
  resetAllDismiss,
  isCollapsed,
  setCollapsed,
  buildBannerState
};
