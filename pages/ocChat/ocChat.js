const { buildChatSystemPrompt } = require('../../utils/ocContext.js');
const { extractSessionMemory, shouldRefreshMemory } = require('../../utils/chatMemory.js');
const { exportChatLongImage } = require('../../utils/chatSnapshot.js');
const {
  buildOcChatList,
  resolveFavoriteId,
  revealOcInChatList,
  renameOcChatRemark
} = require('../../utils/ocChatList.js');
const { removeOcFromChatList } = require('../../utils/chatListTrash.js');
const dragTrash = require('../../utils/panelDragTrash.js');
const {
  loadScenario,
  saveScenario,
  scenarioFromStory,
  migrateScenarioLegacy
} = require('../../utils/chatScenario.js');
const {
  listSessions,
  getMessages,
  setMessages,
  createSession,
  ensureDefaultSession,
  findPrimaryChatSessionId,
  renameSession,
  deleteSession,
  deleteSessionsBatch,
  getSessionMemory,
  setSessionMemory
} = require('../../utils/chatSession.js');
const { getStoryFromFavorite, getStoriesFromItem } = require('../../utils/storyStore.js');
const { getFavoriteById, workFromFavoriteItem } = require('../../utils/favorite.js');
const { isBreakCharacterAttempt } = require('../../utils/chatGuard.js');
const avatarPage = require('../../utils/chatAvatarPage.js');
const bgPage = require('../../utils/chatBackgroundPage.js');
const packPage = require('../../utils/ocPackPage.js');
const { sharePackFile } = require('../../utils/ocShare.js');
const { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');
const fakeNotify = require('../../utils/ocFakeNotify.js');
const { markUserChattedToday } = require('../../utils/ocProactive.js');
const { primaryChatOcId } = require('../../utils/ocChatHistory.js');
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
  buildQuotaSyncPayload,
  onQuotaSheetShare,
  onQuotaSheetRedeem,
  onQuotaSheetFollowOa,
  onQuotaSheetCloseOa,
  onQuotaSheetClose,
  QUOTA_CHANNEL_DM
} = require('../../utils/aiChatQuota.js');
const {
  createDiceRoll,
  buildDiceDecideUserMessage,
  buildDiceAssistantMessages,
  rollDie,
  toAiHistoryMessage,
  isDiceMessage,
  MONEY_PRESETS,
  MONEY_PRESETS_RED,
  MONEY_PRESETS_TRANSFER,
  RED_PACKET_MAX,
  MONEY_TYPE_RED,
  MONEY_TYPE_TRANSFER,
  createMoneySend,
  isMoneyMessage,
  buildMoneyDecideUserMessage,
  buildMoneyReactResult,
  buildMoneyAwareAssistantMessages,
  claimOcMoneyMessage,
  formatMoneyAmount,
  normalizeMoneyAmount,
  withMoneyReplyRules,
  withMoneyProactiveRules,
  rejectOcMoneyMessage
} = require('../../utils/chatGames.js');

function safeBuildDiceAssistantMessages(ocId, userValue, rawReply, ocValue) {
  try {
    if (typeof buildDiceAssistantMessages === 'function') {
      return buildDiceAssistantMessages(ocId, userValue, rawReply, ocValue);
    }
  } catch (e) {
    console.error('buildDiceAssistantMessages', e);
  }
  return [
    {
      role: 'assistant',
      ocId: ocId,
      content: String(rawReply || '').trim() || '……'
    }
  ];
}

function safeBuildMoneyAwareAssistantMessages(ocId, rawReply) {
  try {
    if (typeof buildMoneyAwareAssistantMessages === 'function') {
      return buildMoneyAwareAssistantMessages(ocId, rawReply);
    }
  } catch (e) {
    console.error('buildMoneyAwareAssistantMessages', e);
  }
  return [
    {
      role: 'assistant',
      ocId: ocId,
      content: String(rawReply || '').trim() || '……'
    }
  ];
}
const { ensureCloudReady, callCloudFunction } = require('../../utils/cloudInit.js');

