const background = require('../../utils/background.js');
const defaultPools = require('../../data/pools.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';
const STORAGE_CUSTOM_POOLS = 'oc_custom_pools';

Page({
  data: {
    result: null,
    background: null,
    lockedBackground: { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false },
    cardFlipped: false
  },

  onLoad() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.result) {
      this.setData({
        result: work.result,
        background: work.background || null,
        lockedBackground: work.lockedBackground || { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false },
        cardFlipped: false
      });
    } else {
      wx.showToast({ title: '请先完成基础设定', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  /** 翻开卡牌：若尚未生成则先自动生成，再翻转并直接显示结果 */
  onFlipCard() {
    if (!this.data.background) {
      const pools = this.getPools();
      const bg = background.drawBackgroundStory(pools);
      this.setData({
        background: bg,
        lockedBackground: { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false },
        cardFlipped: true
      });
    } else {
      this.setData({ cardFlipped: true });
    }
  },

  getPools() {
    const custom = wx.getStorageSync(STORAGE_CUSTOM_POOLS);
    if (custom && Array.isArray(custom.names)) return custom;
    return defaultPools;
  },

  onGenerateBackground() {
    const pools = this.getPools();
    const bg = background.drawBackgroundStory(pools);
    this.setData({
      background: bg,
      lockedBackground: { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false }
    });
    wx.showToast({ title: '已生成背景故事', icon: 'none' });
  },

  onBackgroundInput(e) {
    const { key, index } = e.currentTarget.dataset;
    const value = e.detail.value || '';
    const bg = this.data.background;
    if (!bg) return;
    if (key === 'worldview') {
      this.setData({ 'background.worldview': value });
    } else if (index !== undefined && index !== '' && bg.lifeEvents) {
      const i = typeof index === 'number' ? index : parseInt(index, 10);
      if (isNaN(i)) return;
      const lifeEvents = bg.lifeEvents.slice();
      lifeEvents[i] = value;
      this.setData({ 'background.lifeEvents': lifeEvents });
    }
  },

  onLockBackground(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const locked = { ...this.data.lockedBackground };
    locked[key] = !locked[key];
    this.setData({ lockedBackground: locked });
  },

  onRedrawBackground() {
    const { background: bg, lockedBackground: locked } = this.data;
    if (!bg) return;
    const pools = this.getPools();
    const next = background.drawPartialBackground(bg, locked, pools);
    this.setData({ background: next });
    wx.showToast({ title: '已重抽', icon: 'none' });
  },

  onGoNext() {
    const { result, background: bg } = this.data;
    if (!result) return;
    if (!bg || !bg.worldview) {
      wx.showToast({ title: '请先生成背景故事', icon: 'none' });
      return;
    }
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = result;
    work.background = bg;
    work.lockedBackground = this.data.lockedBackground;
    work.layer2Done = true;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/attitude/attitude' });
  }
});
