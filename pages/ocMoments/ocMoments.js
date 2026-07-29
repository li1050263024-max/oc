const momentsStore = require('../../utils/ocMomentsStore.js');
const momentsGen = require('../../utils/ocMomentsGen.js');
const momentsCover = require('../../utils/ocMomentsCover.js');
const momentsComment = require('../../utils/ocMomentsComment.js');
const { hasAnyOcForSocial, getOcsWithBio } = require('../../utils/ocSocialEligible.js');
const chatAvatar = require('../../utils/chatAvatar.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    feed: [],
    loading: true,
    generating: false,
    showPageLoading: true,
    emptyHint: '暂无动态',
    coverUrl: '',
    userAvatarUrl: '',
    composeText: '',
    commentPostId: '',
    commentText: ''
  },

  onLoad() {
    applyPageGradientBg();
    this._alive = true;
  },

  onUnload() {
    this._alive = false;
  },

  onShow() {
    applyPageGradientBg();
    this._loadCover();
    this._loadUserAvatar();
    if (!hasAnyOcForSocial()) {
      this.setData({
        loading: false,
        showPageLoading: false,
        generating: false,
        feed: [],
        emptyHint: '请先在设定本中保存 OC'
      });
      return;
    }
    const bioOcs = getOcsWithBio();
    if (!bioOcs.length) {
      this.setData({
        loading: false,
        showPageLoading: false,
        generating: false,
        feed: [],
        emptyHint: '请先为 OC 填写人物小传后再查看朋友圈'
      });
      return;
    }
    this.setData({ loading: true, showPageLoading: true, generating: true });
    momentsGen
      .ensureMomentsForPageOpen(Date.now())
      .finally(() => {
        if (!this._alive) return;
        this.setData({ generating: false });
        this.refreshFeed();
      });
  },

  onPullDownRefresh() {
    if (!hasAnyOcForSocial()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ generating: true, showPageLoading: !this.data.feed.length });
    momentsGen
      .ensureMomentsForPageOpen(Date.now())
      .finally(() => this.refreshFeed(() => wx.stopPullDownRefresh()));
  },

  async _loadCover() {
    const url = await momentsCover.resolveMomentsCoverUrl();
    if (this._alive) this.setData({ coverUrl: url || '' });
  },

  async _loadUserAvatar() {
    const url = await chatAvatar.resolveUserAvatar();
    if (this._alive) this.setData({ userAvatarUrl: url || '' });
  },

  async onPublishMoment() {
    const text = String(this.data.composeText || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发布中', mask: true });
    try {
      const post = momentsStore.addUserMomentPost(text);
      this.setData({ composeText: '' });
      if (post) {
        this._pendingRevealPostId = post.id;
        this.refreshFeed();
        await momentsComment.autoCommentOnUserPost(post);
        await sleep(500);
        this._pendingRevealPostId = '';
      }
      if (this._alive) {
        this.refreshFeed();
        wx.hideLoading();
        wx.showToast({ title: '已发布', icon: 'success' });
      }
    } catch (e) {
      this._pendingRevealPostId = '';
      if (this._alive) this.refreshFeed();
      console.warn('[ocMoments] auto comment', e);
      wx.hideLoading();
      wx.showToast({ title: '发布失败', icon: 'none' });
    }
  },

  refreshFeed(done) {
    const raw = momentsStore.prepareFeedForDisplay(
      momentsStore.getMomentsFeed(),
      this.data.userAvatarUrl
    );
    const pendingId = this._pendingRevealPostId || '';
    const feed = pendingId
      ? raw.map((item) => {
          if (item.id !== pendingId) return item;
          return Object.assign({}, item, {
            comments: [],
            commentCount: 0,
            likeCount: 0,
            liked: false
          });
        })
      : raw;
    const showPageLoading = this.data.generating && !feed.length;
    this.setData(
      {
        feed: feed,
        loading: false,
        showPageLoading
      },
      () => {
        this._resolveOcAvatars(feed);
        if (typeof done === 'function') done();
      }
    );
  },

  async _resolveOcAvatars(feed) {
    const list = feed || this.data.feed || [];
    const patch = {};
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || item.isUserPost || !item.ocId) continue;
      const key = 'feed[' + i + '].avatarDisplay';
      if (item.avatarDisplay) continue;
      try {
        const url = await chatAvatar.resolveOcAvatar(item.ocId, item.avatarUrl);
        patch[key] = url || item.avatarUrl || '';
      } catch (e) {
        patch[key] = item.avatarUrl || '';
      }
    }
    if (this._alive && Object.keys(patch).length) {
      this.setData(patch);
    }
  },

  onChangeCover() {
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        wx.showLoading({ title: '保存中…', mask: true });
        try {
          const path = await momentsCover.saveMomentsCoverFromTemp(file.tempFilePath);
          if (this._alive) this.setData({ coverUrl: path || file.tempFilePath });
        } catch (e) {
          wx.showToast({ title: '保存失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  onComposeInput(e) {
    this.setData({ composeText: e.detail.value });
  },

  onToggleLike(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    momentsStore.togglePostLike(id);
    this.refreshFeed();
  },

  onOpenComment(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      commentPostId: id === this.data.commentPostId ? '' : id,
      commentText: ''
    });
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  async onSubmitComment(e) {
    const id = (e.currentTarget.dataset.id || this.data.commentPostId || '').trim();
    const text = String(this.data.commentText || '').trim();
    if (!id || !text) {
      wx.showToast({ title: '请输入评论', icon: 'none' });
      return;
    }
    momentsStore.addPostComment(id, text, '我');
    this.setData({ commentPostId: '', commentText: '' });
    this.refreshFeed();
    wx.showLoading({ title: '等待回复…', mask: false });
    try {
      await momentsComment.handleUserCommentReply(id, text);
      if (this._alive) this.refreshFeed();
    } catch (err) {
      console.warn('[ocMoments] reply', err);
    } finally {
      wx.hideLoading();
    }
  },

  onTapOc(e) {
    const ocId = e.currentTarget.dataset.ocId;
    if (!ocId) return;
    const { ensureOcIdBioForChat } = require('../../utils/ocChatGate.js');
    if (!ensureOcIdBioForChat(ocId)) return;
    wx.navigateTo({
      url: '/pages/ocChat/ocChat?ocId=' + encodeURIComponent(ocId),
      fail: () => wx.showToast({ title: '无法打开对话', icon: 'none' })
    });
  }
});
