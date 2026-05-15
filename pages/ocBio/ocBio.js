const { buildOcPromptFromWork } = require('../../utils/ocContext.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

Page({
  data: {
    hints: '',
    bio: '',
    loading: false
  },

  onLoad() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const hints = buildOcPromptFromWork(work);
    const patch = {};
    if (hints) patch.hints = hints;
    if (work.generatedBio) patch.bio = work.generatedBio;
    if (Object.keys(patch).length) this.setData(patch);
  },

  onShow() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.generatedBio) {
      this.setData({ bio: work.generatedBio });
    }
  },

  onHintsInput(e) {
    this.setData({ hints: e.detail.value || '' });
  },

  onGenerate() {
    if (this.data.loading) return;
    const hints = (this.data.hints || '').trim();
    if (!hints) {
      wx.showToast({ title: '请先输入设定或关键词', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });
      return;
    }

    this.setData({ loading: true, bio: '' });
    wx.showLoading({ title: '生成中…', mask: true });
    wx.cloud
      .callFunction({
        name: 'generateOcBio',
        data: { hints },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (r.ok && r.bio) {
          this.setData({ bio: r.bio });
          const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
          work.generatedBio = r.bio;
          wx.setStorageSync(STORAGE_OC_WORK, work);
        } else {
          wx.showToast({ title: r.errMsg || '生成失败', icon: 'none', duration: 3000 });
        }
      })
      .catch((err) => {
        let msg = '';
        if (typeof err === 'string') msg = err;
        else if (err) {
          msg = err.errMsg || err.message || '';
          if (!msg && typeof err.toString === 'function') msg = err.toString();
        }
        const isTimeout = /timeout|超时/i.test(msg);
        wx.showToast({
          title: isTimeout
            ? '请求超时，请缩短设定后重试，或稍后再试'
            : msg || '云函数调用失败，请检查是否已上传云函数',
          icon: 'none',
          duration: isTimeout ? 3500 : 3000
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ loading: false });
      });
  },

  onCopyBio() {
    const bio = this.data.bio;
    if (!bio) return;
    wx.setClipboardData({
      data: bio,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  }
});
