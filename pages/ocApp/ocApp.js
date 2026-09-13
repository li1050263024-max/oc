const { hasAnyOcForSocial } = require('../../utils/ocSocialEligible.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { getUiThemeClass } = require('../../utils/uiTheme.js');
const pageSettings = require('../../utils/ocAppPageSettings.js');
const nav = require('../../utils/nav.js');

function openSocialPage(url) {
  if (!url) return;
  wx.showLoading({ title: '打开中…', mask: true });
  const done = () => {
    try {
      wx.hideLoading();
    } catch (_) {}
  };
  wx.redirectTo({
    url,
    success: done,
    fail(err) {
      console.error('[ocApp] redirectTo fail', url, err);
      wx.reLaunch({
        url,
        success: done,
        fail(err2) {
          done();
          console.error('[ocApp] reLaunch fail', url, err2);
          const msg =
            (err2 && err2.errMsg) || (err && err.errMsg) || '页面打开失败';
          wx.showToast({
            title: /not found|不存在/i.test(msg) ? '页面未注册，请重新编译' : '打开失败，请重试',
            icon: 'none',
            duration: 2800
          });
        }
      });
    }
  });
}

function buildCards() {
  return [
    {
      key: 'moments',
      title: '朋友圈',
      sub: '看看 OC 们在分享什么',
      tone: 'moments',
      enabled: true,
      hasSettings: true
    },
    {
      key: 'douyin',
      title: '抖音',
      sub: '竖滑出镜 · 相册成片',
      tone: 'douyin',
      enabled: true,
      hasSettings: true
    },
    {
      key: 'xhs',
      title: '小红书',
      sub: '即将开放',
      tone: 'xhs',
      enabled: false,
      hasSettings: false
    },
    {
      key: 'weibo',
      title: 'Weibo',
      sub: '即将开放',
      tone: 'weibo',
      enabled: false,
      hasSettings: false
    }
  ];
}

Page({
  data: {
    uiThemeClass: '',
    menuTop: 48,
    menuHeight: 32,
    cards: buildCards(),
    settingsVisible: false,
    settingsAppKey: '',
    settingsTitle: '设置',
    settingsDesc: '',
    settingsWatchSub: '',
    settingsReplyModes: [],
    settingsReplyMode: ''
  },

  onLoad() {
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      if (menu && menu.height) {
        this.setData({ menuTop: menu.top, menuHeight: menu.height });
      } else {
        this.setData({
          menuTop: (Number(sys.statusBarHeight) || 20) + 4,
          menuHeight: 32
        });
      }
    } catch (_) {}
  },

  onShow() {
    applyPageGradientBg();
    try {
      require('../../utils/ocMembership.js').syncMembership();
    } catch (_) {}
    this.setData({
      uiThemeClass: getUiThemeClass(),
      cards: buildCards()
    });
  },

  onGoHome() {
    nav.goHome();
  },

  onOpenSettings(e) {
    const key =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (key !== 'moments' && key !== 'douyin') return;
    pageSettings.openSettings(key, this);
  },

  onCloseSettings() {
    pageSettings.closeSettings(this);
  },

  onSettingsPickWatch() {
    const key = this.data.settingsAppKey || 'moments';
    pageSettings.closeSettings(this);
    pageSettings.openWatchOc(key);
  },

  onSettingsPickReply(e) {
    const mode =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || '';
    if (!mode) return;
    pageSettings.pickReplyMode(this, mode);
  },

  onCardTap(e) {
    const key =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    const card = (this.data.cards || []).find((c) => c.key === key);
    if (!card) return;
    if (!card.enabled) {
      wx.showToast({ title: '即将开放', icon: 'none' });
      return;
    }
    if (!hasAnyOcForSocial()) {
      wx.showToast({
        title: '请先在设定本中保存 OC',
        icon: 'none',
        duration: 2800
      });
      return;
    }
    if (key === 'moments') {
      openSocialPage(nav.ROUTES.moments);
      return;
    }
    if (key === 'douyin') {
      openSocialPage(nav.ROUTES.douyin);
    }
  }
});
