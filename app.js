// OC 设定抽卡器 - 微信小程序
const { loadAiWaitScriptFont } = require('./utils/aiWaitQuote.js');
const { repairFavoritesOnLaunch } = require('./utils/favoriteStore.js');
const { runOcSocialOnAppOpen } = require('./utils/ocSocialOnOpen.js');
const { initUiTheme } = require('./utils/uiTheme.js');
const { initCloud } = require('./utils/cloudInit.js');

App({
  onLaunch() {
    initCloud();
    initUiTheme();
    loadAiWaitScriptFont();
    repairFavoritesOnLaunch();
    this.globalData.indexHomeReset = true;
    // 预下载主 Tab 分包，减少首次点击白屏/等待
    const preload = (name) => {
      if (typeof wx.preloadSubpackage === 'function') {
        try {
          wx.preloadSubpackage({ name, fail() {} });
        } catch (_) {}
      }
    };
    ['ocNotebook', 'ocBioHub', 'ocChat', 'ocMoments', 'ocStory', 'ocGroupChat'].forEach(
      (name, i) => {
        setTimeout(() => preload(name), 80 + i * 120);
      }
    );
    runOcSocialOnAppOpen(Date.now()).catch(() => {});
    setTimeout(() => {
      runOcSocialOnAppOpen(Date.now(), { force: true }).catch(() => {});
    }, 16000);
  },

  onShow() {
    if (this.globalData.skipNextRelaunch) {
      this.globalData.skipNextRelaunch = false;
      this._wentBackground = false;
      return;
    }
    const fromBackground = !!this._wentBackground;
    if (fromBackground) {
      this._wentBackground = false;
      // 原生图片预览 / 系统相册等短暂离开时，不把用户踢回首页
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const cur = pages && pages.length ? pages[pages.length - 1] : null;
      const route = (cur && (cur.route || (cur.__route__))) || '';
      if (
        route.indexOf('ocAlbumDetail') >= 0 ||
        route.indexOf('ocProfileDetail') >= 0 ||
        route.indexOf('ocNotebookEdit') >= 0
      ) {
        runOcSocialOnAppOpen(Date.now(), { fromShow: true }).catch(() => {});
        return;
      }
      this.globalData.indexHomeReset = true;
      wx.reLaunch({ url: '/pages/index/index' });
    }
    // 每次回到前台都尝试注入（内部 debounce；与 onLaunch 不重复依赖 _wentBackground）
    runOcSocialOnAppOpen(Date.now(), { fromShow: true }).catch(() => {});
  },

  onHide() {
    this._wentBackground = true;
    try {
      require('./utils/usageReport.js').flush();
    } catch (_) {}
  },

  onError(err) {
    try {
      const logger =
        typeof wx.getRealtimeLogManager === 'function' ? wx.getRealtimeLogManager() : null;
      if (logger && typeof logger.error === 'function') {
        logger.error('App.onError', err);
        if (String(err || '').indexOf('rewarded_ad') >= 0 && typeof logger.setFilterMsg === 'function') {
          logger.setFilterMsg('rewardedAd');
        }
      }
    } catch (_) {}
  },

  globalData: {
    /** 为 true 时首页 onShow 重置为「点击抽卡」初始界面（不删存档） */
    indexHomeReset: false,
    /** 相册选图返回时不 reLaunch 首页 */
    skipNextRelaunch: false,
    uiTheme: 'purple'
  }
});
