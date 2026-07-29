const { getUiThemeClass } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const {
  readExtraRounds,
  redeemCodeOnServer,
  syncExtraRoundsFromServer
} = require('../../utils/aiChatQuota.js');

Page({
  data: {
    uiThemeClass: '',
    redeemCode: '',
    extraRounds: 0,
    redeeming: false
  },

  onLoad() {
    this._syncTheme();
    this._syncExtra();
  },

  onShow() {
    applyPageGradientBg();
    this._syncTheme();
    this._syncExtra();
  },

  _syncTheme() {
    this.setData({ uiThemeClass: getUiThemeClass() });
  },

  _syncExtra() {
    this.setData({ extraRounds: readExtraRounds() });
    syncExtraRoundsFromServer().then((n) => {
      this.setData({ extraRounds: n });
    });
  },

  onRedeemInput(e) {
    this.setData({ redeemCode: (e.detail && e.detail.value) || '' });
  },

  onSubmitRedeem() {
    if (this.data.redeeming) return;
    const code = String(this.data.redeemCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }
    this.setData({ redeeming: true });
    redeemCodeOnServer(code)
      .then((data) => {
        this.setData({
          redeemCode: '',
          extraRounds:
            data.extraRounds != null ? data.extraRounds : readExtraRounds(),
          redeeming: false
        });
        wx.showToast({
          title: '已兑换 +' + (data.rounds || 0) + ' 轮',
          icon: 'success'
        });
      })
      .catch((err) => {
        this.setData({ redeeming: false });
        wx.showToast({
          title: (err && err.message) || '兑换失败',
          icon: 'none'
        });
      });
  }
});
