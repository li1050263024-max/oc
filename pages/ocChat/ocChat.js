const { buildChatSystemPrompt } = require('../../utils/ocContext.js');

const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_OC_WORK = 'oc_work_in_progress';
const STORAGE_CHAT_PREFIX = 'oc_chat_';

function workFromFavorite(item) {
  return {
    result: item.result ? { ...item.result } : null,
    background: item.background ? { ...item.background } : null,
    catchphrases: (item.catchphrases || []).slice(),
    attitudes: (item.attitudes || []).map((a) => ({ ...a })),
    generatedBio: item.generatedBio || ''
  };
}

Page({
  data: {
    ocList: [],
    selectedId: '',
    selectedName: '',
    messages: [],
    inputText: '',
    loading: false,
    scrollTo: ''
  },

  onLoad(options) {
    this._pendingOcId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    this.refreshOcList();
  },

  onShow() {
    this.refreshOcList();
  },

  refreshOcList() {
    const list = [];
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.result && String(work.result.name || '').trim()) {
      list.push({
        id: '__work__',
        name: work.result.name || '进行中 OC',
        work
      });
    }
    const favs = wx.getStorageSync(STORAGE_FAVORITES) || [];
    if (Array.isArray(favs)) {
      favs.forEach((item) => {
        if (!item || !item.result) return;
        list.push({
          id: item.id,
          name: item.result.name || '未命名',
          work: workFromFavorite(item)
        });
      });
    }
  const selectedId = this.data.selectedId;
    const pending = this._pendingOcId;
    if (pending) this._pendingOcId = '';
    let pickId = selectedId;
    if (pending && list.some((x) => x.id === pending)) {
      pickId = pending;
    } else if (!list.some((x) => x.id === pickId) && list.length) {
      pickId = list[0].id;
    }
    const pick = list.find((x) => x.id === pickId);
    const patch = {
      ocList: list,
      selectedId: pick ? pick.id : '',
      selectedName: pick ? pick.name : ''
    };
    this.setData(patch, () => {
      if (patch.selectedId) this.loadChatHistory(patch.selectedId);
    });
  },

  getSelectedWork() {
    const item = (this.data.ocList || []).find((x) => x.id === this.data.selectedId);
    return item ? item.work : null;
  },

  loadChatHistory(ocId) {
    const key = STORAGE_CHAT_PREFIX + ocId;
    const messages = wx.getStorageSync(key) || [];
    this.setData({
      messages: Array.isArray(messages) ? messages : [],
      scrollTo: 'chat-bottom'
    });
  },

  onSelectOc(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.ocList || []).find((x) => x.id === id);
    if (!item) return;
    this.setData({
      selectedId: id,
      selectedName: item.name,
      messages: [],
      inputText: ''
    });
    this.loadChatHistory(id);
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value || '' });
  },

  onSend() {
    if (this.data.loading) return;
    const text = (this.data.inputText || '').trim();
    if (!text) return;
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const work = this.getSelectedWork();
    if (!work || !work.result) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });
      return;
    }

    const userMsg = { role: 'user', content: text };
    const history = (this.data.messages || []).slice();
    const messages = history.concat([userMsg]);
    this.setData({ messages, inputText: '', loading: true, scrollTo: 'chat-bottom' });
    wx.showLoading({ title: '思考中…', mask: true });

    const systemPrompt = buildChatSystemPrompt(work);
    wx.cloud
      .callFunction({
        name: 'ocChat',
        data: {
          systemPrompt,
          userMessage: text,
          history
        },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (r.ok && r.reply) {
          const next = messages.concat([{ role: 'assistant', content: r.reply }]);
          const id = this.data.selectedId;
          this.setData({ messages: next, scrollTo: 'chat-bottom' }, () => {
            if (id) wx.setStorageSync(STORAGE_CHAT_PREFIX + id, next);
          });
        } else {
          wx.showToast({ title: r.errMsg || '回复失败', icon: 'none', duration: 3000 });
          this.setData({ messages: history });
        }
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || '调用失败';
        wx.showToast({ title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg, icon: 'none' });
        this.setData({ messages: history });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ loading: false });
      });
  },

  onClearChat() {
    if (!this.data.selectedId) return;
    wx.showModal({
      title: '清空对话',
      content: '确定清空与该 OC 的聊天记录？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ messages: [] });
        wx.removeStorageSync(STORAGE_CHAT_PREFIX + this.data.selectedId);
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  }
});
