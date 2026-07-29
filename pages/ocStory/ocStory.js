const {

  buildOcPickerList,

  buildStoryPromptParts,

  getStoriesFromItem,

  getStoryFromFavorite,

  upsertStoryToFavorite,

  saveStoryWithHistory,

  deleteStoryFromFavorite,

  newStoryId,

  storyPreviewParagraphs

} = require('../../utils/storyStore.js');

const { getFavoriteById, ensureCurrentWorkInFavorites, workFromFavoriteItem } = require('../../utils/favorite.js');
const ocImage = require('../../utils/ocImage.js');
const colors = require('../../utils/colors.js');

const storyContinue = require('../../utils/storyContinue.js');
const packPage = require('../../utils/ocPackPage.js');
const inAppShare = require('../../utils/inAppSharePage.js');
const {
  buildStoryPack,
  buildStoryShareText
} = require('../../utils/ocPack.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { buildSegmentNavStyle } = require('../../utils/wxNavSafe.js');
const { getModalConfirmColor } = require('../../utils/uiTheme.js');
const staticAssets = require('../../utils/staticAssets.js');

Page({

  data: {

    ocList: [],

    swiperIndex: 0,

    currentOc: null,

    switchScrollId: '',

    userInput: '',

    storyTitle: '',

    story: '',

    storyId: '',

    saved: false,

    loading: false,

    savedStories: [],

    continueSheetVisible: false,

    continueInput: '',

    continuing: false,

    storyWritingExiting: false,

    storyWritingTip: '',

    continueContext: null,

    pasteStoryTitle: '',

    pasteStoryContent: '',

    expandedStoryIds: {},

    storySegmentOptions: [
      { key: 'bio', label: '小传' },
      { key: 'story', label: '故事' }
    ],
    segmentNavStyle: '',

    settingsExpanded: false,

    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder(),

    uiThemeClass: '',

    ...inAppShare.shareSheetDefaults()

  },

  onLoad() {
    applyPageGradientBg();
    this.setData({ segmentNavStyle: buildSegmentNavStyle() });
    inAppShare.bindSharePage(this);
  },



  noop: storyContinue.noop,



  onShow() {
    applyPageGradientBg();
    this.setData({ segmentNavStyle: buildSegmentNavStyle() });
    try {

      ensureCurrentWorkInFavorites();

      this._reloadList(this.data.swiperIndex);

    } catch (err) {

      console.error('[ocStory] onShow', err);

      wx.showToast({ title: '故事页加载失败', icon: 'none' });

    }

  },



  _mapSavedStories(list) {

    return (list || []).map((s) =>

      Object.assign({}, s, {

        preview: storyPreviewParagraphs(s.content, 3)

      })

    );

  },

  _buildDefaultExpandedStoryIds(stories) {

    const ids = {};

    const list = stories || [];

    if (list.length <= 3) {

      list.forEach((s) => {

        if (s && s.id) ids[s.id] = true;

      });

    }

    return ids;

  },



  _patchOcIndex(patch, ocList, idx) {

    const list = ocList || patch.ocList || this.data.ocList || [];

    const i = typeof idx === 'number' ? idx : this.data.swiperIndex || 0;

    patch.swiperIndex = i;

    patch.currentOc = list[i] || null;

    patch.switchScrollId = 'story-switch-' + i;

    return patch;

  },



  async _reloadList(keepIndex) {

    const rawList = buildOcPickerList();

    const ocList = [];

    for (const entry of rawList) {

      let source = null;

      if (entry.id === '__work__') {

        source = wx.getStorageSync('oc_work_in_progress') || {};

      } else {

        const item = getFavoriteById(entry.id);

        source = item ? workFromFavoriteItem(item) || item : null;

      }

      const ocImagePath = source ? await ocImage.resolveDisplayImagePath(source) : '';

      const r = entry.result || {};

      ocList.push({

        ...entry,

        ocImagePath,

        hairHex: colors.getHairColor(r.hairColor),

        eyeHex: colors.getEyeColor(r.eyeColor)

      });

    }

    let idx = typeof keepIndex === 'number' ? keepIndex : 0;

    if (idx >= ocList.length) idx = Math.max(0, ocList.length - 1);

    const cur = ocList[idx];

    const patch = { ocList };

    this._patchOcIndex(patch, ocList, idx);

    if (!cur || !cur.hasBio) {

      patch.story = '';

      patch.storyId = '';

      patch.storyTitle = '';

      patch.saved = false;

      patch.savedStories = [];

      patch.expandedStoryIds = {};

    } else {

      this._loadStoriesFor(cur.id, patch);

    }

    this.setData(patch);

  },



  _loadStoriesFor(favoriteId, patch) {

    let fid = favoriteId;

    if (fid === '__work__') fid = ensureCurrentWorkInFavorites() || '';

    const item = fid ? getFavoriteById(fid) : null;

    const raw = getStoriesFromItem(item);

    if (!patch) patch = {};

    if (!this.data.storyId || this._currentFavId !== favoriteId) {

      patch.story = '';

      patch.storyId = '';

      patch.storyTitle = '';

      patch.saved = false;

    }

    patch.savedStories = this._mapSavedStories(raw);

    patch.expandedStoryIds = this._buildDefaultExpandedStoryIds(patch.savedStories);

    this._currentFavId = fid;

    return patch;

  },



  _currentOc() {

    const list = this.data.ocList || [];

    const idx = this.data.swiperIndex || 0;

    return list[idx] || null;

  },



  _favoriteIdFor(cur) {

    if (!cur) return '';

    if (cur.id && cur.id !== '__work__') return cur.id;

    return ensureCurrentWorkInFavorites() || '';

  },



  _requireTitle() {

    const title = (this.data.storyTitle || '').trim();

    if (!title) {

      wx.showToast({ title: '请先填写故事题目', icon: 'none' });

      return '';

    }

    return title;

  },



  _saveStoryDraft(withHistory) {

    const cur = this._currentOc();

    const story = (this.data.story || '').trim();

    const title = (this.data.storyTitle || '').trim();

    if (!cur || !story || !title) return false;

    const favId = this._favoriteIdFor(cur);

    if (!favId) return false;

    const id = this.data.storyId || newStoryId();

    const entry = {

      id: id,

      title: title,

      userPrompt: this.data.userInput,

      content: story,

      time: Date.now()

    };

    const ok =

      withHistory && this.data.storyId

        ? saveStoryWithHistory(favId, entry)

        : upsertStoryToFavorite(favId, entry);

    if (!ok) return false;

    const item = getFavoriteById(favId);

    const savedStories = this._mapSavedStories(getStoriesFromItem(item));

    this.setData({

      storyId: id,

      saved: true,

      savedStories,

      expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

    });

    return true;

  },



  _tryAutoSaveDraft() {

    return this._saveStoryDraft(false);

  },



  _switchToIndex(idx) {

    if (idx === this.data.swiperIndex) return;

    this._tryAutoSaveDraft();

    const cur = (this.data.ocList || [])[idx];

    const patch = { userInput: this.data.userInput };

    this._patchOcIndex(patch, null, idx);

    patch.expandedStoryIds = {};

    patch.settingsExpanded = false;

    if (!cur || !cur.hasBio) {

      patch.story = '';

      patch.storyId = '';

      patch.storyTitle = '';

      patch.saved = false;

      patch.savedStories = [];

    } else {

      this._loadStoriesFor(cur.id, patch);

    }

    this.setData(patch);

  },



  onSwitchOc(e) {

    const idx = Number(e.currentTarget.dataset.index);

    if (Number.isNaN(idx)) return;

    this._switchToIndex(idx);

  },



  onToggleSettings() {

    this.setData({ settingsExpanded: !this.data.settingsExpanded });

  },



  onOpenChapter(e) {

    const storyId = e.currentTarget.dataset.id;

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId || !storyId) return;

    storyContinue.openChapter(favId, storyId, false);

  },

  onToggleSavedStory(e) {

    const storyId = e.currentTarget.dataset.id;

    if (!storyId) return;

    const key = 'expandedStoryIds.' + storyId;

    this.setData({

      [key]: !this.data.expandedStoryIds[storyId]

    });

  },

  onEditStory(e) {

    const storyId = e.currentTarget.dataset.id;

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId || !storyId) return;

    storyContinue.openChapter(favId, storyId, false, true);

  },



  onRoleplayStory(e) {

    const storyId = e.currentTarget.dataset.id;

    const cur = this._currentOc();

    if (!cur || !storyId) return;

    const favId = this._favoriteIdFor(cur);

    if (!favId) {

      wx.showToast({ title: '请先保存 OC 设定', icon: 'none' });

      return;

    }

    const ocId = cur.id === '__work__' ? '__work__' : favId;

    const { ensureOcIdBioForChat } = require('../../utils/ocChatGate.js');
    if (!ensureOcIdBioForChat(ocId === '__work__' ? favId || ocId : ocId)) return;

    wx.navigateTo({

      url:

        '/pages/ocChat/ocChat?ocId=' +

        encodeURIComponent(ocId) +

        '&storyId=' +

        encodeURIComponent(storyId) +

        '&newSession=1'

    });

  },

  onDeleteSavedStory(e) {

    const storyId = e.currentTarget.dataset.id;

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId || !storyId) return;

    const story = getStoryFromFavorite(favId, storyId);

    const title = (story && story.title) || '未命名故事';

    wx.showModal({

      title: '删除故事',

      content: '确定删除「' + title + '」？此操作不可恢复。',

      confirmText: '删除',

      confirmColor: '#c62828',

      success: (res) => {

        if (!res.confirm) return;

        if (!deleteStoryFromFavorite(favId, storyId)) {

          wx.showToast({ title: '删除失败', icon: 'none' });

          return;

        }

        const item = getFavoriteById(favId);

        const savedStories = this._mapSavedStories(getStoriesFromItem(item));

        const patch = {

          savedStories,

          expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

        };

        if (this.data.storyId === storyId) {

          patch.story = '';

          patch.storyId = '';

          patch.storyTitle = '';

          patch.saved = false;

        }

        this.setData(patch);

        wx.showToast({ title: '已删除', icon: 'none' });

      }

    });

  },



  _openContinueSheet(context) {

    this.setData({

      continueSheetVisible: true,

      continueInput: '',

      continueContext: context

    });

  },



  onContinueStory() {

    const story = (this.data.story || '').trim();

    if (!story) return;

    const title = this._requireTitle();

    if (!title) return;

    if (!this.data.saved && !this._tryAutoSaveDraft()) {

      wx.showToast({ title: '请先保存故事', icon: 'none' });

      return;

    }

    this._openContinueSheet({

      storyId: this.data.storyId,

      title,

      content: story,

      userPrompt: this.data.userInput || ''

    });

  },



  onContinueSavedStory(e) {

    const storyId = e.currentTarget.dataset.id;

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId || !storyId) return;

    const story = getStoryFromFavorite(favId, storyId);

    if (!story || !story.content) {

      wx.showToast({ title: '故事不存在', icon: 'none' });

      return;

    }

    this._openContinueSheet({

      storyId: story.id,

      title: story.title || '未命名故事',

      content: story.content,

      userPrompt: story.userPrompt || ''

    });

  },



  onContinueInput(e) {

    this.setData({ continueInput: e.detail.value || '' });

  },



  onCancelContinue() {

    this.setData({ continueSheetVisible: false, continueInput: '', continueContext: null });

  },



  onConfirmContinue() {

    if (this.data.continuing || this.data.storyWritingExiting || this.data.loading) return;

    const ctx = this.data.continueContext;

    if (!ctx) return;

    const direction = (this.data.continueInput || '').trim();

    if (!direction) {

      wx.showToast({ title: '请输入续写方向', icon: 'none' });

      return;

    }

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId) return;



    storyContinue.startContinueGeneration(this, {

      favId,

      previousStory: ctx.content,

      sourceTitle: ctx.title,

      prevPrompt: ctx.userPrompt,

      direction,

      parentStoryId: ctx.storyId,

      onSuccess: (newId) => {

        const item = getFavoriteById(favId);

        const savedStories = this._mapSavedStories(getStoriesFromItem(item));

        this.setData({

          continueInput: '',

          continueContext: null,

          savedStories,

          expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

        });

        storyContinue.openChapter(favId, newId, false);

      },

      onFail: () => {

        this.setData({ continueSheetVisible: true });

      }

    });

  },



  onUserInput(e) {

    this.setData({ userInput: e.detail.value || '' });

  },



  onStoryTitleInput(e) {

    this.setData({ storyTitle: e.detail.value || '' });

  },



  onPasteStoryTitleInput(e) {

    this.setData({ pasteStoryTitle: e.detail.value || '' });

  },



  onPasteStoryContentInput(e) {

    this.setData({ pasteStoryContent: e.detail.value || '' });

  },



  onSavePastedStory() {

    const cur = this._currentOc();

    if (!cur) {

      wx.showToast({ title: '请先选择 OC', icon: 'none' });

      return;

    }

    const title = (this.data.pasteStoryTitle || '').trim();

    const content = (this.data.pasteStoryContent || '').trim();

    if (!title) {

      wx.showToast({ title: '请填写故事题目', icon: 'none' });

      return;

    }

    if (!content) {

      wx.showToast({ title: '请粘贴故事正文', icon: 'none' });

      return;

    }

    const favId = this._favoriteIdFor(cur);

    if (!favId) {

      wx.showToast({ title: '未找到设定本记录', icon: 'none' });

      return;

    }

    const id = newStoryId();

    const entry = {

      id,

      title,

      userPrompt: '',

      content,

      time: Date.now()

    };

    const ok = upsertStoryToFavorite(favId, entry);

    if (!ok) {

      wx.showToast({ title: '保存失败', icon: 'none' });

      return;

    }

    const item = getFavoriteById(favId);

    const savedStories = this._mapSavedStories(getStoriesFromItem(item));

    this.setData({

      pasteStoryTitle: '',

      pasteStoryContent: '',

      savedStories,

      expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

    });

    wx.showToast({ title: '故事已保存', icon: 'success' });

  },



  onStoryInput(e) {

    this.setData({ story: e.detail.value || '' });

  },



  onGenerate() {

    const cur = this._currentOc();

    if (!cur || !cur.hasBio) {

      wx.showToast({ title: '请先在 OC 小传中生成小传', icon: 'none' });

      return;

    }

    if (this.data.loading) return;

    const userInput = (this.data.userInput || '').trim();

    if (!userInput) {

      wx.showToast({ title: '请输入故事方向', icon: 'none' });

      return;

    }

    const favId = this._favoriteIdFor(cur);

    const parts = buildStoryPromptParts(favId);

    if (!parts) {

      wx.showToast({ title: '缺少 OC 小传', icon: 'none' });

      return;

    }

    if (!wx.cloud) {

      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });

      return;

    }



    this.setData({

      loading: true,

      story: '',

      storyId: '',

      storyTitle: '',

      saved: false

    });

    wx.cloud

      .callFunction({

        name: 'generateOcStory',

        data: {

          ocSetting: parts.ocSetting,

          ocBio: parts.ocBio,

          userInput: userInput

        },

        timeout: 60000

      })

      .then((res) => {

        const r = res.result || {};

        if (r.ok && r.story) {

          this.setData({

            story: r.story,

            storyId: newStoryId(),

            saved: false

          });

        } else {

          wx.showToast({ title: r.errMsg || '生成失败', icon: 'none', duration: 3000 });

        }

      })

      .catch((err) => {

        const msg = (err && (err.errMsg || err.message)) || '';

        wx.showToast({

          title: /timeout|超时/i.test(msg) ? '请求超时，请稍后重试' : msg || '调用失败',

          icon: 'none',

          duration: 3000

        });

      })

      .finally(() => this.setData({ loading: false }));

  },



  _collapseStoryDraft() {

    const cur = this._currentOc();

    const favId = cur ? this._favoriteIdFor(cur) : '';

    const item = favId ? getFavoriteById(favId) : null;

    const savedStories = this._mapSavedStories(getStoriesFromItem(item));

    this.setData({

      userInput: '',

      story: '',

      storyId: '',

      storyTitle: '',

      saved: false,

      savedStories,

      expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

    });

  },



  onSaveStory() {

    if (!(this.data.story || '').trim()) return;

    if (!this._requireTitle()) return;

    const isUpdate = !!(this.data.storyId && this.data.saved);

    const doSave = () => {

      if (this._saveStoryDraft(isUpdate)) {

        this._collapseStoryDraft();

        wx.showToast({ title: '已保存，可继续创作', icon: 'none' });

      } else {

        wx.showToast({ title: '保存失败', icon: 'none' });

      }

    };

    if (isUpdate) {

      wx.showModal({

        title: '确认保存',

        content: '保存后将替换当前故事正文，上一版会自动存入历史版本。',

        confirmText: '保存',

        confirmColor: getModalConfirmColor(),

        success: (res) => {

          if (res.confirm) doSave();

        }

      });

      return;

    }

    doSave();

  },



  onCopyStory() {

    const story = this.data.story;

    if (!story) return;

    wx.setClipboardData({

      data: story,

      success: () => wx.showToast({ title: '已复制', icon: 'success' })

    });

  },



  onDeleteStory() {

    const cur = this._currentOc();

    const story = (this.data.story || '').trim();

    if (!story) return;

    const favId = this._favoriteIdFor(cur);

    if (this.data.saved && this.data.storyId && favId) {

      deleteStoryFromFavorite(favId, this.data.storyId);

      const item = getFavoriteById(favId);

      const savedStories = this._mapSavedStories(getStoriesFromItem(item));

      this.setData({

        story: '',

        storyId: '',

        storyTitle: '',

        saved: false,

        savedStories,

        expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories)

      });

    } else {

      this.setData({

        story: '',

        storyId: '',

        storyTitle: '',

        saved: false

      });

    }

    wx.showToast({ title: '已删除', icon: 'none' });

  },

  onExportStories() {

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId) {

      wx.showToast({ title: '请先选择 OC', icon: 'none' });

      return;

    }

    const baseName = ((cur && cur.name) || 'story') + '_stories';

    packPage.runExportMenu({

      baseName,

      getText: () => {

        const item = getFavoriteById(favId);

        const stories = (item && item.ocStories) || [];

        return stories

          .map((s) => buildStoryShareText(s))

          .filter(Boolean)

          .join('\n\n────────\n\n');

      },

      getPack: () => buildStoryPack(favId)

    });

  },

  onImportStories() {

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    packPage.runImportPack({ targetFavoriteId: favId }, () => {

      this._reloadList(this.data.swiperIndex);

    });

  },

  onShareStories() {

    const cur = this._currentOc();

    const favId = this._favoriteIdFor(cur);

    if (!favId) {

      wx.showToast({ title: '请先选择 OC', icon: 'none' });

      return;

    }

    const item = getFavoriteById(favId);

    const stories = (item && item.ocStories) || [];

    const body = stories

      .map((s) => buildStoryShareText(s))

      .filter(Boolean)

      .join('\n\n────────\n\n');

    if (!body) {

      wx.showToast({ title: '暂无故事可分享', icon: 'none' });

      return;

    }

    const name = (cur && cur.name) || 'OC';

    packPage.runShareText(name + ' 的故事', body, {

      shareTitle: name + ' 的 OC 故事',

      path: inAppShare.buildOcSharePath(favId)

    });

  },

  onShareAppMessage() {

    return inAppShare.buildShareMessage(this);

  },

  onCloseShareSheet() {

    inAppShare.closeShareSheet(this);

  },

  onStorySegmentChange(e) {
    if (e.detail && e.detail.key === 'bio') {
      wx.redirectTo({ url: '/pages/ocBioHub/ocBioHub' });
    }
  }

});


