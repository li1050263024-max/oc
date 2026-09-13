const socialWatch = require('../../../utils/ocSocialWatch.js');
const membership = require('../../../utils/ocMembership.js');
const { applyPageGradientBg } = require('../../../utils/tabPage.js');
const { getUiThemeClass } = require('../../../utils/uiTheme.js');
const nav = require('../../../utils/nav.js');

const APP_TITLE = {
  moments: '朋友圈',
  douyin: '抖音'
};

Page({
  data: {
    uiThemeClass: '',
    menuTop: 48,
    menuHeight: 32,
    appKey: '',
    appTitle: '',
    list: [],
    selectedCount: 0,
    isMember: false,
    freeLimit: socialWatch.FREE_WATCH_LIMIT,
    requirePortrait: false,
    limitSheetOpen: false,
    oaVisible: false
  },

  onLoad(query) {
    const appKey = String((query && query.app) || '').trim();
    if (!socialWatch.APP_KEYS[appKey]) {
      wx.showToast({ title: '未知 APP', icon: 'none' });
      setTimeout(() => this.onBack(), 400);
      return;
    }
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
    this.setData({
      appKey: appKey,
      appTitle: APP_TITLE[appKey] || appKey,
      requirePortrait: appKey === 'douyin'
    });
    this._selected = {};
    socialWatch.readWatchIds(appKey).forEach((id) => {
      this._selected[id] = true;
    });
  },

  onShow() {
    applyPageGradientBg();
    this.setData({ uiThemeClass: getUiThemeClass() });
    membership.syncMembership().finally(() => {
      this._reloadList();
    });
  },

  _isSelectable(oc) {
    if (!oc || !oc.hasBio) return false;
    if (this.data.requirePortrait && !oc.hasPortrait) return false;
    return true;
  },

  _disabledReason(oc) {
    if (!oc || !oc.hasBio) return '未写小传 · 不可选';
    if (this.data.requirePortrait && !oc.hasPortrait) return '未上传立绘 · 不可选';
    return '';
  },

  _okHint(oc) {
    if (this.data.appKey === 'douyin') {
      const n = Number(oc && oc.albumImageCount) || 0;
      return n > 0 ? '已有小传 · 图册 ' + n + ' 张' : '已有小传与立绘';
    }
    return '已有小传';
  },

  _reloadList() {
    const appKey = this.data.appKey;
    const mem = membership.getMembership();
    const ocs = socialWatch.listSelectableOcs(appKey);
    // 清理：已选但不满足条件的，自动去掉
    const allowIds = {};
    const seenRow = {};
    ocs.forEach((oc) => {
      if (!oc || !oc.id || seenRow[oc.id]) return;
      seenRow[oc.id] = true;
      if (this._isSelectable(oc)) allowIds[oc.id] = true;
    });
    Object.keys(this._selected).forEach((id) => {
      if (!allowIds[id]) delete this._selected[id];
    });

    const list = [];
    const listed = {};
    ocs.forEach((oc) => {
      if (!oc || !oc.id || listed[oc.id]) return;
      listed[oc.id] = true;
      const ok = this._isSelectable(oc);
      list.push({
        id: oc.id,
        name: oc.name || '未命名',
        letter: String(oc.name || 'O').slice(0, 1),
        avatarUrl: oc.avatarUrl || '',
        hasBio: !!oc.hasBio,
        hasPortrait: !!oc.hasPortrait,
        disabled: !ok,
        disabledReason: this._disabledReason(oc),
        okHint: this._okHint(oc),
        selected: !!(ok && this._selected[oc.id])
      });
    });
    const selectedCount = list.filter((x) => x.selected).length;
    this._limit = socialWatch.getWatchLimit(mem.isMember);
    this.setData({
      list: list,
      selectedCount: selectedCount,
      isMember: mem.isMember,
      freeLimit: socialWatch.FREE_WATCH_LIMIT,
      requirePortrait: appKey === 'douyin'
    });
  },

  _openLimitSheet() {
    this.setData({ limitSheetOpen: true, oaVisible: false });
  },

  onCloseLimitSheet() {
    this.setData({ limitSheetOpen: false });
  },

  onLimitNop() {},

  onOpenOa() {
    this.setData({ oaVisible: true });
  },

  onCloseOa() {
    this.setData({ oaVisible: false });
  },

  onToggle(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id;
    if (!id) return;
    if (ds.disabled) {
      const reason = String(ds.reason || '');
      wx.showToast({
        title: /立绘/.test(reason)
          ? '请先在设定本上传立绘'
          : '请先填写人物小传',
        icon: 'none'
      });
      return;
    }
    if (this._selected[id]) {
      delete this._selected[id];
    } else {
      const count = Object.keys(this._selected).length;
      const limit = this._limit;
      if (limit > 0 && count >= limit) {
        this._openLimitSheet();
        return;
      }
      this._selected[id] = true;
    }
    const list = (this.data.list || []).map((item) =>
      Object.assign({}, item, {
        selected: !!(!item.disabled && this._selected[item.id])
      })
    );
    this.setData({
      list: list,
      selectedCount: list.filter((x) => x.selected).length
    });
  },

  onSelectAllVisible() {
    const limit = this._limit;
    const list = this.data.list || [];
    const usable = list.filter((item) => item && !item.disabled);
    if (!usable.length) {
      wx.showToast({
        title: this.data.requirePortrait
          ? '暂无同时具备小传与立绘的 OC'
          : '暂无已写小传的 OC',
        icon: 'none'
      });
      return;
    }
    this._selected = {};
    let hitLimit = false;
    usable.forEach((item, idx) => {
      if (limit > 0 && idx >= limit) {
        hitLimit = true;
        return;
      }
      this._selected[item.id] = true;
    });
    const next = list.map((item) =>
      Object.assign({}, item, {
        selected: !!(!item.disabled && this._selected[item.id])
      })
    );
    this.setData({
      list: next,
      selectedCount: next.filter((x) => x.selected).length
    });
    if (hitLimit) this._openLimitSheet();
  },

  onGoShop() {
    this.setData({ limitSheetOpen: false, oaVisible: false });
    wx.navigateTo({
      url: '/pages/redeemCode/redeemCode',
      fail: () => wx.showToast({ title: '打开额度商店失败', icon: 'none' })
    });
  },

  onPurchaseSlot() {
    const ent = require('../../../utils/ocEntitlements.js');
    const r = ent.purchaseWatchSlot(this.data.appKey);
    if (!r.ok) {
      if ((r.errMsg || '').indexOf('需要') >= 0) {
        wx.showModal({
          title: '额度不足',
          content: r.errMsg + '，是否前往额度商店？',
          confirmText: '去购买',
          success: (res) => {
            if (res.confirm) this.onGoShop();
          }
        });
        return;
      }
      wx.showToast({ title: r.errMsg || '扩容失败', icon: 'none' });
      return;
    }
    this._limit = socialWatch.getWatchLimitForApp(this.data.appKey, this.data.isMember);
    this.setData({
      limitSheetOpen: false,
      limitText: '最多 ' + r.limit + ' 人（含永久扩容 +' + r.bonus + '）'
    });
    wx.showToast({ title: '已永久 +1 人', icon: 'none' });
    this._reloadList();
  },

  onGoRedeem() {
    this.onGoShop();
  },

  onSave() {
    const ids = Object.keys(this._selected);
    const res = socialWatch.setWatchIds(this.data.appKey, ids, {
      isMember: this.data.isMember
    });
    if (!res.ok) {
      wx.showToast({ title: res.errMsg || '保存失败', icon: 'none' });
      return;
    }
    if (res.truncated) {
      this._openLimitSheet();
      wx.showToast({ title: '已按上限保存', icon: 'none' });
      return;
    }
    wx.showToast({ title: '已保存', icon: 'none' });
    setTimeout(() => this.onBack(), 400);
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) {
      wx.navigateBack({ fail: () => nav.switchMainTab('ocapp') });
      return;
    }
    nav.switchMainTab('ocapp');
  }
});
