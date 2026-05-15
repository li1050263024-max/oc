const nav = require('../../utils/nav.js');

const STORAGE_NAV_POS = 'oc_nav_panel_pos';
const STORAGE_FAB_POS = 'oc_nav_fab_pos';

Component({
  properties: {
    current: {
      type: String,
      value: ''
    }
  },

  data: {
    popupOpen: false,
    layer3Ready: false,
    panelLeft: 16,
    panelTop: 120,
    fabLeft: 16,
    fabTop: 200
  },

  lifetimes: {
    attached() {
      const sys = wx.getSystemInfoSync();
      this._winW = sys.windowWidth;
      this._winH = sys.windowHeight;
      const panel = wx.getStorageSync(STORAGE_NAV_POS);
      const fab = wx.getStorageSync(STORAGE_FAB_POS);
      const patch = { layer3Ready: nav.checkLayer3Ready() };
      if (panel && panel.left != null) {
        patch.panelLeft = panel.left;
        patch.panelTop = panel.top;
      } else {
        patch.panelLeft = 16;
        patch.panelTop = Math.round(this._winH * 0.22);
      }
      if (fab && fab.left != null) {
        patch.fabLeft = fab.left;
        patch.fabTop = fab.top;
      } else {
        patch.fabLeft = 16;
        patch.fabTop = Math.round(this._winH * 0.38);
      }
      this.setData(patch);
    }
  },

  pageLifetimes: {
    show() {
      this.setData({ layer3Ready: nav.checkLayer3Ready() });
    }
  },

  methods: {
    preventBubble() {},

    onTogglePopup() {
      const next = !this.data.popupOpen;
      if (next) {
        this.setData({
          popupOpen: true,
          layer3Ready: nav.checkLayer3Ready()
        });
        if (this.data.panelLeft == null) {
          this.setData({
            panelLeft: this.data.fabLeft,
            panelTop: Math.min(this.data.fabTop + 56, this._winH - 320)
          });
        }
      } else {
        this.setData({ popupOpen: false });
      }
    },

    onClosePopup() {
      this.setData({ popupOpen: false });
    },

    onNavTap(e) {
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      if ((key === 'chat' || key === 'bio') && !nav.checkLayer3Ready()) {
        wx.showToast({
          title: '请先在「语言与态度」生成常用语与态度',
          icon: 'none',
          duration: 2800
        });
        return;
      }
      const result = nav.goTo(key);
      if (result === 'same') {
        this.setData({ popupOpen: false });
        if (key === 'index') {
          this.triggerEvent('home');
        }
        return;
      }
      if (result) {
        this.setData({ popupOpen: false });
      }
    },

    onDragStart(e) {
      if (!e.touches || !e.touches[0]) return;
      this._drag = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        origLeft: this.data.panelLeft,
        origTop: this.data.panelTop
      };
    },

    onDragMove(e) {
      if (!this._drag || !e.touches || !e.touches[0]) return;
      const dx = e.touches[0].clientX - this._drag.startX;
      const dy = e.touches[0].clientY - this._drag.startY;
      const panelW = 150;
      const panelH = 300;
      let left = this._drag.origLeft + dx;
      let top = this._drag.origTop + dy;
      left = Math.max(8, Math.min(left, this._winW - panelW));
      top = Math.max(72, Math.min(top, this._winH - panelH));
      this.setData({ panelLeft: left, panelTop: top });
    },

    onDragEnd() {
      if (this._drag) {
        wx.setStorageSync(STORAGE_NAV_POS, {
          left: this.data.panelLeft,
          top: this.data.panelTop
        });
      }
      this._drag = null;
    }
  }
});
