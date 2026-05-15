const defaultPools = require('../../data/pools.js');
const STORAGE_CUSTOM_POOLS = 'oc_custom_pools';

const POOL_KEYS = [
  { key: 'names', label: '姓名' },
  { key: 'races', label: '种族' },
  { key: 'hairColors', label: '发色' },
  { key: 'eyeColors', label: '瞳色' },
  { key: 'personalities', label: '性格' },
  { key: 'quirks', label: '怪癖' }
];

function clonePools(p) {
  return {
    names: (p.names || []).slice(),
    races: (p.races || []).slice(),
    hairColors: (p.hairColors || []).slice(),
    eyeColors: (p.eyeColors || []).slice(),
    personalities: (p.personalities || []).slice(),
    quirks: (p.quirks || []).slice()
  };
}

function makeSections(pools) {
  return POOL_KEYS.map(({ key, label }) => ({
    key,
    label,
    list: (pools[key] || []).slice(),
    newVal: ''
  }));
}

Page({
  data: {
    sections: makeSections(defaultPools)
  },

  onLoad() {
    this.loadPools();
  },

  loadPools() {
    const custom = wx.getStorageSync(STORAGE_CUSTOM_POOLS);
    const pools = (custom && Array.isArray(custom.names)) ? clonePools(custom) : clonePools(defaultPools);
    this.setData({ sections: makeSections(pools) });
  },

  /** 输入新选项 */
  onNewInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value || '';
    const sections = this.data.sections.map(s => s.key === key ? { ...s, newVal: value } : s);
    this.setData({ sections });
  },

  /** 添加选项 */
  onAdd(e) {
    const key = e.currentTarget.dataset.key;
    const sections = this.data.sections;
    const sec = sections.find(s => s.key === key);
    if (!sec) return;
    const trimmed = (sec.newVal || '').trim();
    if (!trimmed) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    if (sec.list.indexOf(trimmed) >= 0) {
      wx.showToast({ title: '已存在该选项', icon: 'none' });
      return;
    }
    const newList = sec.list.concat(trimmed);
    const newSections = sections.map(s => s.key === key ? { ...s, list: newList, newVal: '' } : s);
    this.setData({ sections: newSections });
    this._saveSectionsToStorage(newSections);
  },

  /** 删除选项 */
  onDelete(e) {
    const key = e.currentTarget.dataset.key;
    const index = e.currentTarget.dataset.index;
    const sections = this.data.sections.map(s => {
      if (s.key !== key) return s;
      return { ...s, list: s.list.filter((_, i) => i !== index) };
    });
    this.setData({ sections });
    this._saveSectionsToStorage(sections);
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  _saveSectionsToStorage(sections) {
    const pools = {};
    sections.forEach(s => { pools[s.key] = s.list; });
    wx.setStorageSync(STORAGE_CUSTOM_POOLS, pools);
  },

  /** 恢复默认 */
  onReset() {
    wx.showModal({
      title: '恢复默认',
      content: '将清除当前自定义选项，恢复为默认选项池，是否继续？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(STORAGE_CUSTOM_POOLS);
          this.loadPools();
          wx.showToast({ title: '已恢复默认', icon: 'success' });
        }
      }
    });
  }
});