Page({
  data: Object.assign(
    {
      ocList: [],
    selectedId: '',
    selectedName: '',
    sessionId: '',
    sessionTitle: '',
    messages: [],
    inputText: '',
    loading: false,
    scrollTo: '',
    ocPanelOpen: true,
    ocListCompact: false,
    savingImage: false,
    snapshotCanvasOn: false,
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
    unreadOcIds: [],
    msgMenuIndex: -1,
    chatMoreOpen: false,
    composerToolsOpen: false,
    quotaUsed: 0,
    quotaLeft: 0,
    quotaSheetVisible: false,
    quotaSheetShareLeft: 0,
    quotaOaQrVisible: false,
    diceRolling: false,
    moneySheetVisible: false,
    moneySheetType: 'red_packet',
    moneySheetTitle: '发红包',
    moneyAmountInput: '6.66',
    moneyPresets: MONEY_PRESETS_RED,
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
    this._pendingOcId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    this._clearPendingBadge = !!this._pendingOcId;
    this._pendingStoryId =
      options && options.storyId ? decodeURIComponent(options.storyId) : '';
    this._pendingNewSession = !!(
      options && (options.newSession === '1' || options.newSession === true)
    );
    this.refreshOcList();
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
    this.refreshOcList();
    if (this.data.sessionId && (this.data.messages || []).length) {
      this._syncMessages(stripMessageUiFields(this.data.messages), false);
    } else if (this.data.selectedId && this.data.sessionId) {
      this._loadSession(this.data.selectedId, this.data.sessionId);
    }
    this.refreshOcList();
  },

  onChatSegmentChange(e) {
    if (e.detail && e.detail.key === 'group') {
      wx.redirectTo({
        url: '/pages/ocGroupChat/ocGroupChat',
        fail() {
          wx.reLaunch({ url: '/pages/ocGroupChat/ocGroupChat' });
        }
      });
    }
  },

  _refreshQuotaBadge() {
    const hint = buildQuotaHint(QUOTA_CHANNEL_DM);
    this.setData({
      quotaUsed: hint.used,
      quotaLeft: hint.left
    });
    // 先拉云端余额，再上报免费用量（禁止并行回写额度）
    syncExtraRoundsFromServer()
      .then(() => flushQuotaToCloud())
      .then(() => {
        const next = buildQuotaHint(QUOTA_CHANNEL_DM);
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
    recordAiChatRound(QUOTA_CHANNEL_DM);
    const hint = buildQuotaHint(QUOTA_CHANNEL_DM);
    this.setData({
      quotaUsed: hint.used,
      quotaLeft: hint.left
    });
  },

  _mapOcListWithUnread(list) {
    const unreadSet = {};
    (fakeNotify.getBadges().chatOcIds || []).forEach((id) => {
      if (id) unreadSet[id] = true;
    });
    return (list || []).map((item) =>
      Object.assign({}, item, { hasUnread: !!unreadSet[item.id] })
    );
  },

  refreshOcList() {
    try {
      const rawList = buildOcChatList();
      const selectedId = this.data.selectedId;
      const pending = this._pendingOcId;
      if (pending) this._pendingOcId = '';
      let pickId = selectedId;
      if (pending) {
        revealOcInChatList(pending);
        if (this._clearPendingBadge) {
          fakeNotify.clearChatBadgeForOc(pending);
          this._clearPendingBadge = false;
        }
      }
      if (pending && rawList.some((x) => x.id === pending)) {
        pickId = pending;
      } else if (!rawList.some((x) => x.id === pickId) && rawList.length) {
        pickId = rawList[0].id;
      }
      const pick = rawList.find((x) => x.id === pickId);
      if (pending && pick && pick.id === pending && !pick.hasBio) {
        const { ensureOcIdBioForChat } = require('../../utils/ocChatGate.js');
        ensureOcIdBioForChat(pending);
      } else if (pending && !rawList.some((x) => x.id === pending)) {
        const { ensureOcIdBioForChat } = require('../../utils/ocChatGate.js');
        ensureOcIdBioForChat(pending);
      }
      const patch = {
        ocList: this._mapOcListWithUnread(rawList),
        unreadOcIds: fakeNotify.getBadges().chatOcIds || [],
        selectedId: pick ? pick.id : '',
        selectedName: pick ? pick.name : ''
      };
      this.setData(patch, () => {
        if (!patch.selectedId) return;
        try {
          avatarPage.refreshOcChatAvatars(this);
          bgPage.refreshChatBackground(this);
          if (this._pendingNewSession) {
            this._pendingNewSession = false;
            this._startNewSession(false);
            return;
          }
          if (!this.data.sessionId) {
            const sid = findPrimaryChatSessionId(primaryChatOcId(patch.selectedId));
            this._loadSession(patch.selectedId, sid);
          } else {
            this._loadSession(patch.selectedId, this.data.sessionId);
          }
          this._applyPendingStory();
        } catch (e) {
          console.warn('[ocChat] refresh callback', e);
        }
      });
    } catch (e) {
      console.warn('[ocChat] refreshOcList', e);
    }
  },

  _syncMessages(rawMessages, persist) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const prepared = prepareMessagesForDisplay(rawMessages);
    this.setData({ messages: prepared.list, msgMenuIndex: -1 });
    if (persist && ocId && sessionId) {
      setMessages(ocId, sessionId, stripMessageUiFields(prepared.list));
    }
    return prepared.list;
  },

  _clearChatLoadingWatch() {
    if (this._chatLoadingWatch) {
      clearTimeout(this._chatLoadingWatch);
      this._chatLoadingWatch = null;
    }
  },

  _setChatLoading(on) {
    this._clearChatLoadingWatch();
    if (!on) {
      this.setData({ loading: false, scrollTo: 'chat-bottom' });
      return;
    }
    this.setData({ loading: true, scrollTo: 'chat-bottom' });
    this._chatLoadingWatch = setTimeout(() => {
      this._chatLoadingWatch = null;
      if (!this.data.loading) return;
      this.setData({ loading: false, scrollTo: 'chat-bottom' });
      wx.showToast({ title: '请求超时，请重试', icon: 'none' });
    }, 70000);
  },

  onUnload() {
    this._clearChatLoadingWatch();
  },

  _loadSession(ocId, sessionId) {
    migrateScenarioLegacy(ocId, sessionId);
    const sessions = listSessions(ocId);
    const meta = sessions.find((s) => s.id === sessionId);
    const scenario = loadScenario(ocId, sessionId);
    const raw = avatarPage.normalizeOcChatMessages(ocId, getMessages(ocId, sessionId));
    const prepared = prepareMessagesForDisplay(raw);
    this.setData({
      sessionId: sessionId,
      sessionTitle: (meta && meta.title) || '对话',
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
      scrollTo: 'chat-bottom'
    });
  },

  _applyPendingStory() {
    if (!this._pendingStoryId || !this.data.selectedId) return;
    const storyId = this._pendingStoryId;
    this._pendingStoryId = '';
    const favId = resolveFavoriteId(this.data.selectedId);
    const story = favId ? getStoryFromFavorite(favId, storyId) : null;
    if (!story) return;
    this._openStoryImportSheet(story);
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

  getSelectedWork() {
    return this.getSelectedWorkFresh();
  },

  getSelectedWorkFresh() {
    const id = this.data.selectedId;
    if (!id) return null;
    if (id === '__work__') {
      const work = wx.getStorageSync('oc_work_in_progress') || {};
      return work && work.result ? work : null;
    }
    const favId = id;
    const item = getFavoriteById(favId);
    return item ? workFromFavoriteItem(item) : null;
  },

  onCardLongPress(e) {
    dragTrash.startDrag(this, e);
  },

  onDragMove(e) {
    dragTrash.moveDrag(this, e);
  },

  onDragEnd() {
    dragTrash.endDrag(this, (id, label) => this._confirmTrashDropOc(id, label));
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

  onAvatarTap(e) {
    avatarPage.onAvatarTap(this, e);
  },

  onComposerOcAvatarTap() {
    avatarPage.onComposerOcAvatarTap(this);
  },

  onAvatarLongPress(e) {
    avatarPage.onAvatarLongPress(this, e);
  },

  _confirmTrashDropOc(ocId, name) {
    const label = name || '该 OC';
    wx.showModal({
      title: '删除对话',
      content: '确定删除「' + label + '」吗？',
      confirmText: '确定',
      confirmColor: '#b91c1c',
      success: (res) => {
        if (!res.confirm) return;
        removeOcFromChatList(ocId);
        const patch = { sessionPickerOpen: false };
        if (this.data.selectedId === ocId) {
          Object.assign(patch, {
            selectedId: '',
            selectedName: '',
            sessionId: '',
            sessionTitle: '',
            messages: [],
            scenario: null,
            scenarioTitle: '',
            scenarioPreviewBlocks: []
          });
        }
        this.setData(patch);
        this.refreshOcList();
        wx.showToast({ title: '已移出', icon: 'none' });
      }
    });
  },

  onSelectOc(e) {
    if (this.data.dragging || this._dragMoved) {
      this._dragMoved = false;
      return;
    }
    const id = e.currentTarget.dataset.id;
    const item = (this.data.ocList || []).find((x) => x.id === id);
    if (!item) return;
    const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
    if (!workHasBio(item.work) && !ensureOcBioForChat(item.work, id)) {
      return;
    }
    revealOcInChatList(id);
    fakeNotify.clearChatBadgeForOc(id);
    const storageId = primaryChatOcId(id);
    const sid = findPrimaryChatSessionId(storageId);
    this.setData({
      selectedId: id,
      selectedName: item.name,
      inputText: '',
      sessionPickerOpen: false,
      ocList: this._mapOcListWithUnread(buildOcChatList()),
      unreadOcIds: fakeNotify.getBadges().chatOcIds || []
    });
    this._loadSession(id, sid);
    avatarPage.refreshOcChatAvatars(this);
    bgPage.refreshChatBackground(this);
  },

  onCancelAvatarEdit() {
    avatarPage.onCancelAvatarEdit(this);
  },

  onAvatarModify() {
    avatarPage.onAvatarModify(this);
  },

  onAvatarSave() {
    avatarPage.onAvatarSave(this, async (page) => {
      await avatarPage.refreshOcChatAvatars(page);
    });
  },

  onAvatarDelete() {
    avatarPage.onAvatarDelete(this, async (page) => {
      await avatarPage.refreshOcChatAvatars(page);
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

  _applyScenario(scenario) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    saveScenario(ocId, sessionId, scenario);
    this.setData({
      scenario,
      scenarioTitle: scenario ? scenario.title : '',
      scenarioPreviewBlocks: scenario ? scenario.previewBlocks || [] : []
    });
  },

  onImportScenario() {
    this.setData({ chatMoreOpen: false });
    const ocId = this.data.selectedId;
    if (!ocId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const favId = resolveFavoriteId(ocId);
    const item = favId ? getFavoriteById(favId) : null;
    const stories = getStoriesFromItem(item);
    if (!stories.length) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    const names = stories.map((s) => s.title || '未命名');
    wx.showActionSheet({
      itemList: names.slice(0, 6),
      success: (res) => {
        const story = stories[res.tapIndex];
        if (!story) return;
        this._openStoryImportSheet(story);
      }
    });
  },

  onConfirmStoryImport() {
    const scenario = this._pendingScenario;
    this._pendingScenario = null;
    this.setData({ storyImportVisible: false });
    if (scenario) this._applyScenario(scenario);
  },

  onCancelStoryImport() {
    this._pendingScenario = null;
    this.setData({ storyImportVisible: false });
  },

  onClearScenario() {
    const ocId = this.data.selectedId;
    if (!ocId || !this.data.scenario) return;
    wx.showModal({
      title: '…',
      content: '…',
      confirmColor: getModalConfirmColor(),
      success: (res) => {
        if (!res.confirm) return;
        saveScenario(ocId, this.data.sessionId, null);
        this.setData({
          scenario: null,
          scenarioTitle: '',
          scenarioPreviewBlocks: []
        });
        wx.showToast({ title: '…', icon: 'none' });
      }
    });
  },

  onToggleSessionPicker() {
    const ocId = this.data.selectedId;
    if (!ocId) return;
    const open = !this.data.sessionPickerOpen;
    this.setData({
      sessionPickerOpen: open,
      sessionList: open ? listSessions(ocId) : this.data.sessionList,
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

  _afterSessionsDeleted(deletedIds) {
    const ocId = this.data.selectedId;
    if (!ocId) return;
    const sessions = listSessions(ocId);
    const patch = {
      sessionList: sessions,
      sessionSelectedIds: [],
      sessionManageMode: false
    };
    const cur = this.data.sessionId;
    if ((deletedIds || []).indexOf(cur) >= 0 && sessions[0]) {
      this._loadSession(ocId, sessions[0].id);
    }
    this.setData(patch);
  },

  onBatchDeleteSessions() {
    const ocId = this.data.selectedId;
    const ids = (this.data.sessionSelectedIds || []).slice();
    if (!ocId || !ids.length) {
      wx.showToast({ title: '请先勾选对话', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量删除',
      content: '确定删除选中的 ' + ids.length + '…',
      confirmText: '确定',
      cancelText: '取消',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        const result = deleteSessionsBatch(ocId, ids);
        if (!result.ok) {
          wx.showToast({
            title: result.last ? '部分失败' : '删除失败',
            icon: 'none'
          });
          return;
        }
        this._afterSessionsDeleted(ids);
        wx.showToast({ title: '已删除 ' + result.deleted + ' 个对话', icon: 'none' });
      }
    });
  },

  onCreateSessionFromPicker() {
    this._startNewSession(true);
    this.setData({
      sessionPickerOpen: true,
      sessionList: listSessions(this.data.selectedId),
      sessionManageMode: false,
      sessionSelectedIds: []
    });
  },

  onPickSession(e) {
    if (this.data.sessionManageMode) return;
    const id = e.currentTarget.dataset.id;
    const ocId = this.data.selectedId;
    if (!ocId || !id) return;
    this._loadSession(ocId, id);
    this.setData({ sessionPickerOpen: false });
  },

  onSessionTitleTap(e) {
    if (this.data.sessionManageMode) return;
    const id = e.currentTarget.dataset.id;
    const ocId = this.data.selectedId;
    if (!ocId || !id) return;
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

  onDeleteSessionTap(e) {
    const id = e.currentTarget.dataset.id;
    const ocId = this.data.selectedId;
    if (!ocId || !id) return;
    const item = (this.data.sessionList || []).find((x) => x.id === id);
    const label = (item && item.title) || '对话';
    wx.showModal({
      title: '…',
      content: '确定删除「' + label + '」吗？',
      confirmText: '确定',
      cancelText: '取消',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        const result = deleteSession(ocId, id);
        if (!result.ok) {
          wx.showToast({
            title: result.last ? '部分失败' : '删除失败',
            icon: 'none'
          });
          return;
        }
        this._afterSessionsDeleted([id]);
        this.setData({ sessionPickerOpen: true });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  onRenameOcTap() {
    if (!this.data.selectedId) return;
    this.setData({
      renameVisible: true,
      renameMode: 'oc',
      renameInput: this.data.selectedName || '未命名',
      renameTargetSessionId: '',
      sessionPickerOpen: false
    });
  },

  onRenameSessionTap(e) {
    const id = e.currentTarget.dataset.id;
    const ocId = this.data.selectedId;
    if (!ocId || !id) return;
    const s = (this.data.sessionList || []).find((x) => x.id === id);
    this.setData({
      renameVisible: true,
      renameMode: 'session',
      renameInput: (s && s.title) || '对话',
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
    const ocId = this.data.selectedId;
    const title = (this.data.renameInput || '').trim();
    if (!title) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    if (this.data.renameMode === 'oc') {
      if (!ocId) return;
      if (!renameOcChatRemark(ocId, title)) {
        wx.showToast({ title: '修改失败', icon: 'none' });
        return;
      }
      this.setData({
        renameVisible: false,
        renameInput: '',
        renameTargetSessionId: '',
        renameMode: 'session'
      });
      this.refreshOcList();
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const sid = this.data.renameTargetSessionId;
    if (!ocId || !sid) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    if (!renameSession(ocId, sid, title)) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const patch = {
      renameVisible: false,
      renameInput: '',
      renameTargetSessionId: '',
      renameMode: 'session',
      sessionList: listSessions(ocId)
    };
    if (sid === this.data.sessionId) {
      patch.sessionTitle = title;
    }
    this.setData(patch);
    wx.showToast({ title: '…', icon: 'none' });
  },

  _startNewSession(showToast) {
    const ocId = this.data.selectedId;
    if (!ocId) return;
    const sid = createSession(ocId, '…');
    saveScenario(ocId, sid, null);
    this._loadSession(ocId, sid);
    if (showToast) {
      wx.showToast({ title: '已新建对话', icon: 'none' });
    }
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

  onMorePickBackup() {
    this.setData({ chatMoreOpen: false });
    this.onOpenDataMenu();
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
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    if (!ocId || !sessionId) return;
    const list = (this.data.messages || []).slice();
    const msg = list[idx];
    if (!msg || msg.role === 'user') return;
    const raw = String(msg.content || '').trim();
    const preview = raw.length > 28 ? raw.slice(0, 28) + '…' : raw;
    this.setData({ msgMenuIndex: -1 });
    wx.showModal({
      title: '删除这条消息',
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
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    if (!ocId || !sessionId) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!msg || msg.role === 'user') return;
    const userIdx = findPrecedingUserMessage(list, idx);
    if (userIdx < 0) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    const work = this.getSelectedWork();
    if (!work || !work.result) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }

    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_DM, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._regenerateChatMessage(idx, userIdx);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _regenerateChatMessage(idx, userIdx) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const list = this.data.messages || [];
    this._recordQuotaRound();
    const prevUser = list[userIdx] || {};
    const isDice = isDiceMessage(prevUser);
    const isMoney = isMoneyMessage(prevUser);
    const ocPending = isDice ? rollDie(6).value : 0;
    const userText = isDice
      ? buildDiceDecideUserMessage(prevUser.game, ocPending)
      : isMoney
        ? buildMoneyDecideUserMessage(prevUser.game)
        : String(prevUser.content || '').trim();
    const history = list
      .slice(0, userIdx)
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-12);
    this.setData({ msgMenuIndex: -1, scrollTo: 'chat-bottom' });
    this._setChatLoading(true);
    try {
      const breakCharacterAttempt =
        isDice || isMoney ? false : isBreakCharacterAttempt(userText);
      const sessionMemory = getSessionMemory(ocId, sessionId);
      const work = this.getSelectedWork();
      const systemPrompt = buildChatSystemPrompt(work, {
        scenario: this.data.scenario,
        userMessage: userText,
        sessionMemory
      });
      const promptWithMode = isMoney
        ? withMoneyReplyRules(systemPrompt)
        : isDice
          ? systemPrompt
          : withMoneyProactiveRules(systemPrompt, work);
      callCloudFunction({
          name: 'ocChat',
          data: Object.assign(
            {
              systemPrompt: promptWithMode,
              userMessage: userText,
              history: isDice || isMoney ? history.slice(-10) : history,
              breakCharacterAttempt,
              diceMode: isDice,
              moneyMode: isMoney,
              moneyAware: !isDice && !isMoney,
              channel: 'dm'
            },
            buildQuotaSyncPayload()
          ),
          timeout: 60000
        })
        .then((res) => {
          const r = res.result || {};
            if (r.ok && r.reply) {
            const next = list.slice();
            if (isDice) {
              const built = safeBuildDiceAssistantMessages(
                ocId,
                prevUser.game && prevUser.game.value,
                r.reply,
                ocPending
              ).map((m) => stampOutgoingMessage(m));
              // recovered
              let removeCount = 1;
              const cur = list[idx];
              const prev = idx > 0 ? list[idx - 1] : null;
              if (cur && !cur.kind && prev && isDiceMessage(prev) && prev.role === 'assistant') {
                next.splice(idx - 1, 2, ...built);
              } else if (cur && isDiceMessage(cur)) {
                const fol = list[idx + 1];
                if (fol && fol.role === 'assistant' && !fol.kind) {
                  removeCount = 2;
                }
                next.splice(idx, removeCount, ...built);
              } else {
                next.splice(idx, 1, ...built);
              }
            } else if (isMoney) {
              const reacted = buildMoneyReactResult(ocId, prevUser.game, r.reply);
              next[userIdx] = Object.assign({}, prevUser, {
                game: reacted.updatedUserGame,
                content: reacted.updatedUserContent
              });
              const built = (reacted.messages || []).map((m) => stampOutgoingMessage(m));
              next.splice(idx, 1, ...built);
            } else {
              const built = safeBuildMoneyAwareAssistantMessages(ocId, r.reply).map((m) =>
                stampOutgoingMessage(m)
              );
              // 平常对话可能变成「台词 + 红包」两条，重说时替换当前助手消息起的连续助手消息
              let removeCount = 1;
              const fol = list[idx + 1];
              if (
                fol &&
                fol.role === 'assistant' &&
                isMoneyMessage(fol) &&
                list[idx] &&
                list[idx].role === 'assistant' &&
                !isMoneyMessage(list[idx])
              ) {
                removeCount = 2;
              }
              next.splice(idx, removeCount, ...built);
            }
            this._syncMessages(next, true);
            if (shouldRefreshMemory(next.length, next)) {
              setSessionMemory(
                ocId,
                sessionId,
                extractSessionMemory(next, getSessionMemory(ocId, sessionId))
              );
            }
          } else {
            wx.showToast({ title: r.errMsg || '发送失败', icon: 'none', duration: 3000 });
          }
        })
        .catch((err) => {
          const errMsg = (err && (err.errMsg || err.message)) || '请求失败';
          wx.showToast({
            title: /timeout|超时/i.test(errMsg) ? '请求超时，请重试' : errMsg,
            icon: 'none'
          });
        })
        .finally(() => {
          this._setChatLoading(false);
        });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '请求失败';
        wx.showToast({ title: msg, icon: 'none' });
      this._setChatLoading(false);
    }
  },

  onMessageLongPress(e) {
    if (this.data.loading) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    if (!ocId || !sessionId) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!msg || msg.role !== 'user') return;
    if (!msg.canRecall) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清除情景',
      content: '确定清除当前对话的情景设定？',
      confirmText: '确定',
      success: (res) => {
        if (!res.confirm) return;
        const next = list.slice();
        next[idx] = Object.assign({}, msg, { recalled: true, content: '' });
        this._syncMessages(next, true);
        setMessages(ocId, sessionId, next);
      }
    });
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value || '', composerToolsOpen: false });
  },

  onToggleComposerTools() {
    if (!this.data.selectedId || this.data.loading || this.data.diceRolling) return;
    this.setData({ composerToolsOpen: !this.data.composerToolsOpen, chatMoreOpen: false });
  },

  onCloseComposerTools() {
    if (this.data.composerToolsOpen) this.setData({ composerToolsOpen: false });
  },

  onRollDiceTap() {
    if (this.data.loading || this.data.diceRolling) return;
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    this.setData({ composerToolsOpen: false });
    this._startDiceRoll();
  },

  onRedPacketTap() {
    this._openMoneySheet(MONEY_TYPE_RED);
  },

  onTransferTap() {
    this._openMoneySheet(MONEY_TYPE_TRANSFER);
  },

  _openMoneySheet(type) {
    if (this.data.loading || this.data.diceRolling) return;
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const isTransfer = type === MONEY_TYPE_TRANSFER;
    this.setData({
      composerToolsOpen: false,
      moneySheetVisible: true,
      moneySheetType: isTransfer ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED,
      moneySheetTitle: isTransfer ? '转账' : '发红包',
      moneyAmountInput: isTransfer ? '50.00' : '6.66',
      moneyPresets: isTransfer ? MONEY_PRESETS_TRANSFER : MONEY_PRESETS_RED
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
    this.setData({ moneyAmountInput: formatMoneyAmount(amount) });
  },

  onConfirmMoneySend() {
    if (this.data.loading || this.data.diceRolling) return;
    const type =
      this.data.moneySheetType === MONEY_TYPE_TRANSFER
        ? MONEY_TYPE_TRANSFER
        : MONEY_TYPE_RED;
    const amount = normalizeMoneyAmount(this.data.moneyAmountInput, type);
    if (type === MONEY_TYPE_RED && Number(this.data.moneyAmountInput) > RED_PACKET_MAX) {
      wx.showToast({ title: '红包最多 ' + RED_PACKET_MAX + ' 元', icon: 'none' });
    }
    this.setData({
      moneySheetVisible: false,
      moneyAmountInput: formatMoneyAmount(amount, type)
    });
    this._startMoneySend(type, amount);
  },

  _startMoneySend(type, amount) {
    const work = this.getSelectedWork();
    if (!work || !work.result) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_DM, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._sendMoneyAndReact(type, amount);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _sendMoneyAndReact(type, amount) {
    const roll = createMoneySend(type, amount, 'user');
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    this._recordQuotaRound();
    const moneyMsg = stampOutgoingMessage({
      role: 'user',
      kind: roll.kind,
      game: roll.game,
      content: roll.content
    });
    const history = (this.data.messages || []).slice();
    const messages = history.concat([moneyMsg]);
    this._syncMessages(messages, true);
    this.setData({ scrollTo: 'chat-bottom', msgMenuIndex: -1 });
    this._setChatLoading(true);
    markUserChattedToday(primaryChatOcId(ocId), Date.now());

    const userMessage = buildMoneyDecideUserMessage(roll.game);
    const aiHistory = history
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-10);

    try {
      const sessionMemory = getSessionMemory(ocId, sessionId);
      const work = this.getSelectedWork();
      const systemPrompt = withMoneyReplyRules(
        buildChatSystemPrompt(work, {
          scenario: this.data.scenario,
          userMessage: userMessage,
          sessionMemory
        })
      );
      callCloudFunction({
        name: 'ocChat',
        data: Object.assign(
          {
            systemPrompt,
            userMessage: userMessage,
            history: aiHistory,
            breakCharacterAttempt: false,
            moneyMode: true,
            channel: 'dm'
          },
          buildQuotaSyncPayload()
        ),
        timeout: 60000
      })
        .then((res) => {
          const r = res.result || {};
          if (r.ok && r.reply) {
            const reacted = buildMoneyReactResult(ocId, roll.game, r.reply);
            const next = messages.slice();
            next[next.length - 1] = Object.assign({}, moneyMsg, {
              game: reacted.updatedUserGame,
              content: reacted.updatedUserContent
            });
            const built = (reacted.messages || []).map((m) => stampOutgoingMessage(m));
            const finalMsgs = next.concat(built);
            this._syncMessages(finalMsgs, true);
            if (shouldRefreshMemory(finalMsgs.length, finalMsgs)) {
              setSessionMemory(
                ocId,
                sessionId,
                extractSessionMemory(finalMsgs, getSessionMemory(ocId, sessionId))
              );
            }
            this.setData({ scrollTo: 'chat-bottom' });
          } else {
            wx.showToast({ title: r.errMsg || '发送失败', icon: 'none', duration: 3000 });
          }
        })
        .catch((err) => {
          const msg = (err && (err.errMsg || err.message)) || '请求失败';
          wx.showToast({
            title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg,
            icon: 'none'
          });
        })
        .finally(() => {
          this._setChatLoading(false);
        });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '请求失败';
      wx.showToast({ title: msg, icon: 'none' });
      this._setChatLoading(false);
    }
  },

  onMoneyCardTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const list = this.data.messages || [];
    const msg = list[idx];
    if (!isMoneyMessage(msg) || msg.role !== 'assistant') return;
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
          title:
            action === 'reject'
              ? '已退回'
              : isTransfer
                ? '已收款'
                : '已领取',
          icon: 'none'
        });
      }
    });
  },

  _startDiceRoll() {
    const work = this.getSelectedWork();
    if (!work || !work.result) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }
    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_DM, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._rollDiceAndReact();
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _rollDiceAndReact() {
    const roll = createDiceRoll();
    const ocPending = rollDie(6).value;
    this.setData({ diceRolling: true, scrollTo: 'chat-bottom', msgMenuIndex: -1 });

    // recovered
    setTimeout(() => {
      const ocId = this.data.selectedId;
      const sessionId = this.data.sessionId;
      this._recordQuotaRound();
      const diceMsg = stampOutgoingMessage({
        role: 'user',
        kind: roll.kind,
        game: roll.game,
        content: roll.content
      });
      const history = (this.data.messages || []).slice();
      const messages = history.concat([diceMsg]);
      this._syncMessages(messages, true);
      this.setData({ diceRolling: false });
      this._setChatLoading(true);
      markUserChattedToday(primaryChatOcId(ocId), Date.now());

      const userMessage = buildDiceDecideUserMessage(roll.game, ocPending);
      const aiHistory = history
        .map(toAiHistoryMessage)
        .filter(Boolean)
        .slice(-10);

      try {
        const sessionMemory = getSessionMemory(ocId, sessionId);
        const work = this.getSelectedWork();
        const systemPrompt = buildChatSystemPrompt(work, {
          scenario: this.data.scenario,
          userMessage: userMessage,
          sessionMemory
        });
        callCloudFunction({
          name: 'ocChat',
          data: Object.assign(
            {
              systemPrompt,
              userMessage: userMessage,
              history: aiHistory,
              breakCharacterAttempt: false,
              diceMode: true,
              channel: 'dm'
            },
            buildQuotaSyncPayload()
          ),
          timeout: 60000
        })
          .then((res) => {
            const r = res.result || {};
            if (r.ok && r.reply) {
              const built = safeBuildDiceAssistantMessages(
                ocId,
                roll.game.value,
                r.reply,
                ocPending
              ).map((m) => stampOutgoingMessage(m));
              const next = messages.concat(built);
              this._syncMessages(next, true);
              if (shouldRefreshMemory(next.length, next)) {
                setSessionMemory(
                  ocId,
                  sessionId,
                  extractSessionMemory(next, getSessionMemory(ocId, sessionId))
                );
              }
              this.setData({ scrollTo: 'chat-bottom' });
            } else {
              wx.showToast({ title: r.errMsg || '发送失败', icon: 'none', duration: 3000 });
            }
          })
          .catch((err) => {
            const msg = (err && (err.errMsg || err.message)) || '请求失败';
          wx.showToast({
            title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg,
              icon: 'none'
            });
          })
          .finally(() => {
            this._setChatLoading(false);
          });
      } catch (err) {
        const msg = (err && (err.message || err.errMsg)) || '请求失败';
        wx.showToast({ title: msg, icon: 'none' });
        this._setChatLoading(false);
      }
    }, 650);
  },

  onSend() {
    if (this.data.loading) return;
    const text = (this.data.inputText || '').trim();
    if (!text) return;
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const work = this.getSelectedWork();
    if (!work || !work.result) {
      wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });
      return;
    }
    const { ensureOcBioForChat } = require('../../utils/ocChatGate.js');
    if (!ensureOcBioForChat(work, this.data.selectedId)) return;
    if (!ensureCloudReady()) {
      wx.showToast({ title: '…', icon: 'none' });
      return;
    }

    ensureAiChatAllowed({ channel: QUOTA_CHANNEL_DM, page: this })
      .then((allowed) => {
        if (!allowed) return;
        this._sendChatMessage(text);
      })
      .catch(() => {
        wx.showToast({ title: '…', icon: 'none' });
      });
  },

  _sendChatMessage(text) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    this._recordQuotaRound();
    const userMsg = stampOutgoingMessage({ role: 'user', content: text });
    const history = (this.data.messages || []).slice();
    const messages = history.concat([userMsg]);
    this.setData({ inputText: '', scrollTo: 'chat-bottom', msgMenuIndex: -1, composerToolsOpen: false });
    this._syncMessages(messages, true);
    this._setChatLoading(true);
    markUserChattedToday(primaryChatOcId(ocId), Date.now());

    try {
      const breakCharacterAttempt = isBreakCharacterAttempt(text);
      const sessionMemory = getSessionMemory(ocId, sessionId);
      const work = this.getSelectedWork();
      const systemPrompt = withMoneyProactiveRules(
        buildChatSystemPrompt(work, {
          scenario: this.data.scenario,
          userMessage: text,
          sessionMemory
        }),
        work
      );
      // 只传近期上下文；体积由 cloudChatPayload 按 UTF-8 字节再压到 100KB 内
      const aiHistory = history
        .map(toAiHistoryMessage)
        .filter(Boolean)
        .slice(-12);
      callCloudFunction({
          name: 'ocChat',
          data: Object.assign(
            {
              systemPrompt,
              userMessage: text,
              history: aiHistory,
              breakCharacterAttempt,
              moneyAware: true,
              channel: 'dm'
            },
            buildQuotaSyncPayload()
          ),
          timeout: 60000
        })
        .then((res) => {
          const r = res.result || {};
          if (r.ok && r.reply) {
            const built = safeBuildMoneyAwareAssistantMessages(ocId, r.reply).map((m) =>
              stampOutgoingMessage(m)
            );
            const next = messages.concat(built);
            this._syncMessages(next, true);
            if (shouldRefreshMemory(next.length, next)) {
              setSessionMemory(
                ocId,
                sessionId,
                extractSessionMemory(next, getSessionMemory(ocId, sessionId))
              );
            }
            this.setData({ scrollTo: 'chat-bottom' });
          } else {
            wx.showToast({ title: r.errMsg || '发送失败', icon: 'none', duration: 3000 });
            this._syncMessages(history, true);
          }
        })
        .catch((err) => {
          const msg = (err && (err.errMsg || err.message)) || '请求失败';
          const friendly = /exceed max size|max size/i.test(msg)
            ? '对话太长，已自动精简后请再发一次'
            : /timeout|超时/i.test(msg)
              ? '请求超时，请重试'
              : msg;
          wx.showToast({
            title: friendly,
            icon: 'none'
          });
          this._syncMessages(history, true);
        })
        .finally(() => {
          this._setChatLoading(false);
        });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '请求失败';
        wx.showToast({ title: msg, icon: 'none' });
      this._syncMessages(history, true);
      this._setChatLoading(false);
    }
  },

  onOpenDataMenu() {
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],
      success: (res) => {
        const favId = resolveFavoriteId(this.data.selectedId) || this.data.selectedId;
        const baseName = (this.data.selectedName || 'chat') + '_chat';
        if (res.tapIndex === 0) {
          const text = buildChatShareText(favId);
          if (!text) {
            wx.showToast({ title: '导出失败', icon: 'none' });
            return;
          }
          packPage.runShareTextFile(text, baseName);
        } else if (res.tapIndex === 1) {
          const pack = buildChatPack(favId);
          if (!pack) {
            wx.showToast({ title: '导出失败', icon: 'none' });
            return;
          }
          sharePackFile(pack, baseName);
        } else if (res.tapIndex === 2) {
          packPage.runImportPack({ targetFavoriteId: favId }, () => {
            this._loadSession(this.data.selectedId, this.data.sessionId);
          });
        }
      }
    });
  },

  onToggleListMode() {
    this.setData({ ocListCompact: !this.data.ocListCompact });
  },

  onCollapseOcPanel() {
    this.setData({ ocPanelOpen: false });
  },

  onOpenOcPanel() {
    this.setData({ ocPanelOpen: true, ocListCompact: false });
  },

  onToggleOcPanelFromHead() {
    if (this.data.ocPanelOpen) {
      this.onCollapseOcPanel();
    } else {
      this.onOpenOcPanel();
    }
  },

  onSaveChatImage() {
    if (this.data.savingImage) return;
    const messages = (this.data.messages || []).filter((m) => m && m.content);
    if (!this.data.selectedId || !messages.length) {
      wx.showToast({ title: '暂无对话可保存', icon: 'none' });
      return;
    }
    const title =
      '与' + (this.data.selectedName || 'OC') + ' · ' + (this.data.sessionTitle || '对话');
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
                  title: '需要相册权限',
                  content: '保存长图需要相册写入权限',
                  confirmText: '去设置',
                  cancelText: '取消',
                  success: (r) => {
                    if (r.confirm) wx.openSetting();
                  }
                });
              } else {
                wx.showToast({ title: msg || '保存失败', icon: 'none' });
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
          title: (err && err.message) || '导出失败',
          icon: 'none'
        });
      })
      .finally(() => this.setData({ savingImage: false }));
  },

  onShareAppMessage() {
    consumeQuotaShareIfPending(this);
    const meta = this._aiQuotaShareMeta || buildQuotaShareMessage(QUOTA_CHANNEL_DM);
    const name = (this.data.selectedName || '').trim();
    return {
      title: name ? ('和' + name + '聊天中') : meta.title,
      path: meta.path || '/pages/index/index'
    };
  },

  onQuotaSheetShareTap() {
    onQuotaSheetShare(this);
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
  }
});
