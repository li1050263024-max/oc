Component({
  properties: {
    visible: { type: Boolean, value: false },
    detectedClick: { type: Boolean, value: false },
    makeupDone: { type: Boolean, value: false },
    makeupBusy: { type: Boolean, value: false },
    rounds: { type: Number, value: 30 }
  },

  data: {
    canClaim: false
  },

  observers: {
    'visible, detectedClick, makeupDone': function (visible, detected, makeup) {
      this.setData({
        canClaim: !!(visible && (detected || makeup))
      });
    }
  },

  methods: {
    onPanelTap() {},
    onMakeup() {
      if (this.data.makeupBusy || this.data.makeupDone || this.data.detectedClick) return;
      this.triggerEvent('makeup');
    },
    onClaim() {
      if (!this.data.canClaim) {
        wx.showToast({ title: '请先完成补点并点击广告', icon: 'none' });
        return;
      }
      this.triggerEvent('claim');
    },
    onClose() {
      this.triggerEvent('close');
    }
  }
});
