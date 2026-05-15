const colors = require('../../utils/colors.js');
const STORAGE_OC_WORK = 'oc_work_in_progress';

function defaultResult() {
  return {
    name: '',
    race: '',
    hairColor: '',
    eyeColor: '',
    personality: '',
    quirk: ''
  };
}

function defaultBackground() {
  return { worldview: '', lifeEvents: ['', '', ''] };
}

function defaultCatchphrases() {
  return ['', '', ''];
}

function defaultAttitudes() {
  return [
    { event: '', attitude: '' },
    { event: '', attitude: '' },
    { event: '', attitude: '' }
  ];
}

function mergeWork(raw) {
  const r = raw && raw.result ? { ...defaultResult(), ...raw.result } : defaultResult();
  const bgIn = raw && raw.background;
  const bg = bgIn
    ? {
        worldview: bgIn.worldview || '',
        lifeEvents: (bgIn.lifeEvents || ['', '', '']).slice(0, 3)
      }
    : defaultBackground();
  while (bg.lifeEvents.length < 3) bg.lifeEvents.push('');
  let cp = (raw && raw.catchphrases) || [];
  cp = cp.slice(0, 3);
  while (cp.length < 3) cp.push('');
  let ad = (raw && raw.attitudes) || [];
  ad = ad.slice(0, 3).map((a) => ({
    event: (a && a.event) || '',
    attitude: (a && a.attitude) || ''
  }));
  while (ad.length < 3) ad.push({ event: '', attitude: '' });
  return {
    result: r,
    background: bg,
    catchphrases: cp,
    attitudes: ad,
    generatedBio: (raw && raw.generatedBio) || ''
  };
}

Page({
  data: {
    result: defaultResult(),
    background: defaultBackground(),
    catchphrases: defaultCatchphrases(),
    attitudes: defaultAttitudes(),
    generatedBio: '',
    hairHex: '#4a4a4a',
    eyeHex: '#37474f'
  },

  onLoad() {
    this.loadFromStorage();
  },

  onShow() {
    this.loadFromStorage();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.generatedBio && work.generatedBio !== this.data.generatedBio) {
      this.setData({ generatedBio: work.generatedBio });
    }
  },

  loadFromStorage() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const m = mergeWork(work);
    const hairHex = colors.getHairColor(m.result.hairColor);
    const eyeHex = colors.getEyeColor(m.result.eyeColor);
    this.setData({
      result: m.result,
      background: m.background,
      catchphrases: m.catchphrases,
      attitudes: m.attitudes,
      generatedBio: m.generatedBio || '',
      hairHex,
      eyeHex
    });
  },

  persistPartial(patch) {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, patch);
    wx.setStorageSync(STORAGE_OC_WORK, work);
  },

  onResultInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value || '';
    if (!key) return;
    const result = { ...this.data.result, [key]: value };
    const upd = { result };
    if (key === 'hairColor') upd.hairHex = colors.getHairColor(value);
    if (key === 'eyeColor') upd.eyeHex = colors.getEyeColor(value);
    this.setData(upd);
    this.persistPartial({ result });
  },

  onBgWorldview(e) {
    const background = { ...this.data.background, worldview: e.detail.value || '' };
    this.setData({ background });
    this.persistPartial({ background });
  },

  onLifeEvent(e) {
    const index = Number(e.currentTarget.dataset.index);
    const value = e.detail.value || '';
    const lifeEvents = (this.data.background.lifeEvents || []).slice();
    lifeEvents[index] = value;
    const background = { ...this.data.background, lifeEvents };
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

  _workSnapshot() {
    return {
      result: { ...this.data.result },
      background: {
        worldview: this.data.background.worldview,
        lifeEvents: (this.data.background.lifeEvents || []).slice()
      },
      catchphrases: (this.data.catchphrases || []).slice(),
      attitudes: (this.data.attitudes || []).map((a) => ({ ...a })),
      generatedBio: this.data.generatedBio || ''
    };
  },

  onSaveNotebook() {
    const snap = this._workSnapshot();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = snap.result;
    work.background = snap.background;
    work.catchphrases = snap.catchphrases;
    work.attitudes = snap.attitudes;
    work.generatedBio = snap.generatedBio;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onGoMindmap() {
    const snap = this._workSnapshot();
    if (!String(snap.result.name || '').trim()) {
      wx.showToast({ title: '请先填写至少姓名', icon: 'none' });
      return;
    }
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = snap.result;
    work.background = snap.background;
    work.catchphrases = snap.catchphrases;
    work.attitudes = snap.attitudes;
    work.generatedBio = snap.generatedBio;
    work.layer2Done = true;
    work.layer3Done = true;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/mindmap/mindmap' });
  },

  onGoOcBio() {
    const snap = this._workSnapshot();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    Object.assign(work, snap);
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/ocBio/ocBio' });
  }
});
