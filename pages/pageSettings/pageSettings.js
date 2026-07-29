const {
  getUiTheme,
  getUiThemeClass,
  setUiTheme,
  THEME_PURPLE,
  THEME_MONO,
  THEME_PINK
} = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

const THEME_TOAST = {
  [THEME_PURPLE]: '已切换弥散紫主题',
  [THEME_MONO]: '已切换黑白灰主题',
  [THEME_PINK]: '已切换弥散粉主题'
};

Page({
  data: {
    uiTheme: THEME_PURPLE,
    uiThemeClass: ''
  },

  onLoad() {
    this._syncTheme();
  },

  onShow() {
    applyPageGradientBg();
    this._syncTheme();
  },

  _syncTheme() {
    const uiTheme = getUiTheme();
    this.setData({
      uiTheme,
      uiThemeClass: getUiThemeClass(uiTheme)
    });
  },

  onPickTheme(e) {
    const theme = e.currentTarget.dataset.theme;
    if (theme !== THEME_PURPLE && theme !== THEME_MONO && theme !== THEME_PINK) return;
    if (theme === this.data.uiTheme) return;
    setUiTheme(theme);
    this._syncTheme();
    wx.showToast({
      title: THEME_TOAST[theme] || '已切换主题',
      icon: 'none'
    });
  }
});
