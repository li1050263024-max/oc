const nav = require('../../utils/nav.js');
const fakeNotify = require('../../utils/ocFakeNotify.js');
const { hasAnyOcForSocial } = require('../../utils/ocSocialEligible.js');

const STORAGE_NAV_POS = 'oc_nav_panel_pos';
const STORAGE_FAB_POS = 'oc_nav_fab_pos';
const STORAGE_TUTORIAL_DONE = 'oc_nav_tutorial_done';

Component({
  properties: {
    current: { type: String, value: '' },
    defaultOpen: { type: Boolean, value: false },
    tutorial: { type: Boolean, value: false }
  },

  data: {
    popupOpen: false,
    tutorialMask: false,
    oaQrVisible: false,
    layer3Ready: false,
    hasLocalOc: false,
    hasBioOc: false,
    badgeChat: false,
    badgeGroupChat: false,
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
      this._panelW = Math.round(280 * this._winW / 750);
      this._panelH = Math.round(600 * this._winW / 750);
      this._fabSize = Math.round(72 * this._winW / 750);

      const panel = wx.getStorageSync(STORAGE_NAV_POS);
      const fab = wx.getStorageSync(STORAGE_FAB_POS);
      const patch = {
        layer3Ready: nav.checkLayer3Ready(),
        hasLocalOc: nav.hasLocalOcSetting(),
        hasBioOc: hasAnyOcForSocial(),
        badgeChat: !!fakeNotify.getBadges().chat,
        badgeGroupChat: !!fakeNotify.getBadges().groupChat
      };

      if (panel && panel.left != null) {
        patch.panelLeft = panel.left;
        patch.panelTop = panel.top;
      } else {
        patch.panelLeft = 16;
        patch.panelTop = Math.round(this._winH * 0.2);
      }
      if (fab && fab.left != null) {
        patch.fabLeft = fab.left;
        patch.fabTop = fab.top;
      } else {
        patch.fabLeft = 16;
        patch.fabTop = Math.round(this._winH * 0.36);
      }

      if (this.properties.defaultOpen && !this._didAutoOpen) {
        this._didAutoOpen = true;
        patch.popupOpen = true;
        patch.layer3Ready = nav.checkLayer3Ready();
        patch.hasLocalOc = nav.hasLocalOcSetting();
      }

      if (this.properties.tutorial && patch.popupOpen) {
        const done = wx.getStorageSync(STORAGE_TUTORIAL_DONE);
        if (!done) patch.tutorialMask = true;
      }

      this.setData(patch);
      this._emitTutorialChange(!!patch.tutorialMask);
    }
  },

  pageLifetimes: {
    show() {
      const badges = fakeNotify.getBadges();
      this.setData({
        layer3Ready: nav.checkLayer3Ready(),
        hasLocalOc: nav.hasLocalOcSetting(),
        hasBioOc: hasAnyOcForSocial(),
        badgeChat: !!badges.chat,
        badgeGroupChat: !!badges.groupChat
      });
    }
  },

  methods: {
    _emitTutorialChange(active) {
      this.triggerEvent('tutorialchange', { active: !!active });
    },

    _clampPanel(left, top) {
      const w = this._panelW || 150;
      const h = this._panelH || 300;
      return {
        left: Math.max(8, Math.min(left, this._winW - w)),
        top: Math.max(48, Math.min(top, this._winH - h))
      };
    },

    _clampFab(left, top) {
      const s = this._fabSize || 36;
      return {
        left: Math.max(8, Math.min(left, this._winW - s)),
        top: Math.max(48, Math.min(top, this._winH - s))
      };
    },

    openPopup() {
      const pos = this._clampPanel(
        this.data.fabLeft,
        this.data.fabTop + (this._fabSize || 36) + 8
      );
      const patch = {
        popupOpen: true,
        panelLeft: pos.left,
        panelTop: pos.top,
        layer3Ready: nav.checkLayer3Ready(),
        hasLocalOc: nav.hasLocalOcSetting(),
        hasBioOc: hasAnyOcForSocial(),
        badgeChat: !!fakeNotify.getBadges().chat,
        badgeGroupChat: !!fakeNotify.getBadges().groupChat
      };
      if (this.properties.tutorial) {
        const done = wx.getStorageSync(STORAGE_TUTORIAL_DONE);
        if (!done) patch.tutorialMask = true;
      }
      this.setData(patch);
      this._emitTutorialChange(!!patch.tutorialMask);
    },

    onDismissTutorial() {
      wx.setStorageSync(STORAGE_TUTORIAL_DONE, true);
      this.setData({ tutorialMask: false });
      this._emitTutorialChange(false);
    },

    onFabDragStart(e) {
      if (!e.touches || !e.touches[0]) return;
      this._fabDragged = false;
      this._fabDrag = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        origLeft: this.data.fabLeft,
        origTop: this.data.fabTop
      };
    },

    onFabDragMove(e) {
      if (!this._fabDrag || !e.touches || !e.touches[0]) return;
      const dx = e.touches[0].clientX - this._fabDrag.startX;
      const dy = e.touches[0].clientY - this._fabDrag.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        this._fabDragged = true;
      }
      const pos = this._clampFab(this._fabDrag.origLeft + dx, this._fabDrag.origTop + dy);
      // 拖动时节流，减少每帧 setData 卡顿
      this._fabPending = pos;
      if (this._fabRaf) return;
      this._fabRaf = true;
      const apply = () => {
        this._fabRaf = false;
        if (!this._fabPending) return;
        const p = this._fabPending;
        this._fabPending = null;
        this.setData({ fabLeft: p.left, fabTop: p.top });
      };
      if (typeof setTimeout === 'function') setTimeout(apply, 16);
      else apply();
    },

    onFabDragEnd() {
      if (this._fabDrag) {
        wx.setStorageSync(STORAGE_FAB_POS, {
          left: this.data.fabLeft,
          top: this.data.fabTop
        });
        if (!this._fabDragged) {
          this.openPopup();
        }
      }
      this._fabDrag = null;
      this._fabDragged = false;
    },

    onClosePopup() {
      this.setData({ popupOpen: false, tutorialMask: false });
      this._emitTutorialChange(false);
    },

    preventMove() {},

    onFollowOfficialAccount() {
      if (this._panelDragged) return;
      this.setData({
        oaQrVisible: true,
        popupOpen: false,
        tutorialMask: false
      });
      this._emitTutorialChange(false);
    },

    onOpenRedeem() {
      if (this._panelDragged) return;
      this.setData({ popupOpen: false, tutorialMask: false });
      this._emitTutorialChange(false);
      wx.navigateTo({
        url: '/pages/redeemCode/redeemCode'
      });
    },

    onOpenStorageClean() {
      if (this._panelDragged) return;
      this.setData({ popupOpen: false, tutorialMask: false });
      this._emitTutorialChange(false);
      wx.navigateTo({
        url: '/pages/ocApp/ocStorageClean/ocStorageClean',
        fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
      });
    },

    onCloseOaQr() {
      this.setData({ oaQrVisible: false });
    },

    onPanelDragStart(e) {
      if (!e.touches || !e.touches[0]) return;
      this._panelDragged = false;
      this._panelDrag = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        origLeft: this.data.panelLeft,
        origTop: this.data.panelTop
      };
    },

    onPanelDragMove(e) {
      if (!this._panelDrag || !e.touches || !e.touches[0]) return;
      const dx = e.touches[0].clientX - this._panelDrag.startX;
      const dy = e.touches[0].clientY - this._panelDrag.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        this._panelDragged = true;
      }
      const pos = this._clampPanel(this._panelDrag.origLeft + dx, this._panelDrag.origTop + dy);
      this.setData({ panelLeft: pos.left, panelTop: pos.top });
    },

    onPanelDragEnd() {
      if (this._panelDrag) {
        wx.setStorageSync(STORAGE_NAV_POS, {
          left: this.data.panelLeft,
          top: this.data.panelTop
        });
      }
      this._panelDrag = null;
      this._panelDragged = false;
    },

    onNavTap(e) {
      if (this._panelDragged) return;
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      if (key === 'story' && !nav.hasLocalOcSetting()) {
        wx.showToast({
          title: '请先生成一套 OC 设定',
          icon: 'none',
          duration: 2800
        });
        return;
      }
      if (
        (key === 'chat' || key === 'groupChat') &&
        !hasAnyOcForSocial()
      ) {
        wx.showToast({
          title: '请先在设定本中保存 OC',
          icon: 'none',
          duration: 2800
        });
        return;
      }
      if (key === 'ocapp' && !hasAnyOcForSocial()) {
        wx.showToast({
          title: '请先在设定本中保存 OC',
          icon: 'none',
          duration: 2800
        });
        return;
      }
      if (key === 'bio' && !nav.checkLayer3Ready()) {
        wx.showToast({
          title: '请补全 3 条常用语与态度（抽卡或设定本）',
          icon: 'none',
          duration: 2800
        });
        return;
      }
      if (this.data.tutorialMask) {
        wx.setStorageSync(STORAGE_TUTORIAL_DONE, true);
        this.setData({ tutorialMask: false });
        this._emitTutorialChange(false);
      }
      const result = nav.goTo(key);
      if (result === 'same') {
        this.setData({ popupOpen: false });
        if (key === 'index') this.triggerEvent('home');
        return;
      }
      if (result === 'navigated' || result === true) {
        this.setData({ popupOpen: false });
        if (key === 'index') this.triggerEvent('home');
      }
    }
  }
});
