const douyinStore = require('../../utils/ocDouyinStore.js');
const douyinGen = require('../../utils/ocDouyinGen.js');
const { hasAnyOcForSocial, getOcsWithBio } = require('../../utils/ocSocialEligible.js');
const chatAvatar = require('../../utils/chatAvatar.js');
const nav = require('../../utils/nav.js');

Page({
  data: {
    feed: [],
    current: 0,
    loading: true,
    generating: false,
    emptyHint: '暂无内容',
    windowHeight: 600
  },

  onLoad() {
    this._alive = true;
    try {
      const sys = wx.getSystemInfoSync();
      this.setData({ windowHeight: sys.windowHeight || 600 });
    } catch (_) {}
  },

  onUnload() {
    this._alive = false;
  },

  onShow() {
    if (!hasAnyOcForSocial()) {
      this.setData({
        feed: [],
        loading: false,
        emptyHint: '请先在设定本中保存带小传的 OC'
      });
      return;
    }
    this.refreshFeed();
    this._ensureGenerate();
  },

  async _ensureGenerate() {
    if (this._genLock) return;
    this._genLock = true;
    this.setData({ generating: true });
    try {
      if (!douyinGen.hasAnyOcWithImages()) {
        if (this._alive) {
          this.setData({
            emptyHint: '请先在设定本相册里上传 OC 图片',
            generating: false,
            loading: false
          });
        }
        return;
      }
      await douyinGen.ensureDouyinForPageOpen();
      if (this._alive) this.refreshFeed();
    } catch (e) {
      console.warn('[ocDouyin] generate', e);
    } finally {
      this._genLock = false;
      if (this._alive) this.setData({ generating: false, loading: false });
    }
  },

  refreshFeed() {
    const raw = douyinStore.prepareFeedForDisplay(douyinStore.getFeed());
    const feed = raw.map((item) =>
      Object.assign({}, item, {
        avatarDisplay: item.avatarUrl || '',
        avatarLetter: String(item.ocName || 'O').slice(0, 1)
      })
    );
    let emptyHint = '暂无内容';
    if (!feed.length) {
      if (!getOcsWithBio().length) emptyHint = '请先在设定本中保存带小传的 OC';
      else if (!douyinGen.hasAnyOcWithImages()) emptyHint = '请先在设定本相册里上传 OC 图片';
      else emptyHint = '正在生成中，下拉或稍后再进…';
    }
    this.setData({
      feed: feed,
      loading: false,
      emptyHint: emptyHint,
      current: Math.min(this.data.current || 0, Math.max(0, feed.length - 1))
    });
    this._resolveOcAvatars(feed);
  },

  async _resolveOcAvatars(feed) {
    const list = feed || [];
    for (let i = 0; i < list.length; i++) {
      if (!this._alive) return;
      const item = list[i];
      if (!item || !item.ocId || item.avatarDisplay) continue;
      try {
        const url = await chatAvatar.resolveOcAvatar(item.ocId, item.avatarUrl);
        if (url && this._alive) {
          this.setData({ ['feed[' + i + '].avatarDisplay']: url });
        }
      } catch (_) {}
    }
  },

  onSwiperChange(e) {
    const cur = (e && e.detail && e.detail.current) || 0;
    this.setData({ current: cur });
    // 滑到末尾附近再补生成
    const feed = this.data.feed || [];
    if (feed.length && cur >= feed.length - 2 && !this._genLock) {
      this._ensureGenerate();
    }
  },

  onToggleLike(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    douyinStore.toggleLike(id);
    this.refreshFeed();
  },

  onTapOc(e) {
    const ocId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.ocId;
    if (!ocId) return;
    wx.navigateTo({
      url: '/pages/ocProfileDetail/ocProfileDetail?id=' + encodeURIComponent(ocId),
      fail() {
        wx.showToast({ title: '无法打开档案', icon: 'none' });
      }
    });
  },

  onGoMoments() {
    nav.switchMainTab('moments');
  },

  onPreviewImage(e) {
    const src = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src;
    if (!src) return;
    const urls = (this.data.feed || []).map((x) => x.imagePath).filter(Boolean);
    wx.previewImage({
      current: src,
      urls: urls.length ? urls : [src]
    });
  },

  onRefreshTap() {
    if (this._genLock) return;
    this.setData({ generating: true });
    douyinGen
      .generateDouyinBatch({ force: true })
      .then(() => {
        if (this._alive) this.refreshFeed();
      })
      .finally(() => {
        if (this._alive) this.setData({ generating: false });
      });
  }
});
