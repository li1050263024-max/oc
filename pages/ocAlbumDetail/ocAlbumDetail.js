const ocImage = require('../../utils/ocImage.js');
const ocAlbum = require('../../utils/ocAlbum.js');
const { getFavoriteById, updateFavoriteItem, workFromFavoriteItem } = require('../../utils/favorite.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');

Page({
  data: {
    favoriteId: '',
    albumId: '',
    albumName: '',
    isPreset: false,
    images: [],
    imageCount: 0,
    maxImages: ocAlbum.MAX_IMAGES_PER_ALBUM,
    uploading: false,
    previewVisible: false,
    previewIndex: 0,
    uiThemeClass: ''
  },

  onLoad(options) {
    syncPageTheme(this);
    const favoriteId = options && options.id ? decodeURIComponent(options.id) : '';
    const albumId = options && options.albumId ? decodeURIComponent(options.albumId) : '';
    if (!favoriteId || !albumId) {
      wx.showToast({ title: '缺少图册信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    this.setData({ favoriteId, albumId });
    this.loadAlbum();
  },

  onShow() {
    syncPageTheme(this);
    if (this.data.favoriteId && this.data.albumId && !this.data.uploading) {
      this.loadAlbum();
    }
  },

  loadAlbum() {
    const fav = getFavoriteById(this.data.favoriteId);
    if (!fav) {
      wx.showToast({ title: '未找到该 OC', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    const work = workFromFavoriteItem(fav) || { ocAlbums: fav.ocAlbums, ocImages: fav.ocImages };
    ocAlbum.syncWorkImagesFromAlbums(work);
    const album = ocAlbum.findAlbum(work.ocAlbums, this.data.albumId);
    if (!album) {
      wx.showToast({ title: '图册不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    const images = (album.images || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
    this.setData({
      albumName: album.name,
      isPreset: !!album.preset,
      images,
      imageCount: images.length
    });
    this._albumsCache = work.ocAlbums;
    this._workCache = work;
  },

  _persistAlbums(albums, toastTitle) {
    const fav = getFavoriteById(this.data.favoriteId);
    if (!fav || !fav.result) return false;
    const work = this._workCache || workFromFavoriteItem(fav);
    work.ocAlbums = albums;
    ocAlbum.syncWorkImagesFromAlbums(work);
    work.notebookFavoriteId = this.data.favoriteId;
    work.layer2Done = true;
    work.layer3Done = true;
    work.layer3Confirmed = true;
    const ok = updateFavoriteItem(this.data.favoriteId, work);
    if (ok) {
      try {
        wx.setStorageSync('oc_work_in_progress', work);
      } catch (_) {}
      this._albumsCache = work.ocAlbums;
      this._workCache = work;
      const album = ocAlbum.findAlbum(work.ocAlbums, this.data.albumId);
      const images = album
        ? (album.images || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0))
        : [];
      this.setData({
        albumName: album ? album.name : this.data.albumName,
        images,
        imageCount: images.length,
        isPreset: album ? !!album.preset : this.data.isPreset
      });
      if (toastTitle) wx.showToast({ title: toastTitle, icon: 'success' });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    return ok;
  },

  onRenameAlbum() {
    wx.showModal({
      title: '重命名图册',
      editable: true,
      placeholderText: '请输入图册名称',
      content: this.data.albumName || '',
      success: (res) => {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) {
          wx.showToast({ title: '名称不能为空', icon: 'none' });
          return;
        }
        const albums = ocAlbum.renameAlbum(this._albumsCache || [], this.data.albumId, name);
        this._persistAlbums(albums, '已重命名');
      }
    });
  },

  onDeleteAlbum() {
    if (this.data.isPreset) {
      wx.showToast({ title: '预设图册不可删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除图册',
      content: '确定删除该图册？图册内图片也会移除。',
      confirmColor: '#c45c5c',
      success: (res) => {
        if (!res.confirm) return;
        const albums = ocAlbum.removeAlbum(this._albumsCache || [], this.data.albumId);
        const ok = this._persistAlbums(albums, '已删除');
        if (ok) setTimeout(() => wx.navigateBack(), 300);
      }
    });
  },

  onPreviewImage(e) {
    const list = this.data.images || [];
    if (!list.length) return;
    let index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index) || index < 0) index = 0;
    if (index >= list.length) index = list.length - 1;
    this.setData({ previewVisible: true, previewIndex: index });
  },

  onPreviewSwiperChange(e) {
    const idx = (e.detail && e.detail.current) || 0;
    this.setData({ previewIndex: idx });
  },

  onClosePreview() {
    this.setData({ previewVisible: false });
  },

  preventMove() {},

  onRemoveImage(e) {
    const imageId = e.currentTarget.dataset.id;
    if (!imageId) return;
    wx.showModal({
      title: '移除图片',
      content: '确定从该图册移除这张图片？',
      confirmColor: '#c45c5c',
      success: (res) => {
        if (!res.confirm) return;
        const albums = ocAlbum.removeImageFromAlbum(
          this._albumsCache || [],
          this.data.albumId,
          imageId
        );
        this._persistAlbums(albums, '已移除');
      }
    });
  },

  _formatWxErr(err, fallback) {
    if (!err) return fallback || '未知错误';
    if (typeof err === 'string') return err;
    return String(err.message || err.errMsg || fallback || '未知错误');
  },

  onChooseImages() {
    if (this.data.uploading) return;
    const remain = this.data.maxImages - (this.data.imageCount || 0);
    if (remain <= 0) {
      wx.showToast({ title: '每个图册最多 ' + this.data.maxImages + ' 张', icon: 'none' });
      return;
    }
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: Math.min(9, remain),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
        if (!files.length) {
          wx.showToast({ title: '未获取到图片', icon: 'none' });
          return;
        }
        this._uploadImages(files);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        wx.showToast({ title: this._formatWxErr(err, '选图失败'), icon: 'none' });
      }
    });
  },

  async _uploadImages(files) {
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中…', mask: true });
    const favId = this.data.favoriteId || '';
    let albums = (this._albumsCache || []).map((a) => ocAlbum.normalizeAlbum(a));
    let added = 0;
    let lastErr = null;
    try {
      await ocImage.cleanupUserImageStorage();
      for (let i = 0; i < files.length; i += 1) {
        const album = ocAlbum.findAlbum(albums, this.data.albumId);
        if (!album || album.images.length >= ocAlbum.MAX_IMAGES_PER_ALBUM) break;
        let tempPath = files[i].tempFilePath;
        try {
          const syncPath = ocImage.stabilizeTempImagePathSync(tempPath);
          if (syncPath) tempPath = syncPath;
          else tempPath = await ocImage.ensurePersistedPickPath(tempPath);
          const entry = await ocImage.saveOcImageListFromTemp(tempPath, favId);
          albums = ocAlbum.addImageToAlbum(albums, this.data.albumId, entry);
          added += 1;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!added) {
        wx.hideLoading();
        wx.showToast({ title: this._formatWxErr(lastErr, '上传失败'), icon: 'none' });
        return;
      }
      const ok = this._persistAlbums(albums);
      wx.hideLoading();
      if (ok) {
        wx.showToast({
          title: lastErr ? '已添加 ' + added + ' 张，部分失败' : '已添加 ' + added + ' 张',
          icon: lastErr ? 'none' : 'success'
        });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: this._formatWxErr(e, '上传失败'), icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  }
});
