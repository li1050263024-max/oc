/**
 * Re-apply display-window + export UX patches onto a clean ocChat.js (UTF-8 only).
 * Run: node scripts/repatch-ocChat-display.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '../pages/ocChat/ocChat.js');
let s = fs.readFileSync(file, 'utf8');

function mustReplace(label, from, to) {
  if (!s.includes(from)) {
    throw new Error('missing block: ' + label);
  }
  s = s.replace(from, to);
}

mustReplace(
  'msgDisplayOffset data',
  `    msgMenuIndex: -1,
    chatMoreOpen: false,`,
  `    msgMenuIndex: -1,
    msgDisplayOffset: 0,
    chatMoreOpen: false,`
);

mustReplace(
  'onShow sync',
  `    if (this.data.sessionId && (this.data.messages || []).length) {
      this._syncMessages(stripMessageUiFields(this.data.messages), false);
    } else if (this.data.selectedId && this.data.sessionId) {
      this._loadSession(this.data.selectedId, this.data.sessionId);
    }`,
  `    if (this._fullMessages && this._fullMessages.length) {
      this._syncMessages(stripMessageUiFields(this._fullMessages), false);
    } else if (this.data.selectedId && this.data.sessionId) {
      this._loadSession(this.data.selectedId, this.data.sessionId);
    }`
);

mustReplace(
  '_syncMessages',
  `  _syncMessages(rawMessages, persist) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const prepared = prepareMessagesForDisplay(rawMessages);
    this.setData({ messages: prepared.list, msgMenuIndex: -1 });
    if (persist && ocId && sessionId) {
      setMessages(ocId, sessionId, stripMessageUiFields(prepared.list));
    }
    return prepared.list;
  },`,
  `  _syncMessages(rawMessages, persist) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const prepared = prepareMessagesForDisplay(rawMessages);
    const full = prepared.list || [];
    this._fullMessages = full;
    // 界面只渲染最近若干条，避免 Android「height out of range > 8192」
    const DISPLAY_MAX = 36;
    const BUBBLE_MAX = 2200;
    let display = full.length > DISPLAY_MAX ? full.slice(-DISPLAY_MAX) : full;
    const msgDisplayOffset = Math.max(0, full.length - display.length);
    display = display.map((m, i) => {
      if (!m) return m;
      const c = String(m.content || '');
      const clipped = c.length > BUBBLE_MAX ? c.slice(0, BUBBLE_MAX) + '\\n…' : c;
      const vk =
        String(m.createdAt || m.fakeAt || '') +
        '-' +
        (m.role || '') +
        '-' +
        (msgDisplayOffset + i);
      return Object.assign({}, m, { content: clipped, _vk: vk });
    });
    this.setData({
      messages: display,
      msgDisplayOffset: msgDisplayOffset,
      msgMenuIndex: -1
    });
    if (persist && ocId && sessionId) {
      setMessages(ocId, sessionId, stripMessageUiFields(full));
    }
    return full;
  },

  _getWorkingMessages() {
    if (Array.isArray(this._fullMessages) && this._fullMessages.length) {
      return this._fullMessages.slice();
    }
    return this._getStoredMessages();
  },

  _toFullIndex(displayIdx) {
    return (Number(this.data.msgDisplayOffset) || 0) + Number(displayIdx);
  },

  _getStoredMessages() {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    if (!ocId || !sessionId) return (this.data.messages || []).slice();
    try {
      return avatarPage.normalizeOcChatMessages(
        ocId,
        getMessages(ocId, sessionId)
      );
    } catch (_) {
      return (this.data.messages || []).slice();
    }
  },`
);

// Fix accidental double-escape of \\n… in the written source — we want '\n…'
s = s.replace(
  "c.slice(0, BUBBLE_MAX) + '\\\\n…'",
  "c.slice(0, BUBBLE_MAX) + '\\n…'"
);

mustReplace(
  'loading watch',
  `      wx.showToast({ title: '请求超时，请重试', icon: 'none' });
    }, 70000);
  },`,
  `      wx.showToast({ title: '请求超时，请重试', icon: 'none' });
    }, 56000);
  },`
);

mustReplace(
  '_loadSession',
  `    const raw = avatarPage.normalizeOcChatMessages(ocId, getMessages(ocId, sessionId));
    const prepared = prepareMessagesForDisplay(raw);
    this.setData({
      sessionId: sessionId,
      sessionTitle: (meta && meta.title) || '对话',
      messages: prepared.list,
      msgMenuIndex: -1,`,
  `    const raw = avatarPage.normalizeOcChatMessages(ocId, getMessages(ocId, sessionId));
    this._syncMessages(raw, false);
    this.setData({
      sessionId: sessionId,
      sessionTitle: (meta && meta.title) || '对话',
      msgMenuIndex: -1,`
);

mustReplace(
  'onMsgDelete',
  `    const list = (this.data.messages || []).slice();
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
  },`,
  `    const fullIdx = this._toFullIndex(idx);
    const list = this._getWorkingMessages();
    const msg = list[fullIdx];
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
        next.splice(fullIdx, 1);
        this._syncMessages(next, true);
      }
    });
  },`
);

mustReplace(
  'onMsgRegenerate',
  `    const list = this.data.messages || [];
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
      })`,
  `    const fullIdx = this._toFullIndex(idx);
    const list = this._getWorkingMessages();
    const msg = list[fullIdx];
    if (!msg || msg.role === 'user') return;
    const userIdx = findPrecedingUserMessage(list, fullIdx);
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
        this._regenerateChatMessage(fullIdx, userIdx);
      })`
);

mustReplace(
  '_regenerateChatMessage list',
  `  _regenerateChatMessage(idx, userIdx) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const list = this.data.messages || [];`,
  `  _regenerateChatMessage(idx, userIdx) {
    const ocId = this.data.selectedId;
    const sessionId = this.data.sessionId;
    const list = this._getWorkingMessages();`
);

mustReplace(
  'regen history slice',
  `    const history = list
      .slice(0, userIdx)
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-12);`,
  `    const history = list
      .slice(0, userIdx)
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-8);`
);

mustReplace(
  'onMessageLongPress',
  `    const list = this.data.messages || [];
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
  },`,
  `    const fullIdx = this._toFullIndex(idx);
    const list = this._getWorkingMessages();
    const msg = list[fullIdx];
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
        next[fullIdx] = Object.assign({}, msg, { recalled: true, content: '' });
        this._syncMessages(next, true);
      }
    });
  },`
);

mustReplace(
  'money history',
  `    const history = (this.data.messages || []).slice();
    const messages = history.concat([moneyMsg]);
    this._syncMessages(messages, true);
    this.setData({ scrollTo: 'chat-bottom', msgMenuIndex: -1 });
    this._setChatLoading(true);
    markUserChattedToday(primaryChatOcId(ocId), Date.now());

    const userMessage = buildMoneyDecideUserMessage(roll.game);
    const aiHistory = history
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-10);`,
  `    const history = this._getWorkingMessages();
    const messages = history.concat([moneyMsg]);
    this._syncMessages(messages, true);
    this.setData({ scrollTo: 'chat-bottom', msgMenuIndex: -1 });
    this._setChatLoading(true);
    markUserChattedToday(primaryChatOcId(ocId), Date.now());

    const userMessage = buildMoneyDecideUserMessage(roll.game);
    const aiHistory = history
      .map(toAiHistoryMessage)
      .filter(Boolean)
      .slice(-8);`
);

mustReplace(
  'onMoneyCardTap',
  `  onMoneyCardTap(e) {
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
        this._syncMessages(next, true);`,
  `  onMoneyCardTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (isNaN(idx) || idx < 0) return;
    const fullIdx = this._toFullIndex(idx);
    const list = this._getWorkingMessages();
    const msg = list[fullIdx];
    if (!isMoneyMessage(msg) || msg.role !== 'assistant') return;
    const st = msg.game && msg.game.status;
    if (st !== 'sent' && st !== 'waiting') return;
    const isTransfer = msg.game && msg.game.type === MONEY_TYPE_TRANSFER;
    wx.showActionSheet({
      itemList: [isTransfer ? '收款' : '领取', '退回'],
      success: (res) => {
        const action = res.tapIndex === 1 ? 'reject' : 'claim';
        const next = this._getWorkingMessages();
        const cur = next[fullIdx];
        const updated =
          action === 'reject' ? rejectOcMoneyMessage(cur) : claimOcMoneyMessage(cur);
        if (!updated) return;
        next[fullIdx] = Object.assign({}, cur, updated);
        this._syncMessages(next, true);`
);

mustReplace(
  'dice history',
  `      const history = (this.data.messages || []).slice();
      const messages = history.concat([diceMsg]);
      this._syncMessages(messages, true);
      this.setData({ diceRolling: false });
      this._setChatLoading(true);
      markUserChattedToday(primaryChatOcId(ocId), Date.now());

      const userMessage = buildDiceDecideUserMessage(roll.game, ocPending);
      const aiHistory = history
        .map(toAiHistoryMessage)
        .filter(Boolean)
        .slice(-10);`,
  `      const history = this._getWorkingMessages();
      const messages = history.concat([diceMsg]);
      this._syncMessages(messages, true);
      this.setData({ diceRolling: false });
      this._setChatLoading(true);
      markUserChattedToday(primaryChatOcId(ocId), Date.now());

      const userMessage = buildDiceDecideUserMessage(roll.game, ocPending);
      const aiHistory = history
        .map(toAiHistoryMessage)
        .filter(Boolean)
        .slice(-8);`
);

mustReplace(
  '_sendChatMessage',
  `    const userMsg = stampOutgoingMessage({ role: 'user', content: text });
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
        .slice(-12);`,
  `    const userMsg = stampOutgoingMessage({ role: 'user', content: text });
    const history = this._getWorkingMessages();
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
        .slice(-8);`
);

s = s.replace(/timeout: 60000/g, 'timeout: 55000');

mustReplace(
  'onOpenDataMenu',
  `  onOpenDataMenu() {
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
  },`,
  `  onOpenDataMenu() {
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    // 导出读本地完整会话（含界面未展示的旧消息），经微信「发送给朋友」下载到手机
    wx.showActionSheet({
      itemList: ['导出完整 txt（发给朋友/文件传输助手）', '导出完整 JSON 备份', '导入对话'],
      success: (res) => {
        const favId = resolveFavoriteId(this.data.selectedId) || this.data.selectedId;
        const baseName = (this.data.selectedName || 'chat') + '_chat';
        if (res.tapIndex === 0) {
          const text = buildChatShareText(favId);
          if (!text) {
            wx.showToast({ title: '暂无对话可导出', icon: 'none' });
            return;
          }
          packPage.runShareTextFile(text, baseName);
        } else if (res.tapIndex === 1) {
          const pack = buildChatPack(favId);
          if (!pack) {
            wx.showToast({ title: '暂无对话可导出', icon: 'none' });
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
  },`
);

mustReplace(
  'onSaveChatImage',
  `    const messages = (this.data.messages || []).filter((m) => m && m.content);`,
  `    const messages = this._getWorkingMessages().filter((m) => m && m.content);`
);

try {
  new vm.Script(s, { filename: 'ocChat.js' });
} catch (e) {
  console.error('PARSE FAIL', e.message);
  process.exit(1);
}

fs.writeFileSync(file, s, 'utf8');
console.log('patched OK', file, 'len=', s.length);
console.log('has _fullMessages helpers', s.includes('_getWorkingMessages'));
console.log('has 导出完整', s.includes('导出完整 txt'));
