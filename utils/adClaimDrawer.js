/**
 * 广告播放结束后的领取抽屉。
 * 补点：再拉一条激励视频，须检测到点击进详情后才算完成。
 */

function getTopPage() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    return pages && pages.length ? pages[pages.length - 1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ clicked: boolean, rounds: number }} opts
 * @returns {Promise<{ claim: boolean }>}
 */
function promptAdClaimDrawer(opts) {
  const clicked = !!(opts && opts.clicked);
  const rounds = Math.max(1, Math.floor(Number(opts && opts.rounds) || 30));
  const page = getTopPage();

  if (!page || typeof page.setData !== 'function') {
    return Promise.resolve({ claim: false });
  }

  return new Promise((resolve) => {
    if (page._adClaimDrawerResolve) {
      try {
        page._adClaimDrawerResolve({ claim: false });
      } catch (_) {}
    }
    page._adClaimDrawerResolve = resolve;
    page.setData({
      adClaimSheetVisible: true,
      adClaimDetectedClick: clicked,
      adClaimMakeupDone: clicked,
      adClaimRounds: rounds,
      adClaimMakeupBusy: false
    });
  });
}

/** 补点：再播一条激励视频，必须点进详情 */
function onAdClaimMakeup(page) {
  if (!page || page.data.adClaimMakeupBusy || page.data.adClaimMakeupDone) return;
  let showRewardedVideoAd;
  let formatAdLoadErrMsg;
  try {
    const ad = require('./rewardedVideoAd.js');
    showRewardedVideoAd = ad.showRewardedVideoAd;
    formatAdLoadErrMsg = ad.formatAdLoadErrMsg;
  } catch (_) {
    wx.showToast({ title: '广告模块不可用', icon: 'none' });
    return;
  }

  page.setData({ adClaimMakeupBusy: true });
  try {
    wx.showLoading({ title: '加载激励广告…', mask: true });
  } catch (_) {}

  showRewardedVideoAd()
    .then((result) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      page.setData({ adClaimMakeupBusy: false });

      if (!result || result.loadFailed || result.errCode === 'unsupported') {
        const msg =
          (typeof formatAdLoadErrMsg === 'function' && formatAdLoadErrMsg(result)) ||
          '补点广告加载失败';
        wx.showToast({ title: String(msg).slice(0, 28), icon: 'none' });
        return;
      }
      if (!result.rewarded) {
        wx.showToast({
          title: result.earlyClose ? '需看完补点广告' : '补点未完成',
          icon: 'none'
        });
        return;
      }
      if (!result.clicked) {
        wx.showToast({
          title: '请点击广告进入详情后再返回',
          icon: 'none'
        });
        return;
      }
      page.setData({ adClaimMakeupDone: true });
      wx.showToast({ title: '补点成功，可领取', icon: 'none' });
    })
    .catch((err) => {
      try {
        wx.hideLoading();
      } catch (_) {}
      page.setData({ adClaimMakeupBusy: false });
      wx.showToast({
        title: (err && err.message) || '补点广告失败',
        icon: 'none'
      });
    });
}

function onAdClaimConfirm(page) {
  if (!page) return;
  const ok = !!(page.data.adClaimDetectedClick || page.data.adClaimMakeupDone);
  if (!ok) {
    wx.showToast({ title: '请先完成补点激励视频并点击', icon: 'none' });
    return;
  }
  page.setData({ adClaimSheetVisible: false, adClaimMakeupBusy: false });
  const resolve = page._adClaimDrawerResolve;
  page._adClaimDrawerResolve = null;
  if (typeof resolve === 'function') resolve({ claim: true });
}

function onAdClaimClose(page) {
  if (!page) return;
  page.setData({ adClaimSheetVisible: false, adClaimMakeupBusy: false });
  const resolve = page._adClaimDrawerResolve;
  page._adClaimDrawerResolve = null;
  if (typeof resolve === 'function') resolve({ claim: false });
}

module.exports = {
  promptAdClaimDrawer,
  onAdClaimMakeup,
  onAdClaimConfirm,
  onAdClaimClose
};
