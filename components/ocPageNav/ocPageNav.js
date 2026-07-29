const { getWxNavSafeInsets } = require('../../utils/wxNavSafe.js');

Component({
  properties: {
    /** 覆盖默认顶栏高度（px）；0 表示使用胶囊 bottom + 8 */
    height: {
      type: Number,
      value: 0
    }
  },

  data: {
    totalNavHeight: 20,
    capsulePaddingRight: 12
  },

  observers: {
    height() {
      this.applyNavHeight();
    }
  },

  lifetimes: {
    attached() {
      this.applyNavHeight();
    }
  },

  methods: {
    applyNavHeight() {
      const insets = getWxNavSafeInsets();
      const override = Number(this.properties.height) || 0;
      const totalNavHeight = override > 0 ? Math.round(override) : insets.topHeight;
      this.setData({
        totalNavHeight,
        capsulePaddingRight: insets.capsulePaddingRight
      });
      this.triggerEvent('safechange', Object.assign({}, insets, { topHeight: totalNavHeight }));
    }
  }
});
