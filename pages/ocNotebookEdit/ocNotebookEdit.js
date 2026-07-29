const colors = require('../../utils/colors.js');
const ocImage = require('../../utils/ocImage.js');
const chatBackground = require('../../utils/chatBackground.js');
const {
  upsertOcToFavorites,
  loadFavoriteToWork,
  deleteFavoriteItem,
  getFavoriteById
} = require('../../utils/favorite.js');
const { isLayer3Ready, applyNotebookFlags } = require('../../utils/ocWork.js');
const { emptyWork, mergeWork, workSnapshot } = require('../../utils/ocNotebookData.js');
const { applyParsedSetting } = require('../../utils/parseOcWork.js');
const packPage = require('../../utils/ocPackPage.js');
const inAppShare = require('../../utils/inAppSharePage.js');
const { buildOcFullPack,
  buildSettingShareText,
  buildOcFullShareText
} = require('../../utils/ocPack.js');
const { syncPageTheme, getSwiperIndicatorColors } = require('../../utils/uiTheme.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';
const NOTEBOOK_LIST_URL = '/pages/ocNotebook/ocNotebook';
const { MAX_OC_IMAGES } = ocImage;

function isNotebookListPage(route) {
  if (!route) return false;
  return route.indexOf('ocNotebook/ocNotebook') !== -1;
}

Page({
  data: {
    favoriteId: '',
    result: emptyWork().result,
    background: emptyWork().background,
    catchphrases: emptyWork().catchphrases,
    attitudes: emptyWork().attitudes,
    generatedBio: '',
    ocImages: [],
    ocImageIndex: 0,
    ocImageExpanded: false,
    layer3Ready: false,
    notebookSaved: false,
    hairHex: '#4a4a4a',
    eyeHex: '#37474f',
    autoText: '',
    parsing: false,
    uploadingImages: false,
    ...inAppShare.shareSheetDefaults(),
    swiperIndicatorColor: 'rgba(109, 40, 217, 0.25)',
    swiperIndicatorActiveColor: '#6d28d9'
  },

  onLoad(options) {
    syncPageTheme(this);
    this._syncSwiperTheme();
    inAppShare.bindSharePage(this);
    const id = options && options.id ? decodeURIComponent(options.id) : '';
    const mode = (options && options.mode) || '';
    if (id) {
      const work = loadFavoriteToWork(id);
      if (!work) {
        wx.showToast({ title: '未找到该 OC', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 400);
        return;
      }
      this.setData({ favoriteId: id, notebookSaved: true });
    } else if (mode === 'new') {
      const work = emptyWork();
      wx.setStorageSync(STORAGE_OC_WORK, work);
      this.setData({ favoriteId: '', notebookSaved: false });
    }
    this.loadFromStorage();
  },

  onShow() {
    syncPageTheme(this);
    this._syncSwiperTheme();
    if (this.data.uploadingImages || this._pickingImages) return;
    this.loadFromStorage();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.generatedBio && work.generatedBio !== this.data.generatedBio) {
      this.setData({ generatedBio: work.generatedBio });
    }
  },

  _syncSwiperTheme() {
    const { indicatorColor, indicatorActiveColor } = getSwiperIndicatorColors();
    this.setData({
      swiperIndicatorColor: indicatorColor,
      swiperIndicatorActiveColor: indicatorActiveColor
    });
  },

  async loadFromStorage() {
    if (this.data.uploadingImages) return;
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const favId = this.data.favoriteId || work.notebookFavoriteId || '';
    const storedImages = Array.isArray(work.ocImages) ? work.ocImages.slice() : [];
    if (favId) {
      const favItem = getFavoriteById(favId);
      if (favItem && Array.isArray(favItem.ocImages)) {
        work.ocImages = ocImage.mergeImageLists(storedImages, favItem.ocImages);
      }
    }
    await ocImage.normalizeWorkImages(work);
    if (!work.ocImages.length && storedImages.length) {
      work.ocImages = storedImages;
      ocImage.syncPrimaryImagePath(work);
    }
    wx.setStorageSync(STORAGE_OC_WORK, work);
    const m = mergeWork(work);
    const hairHex = colors.getHairColor(m.result.hairColor);
    const eyeHex = colors.getEyeColor(m.result.eyeColor);
    const ocImages = m.ocImages || [];
    const ocImageIndex = Math.min(this.data.ocImageIndex || 0, Math.max(0, ocImages.length - 1));
    this.setData({
      result: m.result,
      background: m.background,
      catchphrases: m.catchphrases,
      attitudes: m.attitudes,
      generatedBio: m.generatedBio || '',
      ocImages,
      ocImageIndex,
      favoriteId: favId,
      layer3Ready: isLayer3Ready({ ...m, result: m.result }),
      notebookSaved: !!favId,
      hairHex,
      eyeHex
    });
  },

  persistPartial(patch) {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, patch);
    ocImage.syncPrimaryImagePath(work);
    const favId = this.data.favoriteId || work.notebookFavoriteId || '';
    if (favId) {
      work.notebookFavoriteId = favId;
      upsertOcToFavorites(work);
    }
    wx.setStorageSync(STORAGE_OC_WORK, work);
  },

  _buildSnapshot() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const ocImages = Array.isArray(work.ocImages) ? work.ocImages : this.data.ocImages || [];
    return workSnapshot({
      ...this.data,
      favoriteId: this.data.favoriteId,
      ocImages,
      relationships:
        this.data.relationships != null ? this.data.relationships : work.relationships,
      timelineEvents:
        this.data.timelineEvents != null ? this.data.timelineEvents : work.timelineEvents
    });
  },

  onOcImageSwiperChange(e) {
    const index = e.detail && typeof e.detail.current === 'number' ? e.detail.current : 0;
    this.setData({ ocImageIndex: index });
  },

  onExpandOcImage(e) {
    const list = this.data.ocImages || [];
    if (!list.length) return;
    let index = this.data.ocImageIndex || 0;
    if (e && e.currentTarget && e.currentTarget.dataset.index != null) {
      index = Number(e.currentTarget.dataset.index);
      if (Number.isNaN(index)) index = this.data.ocImageIndex || 0;
    }
    this.setData({ ocImageExpanded: true, ocImageIndex: index });
  },

  onCloseOcImageExpand() {
    this.setData({ ocImageExpanded: false });
  },

  preventMove() {},

  onResultInput(e) {
    const key = e.currentTarget.dataset.key;
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    if (!key) return;
    const result = { ...this.data.result };
    if (key === 'personalities' || key === 'quirks') {
      const arr = (result[key] || []).slice();
      arr[Number(index)] = value;
      result[key] = arr;
    } else {
      result[key] = value;
    }
    const upd = { result };
    if (key === 'hairColor') upd.hairHex = colors.getHairColor(value);
    if (key === 'eyeColor') upd.eyeHex = colors.getEyeColor(value);
    this.setData(upd);
    this.persistPartial({ result });
  },

  onOriginInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const lifeEvents = (this.data.background.lifeEvents || []).slice();
    const origins = (this.data.background.origins || []).slice();
    origins[index] = value;
    const background = { ...this.data.background, lifeEvents, origins };
    this.setData({ background });
    this.persistPartial({ background });
  },

  onBgWorldview(e) {
    const background = {
      ...this.data.background,
      worldview: e.detail.value || '',
      origins: (this.data.background.origins || []).slice(),
      lifeEvents: (this.data.background.lifeEvents || []).slice()
    };
    this.setData({ background });
    this.persistPartial({ background });
  },

  onLifeEvent(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const origins = (this.data.background.origins || []).slice();
    const lifeEvents = (this.data.background.lifeEvents || []).slice();
    lifeEvents[index] = value;
    const background = { ...this.data.background, lifeEvents, origins };
    this.setData({ background });
    this.persistPartial({ background });
  },

  onCatchphraseInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const catchphrases = (this.data.catchphrases || []).slice();
    catchphrases[index] = value;
    this.setData({ catchphrases });
    this.persistPartial({ catchphrases });
  },

  onAttitudeEventInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const attitudes = (this.data.attitudes || []).map((a) => ({ ...a }));
    if (attitudes[index]) attitudes[index].event = value;
    this.setData({ attitudes });
    this.persistPartial({ attitudes });
  },

  onAttitudeTextInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const attitudes = (this.data.attitudes || []).map((a) => ({ ...a }));
    if (attitudes[index]) attitudes[index].attitude = value;
    this.setData({ attitudes });
    this.persistPartial({ attitudes });
  },

  onAutoTextInput(e) {
    this.setData({ autoText: e.detail.value || '' });
  },

  onParseSetting() {
    if (this.data.parsing) return;
    const text = (this.data.autoText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入设定文本', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用云开发基础库', icon: 'none' });
      return;
    }
    this.setData({ parsing: true });
    wx.cloud
      .callFunction({
        name: 'parseOcSetting',
        data: { text },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (!r.ok || !r.setting) {
          wx.showToast({ title: r.errMsg || '识别失败', icon: 'none', duration: 3000 });
          return;
        }
        const patch = applyParsedSetting(this.data, r.setting);
        if (!patch) {
          wx.showToast({ title: '识别结果无效', icon: 'none' });
          return;
        }
        this.setData(patch);
        this.persistPartial({
          result: patch.result,
          background: patch.background,
          catchphrases: patch.catchphrases,
          attitudes: patch.attitudes
        });
        wx.showToast({ title: '已填入设定栏', icon: 'success' });
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || '调用失败';
        wx.showToast({
          title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg,
          icon: 'none',
          duration: 3000
        });
      })
      .finally(() => this.setData({ parsing: false }));
  },

  onChooseOcImage() {
    if (this.data.uploadingImages) return;
    const remain = MAX_OC_IMAGES - (this.data.ocImages || []).length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 ' + MAX_OC_IMAGES + ' 张', icon: 'none' });
      return;
    }
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    this._pickingImages = true;
    wx.chooseMedia({
      count: Math.min(9, remain),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        this._pickingImages = false;
        const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
        if (!files.length) return;
        this._uploadOcImages(files);
      },
      fail: (err) => {
        this._pickingImages = false;
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        wx.showToast({ title: '未选择图片', icon: 'none' });
      }
    });
  },

  async _uploadOcImages(files) {
    this.setData({ uploadingImages: true });
    wx.showLoading({ title: '上传中…', mask: true });
    const favId = this.data.favoriteId || '';
    let ocImages = (this.data.ocImages || []).slice();
    let added = 0;
    let lastErr = null;
    try {
      for (let i = 0; i < files.length; i += 1) {
        if (ocImages.length >= MAX_OC_IMAGES) break;
        try {
          const entry = await ocImage.saveOcImageListFromTemp(files[i].tempFilePath, favId);
          ocImages.push(entry);
          added += 1;
        } catch (err) {
          lastErr = err;
        }
      }
      if (added) {
        this.setData({ ocImages, ocImageIndex: ocImages.length - 1 });
        this.persistPartial({ ocImages });
      }
      if (added && lastErr) {
        wx.showToast({ title: '已添加 ' + added + ' 张，部分失败', icon: 'none' });
      } else if (added) {
        wx.showToast({ title: '已添加 ' + added + ' 张', icon: 'success' });
      } else {
        const msg = (lastErr && (lastErr.errMsg || lastErr.message)) || '保存失败';
        console.error('[ocImage] save failed:', lastErr);
        wx.showModal({
          title: '图片保存失败',
          content: msg.length > 120 ? '请检查相册权限或稍后重试' : msg,
          showCancel: false
        });
      }
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ uploadingImages: false });
    }
  },

  onPreviewOcImage(e) {
    this.onExpandOcImage(e);
  },

  onRemoveOcImage() {
    const list = this.data.ocImages || [];
    if (!list.length) return;
    const index = this.data.ocImageIndex || 0;
    const item = list[index];
    if (!item) return;
    wx.showModal({
      title: '移除立绘',
      content: '确定移除当前这张图片？',
      success: async (res) => {
        if (!res.confirm) return;
        await ocImage.removeImageFile(item.path);
        const ocImages = list.filter((_, i) => i !== index);
        const ocImageIndex = Math.min(index, Math.max(0, ocImages.length - 1));
        this.setData({ ocImages, ocImageIndex });
        this.persistPartial({ ocImages });
        wx.showToast({ title: '已移除', icon: 'none' });
      }
    });
  },

  async onSaveNotebook() {
    const snap = this._buildSnapshot();
    if (!String(snap.result.name || '').trim()) {
      wx.showToast({ title: '请至少填写姓名', icon: 'none' });
      return;
    }
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, snap);
    work.source = 'notebook';
    if (this.data.favoriteId) work.notebookFavoriteId = this.data.favoriteId;
    applyNotebookFlags(work);

    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let favId = upsertOcToFavorites(work);
      if (!favId) {
        wx.showToast({ title: '保存失败', icon: 'none' });
        return;
      }
      work.notebookFavoriteId = favId;
      try {
        work.ocImages = await ocImage.migrateImagesToFavorite(work.ocImages || [], favId);
        ocImage.syncPrimaryImagePath(work);
      } catch (e) {
        work.ocImages = work.ocImages || [];
      }
      upsertOcToFavorites(work);
      wx.setStorageSync(STORAGE_OC_WORK, work);

      const ready = isLayer3Ready(work);
      this.setData({
        layer3Ready: ready,
        notebookSaved: true,
        favoriteId: favId,
        ocImages: work.ocImages || []
      });

      let tip = '已保存';
      if (ready) tip = '已保存，可使用 OC 对话';
      wx.showToast({ title: tip, icon: 'success', duration: 2200 });
    } finally {
      wx.hideLoading();
    }
  },

  onGoOcChat() {
    const snap = this._buildSnapshot();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, snap);
    if (this.data.favoriteId) work.notebookFavoriteId = this.data.favoriteId;
    applyNotebookFlags(work);
    if (!isLayer3Ready(work)) {
      wx.showToast({
        title: '请先填写完整 3 条常用语与态度',
        icon: 'none',
        duration: 2800
      });
      return;
    }
    wx.setStorageSync(STORAGE_OC_WORK, work);
    const { ensureOcBioForChat } = require('../../utils/ocChatGate.js');
    const ocId = work.notebookFavoriteId || this.data.favoriteId || '';
    if (!ensureOcBioForChat(work, ocId)) return;
    wx.navigateTo({
      url: ocId
        ? `/pages/ocChat/ocChat?ocId=${encodeURIComponent(ocId)}`
        : '/pages/ocChat/ocChat'
    });
  },

  onGoOcStory() {
    const snap = this._buildSnapshot();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, snap);
    if (this.data.favoriteId) work.notebookFavoriteId = this.data.favoriteId;
    applyNotebookFlags(work);
    wx.setStorageSync(STORAGE_OC_WORK, work);
    const nav = require('../../utils/nav.js');
    nav.goTo('story');
  },

  onGoOcBio() {
    const snap = this._buildSnapshot();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, snap);
    if (this.data.favoriteId) work.notebookFavoriteId = this.data.favoriteId;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    const ocId = this.data.favoriteId ? encodeURIComponent(this.data.favoriteId) : '';
    wx.navigateTo({
      url: ocId
        ? `/pages/ocBioHub/ocBioHub?ocId=${encodeURIComponent(ocId)}`
        : '/pages/ocBioHub/ocBioHub'
    });
  },

  onBackToNotebook() {
    if (this.data.ocImageExpanded) {
      this.setData({ ocImageExpanded: false });
      return;
    }
    const pages = getCurrentPages();
    const cur = pages.length - 1;
    const notebookIdx = pages.findIndex((p) => isNotebookListPage(p.route || ''));
    if (notebookIdx >= 0 && notebookIdx < cur) {
      wx.navigateBack({ delta: cur - notebookIdx });
      return;
    }
    wx.redirectTo({
      url: NOTEBOOK_LIST_URL,
      fail: () => wx.reLaunch({ url: NOTEBOOK_LIST_URL })
    });
  },

  onExportOcPack() {
    const id = this.data.favoriteId;
    if (!id) {
      wx.showToast({ title: '请先保存设定', icon: 'none' });
      return;
    }
    const item = getFavoriteById(id);
    const name = (item && item.result && item.result.name) || 'oc';
    packPage.runExportMenu({
      baseName: name + '_full',
      getText: () => buildOcFullShareText(id),
      getPack: () => buildOcFullPack(id)
    });
  },

  onImportOcPack() {
    packPage.runImportPack({}, (result) => {
      if (result.favoriteId) {
        loadFavoriteToWork(result.favoriteId);
        this.setData({ favoriteId: result.favoriteId, notebookSaved: true });
        this.loadFromStorage();
      }
    });
  },

  onShareOcSetting() {
    const id = this.data.favoriteId;
    if (!id) {
      wx.showToast({ title: '请先保存设定', icon: 'none' });
      return;
    }
    const item = getFavoriteById(id);
    if (!item) return;
    const name = (item.result && item.result.name) || 'OC';
    packPage.runShareText(name, buildSettingShareText(item), {
      shareTitle: 'OC 设定：' + name,
      path: inAppShare.buildOcSharePath(id)
    });
  },

  onShareAppMessage() {
    return inAppShare.buildShareMessage(this);
  },

  onCloseShareSheet() {
    inAppShare.closeShareSheet(this);
  },

  onDeleteOc() {
    const id = this.data.favoriteId;
    if (!id) return;
    wx.showModal({
      title: '删除 OC',
      content: '确定从设定本移除该角色？',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        const fav = getFavoriteById(id);
        if (fav && Array.isArray(fav.ocImages)) {
          await ocImage.removeOcImageFiles(fav.ocImages);
        }
        await ocImage.removeAllFavoriteOcImages(id);
        await chatBackground.removeChatBackground(id);
        deleteFavoriteItem(id);
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => this.onBackToNotebook(), 400);
      }
    });
  }
});
