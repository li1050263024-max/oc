const { loadFavoriteToWork, getFavoriteById } = require('../../utils/favorite.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

Page({
  data: {
    ocName: '',
    bio: '',
    uiThemeClass: ''
  },

  onLoad(options) {
    applyPageGradientBg();
    this._favoriteId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    this._loadBio();
  },

  onShow() {
    syncPageTheme(this);
    applyPageGradientBg();
    this._loadBio();
  },

  _loadBio() {
    let work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (this._favoriteId) {
      const loaded = loadFavoriteToWork(this._favoriteId);
      if (loaded) work = loaded;
      else {
        const item = getFavoriteById(this._favoriteId);
        if (item) work = { result: item.result, generatedBio: item.generatedBio || '' };
      }
    }
    const bio = String(work.generatedBio || '').trim();
    if (!bio) {
      wx.showToast({ title: '暂无小传', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    this.setData({
      ocName: (work.result && work.result.name) || 'OC',
      bio
    });
  },

  onCopyBio() {
    const bio = this.data.bio;
    if (!bio) return;
    wx.setClipboardData({
      data: bio,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  }
});
