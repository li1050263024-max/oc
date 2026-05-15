const background = require('../../utils/background.js');
const defaultPools = require('../../data/pools.js');
const { isLayer3Ready } = require('../../utils/ocWork.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';
const STORAGE_CUSTOM_POOLS = 'oc_custom_pools';

Page({
  data: {
    result: null,
    background: null,
    catchphrases: [],
    attitudes: [],
    cardFlipped: false,
    lockedLayer3: {
      catchphrase0: false,
      catchphrase1: false,
      catchphrase2: false,
      attitude0: false,
      attitude1: false,
      attitude2: false
    },
    layer3Confirmed: false,
    layer3Ready: false
  },

  onLoad() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.result && work.background) {
      this.setData({
        result: work.result,
        background: work.background,
        catchphrases: work.catchphrases || [],
        attitudes: work.attitudes || [],
        lockedLayer3: work.lockedLayer3 || {
          catchphrase0: false,
          catchphrase1: false,
          catchphrase2: false,
          attitude0: false,
          attitude1: false,
          attitude2: false
        },
        layer3Confirmed: !!work.layer3Confirmed,
        layer3Ready: isLayer3Ready(work)
      });
    } else {
      wx.showToast({ title: '请先完成背景故事', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  _persistWork(extra) {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = this.data.result;
    work.background = this.data.background;
    work.catchphrases = this.data.catchphrases || [];
    work.attitudes = this.data.attitudes || [];
    work.lockedLayer3 = this.data.lockedLayer3;
    const ready = isLayer3Ready({
      result: work.result,
      catchphrases: work.catchphrases,
      attitudes: work.attitudes
    });
    work.layer3Done = ready;
    work.layer3Confirmed = ready;
    if (extra) Object.assign(work, extra);
    wx.setStorageSync(STORAGE_OC_WORK, work);
    this.setData({ layer3Ready: ready, layer3Confirmed: ready });
  },

  /** 三条常用语与三条态度是否均已填写 */
  _layer3ContentOk() {
    const c = this.data.catchphrases || [];
    const a = this.data.attitudes || [];
    if (c.length < 3 || a.length < 3) return false;
    for (let i = 0; i < 3; i++) {
      if (!String(c[i] || '').trim()) return false;
    }
    for (let i = 0; i < 3; i++) {
      if (!a[i] || !String(a[i].attitude || '').trim()) return false;
    }
    return true;
  },

  /** 翻开卡牌：若尚未生成则先自动生成，再翻转并直接显示结果 */
  onFlipCard() {
    const { catchphrases, attitudes } = this.data;
    if ((!catchphrases || catchphrases.length === 0) && (!attitudes || attitudes.length === 0)) {
      const pools = this.getPools();
      const newC = background.drawCatchphrases(pools, 3);
      const newA = background.drawAttitudes(pools);
      this.setData({
        catchphrases: newC,
        attitudes: newA,
        cardFlipped: true,
        lockedLayer3: {
          catchphrase0: false,
          catchphrase1: false,
          catchphrase2: false,
          attitude0: false,
          attitude1: false,
          attitude2: false
        },
      }, () => this._persistWork());
    } else {
      this.setData({ cardFlipped: true });
    }
  },

  getPools() {
    const custom = wx.getStorageSync(STORAGE_CUSTOM_POOLS);
    if (custom && Array.isArray(custom.names)) return custom;
    return defaultPools;
  },

  onGenerateLayer3() {
    const pools = this.getPools();
    const catchphrases = background.drawCatchphrases(pools, 3);
    const attitudes = background.drawAttitudes(pools);
    this.setData({
      catchphrases,
      attitudes,
      lockedLayer3: {
        catchphrase0: false,
        catchphrase1: false,
        catchphrase2: false,
        attitude0: false,
        attitude1: false,
        attitude2: false
      }
    }, () => {
      this._persistWork();
      wx.showToast({ title: '已生成常用语与态度', icon: 'none' });
    });
  },

  /** 重抽未锁定：只重抽未锁定的常用语与态度 */
  onRedrawLayer3() {
    const { catchphrases, attitudes, lockedLayer3 } = this.data;
    const locked = lockedLayer3 || {};
    const allLocked =
      locked.catchphrase0 && locked.catchphrase1 && locked.catchphrase2 &&
      locked.attitude0 && locked.attitude1 && locked.attitude2;
    if (allLocked) {
      wx.showToast({ title: '请先取消至少一项的锁定', icon: 'none' });
      return;
    }
    const pools = this.getPools();
    const nextC = background.drawPartialCatchphrases(catchphrases, locked, pools);
    const nextA = background.drawPartialAttitudes(attitudes, locked, pools);
    this.setData({ catchphrases: nextC, attitudes: nextA }, () => this._persistWork());
    wx.showToast({ title: '已重抽', icon: 'none' });
  },

  onLockCatchphrase(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const locked = { ...this.data.lockedLayer3 };
    locked[key] = !locked[key];
    this.setData({ lockedLayer3: locked });
  },

  onLockAttitude(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const locked = { ...this.data.lockedLayer3 };
    locked[key] = !locked[key];
    this.setData({ lockedLayer3: locked });
  },

  onCatchphraseInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    const arr = (this.data.catchphrases || []).slice();
    arr[index] = value;
    this.setData({ catchphrases: arr });
  },

  onAttitudeInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    const arr = (this.data.attitudes || []).slice();
    if (arr[index]) arr[index] = { ...arr[index], attitude: value };
    this.setData({ attitudes: arr });
  },

  onGoOcChat() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    this._persistWork();
    wx.navigateTo({ url: '/pages/ocChat/ocChat' });
  },

  onGoOcBio() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    this._persistWork();
    wx.navigateTo({ url: '/pages/ocBio/ocBio' });
  },

  /** 生成人设图：跳转到人设逻辑图页展示 */
  onGenerateMindMap() {
    if (!this.data.result) return;
    this._persistWork();
    wx.navigateTo({ url: '/pages/mindmap/mindmap' });
  },

  onBackHome() {
    const contentOk = this._layer3ContentOk();
    const confirmed = this.data.layer3Confirmed || contentOk;
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = this.data.result;
    work.background = this.data.background;
    work.catchphrases = this.data.catchphrases;
    work.attitudes = this.data.attitudes;
    work.lockedLayer3 = this.data.lockedLayer3;
    work.layer3Done = true;
    work.layer3Confirmed = confirmed;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    if (contentOk) {
      this.setData({ layer3Confirmed: true });
    }
    wx.navigateBack({ delta: 2 });
  }
});
