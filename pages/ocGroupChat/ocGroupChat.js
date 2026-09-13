const { exportChatLongImage } = require('../../utils/chatSnapshot.js');
const { buildOcChatList, resolveFavoriteId, dedupeChatMembers } = require('../../utils/ocChatList.js');
const {
  loadGroupScenario,
  saveGroupScenario,
  scenarioFromStory,
  migrateGroupScenarioLegacy
} = require('../../utils/chatScenario.js');
const { getStoriesFromItem } = require('../../utils/storyStore.js');
const { getFavoriteById } = require('../../utils/favorite.js');
const {
  roomIdFromMemberIds,
  pickGroupSpeakers,
  callMemberReply
} = require('../../utils/groupChat.js');
const {
  MONEY_TYPE_RED,
  MONEY_TYPE_TRANSFER,
  MONEY_PRESETS_RED,
  MONEY_PRESETS_TRANSFER,
  RED_PACKET_MAX,
  normalizeMoneyAmount,
  formatMoneyAmount,
  isMoneyMessage,
  claimOcMoneyMessage,
  rejectOcMoneyMessage,
  shouldAllowProactiveMoney
} = require('../../utils/chatGames.js');
const {
  MONEY_MODE_NORMAL,
  MONEY_MODE_LUCKY,
  MONEY_MODE_TARGETED,
  createGroupMoneySend,
  buildGroupMoneyDecideUserMessage,
  applyGroupMoneyMemberReact,
  withGroupMoneyProactiveRules,
  withGroupMoneyReplyRules,
  buildGroupMoneyAwareMessages
} = require('../../utils/groupMoney.js');
const dragTrash = require('../../utils/panelDragTrash.js');
const {
  listGroupRooms,
  registerRoom,
  getRoomMeta,
  removeRoom,
  listSessions,
  getMessages,
  setMessages,
  createGroupSession,
  renameGroupSession,
  renameRoomTitle,
  deleteGroupSession,
  deleteGroupSessionsBatch,
  resolveMembersFromMeta
} = require('../../utils/groupChatStore.js');
const avatarPage = require('../../utils/chatAvatarPage.js');
const bgPage = require('../../utils/chatBackgroundPage.js');
const fakeNotify = require('../../utils/ocFakeNotify.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { getModalConfirmColor, syncPageTheme } = require('../../utils/uiTheme.js');
const { getWxNavSafeInsets, buildChatListRailStyle, buildSegmentNavStyle } = require('../../utils/wxNavSafe.js');
const {
  prepareMessagesForDisplay,
  stampOutgoingMessage,
  findPrecedingUserMessage,
  stripMessageUiFields
} = require('../../utils/chatMessageUi.js');
const {
  ensureAiChatAllowed,
  recordAiChatRound,
  consumeQuotaShareIfPending,
  buildQuotaShareMessage,
  buildQuotaHint,
  syncExtraRoundsFromServer,
  flushQuotaToCloud,
  onQuotaSheetShare,
  onQuotaSheetAd,
  onQuotaSheetRedeem,
  onQuotaSheetFollowOa,
  onQuotaSheetCloseOa,
  onQuotaSheetClose,
  QUOTA_CHANNEL_GROUP
} = require('../../utils/aiChatQuota.js');
const { ensureCloudReady } = require('../../utils/cloudInit.js');

const MAX_MEMBERS = 4;

Page({
  data: Object.assign(
    {
      ocPanelOpen: true,
    panelCompact: false,
    panelMode: 'rooms',
    groupRooms: [],
    ocList: [],
    selectedMap: {},
    selectedCount: 0,
    members: [],
    roomId: '',
    roomTitle: '',
    sessionId: '',
    sessionTitle: '',
    messages: [],
    inputText: '',
    loading: false,
    loadingSpeaker: '',
    scrollTo: '',
    scenario: null,
    scenarioTitle: '',
    scenarioPreviewBlocks: [],
    sessionPickerOpen: false,
    sessionManageMode: false,
    sessionSelectedIds: [],
    sessionList: [],
    storyImportVisible: false,
    storyImportTitle: '',
    storyImportBlocks: [],
    dragging: false,
    dragId: '',
    dragLabel: '',
    dragX: 0,
    dragY: 0,
    trashHighlight: false,
    renameVisible: false,
    renameInput: '',
    renameTargetSessionId: '',
    renameMode: 'session',
    savingImage: false,
    snapshotCanvasOn: false,
    msgMenuIndex: -1,
    chatMoreOpen: false,
    quotaUsed: 0,
    quotaLeft: 0,
    quotaSheetVisible: false,
    quotaSheetShareLeft: 0,
    isVip: false,
    adClaimSheetVisible: false,
    adClaimDetectedClick: false,
    adClaimMakeupDone: false,
    adClaimMakeupBusy: false,
    adClaimRounds: 30,
    composerToolsOpen: false,
    moneySheetVisible: false,
    moneySheetType: 'red_packet',
    moneySheetTitle: '发红包',
    moneyAmountInput: '6.66',
    moneyPresets: MONEY_PRESETS_RED,
    moneyMode: 'normal',
    moneyModeOptions: [
      { key: 'normal', label: '普通' },
      { key: 'lucky', label: '拼手气' },
      { key: 'targeted', label: '指定' }
    ],
    moneyTargetMap: {},
    moneyTargetCount: 0,
    moneyCanPickTargets: false,
    capsulePadRight: 96,
    listRailStyle: '',
    segmentNavStyle: '',
    uiThemeClass: '',
    chatModeOptions: [
      { key: 'dm', label: '单聊' },
      { key: 'group', label: '群聊' }
    ]
    },
    avatarPage.avatarEditDefaults(),
    bgPage.bgEditDefaults()
  ),

  onLoad(options) {
    applyPageGradientBg();
    syncPageTheme(this);
    const insets = getWxNavSafeInsets();
    this.setData({
      capsulePadRight: insets.capsulePaddingRight,
      listRailStyle: buildChatListRailStyle(insets),
      segmentNavStyle: buildSegmentNavStyle(insets)
    });
    this._bgContext = 'group';
    this._openRoomId = options && options.roomId ? decodeURIComponent(options.roomId) : '';
    this._pendingNewSession = !!(
      options && (options.newSession === '1' || options.newSession === true)
    );
    if (options && options.phase === 'pick') {
      const pre = options.preselect ? decodeURIComponent(options.preselect) : '';
      const selectedMap = pre ? { [pre]: true } : {};
      this.setData({
        panelMode: 'pick',
        selectedMap,
        selectedCount: pre ? 1 : 0,
        ocPanelOpen: true
      });
    }
    this._refreshRooms();
    this.refreshPickList();
    if (this._openRoomId) {
      const rid = this._openRoomId;
      this._openRoomId = '';
      this._enterRoom(rid, this._pendingNewSession);
      this._pendingNewSession = false;
    }
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    } catch (_) {}
  },

  onShow() {
    applyPageGradientBg();
    syncPageTheme(this);
    this.setData({
      listRailStyle: buildChatListRailStyle(),
      segmentNavStyle: buildSegmentNavStyle()
    });
    this._refreshQuotaBadge();
    if (this._pickingAvatar || this._pickingBackground) return;
    this._refreshRooms();
    if (this.data.panelMode === 'pick') {
      this.refreshPickList();
    }
    if (this.data.roomId) {
      avatarPage.refreshGroupChatAvatars(this);
      bgPage.refreshChatBackground(this);
      if ((this.data.messages || []).length) {
        this._syncMessages(stripMessageUiFields(this.data.messages), false);
      }
    }
  },

  onChatSegmentChange(e) {
    if (e.detail && e.detail.key === 'dm') {
      wx.redirectTo({
        url: '/pages/ocChat/ocChat',
        fail() {
          wx.reLaunch({ url: '/pages/ocChat/ocChat' });
        }
      });
    }
  },

  _refreshQuotaBadge() {
    let isVip = false;
    try {
      isVip = require('../../utils/ocMembership.js').isMember();
    } catch (_) {}
    const hint = buildQuotaHint(QUOTA_CHANNEL_GROUP);
    this.setData({
      quotaUsed: hint.used,
      quotaLeft: hint.left,
      isVip: isVip
    });
    syncExtraRoundsFromServer()
      .then(() => flushQuotaToCloud())
      .then(() => {
        const next = buildQuotaHint(QUOTA_CHANNEL_GROUP);
        this.setData({
          quotaUsed: next.used,
          quotaLeft: next.left
        });
      });
  },

  onTapQuotaBadge() {
    wx.navigateTo({ url: '/pages/redeemCode/redeemCode' });
  },

  _recordQuotaRound() {
    recordAiChatRound(QUOTA_CHANNEL_GROUP);
    const hint = buildQuotaHint(QUOTA_CHANNEL_GROUP);
    this.setData({
      quotaUsed: hint.used,
      quotaLeft: hint.left
    });
  },

  _refreshRooms() {
    const unreadSet = {};
    (fakeNotify.getBadges().groupRoomIds || []).forEach((id) => {
      if (id) unreadSet[id] = true;
    });
    const groupRooms = listGroupRooms().map((room) =>
      Object.assign({}, room, { hasUnread: !!unreadSet[room.roomId] })
    );
    this.setData({ groupRooms, unreadRoomIds: fakeNotify.getBadges().groupRoomIds || [] });
  },

  refreshPickList() {
    const list = buildOcChatList();
    const selectedMap = this.data.selectedMap || {};
    let selectedCount = 0;
    Object.keys(selectedMap).forEach(() => selectedCount++);
    this.setData({ ocList: list, selectedCount });
  },

  onTogglePanelList() {
    if (this.data.panelMode === 'pick') {
      this.setData({ panelMode: 'rooms', panelCompact: false });
      return;
    }
    this.setData({ panelCompact: !this.data.panelCompact });
  },

  onStartPickMembers() {
    this.setData({
      panelMode: 'pick',
      selectedMap: {},
      selectedCount: 0,
      panelCompact: false,
      ocPanelOpen: true
    });
    this.refreshPickList();
  },

  onCancelPick() {
    this.setData({ panelMode: 'rooms' });
  },

  onCollapseOcPanel() {
    this.setData({ ocPanelOpen: false });
  },

  onOpenOcPanel() {
    this.setData({ ocPanelOpen: true });
  },

  onToggleOcPanelFromHead() {
    if (this.data.ocPanelOpen) {
      this.onCollapseOcPanel();
    } else {
      this.onOpenOcPanel();
    }
  },

  onCardLongPress(e) {
    if (this.data.panelMode === 'pick') return;
    dragTrash.startDrag(this, e);
  },

  onDragMove(e) {
    dragTrash.moveDrag(this, e);
  },

  onDragEnd() {
    dragTrash.endDrag(this, (id, label) => this._confirmTrashDropRoom(id, label));
  },

  onLayoutTouchMove(e) {
    if (this.data.dragging) this.onDragMove(e);
  },

  onLayoutTouchEnd() {
    if (this.data.dragging) this.onDragEnd();
  },

  onAvatarTouchStart(e) {
    avatarPage.onAvatarTouchStart(this, e);
  },

  onAvatarTouchMove(e) {
    avatarPage.onAvatarTouchMove(this, e);
  },

  onAvatarTouchMoveBlock(e) {
    avatarPage.onAvatarTouchMoveBlock(this, e);
  },

  onAvatarTouchEnd() {
    avatarPage.onAvatarTouchEnd(this);
  },

  onAvatarPressTouchStart(e) {
    avatarPage.onAvatarPressTouchStart(this, e);
  },

  onAvatarPressTouchEnd() {
    avatarPage.onAvatarPressTouchEnd(this);
  },

  onAvatarTap(e) {
    avatarPage.onAvatarTap(this, e);
  },

  onComposerGroupAvatarTap() {
    avatarPage.onComposerGroupAvatarTap(this);
  },

  onAvatarLongPress(e) {
    avatarPage.onAvatarLongPress(this, e);
  },

  _confirmTrashDropRoom(roomId, title) {
    const label = title || '…';
    wx.showModal({
      title: '…',
      content: '确定删除「' + label + '」吗？',
      confirmText: '确定',
      confirmColor: '#b91c1c',
      success: (res) => {
        if (!res.confirm) return;
        removeRoom(roomId);
        const patch = { sessionPickerOpen: false };
        if (this.data.roomId === roomId) {
          Object.assign(patch, {
            roomId: '',
            roomTitle: '',
            members: [],
            sessionId: '',
            sessionTitle: '',
            messages: [],
            scenario: null,
            scenarioTitle: '',
            scenarioPreviewBlocks: [],
            chatBackgroundUrl: ''
          });
        }
        this.setData(patch);
        this._refreshRooms();
        wx.showToast({ title: '…', icon: 'none' });
      }
    });
  },

  onSelectRoom(e) {
    if (this.data.dragging || this._dragMoved) {
      this._dragMoved = false;
      return;
    }
    const roomId = e.currentTarget.dataset.id;
    if (!roomId) return;
    this._enterRoom(roomId, false);
  },

  _syncMessages(rawMessages, persist) {
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    const members = this.data.members || [];
    const normalized = avatarPage.normalizeGroupMessages(members, rawMessages);
    const prepared = prepareMessagesForDisplay(normalized);
    this.setData({ messages: prepared.list, msgMenuIndex: -1 });
    if (persist && roomId && sessionId) {
      setMessages(roomId, sessionId, stripMessageUiFields(prepared.list));
    }
    return prepared.list;
  },

  _clearChatLoadingWatch() {
    if (this._chatLoadingWatch) {
      clearTimeout(this._chatLoadingWatch);
      this._chatLoadingWatch = null;
    }
  },

  _setChatLoading(on, loadingSpeaker) {
    this._clearChatLoadingWatch();
    if (!on) {
      this.setData({ loading: false, loadingSpeaker: '', scrollTo: 'group-chat-bottom' });
      return;
    }
    this.setData({
      loading: true,
      loadingSpeaker: loadingSpeaker || '',
      scrollTo: 'group-chat-bottom'
    });
    this._chatLoadingWatch = setTimeout(() => {
      this._chatLoadingWatch = null;
      if (!this.data.loading) return;
      this.setData({ loading: false, loadingSpeaker: '', scrollTo: 'group-chat-bottom' });
      wx.showToast({ title: '…', icon: 'none' });
    }, 65000);
  },

  onUnload() {
    this._clearChatLoadingWatch();
  },

  _enterRoom(roomId, forceNewSession) {
    fakeNotify.clearGroupBadgeForRoom(roomId);
    const meta = getRoomMeta(roomId);
    if (!meta) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const ocList = buildOcChatList();
    let members = resolveMembersFromMeta(meta, ocList);
    members = dedupeChatMembers(members).filter((m) => m.work);
    if (members.length < 2) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    let sessionId = meta.activeSessionId;
    if (forceNewSession) {
      sessionId = createGroupSession(roomId, '…');
    } else if (!sessionId) {
      const sessions = listSessions(roomId);
      sessionId = (sessions[0] && sessions[0].id) || createGroupSession(roomId, '…');
    }
    migrateGroupScenarioLegacy(roomId, sessionId);
    const scenario = loadGroupScenario(roomId, sessionId);
    const sessions = listSessions(roomId);
    const sm = sessions.find((s) => s.id === sessionId);
    const raw = avatarPage.normalizeGroupMessages(members, getMessages(roomId, sessionId));
    const prepared = prepareMessagesForDisplay(raw);
    this.setData({
      panelMode: 'rooms',
      roomId,
      roomTitle: meta.title || '…',
      members,
      sessionId,
      sessionTitle: (sm && sm.title) || '…',
      messages: prepared.list,
      msgMenuIndex: -1,
      scenario: scenario || null,
      scenarioTitle: scenario ? scenario.title : '',
      scenarioPreviewBlocks:
        (scenario && scenario.previewBlocks) ||
        (scenario && scenario.preview3
          ? String(scenario.preview3).split(/\n\s*\n/).filter(Boolean)
          : []),
      sessionList: sessions,
      sessionPickerOpen: false,
      scrollTo: 'group-chat-bottom'
    }, () => {
      avatarPage.refreshGroupChatAvatars(this);
      bgPage.refreshChatBackground(this);
    });
  },

  onToggleMember(e) {
    const id = e.currentTarget.dataset.id;
    const selectedMap = Object.assign({}, this.data.selectedMap);
    if (selectedMap[id]) {
      delete selectedMap[id];
    } else {
      const item = (this.data.ocList || []).find((x) => x.id === id);
      const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
      if (item && !workHasBio(item.work)) {
        ensureOcBioForChat(item.work, id);
        return;
      }
      if (Object.keys(selectedMap).length >= MAX_MEMBERS) {
        wx.showToast({ title: '最多 ' + MAX_MEMBERS + ' 人', icon: 'none' });
        return;
      }
      selectedMap[id] = true;
    }
    let selectedCount = 0;
    Object.keys(selectedMap).forEach(() => selectedCount++);
    this.setData({ selectedMap, selectedCount });
  },

  onStartGroup() {
    const list = this.data.ocList || [];
    const selectedMap = this.data.selectedMap || {};
    let members = list.filter((x) => selectedMap[x.id]);
    members = dedupeChatMembers(members);
    if (members.length < 2) {
      wx.showToast({ title: '… 2 …OC', icon: 'none' });
      return;
    }
    const roomId = roomIdFromMemberIds(members.map((m) => m.id));
    registerRoom(members, roomId);
    this._refreshRooms();
    this._enterRoom(roomId, true);
    wx.showToast({ title: '…', icon: 'none' });
  },

  _collectStoryOptions(members) {
    const options = [];
    (members || []).forEach((mem) => {
      const favId = resolveFavoriteId(mem.id);
      const item = favId ? getFavoriteById(favId) : null;
      getStoriesFromItem(item).forEach((s) => {
        options.push({
          story: s,
          label: mem.name + ' · ' + (s.title || '未命名')
        });
      });
    });
    return options;
  },

  _openStoryImportSheet(story) {
    const scenario = scenarioFromStory(story);
    if (!scenario) return;
    this._pendingScenario = scenario;
    this.setData({
      storyImportVisible: true,
      storyImportTitle: scenario.title,
      storyImportBlocks: scenario.previewBlocks || [],
      chatMoreOpen: false
    });
  },

  onImportScenario() {
    this.setData({ chatMoreOpen: false });
    const options = this._collectStoryOptions(this.data.members);
    if (!options.length) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: options.map((o) => o.label).slice(0, 6),
      success: (res) => {
        const opt = options[res.tapIndex];
        if (opt) this._openStoryImportSheet(opt.story);
      }
    });
  },

  onConfirmStoryImport() {
    const scenario = this._pendingScenario;
    this._pendingScenario = null;
    this.setData({ storyImportVisible: false });
    if (!scenario) return;
    saveGroupScenario(this.data.roomId, this.data.sessionId, scenario);
    this.setData({
      scenario,
      scenarioTitle: scenario.title,
      scenarioPreviewBlocks: scenario.previewBlocks || []
    });
  },

  onCancelStoryImport() {
    this._pendingScenario = null;
    this.setData({ storyImportVisible: false });
  },

  onClearScenario() {
    if (!this.data.roomId || !this.data.scenario) return;
    wx.showModal({
      title: '…',
      content: '…',
      confirmColor: getModalConfirmColor(),
      success: (res) => {
        if (!res.confirm) return;
        saveGroupScenario(this.data.roomId, this.data.sessionId, null);
        this.setData({
          scenario: null,
          scenarioTitle: '',
          scenarioPreviewBlocks: []
        });
      }
    });
  },

  onToggleSessionPicker() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    const open = !this.data.sessionPickerOpen;
    this.setData({
      sessionPickerOpen: open,
      sessionList: open ? listSessions(roomId) : this.data.sessionList,
      sessionManageMode: false,
      sessionSelectedIds: [],
      chatMoreOpen: false
    });
  },

  onToggleSessionManage() {
    const next = !this.data.sessionManageMode;
    this.setData({
      sessionManageMode: next,
      sessionSelectedIds: next ? [] : []
    });
  },

  onSessionRowTap(e) {
    if (!this.data.sessionManageMode) return;
    this.onToggleSessionSelect(e);
  },

  onToggleSessionSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    let ids = (this.data.sessionSelectedIds || []).slice();
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    this.setData({ sessionSelectedIds: ids });
  },

  onSelectAllSessions() {
    const all = (this.data.sessionList || []).map((s) => s.id);
    const ids = this.data.sessionSelectedIds || [];
    const allOn = all.length > 0 && all.every((id) => ids.indexOf(id) >= 0);
    this.setData({ sessionSelectedIds: allOn ? [] : all });
  },

  _loadGroupSession(roomId, id) {
    migrateGroupScenarioLegacy(roomId, id);
    const scenario = loadGroupScenario(roomId, id);
    const sessions = listSessions(roomId);
    const sm = sessions.find((s) => s.id === id);
    const raw = avatarPage.normalizeGroupMessages(
      this.data.members || [],
      getMessages(roomId, id)
    );
    const prepared = prepareMessagesForDisplay(raw);
    this.setData({
      sessionId: id,
      sessionTitle: (sm && sm.title) || '…',
      messages: prepared.list,
      msgMenuIndex: -1,
      scenario: scenario || null,
      scenarioTitle: scenario ? scenario.title : '',
      scenarioPreviewBlocks:
        (scenario && scenario.previewBlocks) ||
        (scenario && scenario.preview3
          ? String(scenario.preview3).split(/\n\s*\n/).filter(Boolean)
          : []),
      scrollTo: 'group-chat-bottom'
    });
  },

  _afterSessionsDeleted(deletedIds) {
    const roomId = this.data.roomId;
    if (!roomId) return;
    const sessions = listSessions(roomId);
    const patch = {
      sessionList: sessions,
      sessionSelectedIds: [],
      sessionManageMode: false
    };
    if ((deletedIds || []).indexOf(this.data.sessionId) >= 0 && sessions[0]) {
      this._loadGroupSession(roomId, sessions[0].id);
    }
    this.setData(patch);
  },

  onBatchDeleteSessions() {
    const roomId = this.data.roomId;
    const ids = (this.data.sessionSelectedIds || []).slice();
    if (!roomId || !ids.length) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '…',
      content: '确定删除选中的 ' + ids.length + ' 个对话？删除后不可恢复。',
      confirmText: '确定',
      cancelText: '…',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        const result = deleteGroupSessionsBatch(roomId, ids);
        if (!result.ok) {
          wx.showToast({
            title: result.last ? '至少保留一个对话' : '删除失败',
            icon: 'none'
          });
          return;
        }
        this._afterSessionsDeleted(ids);
        this.setData({ sessionPickerOpen: true });
        wx.showToast({
          title:
            result.recreated
              ? '已删除并新建空对话'
              : '已删除 ' + result.deleted + ' 个对话',
          icon: 'none'
        });
      }
    });
  },

  onCreateSessionFromPicker() {
    const roomId = this.data.roomId;
    if (!roomId) return;
    const sid = createGroupSession(roomId, '…');
    saveGroupScenario(roomId, sid, null);
    migrateGroupScenarioLegacy(roomId, sid);
    this.setData({
      sessionId: sid,
      sessionTitle: '…',
      messages: [],
      scenario: null,
      scenarioTitle: '',
      scenarioPreviewBlocks: [],
      sessionPickerOpen: true,
      sessionList: listSessions(roomId),
      sessionManageMode: false,
      sessionSelectedIds: [],
      scrollTo: 'group-chat-bottom'
    });
    wx.showToast({ title: '…', icon: 'none' });
  },

  onSessionTitleTap(e) {
    if (this.data.sessionManageMode) return;
    const id = e.currentTarget.dataset.id;
    const roomId = this.data.roomId;
    if (!roomId || !id) return;
    const now = Date.now();
    if (
      this._sessionTitleTapId === id &&
      now - (this._sessionTitleTapAt || 0) <= 400
    ) {
      if (this._sessionTitleTapTimer) {
        clearTimeout(this._sessionTitleTapTimer);
        this._sessionTitleTapTimer = null;
      }
      this._sessionTitleTapId = '';
      this.onRenameSessionTap(e);
      return;
    }
    this._sessionTitleTapId = id;
    this._sessionTitleTapAt = now;
    if (this._sessionTitleTapTimer) clearTimeout(this._sessionTitleTapTimer);
    this._sessionTitleTapTimer = setTimeout(() => {
      this._sessionTitleTapTimer = null;
      this._sessionTitleTapId = '';
      this.onPickSession({ currentTarget: { dataset: { id: id } } });
    }, 400);
  },

  onPickSession(e) {
    if (this.data.sessionManageMode) return;
    const id = e.currentTarget.dataset.id;
    const roomId = this.data.roomId;
    if (!roomId || !id) return;
    this._loadGroupSession(roomId, id);
    this.setData({ sessionPickerOpen: false });
  },

  onDeleteSessionTap(e) {
    const id = e.currentTarget.dataset.id;
    const roomId = this.data.roomId;
    if (!roomId || !id) return;
    const item = (this.data.sessionList || []).find((x) => x.id === id);
    const label = (item && item.title) || '会话';
    wx.showModal({
      title: '…',
      content: '确定删除「' + label + '」吗？',
      confirmText: '确定',
      cancelText: '…',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        const result = deleteGroupSession(roomId, id);
        if (!result.ok) {
          wx.showToast({
            title: result.last ? '至少保留一个对话' : '删除失败',
            icon: 'none'
          });
          return;
        }
        this._afterSessionsDeleted([id]);
        this.setData({ sessionPickerOpen: true });
        wx.showToast({
          title: result.recreated ? '已删除并新建空对话' : '已删除',
          icon: 'none'
        });
      }
    });
  },

  onRenameGroupTap() {
    if (!this.data.roomId) return;
    this.setData({
      renameVisible: true,
      renameMode: 'group',
      renameInput: this.data.roomTitle || '…',
      renameTargetSessionId: '',
      sessionPickerOpen: false
    });
  },

  onRenameSessionTap(e) {
    const id = e.currentTarget.dataset.id;
    const roomId = this.data.roomId;
    if (!roomId || !id) return;
    const s = (this.data.sessionList || []).find((x) => x.id === id);
    this.setData({
      renameVisible: true,
      renameMode: 'session',
      renameInput: (s && s.title) || '…',
      renameTargetSessionId: id,
      sessionPickerOpen: true
    });
  },

  onRenameInput(e) {
    this.setData({ renameInput: e.detail.value || '' });
  },

  onCancelRename() {
    this.setData({ renameVisible: false, renameInput: '', renameTargetSessionId: '' });
  },

  onConfirmRename() {
    const roomId = this.data.roomId;
    const title = (this.data.renameInput || '').trim();
    if (!roomId || !title) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    if (this.data.renameMode === 'group') {
      if (!renameRoomTitle(roomId, title)) {
        wx.showToast({ title: '…', icon: 'none' });
        return;
      }
      this.setData({
        renameVisible: false,
        renameInput: '',
        renameTargetSessionId: '',
        renameMode: 'session',
        roomTitle: title
      });
      this._refreshRooms();
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const sid = this.data.renameTargetSessionId;
    if (!sid) return;
    if (!renameGroupSession(roomId, sid, title)) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const patch = {
      renameVisible: false,
      renameInput: '',
      renameTargetSessionId: '',
      renameMode: 'session',
      sessionList: listSessions(roomId)
    };
    if (sid === this.data.sessionId) {
      patch.sessionTitle = title;
    }
    this.setData(patch);
    wx.showToast({ title: '…', icon: 'none' });
  },

  onCancelAvatarEdit() {
    avatarPage.onCancelAvatarEdit(this);
  },

  onAvatarModify() {
    avatarPage.onAvatarModify(this);
  },

  onAvatarSave() {
    avatarPage.onAvatarSave(this, async (page) => {
      await avatarPage.refreshGroupChatAvatars(page);
      page.refreshPickList();
    });
  },

  onAvatarDelete() {
    avatarPage.onAvatarDelete(this, async (page) => {
      await avatarPage.refreshGroupChatAvatars(page);
      page.refreshPickList();
    });
  },

  onOpenBackgroundEdit() {
    bgPage.onOpenBackgroundEdit(this);
  },

  onCancelBgEdit() {
    bgPage.onCancelBgEdit(this);
  },

  onBgModify() {
    bgPage.onBgModify(this);
  },

  onBgSave() {
    bgPage.onBgSave(this);
  },

  onBgDelete() {
    bgPage.onBgDelete(this);
  },

  onCloseMsgMenu() {
    const patch = {};
    if (this.data.msgMenuIndex >= 0) patch.msgMenuIndex = -1;
    if (this.data.chatMoreOpen) patch.chatMoreOpen = false;
    if (Object.keys(patch).length) this.setData(patch);
  },

  onToggleChatMore() {
    this.setData({
      chatMoreOpen: !this.data.chatMoreOpen,
      msgMenuIndex: -1,
      sessionPickerOpen: false
    });
  },

  onMorePickBackground() {
    this.setData({ chatMoreOpen: false });
    this.onOpenBackgroundEdit();
  },

  onMorePickSave() {
    this.setData({ chatMoreOpen: false });
    this.onSaveChatImage();
  },

  onMsgMoreTap(e) {
    if (this.data.loading) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const msg = (this.data.messages || [])[idx];
    if (!msg || msg.role === 'user') return;
    this.setData({
      msgMenuIndex: this.data.msgMenuIndex === idx ? -1 : idx,
      chatMoreOpen: false
    });
  },

  onMsgDelete(e) {
    if (this.data.loading) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    if (!roomId || !sessionId) return;
    const list = (this.data.messages || []).slice();
    const msg = list[idx];
    if (!msg || msg.role === 'user') return;
    const raw = String(msg.content || '').trim();
    const preview = raw.length > 28 ? raw.slice(0, 28) + '…' : raw;
    this.setData({ msgMenuIndex: -1 });
    wx.showModal({
      title: '…',
      content: preview ? ('「' + preview + '」'): '…',
      confirmText: '确定',
      confirmColor: '#c0392b',
      success: (res) => {
        if (!res.confirm) return;
        const next = list.slice();
        next.splice(idx, 1);
        this._syncMessages(next, true);
      }
    });
  },

  onMsgRegenerate(e) {
    if (this.data.loading) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    const members = this.data.members || [];
    if (!roomId || !sessionId) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!msg || msg.role === 'user') return;
    const member = members.find((m) => m && m.id === msg.ocId);
    if (!member || !member.work) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const userIdx = findPrecedingUserMessage(list, idx);
    if (userIdx < 0) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }

    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_GROUP, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._regenerateGroupChatMessage(idx, userIdx, member);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _regenerateGroupChatMessage(idx, userIdx, member) {
    const members = this.data.members || [];
    const list = this.data.messages || [];
    this._recordQuotaRound();
    const userText = String(list[userIdx].content || '').trim();
    const context = list.slice(0, idx);
    this.setData({ msgMenuIndex: -1 });
    this._setChatLoading(true, member.name);
    try {
      callMemberReply(member, members, userText, context, this.data.scenario)
        .then((reply) => {
          const next = list.slice();
          next[idx] = stampOutgoingMessage({
            role: 'assistant',
            ocId: member.id,
            name: member.name,
            content: reply
          });
          this._syncMessages(next, true);
        })
        .catch((err) => {
          wx.showToast({
            title: (err && err.message) || '…',
            icon: 'none'
          });
        })
        .finally(() => {
          this._setChatLoading(false);
        });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '…', icon: 'none' });
      this._setChatLoading(false);
    }
  },

  onMessageLongPress(e) {
    if (this.data.loading) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    if (!roomId || !sessionId) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!msg || msg.role !== 'user') return;
    if (!msg.canRecall) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '…',
      content: '…',
      confirmText: '确定',
      success: (res) => {
        if (!res.confirm) return;
        const next = list.slice();
        next[idx] = Object.assign({}, msg, { recalled: true, content: '' });
        this._syncMessages(next, true);
      }
    });
  },

  onSend() {
    if (this.data.loading) return;
    const text = (this.data.inputText || '').trim();
    if (!text) return;
    const members = this.data.members || [];
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    if (!roomId || members.length < 2) return;
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }

    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_GROUP, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._sendGroupChatMessage(text);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value || '', composerToolsOpen: false });
  },

  onToggleComposerTools() {
    if (!this.data.roomId || this.data.loading) return;
    this.setData({
      composerToolsOpen: !this.data.composerToolsOpen,
      chatMoreOpen: false
    });
  },

  onCloseComposerTools() {
    if (this.data.composerToolsOpen) this.setData({ composerToolsOpen: false });
  },

  onRedPacketTap() {
    this._openMoneySheet(MONEY_TYPE_RED);
  },

  onTransferTap() {
    this._openMoneySheet(MONEY_TYPE_TRANSFER);
  },

  _openMoneySheet(type) {
    if (this.data.loading) return;
    if (!this.data.roomId || (this.data.members || []).length < 2) {
      wx.showToast({ title: '请先进入群聊', icon: 'none' });
      return;
    }
    const isTransfer = type === MONEY_TYPE_TRANSFER;
    const targetMap = {};
    (this.data.members || []).forEach((m) => {
      if (m && m.id) targetMap[m.id] = true;
    });
    const count = Object.keys(targetMap).filter((k) => targetMap[k]).length;
    this.setData({
      composerToolsOpen: false,
      moneySheetVisible: true,
      moneySheetType: isTransfer ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED,
      moneySheetTitle: isTransfer ? '转账' : '发红包',
      moneyAmountInput: isTransfer ? '50.00' : '20.00',
      moneyPresets: isTransfer ? MONEY_PRESETS_TRANSFER : MONEY_PRESETS_RED,
      moneyMode: isTransfer ? MONEY_MODE_TARGETED : MONEY_MODE_NORMAL,
      moneyTargetMap: targetMap,
      moneyTargetCount: count,
      moneyCanPickTargets: !!isTransfer
    });
  },

  onCloseMoneySheet() {
    if (this.data.moneySheetVisible) this.setData({ moneySheetVisible: false });
  },

  onMoneyAmountInput(e) {
    this.setData({ moneyAmountInput: (e.detail && e.detail.value) || '' });
  },

  onMoneyPresetTap(e) {
    const amount = e.currentTarget.dataset.amount;
    this.setData({
      moneyAmountInput: formatMoneyAmount(
        amount,
        this.data.moneySheetType === MONEY_TYPE_TRANSFER
          ? MONEY_TYPE_TRANSFER
          : MONEY_TYPE_RED
      )
    });
  },

  onMoneyModeTap(e) {
    if (this.data.moneySheetType === MONEY_TYPE_TRANSFER) return;
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    const canPick = mode === MONEY_MODE_TARGETED;
    const targetMap = {};
    (this.data.members || []).forEach((m) => {
      if (!m || !m.id) return;
      // 普通/拼手气：固定全员；指定：默认全不选，由用户点选
      targetMap[m.id] = canPick ? false : true;
    });
    const count = Object.keys(targetMap).filter((k) => targetMap[k]).length;
    this.setData({
      moneyMode: mode,
      moneyTargetMap: targetMap,
      moneyTargetCount: count,
      moneyCanPickTargets: canPick
    });
  },

  onToggleMoneyTarget(e) {
    if (!this.data.moneyCanPickTargets) {
      wx.showToast({ title: '普通/拼手气红包默认全员', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const targetMap = Object.assign({}, this.data.moneyTargetMap || {});
    if (this.data.moneySheetType === MONEY_TYPE_TRANSFER) {
      Object.keys(targetMap).forEach((k) => {
        targetMap[k] = k === id;
      });
    } else {
      targetMap[id] = !targetMap[id];
    }
    const count = Object.keys(targetMap).filter((k) => targetMap[k]).length;
    this.setData({ moneyTargetMap: targetMap, moneyTargetCount: count });
  },

  onConfirmMoneySend() {
    if (this.data.loading) return;
    const type =
      this.data.moneySheetType === MONEY_TYPE_TRANSFER
        ? MONEY_TYPE_TRANSFER
        : MONEY_TYPE_RED;
    const amount = normalizeMoneyAmount(this.data.moneyAmountInput, type);
    if (type === MONEY_TYPE_RED && Number(this.data.moneyAmountInput) > RED_PACKET_MAX) {
      wx.showToast({ title: '红包最多 ' + RED_PACKET_MAX + ' 元', icon: 'none' });
    }
    let mode = this.data.moneyMode || MONEY_MODE_NORMAL;
    if (type === MONEY_TYPE_TRANSFER) mode = MONEY_MODE_TARGETED;

    let targetIds;
    if (type === MONEY_TYPE_RED && mode !== MONEY_MODE_TARGETED) {
      // 普通 / 拼手气：强制全员，不可指定
      targetIds = (this.data.members || []).map((m) => m && m.id).filter(Boolean);
      mode = mode === MONEY_MODE_LUCKY ? MONEY_MODE_LUCKY : MONEY_MODE_NORMAL;
    } else {
      targetIds = Object.keys(this.data.moneyTargetMap || {}).filter(
        (k) => this.data.moneyTargetMap[k]
      );
    }
    if (!targetIds.length) {
      wx.showToast({
        title: type === MONEY_TYPE_TRANSFER || mode === MONEY_MODE_TARGETED
          ? '请选择发送对象'
          : '暂无群成员',
        icon: 'none'
      });
      return;
    }
    this.setData({
      moneySheetVisible: false,
      moneyAmountInput: formatMoneyAmount(amount, type)
    });
    this._startGroupMoneySend(type, mode, amount, targetIds);
  },

  _startGroupMoneySend(type, mode, amount, targetIds) {
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_GROUP, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._sendGroupMoneyAndReact(type, mode, amount, targetIds);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _sendGroupMoneyAndReact(type, mode, amount, targetIds) {
    const members = this.data.members || [];
    const roomId = this.data.roomId;
    const scenario = this.data.scenario;
    this._recordQuotaRound();
    const built = createGroupMoneySend({
      type: type,
      mode: mode,
      amount: amount,
      side: 'user',
      fromId: 'user',
      fromName: '我',
      targetIds: targetIds,
      members: members
    });
    const moneyMsg = stampOutgoingMessage({
      role: 'user',
      kind: built.kind,
      game: built.game,
      content: built.content
    });
    const historyBefore = (this.data.messages || []).slice();
    let messages = historyBefore.concat([moneyMsg]);
    const moneyMsgIndex = messages.length - 1;
    this.setData({ scrollTo: 'group-chat-bottom', msgMenuIndex: -1, composerToolsOpen: false });
    this._syncMessages(messages, true);
    this._setChatLoading(true);

    const speakerIds = (built.game.targetIds || []).slice();
    let chain = Promise.resolve();
    speakerIds.forEach((ocId) => {
      chain = chain.then(() => {
        const member = members.find((m) => m.id === ocId);
        if (!member || !member.work) return;
        this._setChatLoading(true, member.name);
        const decide = buildGroupMoneyDecideUserMessage(
          messages[moneyMsgIndex].game,
          member
        );
        return callMemberReply(member, members, decide, messages, scenario, {
          moneyMode: true,
          decideUserMessage: decide,
          wrapSystemPrompt: (sp) => withGroupMoneyReplyRules(sp)
        }).then((reply) => {
          const reacted = applyGroupMoneyMemberReact(
            messages[moneyMsgIndex],
            member,
            reply
          );
          messages[moneyMsgIndex] = Object.assign({}, messages[moneyMsgIndex], {
            game: reacted.updatedGame,
            content: reacted.updatedContent
          });
          messages = messages.concat([
            stampOutgoingMessage({
              role: 'assistant',
              ocId: member.id,
              name: member.name,
              content: reacted.speech
            })
          ]);
          this._syncMessages(messages, true);
          this.setData({ scrollTo: 'group-chat-bottom' });
        });
      });
    });

    chain
      .then(() => {
        if (roomId) this._syncMessages(messages, true);
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || '…',
          icon: 'none'
        });
      })
      .finally(() => {
        this._setChatLoading(false);
      });
  },

  onMoneyCardTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!isMoneyMessage(msg) || msg.role !== 'assistant') return;
    // 仅处理发给用户的卡片
    const targets = (msg.game && msg.game.targetIds) || [];
    const toUser =
      !msg.game.channel ||
      targets.indexOf('user') >= 0 ||
      (msg.game.side === 'oc' && (!targets.length || targets[0] === 'user'));
    if (!toUser && msg.game.channel === 'group' && targets.length && targets[0] !== 'user') {
      return;
    }
    const st = msg.game && msg.game.status;
    if (st !== 'sent' && st !== 'waiting') return;
    const isTransfer = msg.game && msg.game.type === MONEY_TYPE_TRANSFER;
    wx.showActionSheet({
      itemList: [isTransfer ? '收款' : '领取', '退回'],
      success: (res) => {
        const action = res.tapIndex === 1 ? 'reject' : 'claim';
        const next = (this.data.messages || []).slice();
        const cur = next[idx];
        const updated =
          action === 'reject' ? rejectOcMoneyMessage(cur) : claimOcMoneyMessage(cur);
        if (!updated) return;
        next[idx] = Object.assign({}, cur, updated);
        this._syncMessages(next, true);
        wx.showToast({
          title: action === 'reject' ? '已退回' : isTransfer ? '已收款' : '已领取',
          icon: 'none'
        });
      }
    });
  },

  _sendGroupChatMessage(text) {
    const members = this.data.members || [];
    const roomId = this.data.roomId;
    const sessionId = this.data.sessionId;
    this._recordQuotaRound();
    const userMsg = stampOutgoingMessage({ role: 'user', content: text });
    const historyBefore = (this.data.messages || []).slice();
    let messages = historyBefore.concat([userMsg]);
    const scenario = this.data.scenario;

    this.setData({
      inputText: '',
      scrollTo: 'group-chat-bottom',
      sessionPickerOpen: false,
      msgMenuIndex: -1,
      composerToolsOpen: false
    });
    this._syncMessages(messages, true);
    this._setChatLoading(true);

    const runReplies = (speakerIds) => {
      let chain = Promise.resolve();
      speakerIds.forEach((ocId) => {
        chain = chain.then(() => {
          const member = members.find((m) => m.id === ocId);
          if (!member || !member.work) return;
          this._setChatLoading(true, member.name);
          return callMemberReply(member, members, text, messages, scenario, {
            moneyAware: shouldAllowProactiveMoney(text, messages),
            wrapSystemPrompt: (sp, mem) =>
              withGroupMoneyProactiveRules(sp, (mem && mem.work) || member.work, {
                allowProactiveMoney: shouldAllowProactiveMoney(text, messages)
              })
          }).then((reply) => {
            const built = buildGroupMoneyAwareMessages(member, members, reply, {
              recentMessages: messages,
              userMessage: text
            }).map((m) =>
              stampOutgoingMessage(m)
            );
            messages = messages.concat(built);
            this._syncMessages(messages, true);
            this.setData({ scrollTo: 'group-chat-bottom' });
          });
        });
      });
      return chain;
    };

    pickGroupSpeakers(members, text, messages)
      .then((speakerIds) => runReplies(speakerIds))
      .then(() => {
        if (roomId) this._syncMessages(messages, true);
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || '…',
          icon: 'none'
        });
        this._syncMessages(historyBefore, true);
      })
      .finally(() => {
        this._setChatLoading(false);
      });
  },

  onSaveChatImage() {
    if (this.data.savingImage) return;
    const raw = (this.data.messages || []).filter((m) => m && m.content);
    if (!this.data.roomId || !raw.length) {
      wx.showToast({ title: '暂无对话可保存', icon: 'none' });
      return;
    }
    const messages = raw.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.content };
      const prefix = m.name ? m.name + '?\n' : '';
      return { role: 'assistant', content: prefix + m.content };
    });
    const title =
      (this.data.roomTitle || '群聊') + ' · ' + (this.data.sessionTitle || '对话');
    this.setData({ savingImage: true });
    wx.showLoading({ title: '生成长图…', mask: true });
    exportChatLongImage(this, { title, messages })
      .then((filePath) => {
        wx.hideLoading();
        const saveToAlbum = () => {
          wx.saveImageToPhotosAlbum({
            filePath,
            success: () =>
              wx.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: (e) => {
              const msg = (e && e.errMsg) || '';
              if (/auth|authorize|deny/i.test(msg)) {
                wx.showModal({
                  title: '…',
                  content: '…',
                  confirmText: '确定',
                  cancelText: '…',
                  success: (r) => {
                    if (r.confirm) wx.openSetting();
                  }
                });
              } else {
                wx.showToast({ title: msg || '…', icon: 'none' });
              }
            }
          });
        };
        if (wx.showShareImageMenu) {
          wx.showShareImageMenu({
            path: filePath,
            fail: saveToAlbum
          });
        } else {
          saveToAlbum();
        }
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({
          title: (err && err.message) || '…',
          icon: 'none'
        });
      })
      .finally(() => this.setData({ savingImage: false }));
  },

  onShareAppMessage() {
    consumeQuotaShareIfPending(this);
    const meta = this._aiQuotaShareMeta || buildQuotaShareMessage(QUOTA_CHANNEL_GROUP);
    const title = (this.data.roomTitle || '').trim();
    return {
      title: title ? title + ' · 群聊' : meta.title,
      path: meta.path || '/pages/index/index'
    };
  },

  onQuotaSheetShareTap() {
    onQuotaSheetShare(this);
  },
  onQuotaSheetAdTap() {
    onQuotaSheetAd(this);
  },
  onQuotaSheetRedeemTap() {
    onQuotaSheetRedeem(this);
  },
  onQuotaSheetFollowOaTap() {
    onQuotaSheetFollowOa(this);
  },
  onQuotaSheetCloseOaTap() {
    onQuotaSheetCloseOa(this);
  },
  onQuotaSheetCloseTap() {
    onQuotaSheetClose(this);
  },
  onAdClaimMakeup() {
    require('../../utils/adClaimDrawer.js').onAdClaimMakeup(this);
  },
  onAdClaimConfirm() {
    require('../../utils/adClaimDrawer.js').onAdClaimConfirm(this);
  },
  onAdClaimClose() {
    require('../../utils/adClaimDrawer.js').onAdClaimClose(this);
  }
});
