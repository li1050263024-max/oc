const storyStore = require('../../utils/storyStore.js');
const {
  buildOcPickerList,
  buildStoryPromptParts,
  getStoriesFromItem,
  getStoryFromFavorite,
  upsertStoryToFavorite,
  saveStoryWithHistory,
  deleteStoryFromFavorite,
  newStoryId,
  storyPreviewParagraphs,
  ensureCollectionsMigrated,
  createCollection,
  renameCollection
} = storyStore;

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

    continueCostHint: '',

    continuing: false,

    storyWritingExiting: false,

    storyWritingTip: '',

    continueContext: null,

    expandedStoryIds: {},

    storyCollections: [],

    expandedCollectionIds: {},

    vipLimitModalVisible: false,

    oaQrVisible: false,

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

      patch.storyCollections = [];

      patch.expandedStoryIds = {};

      patch.expandedCollectionIds = {};

    } else {

      this._loadStoriesFor(cur.id, patch);

    }

    this.setData(patch);

  },



  _buildStoryCollections(favId) {
    if (!favId) {
      return { storyCollections: [], savedStories: [], expandedStoryIds: {} };
    }
    const migrated = ensureCollectionsMigrated(favId);
    const expandedCol = this.data.expandedCollectionIds || {};
    const hasColState = Object.keys(expandedCol).length > 0;
    const nextExpandedCol = Object.assign({}, expandedCol);
    const storyCollections = migrated.collections.map((c, i) => {
      const stories = this._mapSavedStories(
        migrated.stories.filter((s) => String(s.collectionId || '') === c.id)
      );
      if (!hasColState && i === 0) nextExpandedCol[c.id] = true;
      return {
        id: c.id,
        name: c.name,
        isDefault: !!c.isDefault,
        count: stories.length,
        stories: stories
      };
    });
    const savedStories = this._mapSavedStories(migrated.stories);
    return {
      storyCollections: storyCollections,
      savedStories: savedStories,
      expandedStoryIds: this._buildDefaultExpandedStoryIds(savedStories),
      expandedCollectionIds: nextExpandedCol
    };
  },

  _loadStoriesFor(favoriteId, patch) {

    let fid = favoriteId;

    if (fid === '__work__') fid = ensureCurrentWorkInFavorites() || '';

    if (!patch) patch = {};

    if (!this.data.storyId || this._currentFavId !== favoriteId) {

      patch.story = '';

      patch.storyId = '';

      patch.storyTitle = '';

      patch.saved = false;

    }

    Object.assign(patch, this._buildStoryCollections(fid));

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

    this.setData(
      Object.assign({ storyId: id, saved: true }, this._buildStoryCollections(favId))
    );

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

  onToggleCollection(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const key = 'expandedCollectionIds.' + id;
    this.setData({
      [key]: !this.data.expandedCollectionIds[id]
    });
  },

  onCreateCollection() {
    const cur = this._currentOc();
    const favId = this._favoriteIdFor(cur);
    if (!favId) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const openCreate = () => {
      wx.showModal({
        title: '新建故事集',
        editable: true,
        placeholderText: '输入故事集名称',
        success: (res) => {
          if (!res.confirm) return;
          const r = createCollection(favId, res.content);
          if (!r.ok) {
            if (r.needVip) {
              this.setData({ vipLimitModalVisible: true });
              return;
            }
            wx.showToast({ title: r.errMsg || '创建失败', icon: 'none' });
            return;
          }
          this.setData(this._buildStoryCollections(favId));
          wx.showToast({ title: '已创建', icon: 'success' });
        }
      });
    };
    try {
      require('../../utils/ocMembership.js').syncMembership().finally(openCreate);
    } catch (_) {
      openCreate();
    }
  },

  onRenameCollection(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const name = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || '';
    const cur = this._currentOc();
    const favId = this._favoriteIdFor(cur);
    if (!favId || !id) return;
    wx.showModal({
      title: '重命名故事集',
      editable: true,
      placeholderText: '输入新名称',
      content: name,
      success: (res) => {
        if (!res.confirm) return;
        const r = renameCollection(favId, id, res.content);
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '重命名失败', icon: 'none' });
          return;
        }
        this.setData(this._buildStoryCollections(favId));
        wx.showToast({ title: '已重命名', icon: 'success' });
      }
    });
  },

  onCloseVipLimitModal() {
    this.setData({ vipLimitModalVisible: false });
  },

  onOpenVipOaFromLimit() {
    this.setData({ vipLimitModalVisible: false, oaQrVisible: true });
  },

  onCloseOaQr() {
    this.setData({ oaQrVisible: false });
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

        const patch = this._buildStoryCollections(favId);

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
    let continueCostHint = '';
    try {
      continueCostHint = require('../../utils/ocCredits.js').getStoryContinueCostHint();
    } catch (_) {}
    this.setData({
      continueSheetVisible: true,
      continueInput: '',
      continueContext: context,
      continueCostHint: continueCostHint
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



  onStoryTitleInput(e) {

    this.setData({ storyTitle: e.detail.value || '' });

  },



  _openStorySubPage(which) {
    const cur = this._currentOc();
    if (!cur) {
      wx.showToast({ title: '请先选择 OC', icon: 'none' });
      return;
    }
    const favId = this._favoriteIdFor(cur);
    if (!favId) {
      wx.showToast({ title: '未找到设定本记录', icon: 'none' });
      return;
    }
    const ocName = encodeURIComponent(cur.name || 'OC');
    if (which === 'upload') {
      wx.navigateTo({
        url:
          '/pages/ocStory/ocStoryUpload?favId=' +
          encodeURIComponent(favId) +
          '&ocName=' +
          ocName,
        events: {
          uploaded: () => {
            this.setData(this._buildStoryCollections(favId));
          }
        },
        fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
      });
      return;
    }
    if (!cur.hasBio) {
      wx.showToast({ title: '请先在 OC 小传中生成小传', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url:
        '/pages/ocStory/ocStoryGenerate?favId=' +
        encodeURIComponent(favId) +
        '&ocName=' +
        ocName +
        '&hasBio=1',
      events: {
        saved: () => {
          this.setData(
            Object.assign(
              {
                story: '',
                storyId: '',
                storyTitle: '',
                userInput: '',
                saved: false
              },
              this._buildStoryCollections(favId)
            )
          );
        }
      },
      fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
    });
  },

  onTapStoryDir() {
    this._openStorySubPage('generate');
  },

  onTapPasteStory() {
    this._openStorySubPage('upload');
  },

  onStoryInput(e) {

    this.setData({ story: e.detail.value || '' });

  },




  _collapseStoryDraft() {

    const cur = this._currentOc();

    const favId = cur ? this._favoriteIdFor(cur) : '';

    this.setData(
      Object.assign(
        {
          userInput: '',
          story: '',
          storyId: '',
          storyTitle: '',
          saved: false
        },
        this._buildStoryCollections(favId)
      )
    );

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


