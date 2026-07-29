const feedbackStore = require('../../utils/feedbackStore.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

Page({
  data: {
    content: '',
    submitting: false,
    records: [],
    loadingRecords: false
  },

  onShow() {
    applyPageGradientBg();
    this.loadRecords();
  },

  loadRecords() {
    const local = feedbackStore.mapRecordsForDisplay(feedbackStore.getRecords());
    this.setData({ records: local });
    if (!wx.cloud) return;
    this.setData({ loadingRecords: true });
    wx.cloud
      .callFunction({ name: 'listMyFeedback' })
      .then((res) => {
        const r = res.result || {};
        if (r.ok && Array.isArray(r.list)) {
          const synced = feedbackStore.syncFromCloud(r.list);
          this.setData({
            records: feedbackStore.mapRecordsForDisplay(synced)
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        this.setData({ loadingRecords: false });
      });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value || '' });
  },

  onSubmit() {
    const content = (this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });
    wx.cloud
      .callFunction({
        name: 'submitFeedback',
        data: { content }
      })
      .then((res) => {
        const r = res.result || {};
        if (r.ok) {
          feedbackStore.addRecord({
            cloudId: r.id,
            content,
            timeMs: Date.now(),
            status: 'unread',
            reply: '',
            replyTimeMs: 0
          });
          wx.showToast({ title: '感谢反馈', icon: 'success' });
          this.setData({ content: '' });
          this.loadRecords();
        } else {
          wx.showToast({ title: r.err || '提交失败', icon: 'none', duration: 3200 });
        }
      })
      .catch(() => {
        wx.showToast({ title: '提交失败，请检查云函数', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});
