const nav = require('../../utils/nav.js');
const fakeNotify = require('../../utils/ocFakeNotify.js');
const { hasAnyOcForSocial } = require('../../utils/ocSocialEligible.js');
const { getUiThemeClass } = require('../../utils/uiTheme.js');

Component({
  options: {
    virtualHost: true
  },

  properties: {
    current: { type: String, value: '' },
    chatMode: { type: String, value: 'dm' },
    flatTop: { type: Boolean, value: false }
  },

  data: {
    uiThemeClass: '',
    badgeChat: false,
    badgeChatDm: false,
    badgeChatGroup: false,
    chatPickerOpen: false,
    tabs: [
      { key: 'home', label: '首页', icon: 'home' },
      { key: 'notebook', label: '设定本', icon: 'book' },
      { key: 'story', label: 'oc故事', icon: 'pen' },
      { key: 'chat', label: 'oc聊天', icon: 'chat' },
      { key: 'ocapp', label: 'OC APP', icon: 'ocapp' }
    ]
  },

  pageLifetimes: {
    show() {
      this._refreshBadges(true);
    }
  },

  lifetimes: {
    attached() {
      this._refreshBadges(false);
    }
  },

  methods: {
    _refreshBadges(closePicker) {
      const badges = fakeNotify.getBadges();
      const patch = {
        uiThemeClass: getUiThemeClass(),
        badgeChat: !!(badges.chat || badges.groupChat),
        badgeChatDm: !!badges.chat,
        badgeChatGroup: !!badges.groupChat
      };
      if (closePicker) patch.chatPickerOpen = false;
      this.setData(patch);
    },

    checkChatEligible() {
      if (!hasAnyOcForSocial()) {
        wx.showToast({
          title: '请先在设定本中保存 OC',
          icon: 'none',
          duration: 2800
        });
        return false;
      }
      nav.ensureLayer3WorkLoaded();
      return true;
    },

    getTabKey(e) {
      const cur = e && e.currentTarget;
      const tar = e && e.target;
      const key =
        (cur && cur.dataset && cur.dataset.key) ||
        (tar && tar.dataset && tar.dataset.key) ||
        '';
      return key;
    },

    onTabTap(e) {
      // 模拟器里 cover-view 与 view 可能各点一次，短时去重
      const now = Date.now();
      if (this._lastTabTapAt && now - this._lastTabTapAt < 280) return;
      this._lastTabTapAt = now;

      const key = this.getTabKey(e);
      if (!key) return;

      const current = this.data.current || '';

      if (key === 'chat') {
        if (!this.checkChatEligible()) return;
        // 单聊/群聊改由页面顶部 tab 切换，底部再点「oc聊天」不再弹出模式浮层
        if (current === 'chat') {
          if (this.data.chatPickerOpen) this.setData({ chatPickerOpen: false });
          return;
        }
        if (this.data.chatPickerOpen) this.setData({ chatPickerOpen: false });
        nav.switchMainTab('chat');
        return;
      }

      if (this.data.chatPickerOpen) {
        this.setData({ chatPickerOpen: false });
      }

      if (key === current) {
        if (key === 'home') nav.goHome();
        // 朋友圈/抖音子页也标成 ocapp：再点 Tab 应回到 OC APP 大厅
        if (key === 'ocapp') nav.switchMainTab('ocapp');
        return;
      }

      if (key === 'home') {
        nav.goHome();
        return;
      }

      if (key === 'story' && !nav.hasLocalOcSetting()) {
        wx.showToast({ title: '请先在设定本中保存 OC', icon: 'none', duration: 2800 });
        return;
      }
      if (key === 'ocapp' && !hasAnyOcForSocial()) {
        wx.showToast({ title: '请先在设定本中保存 OC', icon: 'none', duration: 2800 });
        return;
      }

      nav.switchMainTab(key);
    },

    onChatModeDm() {
      this._switchChatMode('dm');
    },

    onChatModeGroup() {
      this._switchChatMode('group');
    },

    onChatModeTap(e) {
      const mode =
        (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) ||
        (e && e.target && e.target.dataset && e.target.dataset.mode) ||
        '';
      this._switchChatMode(mode);
    },

    _switchChatMode(mode) {
      if (mode !== 'dm' && mode !== 'group') return;
      if (!this.checkChatEligible()) return;

      this.setData({ chatPickerOpen: false });

      const current = this.data.current || '';
      const chatMode = this.data.chatMode || 'dm';
      if (current === 'chat' && mode === chatMode) return;

      const url =
        mode === 'group' ? '/pages/ocGroupChat/ocGroupChat' : '/pages/ocChat/ocChat';
      wx.redirectTo({
        url,
        fail() {
          wx.reLaunch({ url });
        }
      });
    }
  }
});