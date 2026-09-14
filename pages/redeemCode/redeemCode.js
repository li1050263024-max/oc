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
    adFreeDays: 30,
    reconciling: false
  },

  onLoad() {
    this._syncTheme();
    this._syncExtra({ skipFlush: true });
    this._syncVip();
    this._loadShop();
    this._reconcileQuiet();
  },

  onShow() {
    applyPageGradientBg();
    this._syncTheme();
    this._syncExtra({ skipFlush: true });
    this._syncVip();
    this._reconcileQuiet();
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

  _reconcileQuiet() {
    if (this._reconciling) return;
    this._reconciling = true;
    virtualPay
      .reconcileMyOrders()
      .then((r) => {
        const n = Math.max(0, Number(r && r.extraRounds) || 0);
        if (n > 0) writeExtraRounds(n);
        this.setData({ extraRounds: Math.max(n, readExtraRounds()) });
        this._syncVip();
      })
      .catch(() => {})
      .then(() => {
        this._reconciling = false;
      });
  },

  onRefreshQuota() {
    if (this.data.reconciling) return;
    wx.showModal({
      title: '刷新到账',
      content: '请确认你已支付成功。系统将扫描近 14 天订单并补发额度。',
      confirmText: '我已付款',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ reconciling: true });
        wx.showLoading({ title: '核对订单…', mask: true });
        virtualPay
          .reconcileMyOrders({ forcePending: true })
          .then((r) => {
            const n = Math.max(0, Number(r && r.extraRounds) || 0);
            writeExtraRounds(n);
            this.setData({ extraRounds: n, reconciling: false });
            this._syncExtra({ skipFlush: true });
            this._syncVip();
            try {
              wx.hideLoading();
            } catch (_) {}
            const gained = Number(r && r.granted) || 0;
            if (n > 0) {
              wx.showToast({
                title: gained ? '已补发到账：' + n + ' 点' : '当前额度 ' + n + ' 点',
                icon: 'none',
                duration: 2800
              });
            } else {
              wx.showToast({
                title: '未找到可补发订单，请先部署最新 virtualPay 云函数',
                icon: 'none',
                duration: 3200
              });
            }
          })
          .catch((err) => {
            this.setData({ reconciling: false });
            try {
              wx.hideLoading();
            } catch (_) {}
            wx.showToast({
              title: String((err && err.message) || '刷新失败').slice(0, 36),
              icon: 'none'
            });
          });
      }
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
            if (delivered && Number(r.extraRounds) > 0) {
              wx.showToast({ title: '充值成功，额度已到账', icon: 'none', duration: 2600 });
              setTimeout(() => this._syncExtra({ skipFlush: true }), 2000);
              setTimeout(() => this._reconcileQuiet(), 4000);
              return;
            }
            wx.showModal({
              title: '支付已提交',
              content: '正在确认到账。若仍为 0，请点余额下方「刷新到账」。',
              showCancel: false
            });
            let n = 0;
            const timer = setInterval(() => {
              n += 1;
              this._reconcileQuiet();
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
