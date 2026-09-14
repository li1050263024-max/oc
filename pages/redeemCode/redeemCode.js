const { getUiThemeClass } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const {
  readExtraRounds,
  syncExtraRoundsFromServer,
  writeExtraRounds
} = require('../../utils/aiChatQuota.js');
const membership = require('../../utils/ocMembership.js');
const virtualPay = require('../../utils/virtualPay.js');

function errText(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;
  return String(err.errMsg || err.message || err.err_msg || JSON.stringify(err)).slice(0, 200);
}

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
            const ver = (r && r.apiVer) || '';
            if (r && r.doubleFixed) {
              wx.showModal({
                title: '已纠正重复到账',
                content:
                  '检测到同一笔充值被加了两次，已从 ' +
                  (r.doubleFixedFrom || 2000) +
                  ' 点改回 ' +
                  n +
                  ' 点。',
                showCancel: false
              });
              return;
            }
            if (n > 0) {
              wx.showToast({
                title: gained ? '已补发到账：' + n + ' 点' : '当前额度 ' + n + ' 点',
                icon: 'none',
                duration: 2800
              });
            } else {
              wx.showModal({
                title: '仍未到账',
                content:
                  '扫描订单 ' +
                  (r && r.scanned != null ? r.scanned : '?') +
                  ' 条，补发 ' +
                  gained +
                  ' 笔。\n版本：' +
                  (ver || '未知') +
                  '\n请再点「分步检测问题」把结果发我。',
                showCancel: false
              });
            }
          })
          .catch((err) => {
            this.setData({ reconciling: false });
            try {
              wx.hideLoading();
            } catch (_) {}
            wx.showModal({
              title: '刷新报错',
              content: errText(err),
              confirmText: '去检测',
              success: (r2) => {
                if (r2.confirm) this.onDiagnosePay();
              }
            });
          });
      }
    });
  },

  onDiagnosePay() {
    wx.showLoading({ title: '检测中…', mask: true });
    virtualPay
      .diagnosePay()
      .then((r) => {
        try {
          wx.hideLoading();
        } catch (_) {}
        if (!r || /未知 action/.test(String((r && r.errMsg) || ''))) {
          wx.showModal({
            title: '云函数不是最新版',
            content:
              '未找到 diagnosePay。请重新上传部署 virtualPay（需显示 virtualPay-quota-fix-v3）。',
            showCancel: false
          });
          return;
        }
        const lines = (r.steps || []).map(
          (s) => (s.ok ? '✓' : '✗') + ' ' + s.step + '.' + s.name + '：' + s.detail
        );
        const text =
          '版本：' +
          (r.apiVer || '?') +
          '\nopenid：' +
          (r.openidMask || '?') +
          '\n额度：' +
          r.extraRounds +
          '\n订单：' +
          r.orderCount +
          '\nVPAY日志：' +
          r.vpayLogs +
          '\n\n' +
          lines.join('\n') +
          '\n\n结论：' +
          (r.hint || '');
        wx.showModal({
          title: '检测结果',
          content: text.slice(0, 500),
          confirmText: '复制全文',
          cancelText: '关闭',
          success: (res) => {
            if (!res.confirm) return;
            wx.setClipboardData({
              data: text,
              success: () => wx.showToast({ title: '已复制', icon: 'none' })
            });
          }
        });
      })
      .catch((err) => {
        try {
          wx.hideLoading();
        } catch (_) {}
        wx.showModal({
          title: '检测失败',
          content:
            errText(err) +
            '\n\n若提示未知 action，说明云函数未部署到含 diagnosePay 的版本。',
          showCancel: false
        });
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
            const msg = errText(err);
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
              title: errText(err).slice(0, 36),
              icon: 'none'
            });
          });
      }
    });
  }
});
