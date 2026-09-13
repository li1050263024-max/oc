const douyinStore = require('../../../utils/ocDouyinStore.js');
const douyinBgm = require('../../../utils/ocDouyinBgm.js');

Page({
  data: {
    statusBar: 20,
    navHeight: 44,
    images: [],
    caption: '',
    canSend: false,
    bgmName: '',
    bgmTrack: null,
    bgmSheetOpen: false,
    bgmLoading: false,
    bgmTracks: [],
    bgmHint: ''
  },

  onLoad() {
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const statusBar = Number(sys.statusBarHeight) || 20;
      const navHeight = menu && menu.height ? menu.height + (menu.top - statusBar) * 2 : 44;
      this.setData({ statusBar: statusBar, navHeight: navHeight });
    } catch (_) {}
    this._syncCanSend();
  },

  _syncCanSend() {
    const caption = String(this.data.caption || '').trim();
    const hasImg = (this.data.images || []).length > 0;
    this.setData({ canSend: !!(caption || hasImg) });
  },

  onCaptionInput(e) {
    this.setData({ caption: String((e.detail && e.detail.value) || '') });
    this._syncCanSend();
  },

  onAddImages() {
    const left = 9 - (this.data.images || []).length;
    if (left <= 0) return;
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || [])
          .map((f) => (f && f.tempFilePath ? { path: f.tempFilePath } : null))
          .filter(Boolean);
        if (!files.length) return;
        this.setData({ images: (this.data.images || []).concat(files).slice(0, 9) });
        this._syncCanSend();
      }
    });
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = (this.data.images || []).slice();
    if (idx < 0 || idx >= images.length) return;
    images.splice(idx, 1);
    this.setData({ images: images });
    this._syncCanSend();
  },

  onPickBgm() {
    this.setData({ bgmSheetOpen: true, bgmLoading: true, bgmHint: '' });
    douyinBgm
      .listCloudBgmLibraryWithSeed()
      .then((res) => {
        const payload = res && Array.isArray(res.tracks) ? res : { tracks: res || [], hint: '' };
        const activeId = this.data.bgmTrack && this.data.bgmTrack.fileID;
        const list = (payload.tracks || []).map((t) =>
          Object.assign({}, t, { active: !!(t.fileID && t.fileID === activeId) })
        );
        this.setData({
          bgmTracks: list,
          bgmLoading: false,
          bgmHint: list.length ? payload.hint || '' : payload.hint || '曲库为空'
        });
      })
      .catch(() => {
        this.setData({
          bgmTracks: [],
          bgmLoading: false,
          bgmHint: '曲库加载失败'
        });
      });
  },

  onCloseBgmSheet() {
    this.setData({ bgmSheetOpen: false });
  },

  onSelectTrack(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const track = (this.data.bgmTracks || [])[idx];
    if (!track) return;
    this.setData({
      bgmTrack: track,
      bgmName: track.name || 'BGM',
      bgmSheetOpen: false
    });
  },

  onClearBgm() {
    this.setData({ bgmTrack: null, bgmName: '' });
  },

  onClose() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/ocApp/ocDouyin/ocDouyin' }) });
  },

  onSend() {
    if (!this.data.canSend || this._sending) return;
    const caption = String(this.data.caption || '').trim();
    const images = this.data.images || [];
    if (!caption && !images.length) {
      wx.showToast({ title: '请添加图片或文案', icon: 'none' });
      return;
    }
    this._sending = true;
    wx.showLoading({ title: '发布中…', mask: true });
    try {
      const paths = images.map((i) => i.path).filter(Boolean);
      const clip = douyinStore.addUserPost({
        text: caption,
        imagePath: paths[0] || '',
        imagePaths: paths
      });
      if (!clip) {
        wx.hideLoading();
        this._sending = false;
        wx.showToast({ title: '发布失败', icon: 'none' });
        return;
      }
      const track = this.data.bgmTrack;
      const finish = () => {
        wx.hideLoading();
        this._sending = false;
        wx.showToast({ title: '已发布', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.redirectTo({ url: '/pages/ocApp/ocDouyin/ocDouyin' })
          });
        }, 400);
      };
      if (track && clip.id) {
        douyinBgm
          .assignCloudTrackToClip(clip.id, track)
          .catch(() => {})
          .then(finish);
      } else {
        finish();
      }
    } catch (err) {
      wx.hideLoading();
      this._sending = false;
      wx.showToast({ title: '发布失败', icon: 'none' });
    }
  }
});
