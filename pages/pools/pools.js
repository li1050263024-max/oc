const defaultPools = require('../../data/pools.js');

const poolsLoader = require('../../utils/poolsLoader.js');

const aiGacha = require('../../utils/aiGacha.js');
const nav = require('../../utils/nav.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');



const STORAGE_POOL_HIDDEN = poolsLoader.STORAGE_POOL_HIDDEN;



const POOL_META = [

  { key: 'names', label: '姓名', group: 'basic' },

  { key: 'races', label: '种族', group: 'basic' },

  { key: 'genders', label: '性别', group: 'basic' },

  { key: 'ages', label: '年龄', group: 'basic' },

  { key: 'hairColors', label: '发色', group: 'basic' },

  { key: 'eyeColors', label: '瞳色', group: 'basic' },

  { key: 'personalities', label: '性格', group: 'basic' },

  { key: 'likes', label: '喜欢的东西', group: 'basic' },

  { key: 'quirks', label: '怪癖', group: 'basic' },

  { key: 'worldviews', label: '世界观', group: 'extra' },

  { key: 'lifeEvents', label: '人生大事件', group: 'extra' },
  { key: 'origins', label: '身世设定', group: 'extra' },

  { key: 'catchphrases', label: '常用语', group: 'extra' },

  { key: 'presetEvents', label: '预设事件', group: 'extra' },

  { key: 'attitudes', label: '态度', group: 'extra' }

];



function loadHiddenMap() {

  const raw = wx.getStorageSync(STORAGE_POOL_HIDDEN);

  return raw && typeof raw === 'object' ? raw : {};

}



function saveHiddenMap(map) {

  wx.setStorageSync(STORAGE_POOL_HIDDEN, map || {});

}



function hiddenKey(poolKey, text) {

  return `${poolKey}::${text}`;

}



function makeSections(pools, hiddenMap, batchSelected) {

  return POOL_META.map(({ key, label, group }) => {

    const list = (pools[key] || []).slice();

    const indices = batchSelected[key] || [];

    const selSet = new Set(indices);

    const listView = list.map((text, i) => ({

      text,

      i,

      selected: selSet.has(i),

      hidden: !!hiddenMap[hiddenKey(key, text)]

    }));

    return {

      key,

      label,

      group,

      list,

      listView,

      expanded: false,

      allSelected: list.length > 0 && indices.length === list.length,

      newVal: '',

      aiTheme: '',

      aiLoading: false

    };

  });

}



function sectionsToPools(sections) {

  const pools = {};

  sections.forEach((s) => {

    pools[s.key] = s.list.slice();

  });

  return pools;

}



function countSelected(batchSelected) {

  let n = 0;

  Object.keys(batchSelected).forEach((k) => {

    n += (batchSelected[k] || []).length;

  });

  return n;

}



