const { getFavoriteById } = require('../../utils/favorite.js');
const {
  getStoryFromFavorite,
  saveStoryWithHistory,
  mapHistoryForDisplay,
  pickCollection,
  moveStoryToCollection,
  ensureCollectionsMigrated,
  listCollections
} = require('../../utils/storyStore.js');
const storyContinue = require('../../utils/storyContinue.js');
const packPage = require('../../utils/ocPackPage.js');
const inAppShare = require('../../utils/inAppSharePage.js');
const { buildStoryShareText } = require('../../utils/ocPack.js');
const { buildLineDiff, hasDiff } = require('../../utils/storyDiff.js');
const { getModalConfirmColor, syncPageTheme } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

const MIN_EDIT_HEIGHT = 200;
const GROW_CHAR_THRESHOLD = 100;
const TEXTAREA_PAD_RPX = 24;

Page({
  data: {
    ocId: '',
    storyId: '',
    title: '',
    content: '',
    userPrompt: '',
    ocName: '',
    editMode: false,
    textareaHeight: MIN_EDIT_HEIGHT,
    polishBeforeContent: '',
    polishCompareReady: false,
    compareVisible: false,
    compareRows: [],
    historyVisible: false,
    historyList: [],
    historyPreviewVisible: false,
    historyPreviewTitle: '',
    historyPreviewContent: '',
    historyPreviewTime: '',
    continueSheetVisible: false,
    continueInput: '',
    continueCostHint: '',
    continuing: false,
    polishSheetVisible: false,
    polishInput: '',
    polishing: false,
    storyWritingExiting: false,
    storyWritingTip: '',
    uiThemeClass: '',
    ...inAppShare.shareSheetDefaults()
  },

  noop: storyContinue.noop,

  _calcEditHeightFromContent(content) {
    const text = String(content || '');
    if (!text) return MIN_EDIT_HEIGHT;
    const charsPerLine = 24;
    const lineHeight = 49;
    const pad = TEXTAREA_PAD_RPX;
    const lines = text.split('\n');
    let rows = 0;
    lines.forEach((line) => {
      rows += Math.max(1, Math.ceil(line.length / charsPerLine));
    });
    return Math.max(MIN_EDIT_HEIGHT, Math.ceil(rows * lineHeight + pad));
  },

  _lockEditHeight(content, heightRpx) {
    const h = Math.max(MIN_EDIT_HEIGHT, Math.ceil(heightRpx || MIN_EDIT_HEIGHT));
    this._editContentBaseline = String(content || '').length;
    this._editHeightLocked = h;
    this.setData({ editMode: true, textareaHeight: h });
  },

  _enterEditFromReadLayout(content) {
    wx.createSelectorQuery()
      .in(this)
      .select('.chapter-body')
      .boundingClientRect((rect) => {
        let heightRpx;
        if (rect && rect.height > 0) {
          const sys = wx.getSystemInfoSync();
          heightRpx = rect.height * (750 / sys.windowWidth) + TEXTAREA_PAD_RPX;
        } else {
          heightRpx = this._calcEditHeightFromContent(content);
        }
        this._lockEditHeight(content, heightRpx);
      })
      .exec();
  },

  _maybeGrowTextarea(content) {
    const text = String(content || '');
    const len = text.length;
    const baseline = this._editContentBaseline || 0;
    if (len - baseline < GROW_CHAR_THRESHOLD) return null;
    const needed = this._calcEditHeightFromContent(text);
    const next = Math.max(this._editHeightLocked || this.data.textareaHeight, needed);
    if (next <= this.data.textareaHeight) return null;
    this._editHeightLocked = next;
    this._editContentBaseline = len;
    return next;
  },

  _clearPolishCompare() {
    this.setData({
      polishBeforeContent: '',
      polishCompareReady: false,
      compareVisible: false,
      compareRows: []
    });
  },

  _refreshHistoryList(story) {
    this.setData({ historyList: mapHistoryForDisplay(story) });
  },

  onLoad(options) {
    applyPageGradientBg();
    inAppShare.bindSharePage(this);
    const ocId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    const storyId = options && options.storyId ? decodeURIComponent(options.storyId) : '';
    const editMode = !!(options && (options.edit === '1' || options.edit === 'true'));
    if (!ocId || !storyId) {
      wx.showToast({ title: '章节不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    this._loadChapter(ocId, storyId, editMode);
  },

  onShow() {
    syncPageTheme(this);
    applyPageGradientBg();
  },

  _loadChapter(ocId, storyId, editMode) {
    const item = getFavoriteById(ocId);
    const story = getStoryFromFavorite(ocId, storyId);
    if (!item || !story) {
      wx.showToast({ title: '未找到该章节', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    this._clearPolishCompare();
    this.setData(
      {
        ocId,
        storyId,
        title: story.title || '未命名故事',
        content: story.content || '',
        userPrompt: story.userPrompt || '',
        ocName: (item.result && item.result.name) || '',
        editMode: false,
        historyList: mapHistoryForDisplay(story),
        historyPreviewVisible: false
      },
      () => {
        if (editMode) {
          wx.nextTick(() => {
            this._enterEditFromReadLayout(story.content || '');
          });
        }
      }
    );
  },

  onBack() {
    wx.navigateBack();
  },

  onEnterEdit() {
    this._clearPolishCompare();
    this._enterEditFromReadLayout(this.data.content || '');
  },

  onCancelEdit() {
    this._loadChapter(this.data.ocId, this.data.storyId, false);
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value || '' });
  },

  onContentInput(e) {
    const content = e.detail.value || '';
    const patch = { content };
    const nextHeight = this._maybeGrowTextarea(content);
    if (nextHeight) patch.textareaHeight = nextHeight;
    this.setData(patch);
  },

  _performSave(stayInEdit) {
    const title = (this.data.title || '').trim();
    const content = (this.data.content || '').trim();
    const ok = saveStoryWithHistory(this.data.ocId, {
      id: this.data.storyId,
      title,
      userPrompt: this.data.userPrompt,
      content,
      time: Date.now()
    });
    if (!ok) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      return false;
    }
    const story = getStoryFromFavorite(this.data.ocId, this.data.storyId);
    const patch = {
      title,
      content,
      historyList: mapHistoryForDisplay(story)
    };
    if (!stayInEdit) {
      this._clearPolishCompare();
      patch.editMode = false;
    }
    this.setData(patch);
    wx.showToast({ title: '已保存', icon: stayInEdit ? 'none' : 'success' });
    return true;
  },

  _openPolishSheetDirect() {
    this.setData({ polishSheetVisible: true, polishInput: '' });
  },

  onSaveChapter() {
    const title = (this.data.title || '').trim();
    const content = (this.data.content || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写故事题目', icon: 'none' });
      return;
    }
    if (!content) {
      wx.showToast({ title: '正文不能为空', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认保存',
      content: '保存后将替换当前故事正文，上一版会自动存入历史版本。',
      confirmText: '保存',
      confirmColor: getModalConfirmColor(),
      success: (res) => {
        if (!res.confirm) return;
        this._performSave();
      }
    });
  },

  onOpenCompare() {
    const before = this.data.polishBeforeContent || '';
    const after = this.data.content || '';
    if (!hasDiff(before, after)) {
      wx.showToast({ title: '润色前后无差异', icon: 'none' });
      return;
    }
    const compareRows = buildLineDiff(before, after);
    if (!compareRows.length) {
      wx.showToast({ title: '润色前后无差异', icon: 'none' });
      return;
    }
    this.setData({
      compareVisible: true,
      compareRows
    });
  },

  onCloseCompare() {
    this.setData({ compareVisible: false });
  },

  onOpenPolishSheet() {
    if (!(this.data.content || '').trim()) {
      wx.showToast({ title: '请先填写正文', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '润色前提示',
      content: '润色将基于当前正文进行。请先保存你手动修改的内容，以免丢失。',
      confirmText: '保存',
      cancelText: '不保存',
      confirmColor: getModalConfirmColor(),
      success: (res) => {
        if (res.confirm) {
          const title = (this.data.title || '').trim();
          const content = (this.data.content || '').trim();
          if (!title) {
            wx.showToast({ title: '请填写故事题目', icon: 'none' });
            return;
          }
          if (!content) {
            wx.showToast({ title: '正文不能为空', icon: 'none' });
            return;
          }
          if (this._performSave(true)) {
            this._openPolishSheetDirect();
          }
          return;
        }
        if (res.cancel) {
          this._openPolishSheetDirect();
        }
      }
    });
  },

  onPolishInput(e) {
    this.setData({ polishInput: e.detail.value || '' });
  },

  onCancelPolish() {
    this.setData({ polishSheetVisible: false, polishInput: '' });
  },

  onConfirmPolish() {
    if (this.data.polishing || this.data.storyWritingExiting) return;
    const direction = (this.data.polishInput || '').trim();
    if (!direction) {
      wx.showToast({ title: '请输入修改意见', icon: 'none' });
      return;
    }
    const beforeContent = this.data.content || '';
    storyContinue.startStoryRevision(this, {
      favId: this.data.ocId,
      storyBody: beforeContent,
      direction,
      onSuccess: (revised) => {
        const patch = {
          content: revised,
          polishInput: '',
          editMode: true,
          polishBeforeContent: beforeContent,
          polishCompareReady: hasDiff(beforeContent, revised)
        };
        const nextHeight = this._maybeGrowTextarea(revised);
        if (nextHeight) patch.textareaHeight = nextHeight;
        this.setData(patch);
        wx.showToast({ title: '润色完成，请确认后保存', icon: 'none' });
      },
      onFail: () => {
        this.setData({ polishSheetVisible: true });
      }
    });
  },

  onOpenHistory() {
    const story = getStoryFromFavorite(this.data.ocId, this.data.storyId);
    this.setData({
      historyVisible: true,
      historyList: mapHistoryForDisplay(story)
    });
  },

  onCloseHistory() {
    this.setData({ historyVisible: false });
  },

  onPreviewHistory(e) {
    const id = e.currentTarget.dataset.id;
    const story = getStoryFromFavorite(this.data.ocId, this.data.storyId);
    const item = (story && story.history ? story.history : []).find((h) => h.id === id);
    if (!item) return;
    this.setData({
      historyPreviewVisible: true,
      historyPreviewTitle: item.title || '未命名故事',
      historyPreviewContent: item.content || '',
      historyPreviewTime: mapHistoryForDisplay({ history: [item] })[0].timeLabel
    });
  },

  onCloseHistoryPreview() {
    this.setData({ historyPreviewVisible: false });
  },

  onRestoreHistory() {
    const content = this.data.historyPreviewContent || '';
    const title = this.data.historyPreviewTitle || this.data.title;
    if (!content) return;
    wx.showModal({
      title: '恢复此版本',
      content: '将用该历史版本替换当前编辑内容，需保存后才会写入故事。',
      confirmText: '恢复',
      confirmColor: getModalConfirmColor(),
      success: (res) => {
        if (!res.confirm) return;
        const patch = {
          historyPreviewVisible: false,
          historyVisible: false,
          title,
          content,
          editMode: true
        };
        const nextHeight = this._calcEditHeightFromContent(content);
        patch.textareaHeight = Math.max(this.data.textareaHeight, nextHeight);
        this._editContentBaseline = content.length;
        this._editHeightLocked = patch.textareaHeight;
        this._clearPolishCompare();
        this.setData(patch);
        wx.showToast({ title: '已恢复，请确认后保存', icon: 'none' });
      }
    });
  },

  onContinueChapter() {
    if (!(this.data.content || '').trim()) return;
    let continueCostHint = '';
    try {
      continueCostHint = require('../../utils/ocCredits.js').getStoryContinueCostHint();
    } catch (_) {}
    this.setData({ continueSheetVisible: true, continueInput: '', continueCostHint });
  },

  onContinueInput(e) {
    this.setData({ continueInput: e.detail.value || '' });
  },

  onCancelContinue() {
    this.setData({ continueSheetVisible: false, continueInput: '' });
  },

  onConfirmContinue() {
    if (this.data.continuing || this.data.polishing || this.data.storyWritingExiting) return;
    const direction = (this.data.continueInput || '').trim();
    if (!direction) {
      wx.showToast({ title: '请输入续写方向', icon: 'none' });
      return;
    }

    storyContinue.startContinueGeneration(this, {
      favId: this.data.ocId,
      previousStory: this.data.content,
      sourceTitle: this.data.title,
      prevPrompt: this.data.userPrompt,
      direction,
      parentStoryId: this.data.storyId,
      onSuccess: (newId) => {
        this.setData({ continueInput: '' });
        storyContinue.openChapter(this.data.ocId, newId, true);
      },
      onFail: () => {
        this.setData({ continueSheetVisible: true });
      }
    });
  },

  onShareChapter() {
    const { ocId, storyId, title, content } = this.data;
    if (!ocId || !storyId) {
      wx.showToast({ title: '故事未保存', icon: 'none' });
      return;
    }
    const story = { id: storyId, title, content };
    const body = buildStoryShareText(story);
    packPage.runShareText(title || '故事', body, {
      shareTitle: (title || 'OC 故事') + ' · ' + (this.data.ocName || ''),
      path: inAppShare.buildOcSharePath(ocId)
    });
  },

  onMoveCollection() {
    const ocId = this.data.ocId;
    const storyId = this.data.storyId;
    if (!ocId || !storyId) return;
    ensureCollectionsMigrated(ocId);
    const cols = listCollections(ocId);
    if (cols.length < 2) {
      wx.showToast({ title: '请先新建其他故事集', icon: 'none' });
      return;
    }
    pickCollection(ocId, { title: '移到哪个故事集' })
      .then((col) => {
        const r = moveStoryToCollection(ocId, storyId, col.id);
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '移动失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已移至「' + col.name + '」', icon: 'none' });
      })
      .catch((err) => {
        if (err && String(err.message || err) === 'cancel') return;
      });
  },

  onShareAppMessage() {
    return inAppShare.buildShareMessage(this);
  },

  onCloseShareSheet() {
    inAppShare.closeShareSheet(this);
  }
});
