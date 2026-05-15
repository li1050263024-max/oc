// OC 设定抽卡器 - 微信小程序
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true
      });
    }
  },
  globalData: {}
});
