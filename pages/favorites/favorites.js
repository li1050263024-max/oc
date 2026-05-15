const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_OC_WORK = 'oc_work_in_progress';

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
    let list = wx.getStorageSync(STORAGE_FAVORITES) || [];
    if (!Array.isArray(list)) list = [];
    this.setData({ list });
  },

  /** 删除某条收藏 */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    let list = (wx.getStorageSync(STORAGE_FAVORITES) || []).filter(item => item.id !== id);
    if (!Array.isArray(list)) list = [];
    wx.setStorageSync(STORAGE_FAVORITES, list);
    this.setData({ list });
    wx.showToast({ title: '已移除', icon: 'none' });
  },

  onBackHome() {
    wx.navigateBack();
  },

  /** 载入到 OC 设定本 / 进行中存档 */
  onLoadToNotebook(e) {
    const id = e.currentTarget.dataset.id;
    const list = wx.getStorageSync(STORAGE_FAVORITES) || [];
    const item = list.find((i) => i.id === id);
    if (!item || !item.result) return;
    const work = {
      result: { ...item.result },
      background: item.background ? { ...item.background } : null,
      catchphrases: (item.catchphrases || []).slice(),
      attitudes: (item.attitudes || []).map((a) => ({ ...a })),
      generatedBio: item.generatedBio || '',
      layer2Done: true,
      layer3Done: true
    };
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/ocNotebook/ocNotebook' });
  },

  /** 与该 OC 对话 */
  onChat(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/ocChat/ocChat?ocId=' + encodeURIComponent(id) });
  },

  /** 复制该条设定（含背景与态度） */
  onCopy(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const list = wx.getStorageSync(STORAGE_FAVORITES) || [];
    const item = list.find(i => i.id === id);
    if (!item || !item.result) return;
    const r = item.result;
    let lines = [
      '【OC 设定】',
      `姓名：${r.name}`,
      `种族：${r.race}`,
      `发色：${r.hairColor}`,
      `瞳色：${r.eyeColor}`,
      `性格：${r.personality}`,
      `怪癖：${r.quirk}`
    ];
    if (item.background && item.background.worldview) {
      lines.push('', '【背景故事】', `世界观：${item.background.worldview}`);
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
