const clean = require('../../../utils/ocLocalStorageClean.js');

Page({
  data: {
    statusBar: 20,
    navHeight: 44,
    loading: true,
    kvText: '',
    categories: [],
    items: [],
    selectedCount: 0,
    orphanAudioText: '',
    orphanImageHint: ''
  },

  onLoad() {
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const statusBar = Number(sys.statusBarHeight) || 20;
      const navHeight =
        menu && menu.height ? menu.height + (menu.top - statusBar) * 2 : 44;
      this.setData({ statusBar: statusBar, navHeight: navHeight });
    } catch (_) {}
  },

  onShow() {
    this._reload();
  },

  _reload() {
    this.setData({ loading: true });
    clean
      .buildCleanupInventory()
      .then((inv) => {
        const items = (inv.items || []).map((it) =>
          Object.assign({}, it, { selected: false })
        );
        this.setData({
          loading: false,
          kvText: inv.kvText || '',
          categories: inv.categories || [],
          items: items,
          selectedCount: 0,
          orphanAudioText: inv.orphanAudioText || '',
          orphanImageHint: inv.orphanImageHint || ''
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '读取存储信息失败', icon: 'none' });
      });
  },

  onToggle(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const items = (this.data.items || []).map((it) => {
      if (it.id !== id) return it;
      return Object.assign({}, it, { selected: !it.selected });
    });
    this.setData({
      items: items,
      selectedCount: items.filter((x) => x.selected).length
    });
  },

  onAutoPurge() {
    wx.showLoading({ title: '清理中…', mask: true });
    clean
      .runAutoPurge()
      .then((r) => {
        try {
          wx.hideLoading();
        } catch (_) {}
        wx.showToast({
          title: r && r.deleted ? '已清理 ' + r.deleted + ' 项' : '没有可清理项',
          icon: 'none'
        });
        this._reload();
      })
      .catch(() => {
        try {
          wx.hideLoading();
        } catch (_) {}
        wx.showToast({ title: '清理失败', icon: 'none' });
      });
  },

  onDeleteSelected() {
    const ids = (this.data.items || []).filter((x) => x.selected).map((x) => x.id);
    if (!ids.length) {
      wx.showToast({ title: '请先勾选要删除的内容', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: '将删除所选 ' + ids.length + ' 个本地 BGM，且不可恢复。',
      confirmText: '删除',
      confirmColor: '#7c3aed',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        clean
          .deleteSelectedItems(ids)
          .then((r) => {
            try {
              wx.hideLoading();
            } catch (_) {}
            wx.showToast({
              title: '已删除 ' + (r.deleted || 0) + ' 项',
              icon: 'none'
            });
            this._reload();
          })
          .catch(() => {
            try {
              wx.hideLoading();
            } catch (_) {}
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      }
    });
  },

  onExit() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
