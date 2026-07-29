const colors = require('../../utils/colors.js');
const ocImage = require('../../utils/ocImage.js');
const chatBackground = require('../../utils/chatBackground.js');
const { getFavorites, loadFavoriteToWork, deleteFavoriteItem, deleteFavoriteItems, getFavoriteById, consolidateFavoriteDuplicatesByName } = require('../../utils/favorite.js');
const { isLayer3Ready } = require('../../utils/ocWork.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { normalizeResult, personalityBlend } = require('../../utils/ocResult.js');
const nav = require('../../utils/nav.js');
const packPage = require('../../utils/ocPackPage.js');
const inAppShare = require('../../utils/inAppSharePage.js');
const {
  buildOcFullPack,
  buildNotebookPack,
  buildSettingShareText,
  buildOcFullShareText,
  buildNotebookShareText
} = require('../../utils/ocPack.js');
const { buildChatListRailStyle } = require('../../utils/wxNavSafe.js');
const staticAssets = require('../../utils/staticAssets.js');

Page({
  data: {
    list: [],
    expandedOcIds: {},
    manageMode: false,
    selectedMap: {},
    selectedCount: 0,
    toolbarFloatStyle: '',
    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder(),
    ...inAppShare.shareSheetDefaults()
  },

  _updateToolbarLayout() {
    this.setData({ toolbarFloatStyle: buildChatListRailStyle() });
  },

  onLoad() {
    applyPageGradientBg();
    inAppShare.bindSharePage(this);
    this._updateToolbarLayout();
    this.loadList();
  },

  onShow() {
    applyPageGradientBg();
    this._updateToolbarLayout();
    if (this._importPending || packPage.isPickBusy()) return;
    this.loadList();
  },

  async loadList() {
    if (this._loadingList) {
      this._reloadQueued = true;
      return;
    }
    this._loadingList = true;
    try {
      try {
        consolidateFavoriteDuplicatesByName();
      } catch (e) {}
      const raw = getFavorites();
      // 先同步渲染，避免等文件系统扫描导致白屏/卡顿
      const list = raw.map((item) => {
        const r = normalizeResult(item.result || {});
        return {
          id: item.id,
          name: (r.name && String(r.name).trim()) || '未命名',
          race: r.race || '—',
          hairColor: r.hairColor || '—',
          eyeColor: r.eyeColor || '—',
          gender: r.gender || '—',
          age: r.age || '—',
          personality: personalityBlend(r) || '—',
          quirk: (r.quirks || []).filter(Boolean).join('、') || '—',
          hairHex: colors.getHairColor(r.hairColor),
          eyeHex: colors.getEyeColor(r.eyeColor),
          ocImagePath: ocImage.getDisplayImagePathQuick(item),
          layer3Ready: isLayer3Ready(item)
        };
      });
      const expanded = this.data.expandedOcIds || {};
      const expandedOcIds = {};
      list.forEach((item) => {
        if (expanded[item.id]) expandedOcIds[item.id] = true;
      });
      const selectedMap = {};
      let selectedCount = 0;
      if (this.data.manageMode) {
        const prev = this.data.selectedMap || {};
        list.forEach((item) => {
          if (prev[item.id]) {
            selectedMap[item.id] = true;
            selectedCount += 1;
          }
        });
      }
      this.setData({
        list,
        expandedOcIds,
        selectedMap,
        selectedCount,
        manageMode: this.data.manageMode && list.length > 0 ? this.data.manageMode : false
      });
    } catch (err) {
      console.error('[ocNotebook] loadList', err);
    } finally {
      this._loadingList = false;
      if (this._reloadQueued) {
        this._reloadQueued = false;
        this.loadList();
      }
    }
  },

  onAddOc() {
    if (this.data.manageMode) return;
    wx.navigateTo({ url: '/pages/ocNotebookEdit/ocNotebookEdit?mode=new' });
  },

  onCardTap(e) {
    if (this.data.manageMode) {
      this.onToggleSelectOc(e);
      return;
    }
    this.onOpenOc(e);
  },

  onOpenOc(e) {
    if (this.data.manageMode) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: '/pages/ocProfileDetail/ocProfileDetail?id=' + encodeURIComponent(id)
    });
  },

  onToggleManageMode() {
    if (this.data.manageMode) {
      this.setData({ manageMode: false, selectedMap: {}, selectedCount: 0 });
      return;
    }
    if (!(this.data.list || []).length) {
      wx.showToast({ title: '暂无 OC 可管理', icon: 'none' });
      return;
    }
    this.setData({ manageMode: true, selectedMap: {}, selectedCount: 0, expandedOcIds: {} });
  },

  onToggleSelectOc(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || !this.data.manageMode) return;
    const selectedMap = Object.assign({}, this.data.selectedMap);
    if (selectedMap[id]) delete selectedMap[id];
    else selectedMap[id] = true;
    let selectedCount = 0;
    Object.keys(selectedMap).forEach(() => {
      selectedCount += 1;
    });
    this.setData({ selectedMap, selectedCount });
  },

  onSelectAllOc() {
    if (!this.data.manageMode) return;
    const list = this.data.list || [];
    if (!list.length) return;
    if (this.data.selectedCount >= list.length) {
      this.setData({ selectedMap: {}, selectedCount: 0 });
      return;
    }
    const selectedMap = {};
    list.forEach((item) => {
      if (item && item.id) selectedMap[item.id] = true;
    });
    this.setData({ selectedMap, selectedCount: list.length });
  },

  onBatchDeleteOc() {
    if (!this.data.manageMode) return;
    const ids = Object.keys(this.data.selectedMap || {}).filter(Boolean);
    if (!ids.length) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量删除',
      content: '确定删除已选的 ' + ids.length + ' 名 OC？此操作不可恢复。',
      confirmText: '删除',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const fav = getFavoriteById(id);
            if (fav && Array.isArray(fav.ocImages)) {
              await ocImage.removeOcImageFiles(fav.ocImages);
            }
            await ocImage.removeAllFavoriteOcImages(id);
            await chatBackground.removeChatBackground(id);
          }
          deleteFavoriteItems(ids);
          this.setData({ manageMode: false, selectedMap: {}, selectedCount: 0 });
          wx.showToast({ title: '已删除 ' + ids.length + ' 项', icon: 'none' });
          this.loadList();
        } catch (err) {
          console.error('[ocNotebook] batch delete', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  onToggleOcCard(e) {
    if (this.data.manageMode) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const key = 'expandedOcIds.' + id;
    this.setData({
      [key]: !this.data.expandedOcIds[id]
    });
  },

  _loadWorkById(id) {
    const work = loadFavoriteToWork(id);
    if (!work) {
      wx.showToast({ title: '未找到该 OC', icon: 'none' });
      return null;
    }
    return work;
  },

  onOcChat(e) {
    const id = e.currentTarget.dataset.id;
    const work = this._loadWorkById(id);
    if (!work) return;
    if (!isLayer3Ready(work)) {
      wx.showToast({ title: '请先补全常用语与态度', icon: 'none' });
      return;
    }
    const { revealOcInChatList } = require('../../utils/ocChatList.js');
    revealOcInChatList(id);
    const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
    if (!workHasBio(work)) {
      ensureOcBioForChat(work, id);
      return;
    }
    wx.navigateTo({
      url:
        '/pages/ocChat/ocChat?ocId=' +
        encodeURIComponent(id) +
        '&newSession=1'
    });
  },

  onOcGroupChat(e) {
    const id = e.currentTarget.dataset.id;
    const work = this._loadWorkById(id);
    if (!work) return;
    if (!isLayer3Ready(work)) {
      wx.showToast({ title: '请先补全常用语与态度', icon: 'none' });
      return;
    }
    const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
    if (!workHasBio(work)) {
      ensureOcBioForChat(work, id);
      return;
    }
    wx.navigateTo({
      url:
        '/pages/ocGroupChat/ocGroupChat?phase=pick&preselect=' +
        encodeURIComponent(id)
    });
  },

  onOcBio(e) {
    const id = e.currentTarget.dataset.id;
    if (!this._loadWorkById(id)) return;
    wx.navigateTo({ url: '/pages/ocBioHub/ocBioHub?ocId=' + encodeURIComponent(id) });
  },

  onOcStory(e) {
    const id = e.currentTarget.dataset.id;
    if (!this._loadWorkById(id)) return;
    nav.goTo('story');
  },

  onDeleteOc(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = (this.data.list || []).find((x) => x.id === id);
    const name = (item && item.name) || '该角色';
    wx.showModal({
      title: '删除 OC',
      content: '确定从设定本移除「' + name + '」？此操作不可恢复。',
      confirmText: '删除',
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
        this.loadList();
      }
    });
  },

  onExportNotebook() {
    packPage.runExportMenu({
      baseName: 'oc_notebook',
      getText: () => buildNotebookShareText(),
      getPack: () => buildNotebookPack()
    });
  },

  onImportNotebook() {
    this._importPending = true;
    packPage.runImportPack(
      {
        onFinish: () => {
          this._importPending = false;
        }
      },
      () => {
        this._importPending = false;
        this.loadList();
      }
    );
  },

  onExportOc(e) {
    const id = e.currentTarget.dataset.id;
    const item = getFavoriteById(id);
    if (!item) {
      wx.showToast({ title: '导出失败', icon: 'none' });
      return;
    }
    const name = (item.result && item.result.name) || 'oc';
    packPage.runExportMenu({
      baseName: name + '_full',
      getText: () => buildOcFullShareText(id),
      getPack: () => buildOcFullPack(id)
    });
  },

  onShareOc(e) {
    const id = e.currentTarget.dataset.id;
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
  }
});
