/** 相册/文件选择/分享等会短暂切出小程序，需跳过 app.onShow 的首页 reLaunch */
function markSkipAppRelaunch() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.skipNextRelaunch = true;
    }
  } catch (e) {
    /* getApp 在极早期可能不可用 */
  }
}

module.exports = {
  markSkipAppRelaunch
};
