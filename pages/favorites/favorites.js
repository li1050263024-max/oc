const STORAGE_FAVORITES = 'oc_favorites';
const { loadFavoriteToWork } = require('../../utils/favorite.js');
const { normalizeResult, personalityBlend, quirkBlend } = require('../../utils/ocResult.js');

Page({
  data: {
    list: []
  },

  onLoad() {
    this.loadList();
  },

  onShow() {
    this.loadList();
  },

  loadList() {
    const { getFavorites } = require('../../utils/favorite.js');
    let list = getFavorites();
    if (!Array.isArray(list)) list = [];
    list = list.map((item) => {
      const r = normalizeResult(item.result || {});
      return {
        ...item,
        result: r,
        personalityText: personalityBlend(r) || '—',
        quirkText: quirkBlend(r) || '—'
      };
    });
    this.setData({ list });
  },

  /** 删除某条收藏 */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const { deleteFavoriteItem } = require('../../utils/favorite.js');
    const ok = deleteFavoriteItem(id);
    if (!ok) {
      wx.showToast({
        title: '删除失败：本地存储不足',
        icon: 'none',
        duration: 2800
      });
      this.loadList();
      return;
    }
    this.loadList();
    wx.showToast({ title: '已移除', icon: 'none' });
  },

  onBackHome() {
    wx.navigateBack();
  },

  /** 载入到 OC 设定详情页 */
  onLoadToNotebook(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: '/pages/ocNotebookEdit/ocNotebookEdit?id=' + encodeURIComponent(id)
    });
  },

  /** 查看 / 生成 OC 小传 */
  onViewBio(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const work = loadFavoriteToWork(id);
    if (!work) {
      wx.showToast({ title: '未找到该收藏', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/ocBioHub/ocBioHub?ocId=' + encodeURIComponent(id) });
  },

  /** 与该 OC 对话 */
  onChat(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const { ensureOcIdBioForChat } = require('../../utils/ocChatGate.js');
    if (!ensureOcIdBioForChat(id)) return;
    wx.navigateTo({ url: '/pages/ocChat/ocChat?ocId=' + encodeURIComponent(id) });
  },

  /** 复制该条设定（含背景与态度） */
  onCopy(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const list = wx.getStorageSync(STORAGE_FAVORITES) || [];
    const item = list.find(i => i.id === id);
    if (!item || !item.result) return;
    const r = normalizeResult(item.result);
    let lines = [
      '【OC 设定】',
      `姓名：${r.name}`,
      `种族：${r.race}`,
      `性别：${r.gender}`,
      `年龄：${r.age}`,
      `发色：${r.hairColor}`,
      `瞳色：${r.eyeColor}`,
      `性格：${personalityBlend(r)}`,
      r.likes ? `喜欢：${r.likes}` : '',
      `怪癖：${quirkBlend(r)}`
    ];
    if (item.background && item.background.worldview) {
      lines.push('', '【背景故事】', `世界观：${item.background.worldview}`);
      (item.background.origins || []).forEach((ev, i) => {
        if (ev) lines.push(`身世设定${i + 1}：${ev}`);
      });
      (item.background.lifeEvents || []).forEach((ev, i) => lines.push(`人生大事件${i + 1}：${ev}`));
    }
    if (item.catchphrases && item.catchphrases.length) {
      lines.push('', '【常用语】', ...item.catchphrases);
    }
    if (item.attitudes && item.attitudes.length) {
      lines.push('', '【态度】');
      item.attitudes.forEach(a => lines.push(`${a.event} → ${a.attitude}`));
    }
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  }
});
