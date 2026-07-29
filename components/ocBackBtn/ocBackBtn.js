const { buildChatListRailStyle } = require('../../utils/wxNavSafe.js');
const nav = require('../../utils/nav.js');

Component({
  properties: {
    home: { type: Boolean, value: false },
    custom: { type: Boolean, value: false },
    label: { type: String, value: '返回' }
  },

  data: {
    railStyle: ''
  },

  lifetimes: {
    attached() {
      this._updateLayout();
    }
  },

  pageLifetimes: {
    show() {
      this._updateLayout();
    }
  },

  methods: {
    _updateLayout() {
      this.setData({ railStyle: buildChatListRailStyle() });
    },

    onTap() {
      this.triggerEvent('back');
      if (this.properties.custom) return;
      if (this.properties.home) {
        nav.goHome();
        return;
      }
      wx.navigateBack({
        delta: 1,
        fail: () => nav.goHome()
      });
    }
  }
});
