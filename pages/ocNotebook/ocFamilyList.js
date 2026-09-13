const ocImage = require('../../utils/ocImage.js');
const notebookFamily = require('../../utils/ocNotebookFamily.js');
const { getFavorites, getFavoriteById } = require('../../utils/favorite.js');
const { normalizeResult } = require('../../utils/ocResult.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');
const staticAssets = require('../../utils/staticAssets.js');

const COLS = 4;

Page({
  data: {
    families: [],
    expandedFamilyIds: {},
    draggingKey: '',
    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder(),
    uiThemeClass: ''
  },

  onLoad() {
    syncPageTheme(this);
    applyPageGradientBg();
    this.loadFamilies();
  },

  onShow() {
    syncPageTheme(this);
    applyPageGradientBg();
    this.loadFamilies();
  },

  loadFamilies() {
    const byId = {};
    getFavorites().forEach((item) => {
      if (!item || !item.id) return;
      const r = normalizeResult(item.result || {});
      byId[item.id] = {
        id: item.id,
        name: (r.name && String(r.name).trim()) || '未命名',
        ocImagePath: ocImage.getDisplayImagePathQuick(item)
      };
    });
    const families = notebookFamily.getFamilies().map((f) => {
      const members = (f.memberIds || []).map((id) => byId[id]).filter(Boolean);
      return {
        id: f.id,
        name: f.name,
        count: members.length,
        familyPinned: !!f.familyPinned,
        members
      };
    });
    this.setData({ families });
  },

  onCreateFamily() {
    wx.showModal({
      title: '新建 OC 家族',
      editable: true,
      placeholderText: '输入家族名称',
      success: (res) => {
        if (!res.confirm) return;
        const r = notebookFamily.createFamily(res.content);
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '创建失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已创建', icon: 'success' });
        this.loadFamilies();
      }
    });
  },

  onToggleFamilyPin(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const r = notebookFamily.toggleFamilyPinned(id);
    if (!r.ok) {
      wx.showToast({ title: r.errMsg || '操作失败', icon: 'none' });
      return;
    }
    wx.showToast({
      title: r.familyPinned ? '已置顶' : '已取消置顶',
      icon: 'none'
    });
    this.loadFamilies();
  },

  onToggleFamilyExpand(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const expandedFamilyIds = Object.assign({}, this.data.expandedFamilyIds);
    expandedFamilyIds[id] = !expandedFamilyIds[id];
    this.setData({ expandedFamilyIds });
  },

  onRenameFamily(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    if (!id) return;
    wx.showModal({
      title: '重命名 OC 家族',
      editable: true,
      placeholderText: '输入新名称',
      content: name,
      success: (res) => {
        if (!res.confirm) return;
        const r = notebookFamily.renameFamily(id, res.content);
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '重命名失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已重命名', icon: 'success' });
        this.loadFamilies();
      }
    });
  },

  onDeleteFamily(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该家族';
    if (!id) return;
    wx.showModal({
      title: '删除家族',
      content: '确定删除「' + name + '」？仅移除分类，不会删除其中的 OC。',
      confirmText: '删除',
      confirmColor: '#c62828',
      success: (res) => {
        if (!res.confirm) return;
        if (!notebookFamily.deleteFamily(id)) {
          wx.showToast({ title: '删除失败', icon: 'none' });
          return;
        }
        const expandedFamilyIds = Object.assign({}, this.data.expandedFamilyIds);
        delete expandedFamilyIds[id];
        this.setData({ expandedFamilyIds });
        wx.showToast({ title: '已删除', icon: 'none' });
        this.loadFamilies();
      }
    });
  },

  onOpenOc(e) {
    if (this._memberDrag && this._memberDrag.moved) return;
    const id = e.currentTarget.dataset.id;
    if (!id || !getFavoriteById(id)) {
      wx.showToast({ title: '未找到该 OC', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/ocProfileDetail/ocProfileDetail?id=' + encodeURIComponent(id)
    });
  },

  onMemberLongPress(e) {
    const ds = e.currentTarget.dataset || {};
    const familyId = String(ds.familyId || '');
    const ocId = String(ds.id || '');
    const index = Number(ds.index);
    if (!familyId || !ocId || Number.isNaN(index)) return;

    this._memberDrag = {
      familyId,
      ocId,
      fromIndex: index,
      index,
      moved: false,
      name: ds.name || '该 OC',
      grid: null
    };
    this.setData({ draggingKey: familyId + ':' + ocId });
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (_) {}

    const count = this._memberCount(familyId);
    const rows = Math.max(1, Math.ceil(count / COLS));
    const query = wx.createSelectorQuery().in(this);
    query.select('#famGrid_' + familyId).boundingClientRect();
    query.exec((res) => {
      if (!this._memberDrag || this._memberDrag.familyId !== familyId) return;
      const rect = res && res[0];
      if (!rect || !rect.width || !rect.height) return;
      this._memberDrag.grid = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        cellW: rect.width / COLS,
        cellH: rect.height / rows
      };
    });
  },

  _memberCount(familyId) {
    const fam = (this.data.families || []).find((f) => f.id === familyId);
    return fam && fam.members ? fam.members.length : 0;
  },

  _indexFromTouch(touch) {
    const drag = this._memberDrag;
    if (!drag || !drag.grid || !touch) return -1;
    const g = drag.grid;
    const x = touch.clientX - g.left;
    const y = touch.clientY - g.top;
    if (x < 0 || y < 0 || x > g.width) return -1;
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(x / g.cellW)));
    const row = Math.max(0, Math.floor(y / g.cellH));
    const idx = row * COLS + col;
    const count = this._memberCount(drag.familyId);
    if (idx < 0 || idx >= count) return -1;
    return idx;
  },

  onMemberTouchMove(e) {
    const drag = this._memberDrag;
    if (!drag) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    // 网格尺寸未就绪时，用相对位移粗略换位
    let toIndex = this._indexFromTouch(touch);
    if (toIndex < 0) return;
    if (toIndex === drag.index) return;

    drag.moved = true;
    const families = (this.data.families || []).slice();
    const fIdx = families.findIndex((f) => f.id === drag.familyId);
    if (fIdx < 0) return;
    const fam = Object.assign({}, families[fIdx]);
    const members = (fam.members || []).slice();
    if (drag.index < 0 || drag.index >= members.length || toIndex >= members.length) return;
    const [picked] = members.splice(drag.index, 1);
    members.splice(toIndex, 0, picked);
    fam.members = members;
    fam.count = members.length;
    families[fIdx] = fam;
    drag.index = toIndex;
    this.setData({ families });
  },

  onMemberTouchEnd() {
    const drag = this._memberDrag;
    if (!drag) return;
    this._memberDrag = null;
    this.setData({ draggingKey: '' });

    if (drag.moved) {
      const fam = (this.data.families || []).find((f) => f.id === drag.familyId);
      if (!fam) return;
      const ids = (fam.members || []).map((m) => m.id);
      const r = notebookFamily.setFamilyMembers(drag.familyId, ids);
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '排序失败', icon: 'none' });
        this.loadFamilies();
        return;
      }
      return;
    }

    // 长按后未拖动：移出家族
    const familyId = drag.familyId;
    const ocId = drag.ocId;
    const name = drag.name || '该 OC';
    wx.showModal({
      title: '移出家族',
      content: '确定将「' + name + '」移出该家族？不会删除设定本中的 OC。',
      confirmText: '移出',
      confirmColor: '#c62828',
      success: (res) => {
        if (!res.confirm) return;
        const r = notebookFamily.removeMemberFromFamily(familyId, ocId);
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '移除失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已移出家族', icon: 'none' });
        this.loadFamilies();
      }
    });
  }
});
