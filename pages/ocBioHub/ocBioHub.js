const {
  getFavorites,
  loadFavoriteToWork,
  ensureCurrentWorkInFavorites,
  workFromFavoriteItem
} = require('../../utils/favorite.js');
const ocImage = require('../../utils/ocImage.js');
const colors = require('../../utils/colors.js');
const { personalityBlend, quirkBlend } = require('../../utils/ocResult.js');
const {
  bioPreviewLines,
  formatBackgroundForWork,
  formatLayer3ForWork
} = require('../../utils/storyStore.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');
const { buildSegmentNavStyle } = require('../../utils/wxNavSafe.js');
const nav = require('../../utils/nav.js');
const staticAssets = require('../../utils/staticAssets.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

function mapOcEntryLight(id, item, work) {
  const r = (work && work.result) || (item && item.result) || {};
  const bioText = String(
    (item && item.generatedBio) || (work && work.generatedBio) || ''
  ).trim();
  return {
    id,
    name: String(r.name || '').trim() || '未命名',
    race: r.race || '—',
    gender: r.gender || '—',
    age: r.age || '—',
    hairColor: r.hairColor || '—',
    eyeColor: r.eyeColor || '—',
    personalityText: personalityBlend(r),
    quirkText: quirkBlend(r),
    backgroundText: '',
    layer3Text: '',
    summary: '',
    hasBio: !!bioText,
    bioText,
    bioPreview: bioPreviewLines(bioText, 5),
    ocImagePath: ocImage.getDisplayImagePathQuick(work || item),
    hairHex: colors.getHairColor(r.hairColor),
    eyeHex: colors.getEyeColor(r.eyeColor),
    _extrasLoaded: false
  };
}

function attachOcExtras(entry, work) {
  if (!entry || entry._extrasLoaded) return entry;
  return {
    ...entry,
    backgroundText: formatBackgroundForWork(work),
    layer3Text: formatLayer3ForWork(work),
    summary: '',
    _extrasLoaded: true
  };
}

function buildBioHubList() {
  const mapped = getFavorites()
    .filter((i) => i && i.result)
    .map((item) => mapOcEntryLight(item.id, item, workFromFavoriteItem(item)));

  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.result || !String(work.result.name || '').trim()) return mapped;

  const favId = work.notebookFavoriteId;
  if (favId && mapped.some((m) => m.id === favId)) return mapped;

  const name = String(work.result.name || '').trim();
  if (name && mapped.some((m) => m.name === name)) return mapped;

  mapped.unshift(
    mapOcEntryLight(favId || '__work__', { generatedBio: work.generatedBio }, work)
  );
  return mapped;
}

function resolveWorkForEntry(entry) {
  if (!entry) return null;
  if (entry.id === '__work__') {
    return wx.getStorageSync(STORAGE_OC_WORK) || {};
  }
  const item = getFavorites().find((f) => f.id === entry.id);
  return item ? workFromFavoriteItem(item) || item : null;
}

Page({
  data: {
    ocList: [],
    swiperIndex: 0,
    currentOc: null,
    switchScrollId: '',
    settingsExpanded: false,
    currentBioPreview: '',
    currentHasBio: false,
    uiThemeClass: '',
    storySegmentOptions: [
      { key: 'bio', label: '小传' },
      { key: 'story', label: '故事' }
    ],
    segmentNavStyle: '',
    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder()
  },

  onLoad(options) {
    applyPageGradientBg();
    syncPageTheme(this);
    this.setData({ segmentNavStyle: buildSegmentNavStyle() });
    this._pendingOcId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    // 首屏立刻出列表，避免白屏
    this._reloadList(0);
  },

  onShow() {
    applyPageGradientBg();
    syncPageTheme(this);
    this.setData({ segmentNavStyle: buildSegmentNavStyle() });
    try {
      ensureCurrentWorkInFavorites();
      const pending = this._pendingOcId;
      if (pending) this._pendingOcId = '';
      let idx = this.data.swiperIndex || 0;
      if (pending) {
        const ocList = buildBioHubList();
        const found = ocList.findIndex((o) => o.id === pending);
        if (found >= 0) idx = found;
      }
      this._reloadList(idx);
    } catch (err) {
      console.error('[ocBioHub] onShow', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  _currentOc() {
    const list = this.data.ocList || [];
    return list[this.data.swiperIndex || 0] || null;
  },

  _favoriteIdFor(cur) {
    if (!cur) return '';
    if (cur.id && cur.id !== '__work__') return cur.id;
    return ensureCurrentWorkInFavorites() || '';
  },

  _patchOcIndex(patch, ocList, idx) {
    const list = ocList || patch.ocList || this.data.ocList || [];
    const i = typeof idx === 'number' ? idx : this.data.swiperIndex || 0;
    let cur = list[i] || null;
    if (cur && this.data.settingsExpanded && !cur._extrasLoaded) {
      const work = resolveWorkForEntry(cur);
      cur = attachOcExtras(cur, work || {});
      list[i] = cur;
      patch.ocList = list.slice();
    }
    patch.swiperIndex = i;
    patch.currentOc = cur;
    patch.switchScrollId = 'story-switch-' + i;
    patch.currentBioPreview = cur && cur.hasBio ? cur.bioPreview : '';
    patch.currentHasBio = !!(cur && cur.hasBio);
    return patch;
  },

  _reloadList(keepIndex) {
    const ocList = buildBioHubList();
    let idx = typeof keepIndex === 'number' ? keepIndex : 0;
    if (idx >= ocList.length) idx = Math.max(0, ocList.length - 1);
    const patch = { ocList };
    this._patchOcIndex(patch, ocList, idx);
    this.setData(patch);
  },

  onSwitchOc(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(idx) || idx === this.data.swiperIndex) return;
    const patch = {};
    this._patchOcIndex(patch, null, idx);
    patch.settingsExpanded = false;
    this.setData(patch);
  },

  onToggleSettings() {
    const next = !this.data.settingsExpanded;
    if (!next) {
      this.setData({ settingsExpanded: false });
      return;
    }
    const list = (this.data.ocList || []).slice();
    const i = this.data.swiperIndex || 0;
    let cur = list[i];
    if (cur && !cur._extrasLoaded) {
      const work = resolveWorkForEntry(cur);
      cur = attachOcExtras(cur, work || {});
      list[i] = cur;
    }
    this.setData({
      settingsExpanded: true,
      ocList: list,
      currentOc: cur || this.data.currentOc
    });
  },

  onGoGenerate() {
    const cur = this._currentOc();
    if (!cur) {
      wx.showToast({ title: '请先在设定本保存 OC', icon: 'none' });
      return;
    }
    const fid = this._favoriteIdFor(cur);
    if (fid) loadFavoriteToWork(fid);
    const url = fid
      ? '/pages/ocBio/ocBio?ocId=' + encodeURIComponent(fid)
      : '/pages/ocBio/ocBio';
    wx.navigateTo({ url });
  },

  onReadBio() {
    const cur = this._currentOc();
    if (!cur || !cur.hasBio) return;
    const fid = this._favoriteIdFor(cur);
    if (fid) loadFavoriteToWork(fid);
    const url = fid
      ? '/pages/ocBioRead/ocBioRead?ocId=' + encodeURIComponent(fid)
      : '/pages/ocBioRead/ocBioRead';
    wx.navigateTo({ url });
  },

  onStorySegmentChange(e) {
    if (e.detail && e.detail.key === 'story') {
      nav.goTo('story');
    }
  }
});
