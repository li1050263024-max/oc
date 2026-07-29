Component({
  properties: {
    visible: { type: Boolean, value: false },
    shareLeft: { type: Number, value: 0 },
    oaVisible: { type: Boolean, value: false }
  },

  methods: {
    onMaskTap() {
      this.triggerEvent('close');
    },
    onPanelTap() {},
    onShare() {
      if (Number(this.data.shareLeft) <= 0) {
        wx.showToast({ title: '今日分享次数已用完', icon: 'none' });
        return;
      }
      this.triggerEvent('share');
    },
    onRedeem() {
      this.triggerEvent('redeem');
    },
    onFollowOa() {
      this.triggerEvent('followoa');
    },
    onCloseOa() {
      this.triggerEvent('closeoa');
    },
    onCancel() {
      this.triggerEvent('close');
    }
  }
});
