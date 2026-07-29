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
    windowHeight: 600,
    commentOpen: false,
    commentClipId: '',
    commentList: [],
    commentText: ''
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

  onShareAppMessage() {
    const feed = this.data.feed || [];
    const cur = feed[this.data.current] || feed[0] || {};
    const name = cur.ocName || 'OC';
    const caption = String(cur.content || '').slice(0, 36);
    return {
      title: caption ? name + '：' + caption : '来看 ' + name + ' 的 OC 抖音',
      path: '/pages/ocDouyin/ocDouyin'
    };
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

  onToggleFavorite(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const on = douyinStore.toggleFavorite(id);
    this.refreshFeed();
    wx.showToast({
      title: on ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1200
    });
  },

  onOpenComment(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({
      commentOpen: true,
      commentClipId: id,
      commentList: douyinStore.getComments(id),
      commentText: ''
    });
  },

  onCloseComment() {
    this.setData({
      commentOpen: false,
      commentClipId: '',
      commentList: [],
      commentText: ''
    });
  },

  onCommentInput(e) {
    this.setData({ commentText: (e && e.detail && e.detail.value) || '' });
  },

  onSubmitComment() {
    const id = this.data.commentClipId;
    const text = String(this.data.commentText || '').trim();
    if (!id) return;
    if (!text) {
      wx.showToast({ title: '写点内容再发', icon: 'none' });
      return;
    }
    douyinStore.addComment(id, text);
    this.setData({
      commentText: '',
      commentList: douyinStore.getComments(id)
    });
    this.refreshFeed();
  },

  onShareTap(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const clip =
      (this.data.feed || []).find((x) => x && x.id === id) ||
      (this.data.feed || [])[this.data.current] ||
      null;
    if (!clip) return;
    const shareText =
      '@' +
      (clip.ocName || 'OC') +
      '\n' +
      String(clip.content || '') +
      (clip.tagText ? '\n' + clip.tagText : '');
    wx.showActionSheet({
      itemList: ['复制文案', '分享给朋友（右上角···）'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.setClipboardData({
            data: shareText,
            success: () => wx.showToast({ title: '已复制', icon: 'success' })
          });
        } else if (res.tapIndex === 1) {
          wx.showToast({
            title: '请点右上角 ··· 转发给朋友',
            icon: 'none',
            duration: 2500
          });
        }
      }
    });
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
