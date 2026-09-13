const momentsStore = require('../../../utils/ocMomentsStore.js');
const momentsGen = require('../../../utils/ocMomentsGen.js');
const momentsCover = require('../../../utils/ocMomentsCover.js');
const momentsComment = require('../../../utils/ocMomentsComment.js');
const momentsQuota = require('../../../utils/ocMomentsQuota.js');
const momentsNotify = require('../../../utils/ocMomentsNotify.js');
const {
  hasAnyOcForSocial,
  getOcsWithBio,
  getOcsForSocial
} = require('../../../utils/ocSocialEligible.js');
const chatAvatar = require('../../../utils/chatAvatar.js');
const { applyPageGradientBg } = require('../../../utils/tabPage.js');

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
    composeImages: [],
    composeOpen: false,
    composeMode: '',
    composeCanPublish: false,
    composeNavPadTop: 44,
    cameraMenuOpen: false,
    cameraBtnStyle: '',
    inviteOcIds: [],
    remindOpen: false,
    remindCandidates: [],
    remindMap: {},
    remindLabel: '',
    commentPostId: '',
    commentText: '',
    replyNotifyVisible: false,
    replyNotifyText: '',
    replyNotifyAvatar: '',
    replyNotifyLetter: 'O',
    msgListOpen: false,
    msgList: [],
    adSheetOpen: false,
    adUnlockBusy: false,
    adSheetText: '今日朋友圈 AI 生成已达上限，看激励广告可继续解锁'
  },

  onLoad() {
    applyPageGradientBg();
    this._alive = true;
    this._layoutChrome();
  },

  onUnload() {
    this._alive = false;
  },

  _layoutChrome(force) {
    // 只算 top；横向 right 写死在 wxss，避免 getMenuButton 异常把相机推到胶囊左侧
    if (this._chromeLaidOut && !force) return;
    try {
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const sys = wx.getSystemInfoSync();
      const status = Number(sys.statusBarHeight) || 20;
      if (menu && menu.height > 0 && menu.bottom > 0) {
        const top = Math.max(status + 36, menu.bottom + 8);
        this.setData({
          cameraBtnStyle: 'top:' + top + 'px;',
          composeNavPadTop: menu.bottom + 6
        });
        this._chromeLaidOut = true;
        return;
      }
      this.setData({
        cameraBtnStyle: 'top:calc(52px + env(safe-area-inset-top));',
        composeNavPadTop: status + 48
      });
      this._chromeLaidOut = true;
    } catch (_) {
      this.setData({
        cameraBtnStyle: 'top:calc(52px + env(safe-area-inset-top));',
        composeNavPadTop: 88
      });
      this._chromeLaidOut = true;
    }
  },

  _refreshComposeCanPublish() {
    const mode = this.data.composeMode;
    const text = String(this.data.composeText || '').trim();
    const imgs = this.data.composeImages || [];
    const ok = mode === 'text' ? !!text : imgs.length > 0;
    this.setData({ composeCanPublish: ok });
  },

  async _syncReplyNotifyBanner() {
    const info = momentsNotify.getUnreadInfo();
    if (!info.visible || !info.latest) {
      if (this._alive) {
        this.setData({ replyNotifyVisible: false, replyNotifyText: '' });
      }
      return;
    }
    let replyNotifyAvatar = '';
    try {
      replyNotifyAvatar =
        (await chatAvatar.resolveOcAvatar(
          info.latest.ocId,
          info.latest.avatarUrl || ''
        )) || '';
    } catch (_) {}
    if (!this._alive) return;
    this.setData({
      replyNotifyVisible: true,
      replyNotifyText: info.text,
      replyNotifyAvatar: replyNotifyAvatar,
      replyNotifyLetter: String(info.latest.ocName || 'O').slice(0, 1) || 'O'
    });
  },

  async _showReplyNotify(payload) {
    if (!payload || payload.skipped || !payload.text) return;
    momentsNotify.addReplyNotify(payload);
    await this._syncReplyNotifyBanner();
  },

  onShow() {
    applyPageGradientBg();
    // 不重复重算相机位置，防止点多次后漂移到胶囊左侧
    this._loadCover();
    this._loadUserAvatar();
    this._syncReplyNotifyBanner();
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
    this._runMomentsGenerate();
  },

  onPullDownRefresh() {
    if (!hasAnyOcForSocial()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ generating: true, showPageLoading: !this.data.feed.length });
    this._runMomentsGenerate(() => wx.stopPullDownRefresh());
  },

  _runMomentsGenerate(done) {
    momentsGen
      .ensureMomentsForPageOpen(Date.now())
      .then((res) => {
        if (!this._alive) return;
        if (res && res.reason === 'no_oc') {
          this.setData({
            emptyHint: '请先在「选择OC」中勾选有小传的角色，或为 OC 填写小传'
          });
        } else if (res && res.needAd) {
          this.setData({
            adSheetOpen: true,
            adSheetText:
              (res.errMsg || '今日朋友圈 AI 已达上限') +
              '（看完广告可再解锁 ' +
              momentsQuota.AD_BONUS_CALLS +
              ' 次）'
          });
          if (!(this.data.feed || []).length && !momentsStore.getMomentsFeed().length) {
            this.setData({ emptyHint: '今日免费次数已用完，看广告后可继续生成' });
          }
        } else if (res && res.ok === false && res.errMsg) {
          if (!momentsStore.getMomentsFeed().length) {
            this.setData({ emptyHint: res.errMsg || '生成失败，请下拉重试' });
          }
        }
      })
      .finally(() => {
        if (!this._alive) return;
        this.setData({ generating: false });
        this.refreshFeed(() => {
          if (typeof done === 'function') done();
        });
      });
  },

  onCloseAdSheet() {
    this.setData({ adSheetOpen: false });
  },

  onWatchAdUnlock() {
    if (this.data.adUnlockBusy) return;
    this.setData({ adUnlockBusy: true });
    momentsQuota
      .unlockMoreByRewardedAd()
      .then((r) => {
        if (!this._alive) return;
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.errMsg) || '解锁失败', icon: 'none' });
          return;
        }
        this.setData({ adSheetOpen: false });
        wx.showToast({
          title: '已解锁 ' + (r.unlocked || momentsQuota.AD_BONUS_CALLS) + ' 次',
          icon: 'success'
        });
        this.setData({ generating: true, showPageLoading: !this.data.feed.length });
        this._runMomentsGenerate();
      })
      .finally(() => {
        if (this._alive) this.setData({ adUnlockBusy: false });
      });
  },

  async _loadCover() {
    const url = await momentsCover.resolveMomentsCoverUrl();
    if (this._alive) this.setData({ coverUrl: url || '' });
  },

  async _loadUserAvatar() {
    const url = await chatAvatar.resolveUserAvatar();
    if (this._alive) this.setData({ userAvatarUrl: url || '' });
  },

  onProfileNop() {},
  onComposeNop() {},
  onAdPanelNop() {},

  onTapCamera(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    this.setData({ cameraMenuOpen: !this.data.cameraMenuOpen });
  },

  onCloseCameraMenu() {
    this.setData({ cameraMenuOpen: false });
  },

  onChoosePublishText() {
    this.setData({
      cameraMenuOpen: false,
      composeOpen: true,
      composeMode: 'text',
      composeText: '',
      composeImages: [],
      inviteOcIds: [],
      remindLabel: '',
      composeCanPublish: false
    });
  },

  onChoosePublishImage() {
    this.setData({ cameraMenuOpen: false });
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || [])
          .map((f) => f && f.tempFilePath)
          .filter(Boolean);
        if (!files.length) return;
        this.setData({
          composeOpen: true,
          composeMode: 'image',
          composeText: '',
          composeImages: files.slice(0, 9),
          inviteOcIds: [],
          remindLabel: '',
          composeCanPublish: true
        });
      }
    });
  },

  onCloseCompose() {
    this.setData({
      composeOpen: false,
      composeMode: '',
      composeText: '',
      composeImages: [],
      inviteOcIds: [],
      remindLabel: '',
      composeCanPublish: false,
      remindOpen: false
    });
  },

  onComposeInput(e) {
    this.setData({ composeText: e.detail.value }, () => this._refreshComposeCanPublish());
  },

  onAddComposeImages() {
    const left = 9 - (this.data.composeImages || []).length;
    if (left <= 0) return;
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || [])
          .map((f) => f && f.tempFilePath)
          .filter(Boolean);
        if (!files.length) return;
        this.setData(
          {
            composeImages: (this.data.composeImages || []).concat(files).slice(0, 9)
          },
          () => this._refreshComposeCanPublish()
        );
      }
    });
  },

  onRemoveComposeImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(idx)) return;
    const next = (this.data.composeImages || []).slice();
    next.splice(idx, 1);
    this.setData({ composeImages: next }, () => this._refreshComposeCanPublish());
  },

  onOpenRemindPicker() {
    const list = getOcsForSocial()
      .filter((oc) => oc && oc.id)
      .map((oc) => ({ id: oc.id, name: oc.name || 'OC' }));
    const map = {};
    (this.data.inviteOcIds || []).forEach((id) => {
      map[id] = true;
    });
    this.setData({
      remindOpen: true,
      remindCandidates: list,
      remindMap: map
    });
  },

  onCloseRemindPicker() {
    this.setData({ remindOpen: false });
  },

  onToggleRemindOc(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const map = Object.assign({}, this.data.remindMap);
    map[id] = !map[id];
    this.setData({ remindMap: map });
  },

  onConfirmRemind() {
    const map = this.data.remindMap || {};
    const ids = Object.keys(map).filter((k) => map[k]);
    const names = (this.data.remindCandidates || [])
      .filter((c) => map[c.id])
      .map((c) => c.name);
    this.setData({
      inviteOcIds: ids,
      remindLabel: names.length ? names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') : '',
      remindOpen: false
    });
  },

  async onPublishMoment() {
    if (!this.data.composeCanPublish) return;
    const mode = this.data.composeMode;
    const text = String(this.data.composeText || '').trim();
    const temps = this.data.composeImages || [];
    const invited = this.data.inviteOcIds || [];

    if (mode === 'text') {
      if (!text) {
        wx.showToast({ title: '请输入文案', icon: 'none' });
        return;
      }
    } else if (mode === 'image') {
      if (!temps.length) {
        wx.showToast({ title: '请添加图片', icon: 'none' });
        return;
      }
    } else {
      return;
    }

    wx.showLoading({ title: '发布中', mask: true });
    try {
      let images = [];
      if (mode === 'image') {
        images = await momentsCover.saveMomentPostImagesFromTemp(temps);
      }
      const post = momentsStore.addUserMomentPost(
        text,
        invited,
        mode === 'image' ? images : []
      );
      this.onCloseCompose();
      if (post) {
        this._pendingRevealPostId = post.id;
        this.refreshFeed();
        // 有「提醒谁看」时被提醒 OC 会评论，并写入消息提醒
        const replied = await momentsComment.autoCommentOnUserPost(post);
        if (Array.isArray(replied)) {
          for (let i = 0; i < replied.length; i++) {
            if (replied[i] && replied[i].text) {
              await this._showReplyNotify(replied[i]);
            }
          }
        }
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
      console.warn('[ocMoments] publish', e);
      wx.hideLoading();
      const msg = String((e && (e.message || e.errMsg)) || '');
      wx.showToast({
        title:
          e && (e.risky || e.code === 'IMG_RISKY' || /违规/i.test(msg))
            ? msg.slice(0, 20) || '图片含违规内容'
            : msg.slice(0, 20) || '发布失败',
        icon: 'none',
        duration: 2500
      });
    }
  },

  async onOpenMessageList() {
    const list = momentsNotify.openMessageList();
    const enriched = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      let avatarDisplay = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        avatarDisplay =
          (await chatAvatar.resolveOcAvatar(item.ocId, item.avatarUrl || '')) ||
          '';
      } catch (_) {}
      enriched.push({
        id: item.id,
        ocId: item.ocId,
        ocName: item.ocName,
        text: item.text,
        postId: item.postId,
        timeLabel: momentsNotify.formatMsgTime(item.createdAt),
        avatarDisplay: avatarDisplay,
        letter: String(item.ocName || 'O').slice(0, 1) || 'O'
      });
    }
    if (!this._alive) return;
    this.setData({
      replyNotifyVisible: false,
      replyNotifyText: '',
      msgListOpen: true,
      msgList: enriched
    });
  },

  onCloseMessageList() {
    this.setData({ msgListOpen: false });
  },

  onTapMessageItem(e) {
    const postId = e.currentTarget.dataset.postId;
    this.setData({ msgListOpen: false });
    if (!postId) return;
    this.setData({ commentPostId: postId });
  },

  onPreviewMomentImage(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const postId = ds.postId;
    const idx = Number(ds.index) || 0;
    const feed = this.data.feed || [];
    let urls = [];
    for (let i = 0; i < feed.length; i++) {
      if (feed[i] && feed[i].id === postId) {
        urls = (feed[i].images || []).map((img) => img && img.path).filter(Boolean);
        break;
      }
    }
    if (!urls.length) return;
    wx.previewImage({
      current: urls[Math.min(idx, urls.length - 1)],
      urls: urls
    });
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
    if (this.data.cameraMenuOpen || this.data.composeOpen) return;
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

  onSubmitComment(e) {
    const id = (e.currentTarget.dataset.id || this.data.commentPostId || '').trim();
    const text = String(this.data.commentText || '').trim();
    if (!id || !text) {
      wx.showToast({ title: '请输入评论', icon: 'none' });
      return;
    }
    momentsStore.addPostComment(id, text, '我');
    this.setData({ commentPostId: '', commentText: '' });
    this.refreshFeed();
    momentsComment
      .handleUserCommentReply(id, text)
      .then((result) => {
        if (!this._alive || !result || result.skipped) return;
        this.refreshFeed();
        this._showReplyNotify(result);
      })
      .catch((err) => {
        console.warn('[ocMoments] reply', err);
      });
  },

  onTapOc(e) {
    const ocId = e.currentTarget.dataset.ocId;
    if (!ocId) return;
    const { ensureOcIdBioForChat } = require('../../../utils/ocChatGate.js');
    if (!ensureOcIdBioForChat(ocId)) return;
    wx.navigateTo({
      url: '/pages/ocChat/ocChat?ocId=' + encodeURIComponent(ocId),
      fail: () => wx.showToast({ title: '无法打开对话', icon: 'none' })
    });
  },

  onGoOcApp() {
    const nav = require('../../../utils/nav.js');
    nav.switchMainTab('ocapp');
  }
});
