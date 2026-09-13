const {
  getStoriesFromItem,
  upsertStoryToFavorite,
  newStoryId,
  pickCollection,
  ensureCollectionsMigrated
} = require('../../utils/storyStore.js');
const {
  getFavoriteById,
  ensureCurrentWorkInFavorites
} = require('../../utils/favorite.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { getUiThemeClass } = require('../../utils/uiTheme.js');

function resolveFavId(raw) {
  let fid = String(raw || '').trim();
  if (!fid || fid === '__work__') {
    fid = ensureCurrentWorkInFavorites() || '';
  }
  return fid;
}

Page({
  data: {
    uiThemeClass: '',
    favId: '',
    ocName: '',
    pasteStoryTitle: '',
    pasteStoryContent: ''
  },

  onLoad(query) {
    applyPageGradientBg();
    const favId = resolveFavId(query && query.favId);
    const item = favId ? getFavoriteById(favId) : null;
    const ocName =
      (item && (item.name || (item.result && item.result.name))) ||
      String((query && query.ocName) || '').trim();
    if (!favId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail() {} }), 400);
      return;
    }
    this.setData({
      uiThemeClass: getUiThemeClass(),
      favId: favId,
      ocName: ocName || '当前 OC'
    });
  },

  onShow() {
    applyPageGradientBg();
    this.setData({ uiThemeClass: getUiThemeClass() });
  },

  onPasteStoryTitleInput(e) {
    this.setData({ pasteStoryTitle: (e.detail && e.detail.value) || '' });
  },

  onPasteStoryContentInput(e) {
    this.setData({ pasteStoryContent: (e.detail && e.detail.value) || '' });
  },

  onSavePastedStory() {
    const favId = this.data.favId;
    if (!favId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const title = (this.data.pasteStoryTitle || '').trim();
    const content = (this.data.pasteStoryContent || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写故事题目', icon: 'none' });
      return;
    }
    if (!content) {
      wx.showToast({ title: '请粘贴故事正文', icon: 'none' });
      return;
    }
    ensureCollectionsMigrated(favId);
    pickCollection(favId, { title: '放入哪个故事集' })
      .then((col) => {
        const id = newStoryId();
        const entry = {
          id: id,
          title: title,
          userPrompt: '',
          content: content,
          time: Date.now(),
          collectionId: col.id
        };
        const ok = upsertStoryToFavorite(favId, entry);
        if (!ok) {
          wx.showToast({ title: '保存失败', icon: 'none' });
          return;
        }
        try {
          const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
          if (ec && typeof ec.emit === 'function') {
            const item = getFavoriteById(favId);
            ec.emit('uploaded', {
              favId: favId,
              stories: getStoriesFromItem(item)
            });
          }
        } catch (_) {}
        wx.showToast({ title: '故事已保存', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ fail() {} });
        }, 400);
      })
      .catch((err) => {
        if (err && String(err.message || err) === 'cancel') return;
        wx.showToast({ title: '请选择故事集', icon: 'none' });
      });
  }
});
