Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '分享' },
    content: { type: String, value: '' }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onCopy() {
      const text = String(this.data.content || '').trim();
      if (!text) {
        wx.showToast({ title: '无内容可复制', icon: 'none' });
        return;
      }
      wx.setClipboardData({
        data: text.slice(0, 50000),
        success: () => wx.showToast({ title: '已复制', icon: 'success' })
      });
    }
  }
});