Page({

  data: {

    sections: [],

    expandAllLoading: false,

    batchMode: false,

    batchSelected: {},

    batchSelectedCount: 0,

    hiddenMap: {}

  },



  onLoad() {
    applyPageGradientBg();
    this.loadPools();
  },

  onShow() {
    applyPageGradientBg();
  },

  onBackHome() {
    nav.goHome();
  },



  loadPools(useDefaultOnly) {

    const pools = useDefaultOnly

      ? poolsLoader.getDefaultPools()

      : poolsLoader.getFullPools();

    const hiddenMap = useDefaultOnly ? {} : loadHiddenMap();

    this._rawSections = makeSections(pools, hiddenMap, {});

    this.setData({

      hiddenMap,

      batchMode: false,

      batchSelected: {},

      batchSelectedCount: 0

    });

    this._applySections(this._rawSections, {});

  },



  _applySections(sections, batchSelected, opts) {
    const options = opts || {};
    const collapseAll = !!options.collapseAll;
    const expandAll = !!options.expandAll;

    const hiddenMap = this.data.hiddenMap || loadHiddenMap();

    const enriched = makeSections(sectionsToPools(sections), hiddenMap, batchSelected);

    enriched.forEach((sec) => {
      const prev = sections.find((s) => s.key === sec.key);

      if (prev) {
        if (collapseAll) {
          sec.expanded = false;
        } else if (expandAll) {
          sec.expanded = true;
        } else {
          sec.expanded = !!prev.expanded;
        }

        sec.newVal = prev.newVal || '';

        sec.aiTheme = prev.aiTheme || '';

        sec.aiLoading = !!prev.aiLoading;
      } else if (collapseAll) {
        sec.expanded = false;
      } else if (expandAll) {
        sec.expanded = true;
      }
    });

    if (collapseAll) {
      enriched.forEach((sec) => {
        sec.expanded = false;
      });
    } else if (expandAll) {
      enriched.forEach((sec) => {
        sec.expanded = true;
      });
    }

    this._rawSections = enriched.map((s) => ({

      key: s.key,

      label: s.label,

      group: s.group,

      list: s.list.slice(),

      expanded: s.expanded,

      newVal: s.newVal,

      aiTheme: s.aiTheme,

      aiLoading: s.aiLoading

    }));

    const setObj = {
      sections: enriched,
      batchSelected,
      batchSelectedCount: countSelected(batchSelected)
    };
    if (options.extraSetData && typeof options.extraSetData === 'object') {
      Object.assign(setObj, options.extraSetData);
    }
    this.setData(setObj);
  },



  onToggleBatchMode() {
    const batchMode = !this.data.batchMode;

    if (batchMode) {
      const batchSelected = this.data.batchSelected || {};
      const collapsed = (this.data.sections || this._rawSections || []).map((s) => ({
        ...s,
        expanded: false
      }));
      this._applySections(collapsed, batchSelected, {
        collapseAll: true,
        extraSetData: { batchMode: true }
      });
      wx.showToast({ title: '可多选后删除', icon: 'none' });
      return;
    }

    const collapsed = (this.data.sections || this._rawSections || []).map((s) => ({
      ...s,
      expanded: false
    }));
    this._applySections(collapsed, {}, {
      collapseAll: true,
      extraSetData: {
        batchMode: false,
        batchSelected: {},
        batchSelectedCount: 0
      }
    });
  },



  onToggleSectionExpand(e) {

    const key = e.currentTarget.dataset.key;

    const sections = this._rawSections.map((s) =>

      s.key === key ? { ...s, expanded: !s.expanded } : s

    );

    this._applySections(sections, this.data.batchSelected);

  },



  onToggleItemHidden(e) {

    const key = e.currentTarget.dataset.key;

    const index = Number(e.currentTarget.dataset.index);

    const sec = this._rawSections.find((s) => s.key === key);

    if (!sec || index < 0 || index >= sec.list.length) return;

    const text = sec.list[index];

    const map = { ...this.data.hiddenMap };

    const hk = hiddenKey(key, text);

    if (map[hk]) {

      delete map[hk];

    } else {

      map[hk] = true;

    }

    saveHiddenMap(map);

    this.setData({ hiddenMap: map });

    this._applySections(this._rawSections, this.data.batchSelected);

  },



  onToggleItemSelect(e) {

    const key = e.currentTarget.dataset.key;

    const index = Number(e.currentTarget.dataset.index);

    const batchSelected = { ...this.data.batchSelected };

    const arr = (batchSelected[key] || []).slice();

    const pos = arr.indexOf(index);

    if (pos >= 0) {

      arr.splice(pos, 1);

    } else {

      arr.push(index);

      arr.sort((a, b) => a - b);

    }

    if (arr.length) {

      batchSelected[key] = arr;

    } else {

      delete batchSelected[key];

    }

    this._applySections(this._rawSections, batchSelected);

  },



  onSectionSelectAll(e) {

    const key = e.currentTarget.dataset.key;

    const sec = this._rawSections.find((s) => s.key === key);

    if (!sec || !sec.list.length) return;

    const batchSelected = { ...this.data.batchSelected };

    const indices = this.data.batchSelected[key] || [];

    const allOn = indices.length === sec.list.length;

    if (allOn) {

      delete batchSelected[key];

    } else {

      batchSelected[key] = sec.list.map((_, i) => i);

    }

    this._applySections(this._rawSections, batchSelected);

  },



  onBatchSelectAll() {

    const batchSelected = {};

    this._rawSections.forEach((s) => {

      if (s.list.length) {

        batchSelected[s.key] = s.list.map((_, i) => i);

      }

    });

    this._applySections(this._rawSections, batchSelected);

  },



  onBatchSelectNone() {

    this._applySections(this._rawSections, {});

  },



  onBatchDeleteSelected() {

    const count = this.data.batchSelectedCount;

    if (!count) {

      wx.showToast({ title: '请先选择选项', icon: 'none' });

      return;

    }

    wx.showModal({

      title: '删除选中',

      content: `确定删除已选的 ${count} 项？`,

      success: (res) => {

        if (!res.confirm) return;

        const batchSelected = this.data.batchSelected;

        const hiddenMap = { ...this.data.hiddenMap };

        let sections = this._rawSections.map((s) => {

          const indices = batchSelected[s.key];

          if (!indices || !indices.length) return s;

          const removeSet = new Set(indices);

          const nextList = s.list.filter((text, i) => {

            if (!removeSet.has(i)) return true;

            delete hiddenMap[hiddenKey(s.key, text)];

            return false;

          });

          return { ...s, list: nextList };

        });

        saveHiddenMap(hiddenMap);

        this.setData({ hiddenMap, batchSelected: {}, batchSelectedCount: 0 });

        this._saveSectionsToStorage(sections);

        this._applySections(sections, {});

        wx.showToast({ title: `已删除 ${count} 项`, icon: 'success' });

      }

    });

  },



  onNewInput(e) {

    const key = e.currentTarget.dataset.key;

    const value = e.detail.value || '';

    this._rawSections = this._rawSections.map((s) =>

      s.key === key ? { ...s, newVal: value } : s

    );

    this._applySections(this._rawSections, this.data.batchSelected);

  },



  onAiThemeInput(e) {

    const key = e.currentTarget.dataset.key;

    const value = e.detail.value || '';

    this._rawSections = this._rawSections.map((s) =>

      s.key === key ? { ...s, aiTheme: value } : s

    );

    this._applySections(this._rawSections, this.data.batchSelected);

  },



  onAdd(e) {

    const key = e.currentTarget.dataset.key;

    const sec = this._rawSections.find((s) => s.key === key);

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

    const sections = this._rawSections.map((s) =>

      s.key === key ? { ...s, list: s.list.concat(trimmed), newVal: '', expanded: true } : s

    );

    this._saveSectionsToStorage(sections);

    this._applySections(sections, this.data.batchSelected);

  },



  onDelete(e) {

    const key = e.currentTarget.dataset.key;

    const index = Number(e.currentTarget.dataset.index);

    const hiddenMap = { ...this.data.hiddenMap };

    const sections = this._rawSections.map((s) => {

      if (s.key !== key) return s;

      const text = s.list[index];

      if (text) delete hiddenMap[hiddenKey(key, text)];

      return { ...s, list: s.list.filter((_, i) => i !== index) };

    });

    saveHiddenMap(hiddenMap);

    this.setData({ hiddenMap });

    this._saveSectionsToStorage(sections);

    this._applySections(sections, this.data.batchSelected);

    wx.showToast({ title: '已删除', icon: 'none' });

  },



  _saveSectionsToStorage(sections) {

    poolsLoader.saveCustomPools(sectionsToPools(sections));

  },



  _setSectionLoading(key, loading) {

    this._rawSections = this._rawSections.map((s) =>

      s.key === key ? { ...s, aiLoading: loading } : s

    );

    this._applySections(this._rawSections, this.data.batchSelected);

  },



  onAiExpand(e) {

    const key = e.currentTarget.dataset.key;

    const sec = this._rawSections.find((s) => s.key === key);

    if (!sec || sec.aiLoading || this.data.expandAllLoading) return;



    this._setSectionLoading(key, true);

    wx.showLoading({ title: '生成中…', mask: true });



    aiGacha

      .expandPool(key, sec.label, sec.list, sec.aiTheme || '', 8)

      .then((items) => {

        const sections = this._rawSections.map((s) => {

          if (s.key !== key) return { ...s, aiLoading: false };

          const set = new Set(s.list);

          items.forEach((t) => set.add(t));

          return { ...s, list: Array.from(set), aiLoading: false, expanded: true };

        });

        this._saveSectionsToStorage(sections);

        this._applySections(sections, this.data.batchSelected);

        wx.showToast({ title: `已添加 ${items.length} 项`, icon: 'success' });

      })

      .catch((err) => {

        this._setSectionLoading(key, false);

        wx.showToast({

          title: (err && err.message) || '生成失败',

          icon: 'none',

          duration: 2800

        });

      })

      .finally(() => wx.hideLoading());

  },



  onAiExpandAll() {

    if (this.data.expandAllLoading) return;

    wx.showModal({

      title: '丰富全部',

      content: '将为全部 11 个维度各补充约 8 条新选项（需联网，耗时约 1～2 分钟），是否继续？',

      success: (res) => {

        if (!res.confirm) return;

        this._runExpandAll();

      }

    });

  },



  async _runExpandAll() {

    this.setData({ expandAllLoading: true });

    wx.showLoading({ title: '正在丰富…', mask: true });

    let sections = this._rawSections.slice();

    let added = 0;



    for (let i = 0; i < POOL_META.length; i++) {

      const { key, label } = POOL_META[i];

      const sec = sections.find((s) => s.key === key);

      if (!sec) continue;

      wx.showLoading({ title: `丰富${label}…`, mask: true });

      try {

        const items = await aiGacha.expandPool(key, label, sec.list, sec.aiTheme || '', 6);

        const set = new Set(sec.list);

        items.forEach((t) => set.add(t));

        added += items.length;

        sections = sections.map((s) =>

          s.key === key ? { ...s, list: Array.from(set), aiLoading: false } : s

        );

        this._applySections(sections, this.data.batchSelected);

      } catch (e) {

        /* 单维失败继续 */

      }

    }



    wx.hideLoading();

    this.setData({ expandAllLoading: false });

    this._saveSectionsToStorage(sections);

    wx.showToast({

      title: added ? `共添加约 ${added} 项` : '部分维度失败',

      icon: added ? 'success' : 'none'

    });

  },



  onReset() {

    wx.showModal({

      title: '恢复默认',

      content: '将清除当前自定义选项，恢复为默认选项池，是否继续？',

      success: (res) => {

        if (res.confirm) {

          poolsLoader.resetToDefaults();

          this.loadPools(true);

          wx.showToast({ title: '已恢复默认', icon: 'success' });

        }

      }

    });

  }

});

