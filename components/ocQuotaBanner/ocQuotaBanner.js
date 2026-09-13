const banner = require('../../utils/ocQuotaBanner.js');

Component({
  properties: {
    pageKey: { type: String, value: '' },
    dark: { type: Boolean, value: false }
  },

  data: {
    visible: false,
    collapsed: false,
    summaryText: '',
    detailText: '',
    adBusy: false,
    isVip: false
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  observers: {
    pageKey() {
      this.refresh();
    }
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const doRefresh = () => {
        const st = banner.buildBannerState(this.data.pageKey);
        let isVip = false;
        try {
          isVip = require('../../utils/ocMembership.js').isMember();
        } catch (_) {}
        this.setData({
          visible: st.visible,
          collapsed: st.collapsed,
          summaryText: st.summaryText,
          detailText: st.detailText,
          isVip: isVip
        });
      };
      doRefresh();
      // 支付后回页：强制拉云端，避免本地旧额度
      try {
        const quota = require('../../utils/aiChatQuota.js');
        if (typeof quota.syncExtraRoundsFromServer === 'function') {
          quota.syncExtraRoundsFromServer().then(() => doRefresh()).catch(() => {});
        }
      } catch (_) {}
    },

    onToggle() {
      if (!this.data.visible) return;
      const next = !this.data.collapsed;
      banner.setCollapsed(this.data.pageKey, next);
      this.setData({ collapsed: next });
    },

    onClose(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      banner.dismiss(this.data.pageKey);
      this.setData({ visible: false });
      this.triggerEvent('dismiss');
      wx.showToast({ title: '已关闭，可在 OC APP 设置里重新打开', icon: 'none' });
    },

    onWatchAd() {
      if (this.data.adBusy) return;
      this.setData({ adBusy: true });
      const quota = require('../../utils/aiChatQuota.js');
      quota
        .claimAdCredits()
        .then((r) => {
          try {
            wx.hideLoading();
          } catch (_) {}
          this.setData({ adBusy: false });
          this.refresh();
          if (r && r.ok) {
            wx.showToast({ title: '已领取 +' + (r.added || 30) + ' 点', icon: 'none' });
            this.triggerEvent('credited', { added: r.added || 30 });
            return;
          }
          const msg = (r && r.errMsg) || '';
          if (!msg || msg === '已取消' || msg === '未领取') return;
          wx.showToast({
            title: String(msg).slice(0, 28),
            icon: 'none'
          });
        })
        .catch((err) => {
          try {
            wx.hideLoading();
          } catch (_) {}
          this.setData({ adBusy: false });
          wx.showToast({
            title: (err && err.message) || '广告加载失败',
            icon: 'none'
          });
        });
    },

    onRedeem() {
      wx.navigateTo({
        url: '/pages/redeemCode/redeemCode',
        fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
      });
    }
  }
});
