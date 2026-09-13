const { getUiThemeClass } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const {
  readExtraRounds,
  syncExtraRoundsFromServer,
  writeExtraRounds
} = require('../../utils/aiChatQuota.js');
const membership = require('../../utils/ocMembership.js');
const virtualPay = require('../../utils/virtualPay.js');

Page({
  data: {
    uiThemeClass: '',
    extraRounds: 0,
    isVip: false,
    vipExpireText: '',
    shopProducts: [],
    buyingId: '',
    buyingAdFree: false,
    adFreeCost: 300,
    adFreeDays: 30
  },

  onLoad() {
    this._syncTheme();
    this._syncExtra();
    this._syncVip();
    this._loadShop();
  },

  onShow() {
    applyPageGradientBg();
    this._syncTheme();
    this._syncExtra();
    this._syncVip();
  },

  _syncTheme() {
    this.setData({ uiThemeClass: getUiThemeClass() });
  },

  _syncExtra(opts) {
    this.setData({ extraRounds: readExtraRounds() });
    const skipFlush = !!(opts && opts.skipFlush);
    syncExtraRoundsFromServer(skipFlush ? { skipFlush: true } : undefined).then((n) => {
      this.setData({ extraRounds: n });
      this._syncVip();
    });
  },

  _syncVip() {
    const mem = membership.getMembership();
    this.setData({
      isVip: !!mem.isVip,
      vipExpireText: mem.isVip ? mem.vipExpireText || '永久' : ''
    });
    membership.syncMembership().then((m) => {
      this.setData({
        isVip: !!m.isVip,
        vipExpireText: m.isVip ? m.vipExpireText || '永久' : ''
      });
    });
  },

  _loadShop() {
    virtualPay
      .listProducts()
      .then((r) => {
        this.setData({
          shopProducts: (r && r.products) || [],
          adFreeCost: Number(r && r.adFreeCost) || 300,
          adFreeDays: Number(r && r.adFreeDays) || 30
        });
      })
      .catch(() => {
        this.setData({ shopProducts: [] });
      });
  },

  onBuyProduct(e) {
    if (this.data.buyingId) return;
    const productId = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || '该商品';
    if (!productId) return;
    wx.showModal({
      title: '确认购买',
      content: '购买「' + title + '」？支付成功后自动到账。',
      confirmText: '去支付',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ buyingId: productId });
        wx.showLoading({ title: '下单中…', mask: true });
        virtualPay
          .buyProduct(productId)
          .then((r) => {
            wx.hideLoading();
            this.setData({ buyingId: '' });
            const delivered = r && r.status === 'delivered';
            if (r && r.extraRounds != null) {
              writeExtraRounds(Number(r.extraRounds) || 0);
              this.setData({ extraRounds: Number(r.extraRounds) || 0 });
            }
            this._syncExtra({ skipFlush: true });
            this._syncVip();
            if (delivered) {
              wx.showToast({ title: '充值成功，额度已到账', icon: 'none', duration: 2600 });
              // 延迟再拉一次，支付窗口内禁止 flush 盖额度
              setTimeout(() => this._syncExtra({ skipFlush: true }), 2000);
              setTimeout(() => this._syncExtra({ skipFlush: true }), 6000);
              setTimeout(() => this._syncExtra({ skipFlush: true }), 12000);
              return;
            }
            wx.showModal({
              title: '支付已提交',
              content: '正在确认到账，请稍候；本页额度会自动刷新。',
              showCancel: false
            });
            // 支付成功但发货延迟：持续同步一段时间
            let n = 0;
            const timer = setInterval(() => {
              n += 1;
              this._syncExtra({ skipFlush: true });
              if (n >= 20) clearInterval(timer);
            }, 2000);
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ buyingId: '' });
            const msg = String((err && (err.errMsg || err.message)) || err || '支付失败');
            if (/cancel|取消|-2/.test(msg)) {
              wx.showToast({ title: '已取消支付', icon: 'none' });
              return;
            }
            wx.showToast({ title: msg.slice(0, 36), icon: 'none', duration: 3000 });
          });
      }
    });
  },

  onBuyAdFree() {
    if (this.data.buyingAdFree) return;
    if (this.data.isVip) {
      wx.showToast({ title: '免广告卡已生效', icon: 'none' });
      return;
    }
    const cost = this.data.adFreeCost;
    const days = this.data.adFreeDays;
    wx.showModal({
      title: '开通免广告卡',
      content: '消耗 ' + cost + ' 代币，获得 ' + days + ' 天免广告。',
      confirmText: '开通',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ buyingAdFree: true });
        wx.showLoading({ title: '开通中…', mask: true });
        virtualPay
          .buyAdFree()
          .then((r) => {
            wx.hideLoading();
            this.setData({ buyingAdFree: false });
            if (r && r.extraRounds != null) {
              writeExtraRounds(Number(r.extraRounds) || 0);
            }
            this._syncExtra();
            this._syncVip();
            wx.showToast({ title: '免广告卡已开通', icon: 'none', duration: 2600 });
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ buyingAdFree: false });
            wx.showToast({
              title: String((err && (err.errMsg || err.message)) || '开通失败').slice(0, 36),
              icon: 'none'
            });
          });
      }
    });
  }
});
