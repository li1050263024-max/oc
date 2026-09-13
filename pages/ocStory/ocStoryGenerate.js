const {
  buildStoryPromptParts,
  newStoryId,
  upsertStoryToFavorite,
  getStoriesFromItem,
  pickCollection,
  ensureCollectionsMigrated
} = require('../../utils/storyStore.js');
const {
  getFavoriteById,
  ensureCurrentWorkInFavorites
} = require('../../utils/favorite.js');
const credits = require('../../utils/ocCredits.js');
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
    hasBio: false,
    userInput: '',
    loading: false,
    story: '',
    storyId: '',
    storyTitle: ''
  },

  onLoad(query) {
    applyPageGradientBg();
    const favId = resolveFavId(query && query.favId);
    const item = favId ? getFavoriteById(favId) : null;
    const ocName =
      (item && (item.name || (item.result && item.result.name))) ||
      String((query && query.ocName) || '').trim();
    const hasBio = !!(query && (query.hasBio === '1' || query.hasBio === 'true'));
    let bioOk = hasBio;
    if (favId && !bioOk) {
      try {
        bioOk = !!buildStoryPromptParts(favId);
      } catch (_) {
        bioOk = false;
      }
    }
    if (!favId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail() {} }), 400);
      return;
    }
    this.setData({
      uiThemeClass: getUiThemeClass(),
      favId: favId,
      ocName: ocName || '当前 OC',
      hasBio: bioOk
    });
  },

  onShow() {
    applyPageGradientBg();
    this.setData({ uiThemeClass: getUiThemeClass() });
  },

  onUserInput(e) {
    this.setData({ userInput: (e.detail && e.detail.value) || '' });
  },

  onStoryTitleInput(e) {
    this.setData({ storyTitle: (e.detail && e.detail.value) || '' });
  },

  onStoryInput(e) {
    this.setData({ story: (e.detail && e.detail.value) || '' });
  },

  onDiscardStory() {
    if (!(this.data.story || '').trim()) {
      this.setData({ story: '', storyId: '', storyTitle: '' });
      return;
    }
    wx.showModal({
      title: '放弃当前故事？',
      content: '未保存的内容将丢失',
      confirmText: '放弃',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ story: '', storyId: '', storyTitle: '' });
      }
    });
  },

  onCopyStory() {
    const story = this.data.story;
    if (!story) return;
    wx.setClipboardData({
      data: story,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  onSaveStory() {
    const favId = this.data.favId;
    const story = (this.data.story || '').trim();
    const title = (this.data.storyTitle || '').trim();
    if (!favId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    if (!story) {
      wx.showToast({ title: '暂无故事可保存', icon: 'none' });
      return;
    }
    if (!title) {
      wx.showToast({ title: '请先填写故事题目', icon: 'none' });
      return;
    }
    ensureCollectionsMigrated(favId);
    pickCollection(favId, { title: '放入哪个故事集' })
      .then((col) => {
        const id = this.data.storyId || newStoryId();
        const entry = {
          id: id,
          title: title,
          userPrompt: this.data.userInput || '',
          content: story,
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
            ec.emit('saved', {
              favId: favId,
              stories: getStoriesFromItem(item)
            });
          }
        } catch (_) {}
        wx.showToast({ title: '已保存到故事集', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ fail() {} });
        }, 400);
      })
      .catch((err) => {
        if (err && String(err.message || err) === 'cancel') return;
        wx.showToast({ title: '请选择故事集', icon: 'none' });
      });
  },

  onGenerate() {
    if (!this.data.hasBio) {
      wx.showToast({ title: '请先在 OC 小传中生成小传', icon: 'none' });
      return;
    }
    if (this.data.loading) return;
    const userInput = (this.data.userInput || '').trim();
    if (!userInput) {
      wx.showToast({ title: '请输入故事方向', icon: 'none' });
      return;
    }
    const favId = this.data.favId;
    const parts = buildStoryPromptParts(favId);
    if (!parts) {
      wx.showToast({ title: '缺少 OC 小传', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });
      return;
    }

    const pay = credits.consumeStoryNew();
    if (!pay.ok) {
      wx.showModal({
        title: '额度不足',
        content:
          pay.errMsg ||
          '本周免费已用完，生成故事需要 ' + credits.COSTS.STORY_NEW + ' 点额度',
        confirmText: '去兑换',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: '/pages/redeemCode/redeemCode' });
        }
      });
      return;
    }

    this.setData({ loading: true });
    wx.cloud
      .callFunction({
        name: 'generateOcStory',
        data: {
          ocSetting: parts.ocSetting,
          ocBio: parts.ocBio,
          userInput: userInput
        },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (r.ok && r.story) {
          this.setData({
            story: r.story,
            storyId: newStoryId(),
            storyTitle: this.data.storyTitle || ''
          });
          wx.showToast({ title: '已生成，可编辑后保存', icon: 'none' });
        } else {
          credits.refundStoryNew(pay);
          wx.showToast({
            title: r.errMsg || '生成失败',
            icon: 'none',
            duration: 3000
          });
        }
      })
      .catch((err) => {
        credits.refundStoryNew(pay);
        const msg = (err && (err.errMsg || err.message)) || '';
        wx.showToast({
          title: /timeout|超时/i.test(msg) ? '请求超时，请稍后重试' : msg || '调用失败',
          icon: 'none',
          duration: 3000
        });
      })
      .finally(() => this.setData({ loading: false }));
  }
});
