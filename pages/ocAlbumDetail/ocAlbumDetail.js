const ocImage = require('../../utils/ocImage.js');
const ocAlbum = require('../../utils/ocAlbum.js');
const { getFavoriteById, updateFavoriteItem, workFromFavoriteItem } = require('../../utils/favorite.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');

Page({
  data: {
    favoriteId: '',
    albumId: '',
    albumName: '',
    albumDescription: '',
    isPreset: false,
    images: [],
    imageCount: 0,
    maxImages: ocAlbum.MAX_IMAGES_PER_ALBUM,
    uploading: false,
    previewVisible: false,
    previewIndex: 0,
    previewCloseStyle: '',
    previewHeadStyle: '',
    descFocus: false,
    uiThemeClass: ''
  },

  _updatePreviewChromeLayout() {
    try {
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const statusBar = Number(sys.statusBarHeight) || 20;
      if (menu && menu.bottom) {
        // 叉号放在胶囊下方，避免与微信按钮重叠误触
        const closeTop = Math.round(menu.bottom + 10);
        const headPad = Math.round(menu.bottom + 8);
        this.setData({
          previewCloseStyle: 'top:' + closeTop + 'px;',
          previewHeadStyle: 'padding-top:' + headPad + 'px;'
        });
        return;
      }
      const closeTop = statusBar + 48;
      this.setData({
        previewCloseStyle: 'top:' + closeTop + 'px;',
        previewHeadStyle: 'padding-top:' + (statusBar + 44) + 'px;'
      });
    } catch (_) {
      this.setData({
        previewCloseStyle: 'top:96px;',
        previewHeadStyle: 'padding-top:88px;'
      });
    }
  },

  onLoad(options) {
    syncPageTheme(this);
    this._updatePreviewChromeLayout();
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
    const beforeIds = (Array.isArray(work.ocAlbums) ? work.ocAlbums : [])
      .map((a) => a && a.id)
      .filter(Boolean)
      .join('|');
    ocAlbum.syncWorkImagesFromAlbums(work);
    const afterIds = (work.ocAlbums || [])
      .map((a) => a && a.id)
      .filter(Boolean)
      .join('|');
    // 超额拆册后写回收藏，避免刷新又重复拆
    if (afterIds !== beforeIds) {
      updateFavoriteItem(this.data.favoriteId, work);
    }
    const album = ocAlbum.findAlbum(work.ocAlbums, this.data.albumId);
    if (!album) {
      wx.showToast({ title: '图册不存在（超额图已拆到新图册）', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    const images = (album.images || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
    this.setData({
      albumName: album.name,
      albumDescription: album.description || '',
      isPreset: !!album.preset,
      images,
      imageCount: images.length,
      maxImages: ocAlbum.MAX_IMAGES_PER_ALBUM
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
      const patch = {
        albumName: album ? album.name : this.data.albumName,
        albumDescription: album ? album.description || '' : this.data.albumDescription,
        images,
        imageCount: images.length,
        isPreset: album ? !!album.preset : this.data.isPreset
      };
      if (!images.length && this.data.previewVisible) {
        patch.previewVisible = false;
        patch.previewIndex = 0;
      } else if (this.data.previewVisible && this.data.previewIndex >= images.length) {
        patch.previewIndex = Math.max(0, images.length - 1);
      }
      this.setData(patch);
      if (toastTitle) wx.showToast({ title: toastTitle, icon: 'success' });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    return ok;
  },

  onFocusDescription() {
    this.setData({ descFocus: false });
    setTimeout(() => {
      this.setData({ descFocus: true });
    }, 30);
  },

  onDescriptionInput(e) {
    this.setData({
      albumDescription: String((e && e.detail && e.detail.value) || '').slice(0, 120)
    });
  },

  onDescriptionBlur() {
    this.setData({ descFocus: false });
    const description = String(this.data.albumDescription || '').trim().slice(0, 120);
    const prev = ocAlbum.findAlbum(this._albumsCache || [], this.data.albumId);
    const prevDesc = prev ? String(prev.description || '').trim() : '';
    if (description === prevDesc) return;
    const albums = ocAlbum.setAlbumDescription(
      this._albumsCache || [],
      this.data.albumId,
      description
    );
    this._persistAlbums(albums);
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
    this._updatePreviewChromeLayout();
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
    // 单册上限 15；选超后自动写入「原名·续N」新图册（适配抖音/朋友圈）
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: 9,
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
    // 本批次已写入但尚未 persist 到 storage 的路径，清理时必须保留
    const pendingKeep = [];
    albums.forEach((a) => {
      ((a && a.images) || []).forEach((img) => {
        if (img && img.path) pendingKeep.push(img.path);
      });
    });
    try {
      // 不再上传前主动 cleanup：路径格式不一致时会误删其它立绘，导致抖音多图 500
      const entries = [];
      for (let i = 0; i < files.length; i += 1) {
        let tempPath = files[i].tempFilePath;
        try {
          const syncPath = ocImage.stabilizeTempImagePathSync(tempPath);
          if (syncPath) tempPath = syncPath;
          else tempPath = await ocImage.ensurePersistedPickPath(tempPath);
          const entry = await ocImage.saveOcImageListFromTemp(tempPath, favId, pendingKeep);
          if (entry && entry.path) pendingKeep.push(entry.path);
          entries.push(entry);
        } catch (err) {
          lastErr = err;
          if (err && (err.risky || err.code === 'IMG_RISKY')) {
            break;
          }
        }
      }
      const result = ocAlbum.addImagesToAlbumWithOverflow(albums, this.data.albumId, entries);
      albums = result.albums;
      added = result.added || 0;
      if (!added) {
        wx.hideLoading();
        if (
          lastErr &&
          (lastErr.risky ||
            lastErr.code === 'IMG_RISKY' ||
            /违规/i.test(String(lastErr.message || '')))
        ) {
          wx.showToast({
            title: this._formatWxErr(lastErr, '图片含违规内容'),
            icon: 'none',
            duration: 2500
          });
          return;
        }
        if (
          lastErr &&
          (lastErr.storageFull ||
            lastErr.code === 'STORAGE_FULL' ||
            /存储.*满|空间不足|10MB/i.test(String(lastErr.message || '')))
        ) {
          try {
            require('../../utils/ocLocalStorageClean.js').promptStorageCleanup({
              message: String(lastErr.message || '')
            });
          } catch (_) {
            wx.showToast({ title: this._formatWxErr(lastErr, '上传失败'), icon: 'none' });
          }
          return;
        }
        wx.showToast({ title: this._formatWxErr(lastErr, '上传失败'), icon: 'none' });
        return;
      }
      const ok = this._persistAlbums(albums);
      wx.hideLoading();
      if (ok) {
        const spilled = (result.spillAlbumIds || []).length;
        let title = lastErr ? '已添加 ' + added + ' 张，部分失败' : '已添加 ' + added + ' 张';
        if (spilled) {
          title = '已添加 ' + added + ' 张，超额已存入新图册';
        }
        wx.showToast({
          title: title,
          icon: spilled || lastErr ? 'none' : 'success',
          duration: spilled ? 2500 : 1500
        });
      }
    } catch (e) {
      wx.hideLoading();
      if (
        e &&
        (e.storageFull ||
          e.code === 'STORAGE_FULL' ||
          /存储.*满|空间不足|10MB/i.test(String(e.message || '')))
      ) {
        try {
          require('../../utils/ocLocalStorageClean.js').promptStorageCleanup({
            message: String(e.message || '')
          });
        } catch (_) {
          wx.showToast({ title: this._formatWxErr(e, '上传失败'), icon: 'none' });
        }
      } else {
        wx.showToast({ title: this._formatWxErr(e, '上传失败'), icon: 'none' });
      }
    } finally {
      this.setData({ uploading: false });
    }
  }
});
