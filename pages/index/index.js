const colors = require('../../utils/colors.js');
const staticAssets = require('../../utils/staticAssets.js');
const cardAnim = require('../../utils/cardAnim.js');
const poolsLoader = require('../../utils/poolsLoader.js');
const aiGacha = require('../../utils/aiGacha.js');
const gacha = require('../../utils/gacha.js');
const mindmap = require('../../utils/mindmap.js');
const { isLayer3Ready, applyNotebookFlags } = require('../../utils/ocWork.js');
const { normalizeResult, normalizeBackground, personalityBlend, quirkBlend } = require('../../utils/ocResult.js');
const { AI_WAIT_QUOTE, loadAiWaitScriptFont } = require('../../utils/aiWaitQuote.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');
const { syncPageTheme } = require('../../utils/uiTheme.js');
const { getWxNavSafeInsets } = require('../../utils/wxNavSafe.js');
const { upsertOcToFavorites } = require('../../utils/favorite.js');
const { applyParsedSetting } = require('../../utils/parseOcWork.js');
const { emptyWork } = require('../../utils/ocNotebookData.js');

const DEFAULT_LOCKED = {
  name: false,
  race: false,
  gender: false,
  age: false,
  hairColor: false,
  eyeColor: false,
  personality0: false,
  personality1: false,
  likes: false,
  quirk0: false,
  quirk1: false
};

const EMPTY_LOCKED_BG = {
  worldview: false,
  origin0: false,
  origin1: false,
  origin2: false,
  lifeEvent0: false,
  lifeEvent1: false,
  lifeEvent2: false
};

const EMPTY_LOCKED_LAYER3 = {
  catchphrase0: false,
  catchphrase1: false,
  catchphrase2: false,
  attitude0: false,
  attitude1: false,
  attitude2: false
};

const STORAGE_OC_WORK = 'oc_work_in_progress';
/** 首页初始态：仅标题区与设置图标下移（px） */
const HOME_INTRO_TITLE_OFFSET = 80;

function isHomeIntroState(data) {
  return data.gachaPhase === 1 && !(data.result && data.cardFlipped);
}

function buildIndexNavHeight(data) {
  try {
    const insets = getWxNavSafeInsets();
    return isHomeIntroState(data) ? insets.menuTop : insets.topHeight;
  } catch (_) {
    return 64;
  }
}

function buildSettingsWrapStyle(data) {
  try {
    const insets = getWxNavSafeInsets();
    const sys = wx.getSystemInfoSync();
    const windowWidth = Number(sys.windowWidth) || 375;
    const leftPx = Math.round((28 / 750) * windowWidth);
    const extra = data && isHomeIntroState(data) ? HOME_INTRO_TITLE_OFFSET : 0;
    return 'top:' + (insets.menuTop + extra) + 'px;left:' + leftPx + 'px;right:auto;';
  } catch (_) {
    return 'top:48px;left:14px;right:auto;';
  }
}

Page({
  data: {
    cardBackSrc: staticAssets.getCardBackSrc(),
    gachaPhase: 1,
    step: 0,
    result: null,
    hairHex: '#4a4a4a',
    eyeHex: '#37474f',
    cardFlipped: false,
    cardSpinning: false,
    cardAiWaiting: false,
    cardLayer1Waiting: false,
    aiWaitQuote: AI_WAIT_QUOTE,
    saved: false,
    contentScrollTop: 0,
    locked: { ...DEFAULT_LOCKED },
    background: null,
    lockedBackground: { ...EMPTY_LOCKED_BG },
    hasBackground: false,
    layer2Done: false,
    catchphrases: [],
    attitudes: [],
    hasLayer3: false,
    lockedLayer3: { ...EMPTY_LOCKED_LAYER3 },
    layer3Confirmed: false,
    layer3Done: false,
    layer3Ready: false,
    notebookSaved: false,
    notebookFavoriteId: '',
    settingsOpen: false,
    oaQrVisible: false,
    membershipPanelVisible: false,
    membershipPanelTitle: '会员权益',
    membershipPanelLines: [],
    membershipPanelFooter: '',
    membershipSheetVisible: false,
    settingsWrapStyle: 'top:48px;left:14px;right:auto;',
    indexNavHeight: 0,
    uiThemeClass: '',
    scopePanelOpen: false,
    knownPanelOpen: false,
    gachaScopeHint: '',
    gachaScopeApplied: false,
    knownCharacterName: '',
    knownCharacterCanSubmit: false,
    creatingKnown: false,
    exportCanvasOn: false
  },

  _updatePageLayout() {
    this.setData({
      settingsWrapStyle: buildSettingsWrapStyle(this.data),
      indexNavHeight: buildIndexNavHeight(this.data)
    });
  },

  onLoad(options) {
    applyPageGradientBg();
    loadAiWaitScriptFont();
    this._updatePageLayout();
    this._syncMembershipPanel();
    const phase = options && options.phase ? parseInt(options.phase, 10) : 0;
    if (phase === 2 || phase === 3) {
      this._enterGachaPhase(phase, { autoDraw: true, freshDraw: false });
      return;
    }
    const d = this.data;
    if (d.result == null && (d.step === undefined || d.step > 0)) {
      this.setData({ step: 0, result: null, gachaPhase: 1 });
    }
  },

  _syncMembershipPanel() {
    // 会员权益介绍面板已下线
    this.setData({
      membershipPanelVisible: false,
      membershipPanelTitle: '',
      membershipPanelLines: [],
      membershipPanelFooter: '',
      membershipSheetVisible: false
    });
  },

  onShow() {
    applyPageGradientBg();
    syncPageTheme(this);
    this.setData({ cardBackSrc: staticAssets.getCardBackSrc() });
    this._updatePageLayout();
    this._syncMembershipPanel();
    const app = getApp();
    if (app.globalData && app.globalData.indexHomeReset) {
      app.globalData.indexHomeReset = false;
      this.resetToHomeScreen();
    } else {
      const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
      if (work.result && !this.data.result) {
        const result = normalizeResult(work.result);
        this.setData({
          result,
          cardFlipped: false,
          cardSpinning: false,
          cardAiWaiting: false,
          cardLayer1Waiting: false,
          hairHex: colors.getHairColor(result.hairColor),
          eyeHex: colors.getEyeColor(result.eyeColor),
          locked: work.locked ? { ...DEFAULT_LOCKED, ...work.locked } : { ...DEFAULT_LOCKED },
          gachaScopeHint: work.gachaScopeHint || this.data.gachaScopeHint || '',
          gachaScopeApplied: !!work.gachaScopeApplied
        });
      } else if (work.gachaScopeHint && !this.data.gachaScopeHint) {
        this.setData({
          gachaScopeHint: work.gachaScopeHint,
          gachaScopeApplied: !!work.gachaScopeApplied
        });
      }
    }
    this.syncWorkToStorage();
  },

  resetToHomeScreen() {
    try {
      const { beginFreshGachaWork } = require('../../utils/favorite.js');
      beginFreshGachaWork();
    } catch (e) {}
    this.setData({
      gachaPhase: 1,
      step: 0,
      result: null,
      hairHex: '#4a4a4a',
      eyeHex: '#37474f',
      cardFlipped: false,
      cardSpinning: false,
      cardAiWaiting: false,
      cardLayer1Waiting: false,
      saved: false,
      locked: { ...DEFAULT_LOCKED },
      background: null,
      lockedBackground: { ...EMPTY_LOCKED_BG },
      hasBackground: false,
      layer2Done: false,
      catchphrases: [],
      attitudes: [],
      hasLayer3: false,
      lockedLayer3: { ...EMPTY_LOCKED_LAYER3 },
      layer3Confirmed: false,
      layer3Done: false,
      layer3Ready: false,
      notebookSaved: false,
      notebookFavoriteId: '',
      scopePanelOpen: false,
      knownPanelOpen: false,
      knownCharacterName: '',
      knownCharacterCanSubmit: false,
      creatingKnown: false,
      gachaScopeApplied: false
    }, () => this._updatePageLayout());
    this._saveScopeState(this.data.gachaScopeHint, false);
  },

  onToggleScopePanel() {
    const open = !this.data.scopePanelOpen;
    this.setData({
      scopePanelOpen: open,
      knownPanelOpen: open ? false : this.data.knownPanelOpen
    });
  },

  onToggleKnownPanel() {
    const open = !this.data.knownPanelOpen;
    this.setData({
      knownPanelOpen: open,
      scopePanelOpen: open ? false : this.data.scopePanelOpen
    });
  },

  onScopeHintInput(e) {
    const gachaScopeHint = String((e.detail && e.detail.value) || '');
    this.setData({ gachaScopeHint, gachaScopeApplied: false });
    this._saveScopeState(gachaScopeHint, false);
  },

  onApplyScopeHint() {
    if (this.data.gachaScopeApplied) return;
    const hint = String(this.data.gachaScopeHint || '').trim();
    if (!hint) {
      wx.showToast({ title: '请先填写抽卡方向', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '需云开发环境才能应用范围', icon: 'none', duration: 2800 });
      return;
    }
    this.setData({ gachaScopeApplied: true });
    this._saveScopeState(hint, true);
    wx.showToast({ title: '已应用', icon: 'success', duration: 1200 });
  },

  _saveScopeState(hint, applied) {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.gachaScopeHint = String(hint || '').trim();
    work.gachaScopeApplied = !!applied;
    wx.setStorageSync(STORAGE_OC_WORK, work);
  },

  _clearGachaScopeApplied() {
    if (!this.data.gachaScopeApplied) {
      this._saveScopeState(this.data.gachaScopeHint, false);
      return;
    }
    this.setData({ gachaScopeApplied: false });
    this._saveScopeState(this.data.gachaScopeHint, false);
  },

  onKnownCharacterInput(e) {
    const knownCharacterName = String((e.detail && e.detail.value) || '');
    this.setData({
      knownCharacterName,
      knownCharacterCanSubmit: !!knownCharacterName.trim()
    });
  },

  onCreateKnownCharacter() {
    if (this.data.creatingKnown) return;
    const name = String(this.data.knownCharacterName || '').trim();
    if (!name) return;
    if (!wx.cloud) {
      wx.showToast({ title: '请使用云开发环境', icon: 'none' });
      return;
    }
    this.setData({ creatingKnown: true });
    wx.showLoading({ title: '创建中', mask: true });
    wx.cloud
      .callFunction({
        name: 'parseOcSetting',
        data: { text: name, mode: 'knownCharacter' },
        timeout: 60000
      })
      .then((res) => {
        const r = (res && res.result) || {};
        if (!r.ok || !r.setting) {
          wx.showToast({ title: r.errMsg || '创建失败', icon: 'none', duration: 2800 });
          return;
        }
        const base = emptyWork();
        base.source = 'knownCharacter';
        const patch = applyParsedSetting(base, r.setting);
        if (!patch) {
          wx.showToast({ title: '生成结果无效', icon: 'none' });
          return;
        }
        const work = Object.assign({}, base, {
          result: patch.result,
          background: patch.background,
          catchphrases: patch.catchphrases,
          attitudes: patch.attitudes
        });
        if (!String(work.result.name || '').trim()) {
          work.result.name = name;
        }
        applyNotebookFlags(work);
        const favId = upsertOcToFavorites(work);
        if (!favId) {
          wx.showToast({ title: '写入设定本失败', icon: 'none' });
          return;
        }
        work.notebookFavoriteId = favId;
        wx.setStorageSync(STORAGE_OC_WORK, work);
        this.setData({
          knownPanelOpen: false,
          knownCharacterName: '',
          knownCharacterCanSubmit: false,
          creatingKnown: false
        });
        wx.navigateTo({
          url: '/pages/ocNotebookEdit/ocNotebookEdit?id=' + encodeURIComponent(favId)
        });
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || '创建失败';
        wx.showToast({
          title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : '创建失败',
          icon: 'none',
          duration: 2800
        });
      })
      .finally(() => {
        wx.hideLoading();
        if (this._alive) this.setData({ creatingKnown: false });
      });
  },

  _enterGachaPhase(phase, options) {
    const opts = options || {};
    const autoDraw = opts.autoDraw === true;
    const freshDraw = opts.freshDraw === true;
    cardAnim.cancelAiWaiting(this);
    if (freshDraw) {
      try {
        const { beginFreshGachaWork } = require('../../utils/favorite.js');
        beginFreshGachaWork();
      } catch (e) {}
    }
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};

    if (phase === 2) {
      if (!work.result && !this.data.result) {
        wx.showToast({ title: '请先完成基础设定', icon: 'none' });
        setTimeout(() => wx.redirectTo({ url: '/pages/index/index' }), 1200);
        return;
      }
      let bg = null;
      let hasBg = false;
      if (!freshDraw) {
        bg = this._normalizeBackground(work.background || this.data.background);
        hasBg = !!bg;
      }
      this.setData(
        {
          gachaPhase: 2,
          result: work.result || this.data.result,
          background: bg || { worldview: '', origins: [], lifeEvents: [] },
          hasBackground: hasBg,
          lockedBackground: work.lockedBackground
            ? { ...EMPTY_LOCKED_BG, ...work.lockedBackground }
            : { ...EMPTY_LOCKED_BG },
          cardFlipped: hasBg,
          cardSpinning: false,
          cardAiWaiting: false,
          cardLayer1Waiting: false
        },
        () => {
          this._updatePageLayout();
          if (autoDraw && (freshDraw || !hasBg)) {
            wx.nextTick(() => this._startPhase2Draw());
          }
        }
      );
      return;
    }

    if (phase === 3) {
      const workBg = this._normalizeBackground(work.background);
      if (!work.result || !workBg) {
        wx.showToast({ title: '请先完成背景故事', icon: 'none' });
        setTimeout(() => wx.redirectTo({ url: '/pages/index/index?phase=2' }), 1200);
        return;
      }
      let norm = null;
      let hasL3 = false;
      if (!freshDraw) {
        norm = this._normalizeLayer3({
          catchphrases: work.catchphrases,
          attitudes: work.attitudes
        });
        hasL3 = !!norm;
      }
      this.setData(
        {
          gachaPhase: 3,
          result: work.result,
          background: workBg,
          lockedBackground: work.lockedBackground || { ...EMPTY_LOCKED_BG },
          layer2Done: true,
          catchphrases: norm ? norm.catchphrases : [],
          attitudes: norm ? norm.attitudes : [],
          hasLayer3: hasL3,
          lockedLayer3: work.lockedLayer3
            ? { ...EMPTY_LOCKED_LAYER3, ...work.lockedLayer3 }
            : { ...EMPTY_LOCKED_LAYER3 },
          layer3Confirmed: freshDraw ? false : !!work.layer3Confirmed,
          layer3Ready: freshDraw ? false : isLayer3Ready(work),
          layer3Done: freshDraw ? false : isLayer3Ready(work),
          notebookSaved: freshDraw ? false : !!work.notebookFavoriteId,
          notebookFavoriteId: freshDraw ? '' : work.notebookFavoriteId || '',
          cardFlipped: hasL3,
          cardSpinning: false,
          cardAiWaiting: false,
          cardLayer1Waiting: false
        },
        () => {
          this._updatePageLayout();
          if (autoDraw && (freshDraw || !hasL3)) {
            wx.nextTick(() => this._startPhase3Draw());
          }
        }
      );
    }
  },

  _phaseNum() {
    return Number(this.data.gachaPhase) || 1;
  },

  _startPhase2Draw() {
    if (this._phaseNum() !== 2) return;
    if (this.data.hasBackground || cardAnim.isCardBusy(this)) return;
    this.onFlipBackgroundCard();
  },

  _startPhase3Draw() {
    if (this._phaseNum() !== 3) return;
    if (this.data.hasLayer3 || cardAnim.isCardBusy(this)) return;
    this.onFlipLayer3Card();
  },

  onGoPools() {
    this.setData({ settingsOpen: false });
    require('../../utils/nav.js').goTo('pools');
  },

  onGoFeedback() {
    this.setData({ settingsOpen: false });
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onPageSettings() {
    this.setData({ settingsOpen: false });
    wx.navigateTo({ url: '/pages/pageSettings/pageSettings' });
  },

  onGoRedeem() {
    this.setData({ settingsOpen: false });
    wx.navigateTo({ url: '/pages/redeemCode/redeemCode' });
  },

  onGoStorageClean() {
    this.setData({ settingsOpen: false });
    wx.navigateTo({
      url: '/pages/ocApp/ocStorageClean/ocStorageClean',
      fail: () => wx.showToast({ title: '打开清理页失败', icon: 'none' })
    });
  },

  onGoAdFreeCard() {
    this.setData({ settingsOpen: false });
    wx.navigateTo({ url: '/pages/redeemCode/redeemCode?focus=adfree' });
  },

  onCloseMembershipPanel() {
    this.setData({ membershipSheetVisible: false });
  },

  onMembershipGoRedeem() {
    this.setData({ membershipSheetVisible: false });
    wx.navigateTo({ url: '/pages/redeemCode/redeemCode' });
  },

  onFollowOfficialAccount() {
    this.setData({ settingsOpen: false, oaQrVisible: true });
  },

  onCloseOaQr() {
    this.setData({ oaQrVisible: false });
  },

  preventOaMove() {},

  onToggleSettings() {
    this.setData({ settingsOpen: !this.data.settingsOpen });
  },

  onCloseSettings() {
    this.setData({ settingsOpen: false });
  },

  onNavHome() {
    this.resetToHomeScreen();
    this.setData({ contentScrollTop: 1 });
    wx.nextTick(() => {
      this.setData({ contentScrollTop: 0 });
    });
  },

  getPools() {
    return poolsLoader.getDrawPools();
  },

  syncWorkToStorage() {
    try {
      const tomb = require('../../utils/ocDeletedIds.js');
      const fid = String(this.data.notebookFavoriteId || '').trim();
      if (fid && tomb.isOcDeleted(fid)) {
        this.setData({ result: null, notebookFavoriteId: '', notebookSaved: false });
        try {
          wx.removeStorageSync(STORAGE_OC_WORK);
        } catch (_) {}
        return;
      }
    } catch (_) {}
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (this.data.result) {
      work.result = normalizeResult(this.data.result);
      work.step = this.data.step;
      work.locked = { ...this.data.locked };
      work.hairHex = this.data.hairHex;
      work.eyeHex = this.data.eyeHex;
    }
    const bgNorm = this._normalizeBackground(this.data.background);
    if (bgNorm) work.background = { ...bgNorm };
    work.lockedBackground = { ...this.data.lockedBackground };
    work.layer2Done = this.data.layer2Done || !!bgNorm;
    const l3Norm = this._normalizeLayer3({
      catchphrases: this.data.catchphrases,
      attitudes: this.data.attitudes
    });
    if (l3Norm) {
      work.catchphrases = l3Norm.catchphrases.slice();
      work.attitudes = l3Norm.attitudes.map((a) => ({ ...a }));
    }
    work.lockedLayer3 = { ...this.data.lockedLayer3 };
    work.layer3Confirmed = this.data.layer3Confirmed;
    work.gachaScopeHint = String(this.data.gachaScopeHint || '').trim();
    work.gachaScopeApplied = !!this.data.gachaScopeApplied;
    // 必须镜像页面状态：页面已清空 id 时不能把 storage 里旧收藏 id 又写回去（否则会串档）
    if (this.data.notebookFavoriteId) {
      work.notebookFavoriteId = this.data.notebookFavoriteId;
    } else {
      delete work.notebookFavoriteId;
    }
    if (work.result) {
      work.layer3Done = isLayer3Ready({
        result: work.result,
        catchphrases: work.catchphrases,
        attitudes: work.attitudes
      });
    }
    wx.setStorageSync(STORAGE_OC_WORK, work);
    if (this.data.gachaPhase === 3) {
      this.setData({
        layer3Ready: work.layer3Done,
        layer3Done: work.layer3Done,
        layer3Confirmed: work.layer3Done
      });
    }
  },

  onStartDraw() {
    if (this._phaseNum() !== 1) return;
    if (cardAnim.isCardBusy(this)) return;
    this._saveScopeState(this.data.gachaScopeHint, this.data.gachaScopeApplied);
    const { beginFreshGachaWork } = require('../../utils/favorite.js');
    beginFreshGachaWork();
    this.setData({ notebookSaved: false, notebookFavoriteId: '' });
    const pools = this.getPools();
    cardAnim.startLayer1Waiting(this);
    aiGacha
      .drawLayer1(pools, {}, null, this._buildWorkForGacha())
      .then((raw) => {
        const result = normalizeResult(raw);
        const hairHex = colors.getHairColor(result.hairColor);
        const eyeHex = colors.getEyeColor(result.eyeColor);
        cardAnim.endLayer1WaitingThenSpin(this, {
          result,
          step: 6,
          hairHex,
          eyeHex,
          saved: false,
          locked: { ...DEFAULT_LOCKED }
        });
      })
      .catch(() => {
        cardAnim.cancelAiWaiting(this);
        wx.showToast({ title: '抽卡失败，请重试', icon: 'none' });
      });
  },

  onCardSpinEnd(e) {
    if (!this.data.cardSpinning) return;
    const phase = this._phaseNum();
    if (phase === 1) {
      cardAnim.onCardSpinEnd(this, e, () => {
        this.syncWorkToStorage();
        this._updatePageLayout();
      });
      return;
    }
    if (phase === 2) {
      cardAnim.onCardSpinEnd(this, e, () => {
        this.setData({ hasBackground: !!this._normalizeBackground(this.data.background) });
        this.syncWorkToStorage();
      });
      return;
    }
    if (phase === 3) {
      cardAnim.onCardSpinEnd(this, e, () => {
        const norm = this._normalizeLayer3({
          catchphrases: this.data.catchphrases,
          attitudes: this.data.attitudes
        });
        this.setData({ hasLayer3: !!norm });
        this.syncWorkToStorage();
      });
    }
  },

  onDrawAgain() {
    wx.removeStorageSync(STORAGE_OC_WORK);
    this.resetToHomeScreen();
  },

  onGoBackground() {
    if (!this.data.result) return;
    this.syncWorkToStorage();
    this._enterGachaPhase(2, { autoDraw: true, freshDraw: true });
  },

  onGoAttitude() {
    const { background, hasBackground } = this.data;
    if (!hasBackground || !background || !String(background.worldview || '').trim()) {
      wx.showToast({ title: '请先生成背景故事', icon: 'none' });
      return;
    }
    this.setData({ layer2Done: true });
    this.syncWorkToStorage();
    this._enterGachaPhase(3, { autoDraw: true, freshDraw: true });
  },

  _normalizeBackground(bg) {
    if (!bg || !String(bg.worldview || '').trim()) return null;
    const norm = normalizeBackground(bg);
    return {
      worldview: String(norm.worldview).trim(),
      lifeEvents: norm.lifeEvents,
      origins: norm.origins
    };
  },

  _buildWorkForGacha() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = this.data.result;
    if (this.data.background) work.background = this.data.background;
    work.gachaScopeHint = String(this.data.gachaScopeHint || '').trim();
    work.gachaScopeApplied = !!this.data.gachaScopeApplied;
    return work;
  },

  _fetchBackground(locked, current) {
    return aiGacha.drawLayer2(this.getPools(), locked || {}, current, this._buildWorkForGacha());
  },

  onFlipBackgroundCard() {
    if (this._phaseNum() !== 2) return;
    if (cardAnim.isCardBusy(this)) return;
    if (!this.data.hasBackground) {
      cardAnim.startAiWaiting(this);
      this._fetchBackground({}, null)
        .then((bg) => {
          if (!bg || !String(bg.worldview || '').trim()) {
            cardAnim.cancelAiWaiting(this);
            wx.showToast({ title: '选项池为空，请先在选项库添加世界观', icon: 'none' });
            return;
          }
          const normalized = this._normalizeBackground(bg);
          if (!normalized) {
            cardAnim.cancelAiWaiting(this);
            return;
          }
          cardAnim.endAiWaitingThenSpin(this, {
            background: normalized,
            hasBackground: true,
            lockedBackground: { ...EMPTY_LOCKED_BG }
          });
        })
        .catch(() => {
          cardAnim.cancelAiWaiting(this);
          wx.showToast({ title: '生成失败', icon: 'none' });
        });
    } else {
      cardAnim.startCardSpin(this, {});
    }
  },

  onBackgroundInput(e) {
    const { key, index } = e.currentTarget.dataset;
    const value = e.detail.value || '';
    const bg = this.data.background;
    if (!bg) return;
    if (key === 'worldview') {
      this.setData({ 'background.worldview': value });
    } else if (key === 'origin' && index !== undefined && index !== '' && bg.origins) {
      const i = typeof index === 'number' ? index : parseInt(index, 10);
      if (isNaN(i)) return;
      const origins = bg.origins.slice();
      origins[i] = value;
      this.setData({ 'background.origins': origins });
    } else if (index !== undefined && index !== '' && bg.lifeEvents) {
      const i = typeof index === 'number' ? index : parseInt(index, 10);
      if (isNaN(i)) return;
      const lifeEvents = bg.lifeEvents.slice();
      lifeEvents[i] = value;
      this.setData({ 'background.lifeEvents': lifeEvents });
    }
  },

  onLockBackgroundToggle(e) {
    const key = e.currentTarget.dataset.lockKey;
    if (!key) return;
    const next = !this.data.lockedBackground[key];
    this.setData({ [`lockedBackground.${key}`]: next }, () => this.syncWorkToStorage());
  },

  onRedrawBackground() {
    if (!this.data.hasBackground) return;
    this._fetchBackground(this.data.lockedBackground, this.data.background)
      .then((next) => {
        const bg = this._normalizeBackground(next) || next;
        this.setData({ background: bg, hasBackground: !!bg }, () => this.syncWorkToStorage());
        wx.showToast({ title: '已重抽', icon: 'none' });
      })
      .catch(() => wx.showToast({ title: '重抽失败', icon: 'none' }));
  },

  onGachaPrevStep() {
    const phase = this._phaseNum();
    cardAnim.cancelAiWaiting(this);
    if (phase === 3) {
      this.syncWorkToStorage();
      this._enterGachaPhase(2, { autoDraw: false });
      return;
    }
    if (phase === 2) {
      this.syncWorkToStorage();
      const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
      const result = work.result || this.data.result;
      this.setData({
        gachaPhase: 1,
        result,
        cardFlipped: true,
        cardSpinning: false,
        cardAiWaiting: false,
        cardLayer1Waiting: false,
        hairHex: work.hairHex || this.data.hairHex,
        eyeHex: work.eyeHex || this.data.eyeHex,
        locked: work.locked ? { ...DEFAULT_LOCKED, ...work.locked } : { ...DEFAULT_LOCKED }
      });
    }
  },

  _normalizeLayer3(data) {
    if (!data) return null;
    const cp = Array.isArray(data.catchphrases) ? data.catchphrases.slice(0, 3) : [];
    const ad = Array.isArray(data.attitudes) ? data.attitudes.slice(0, 3) : [];
    if (cp.length < 3 || ad.length < 3) return null;
    for (let i = 0; i < 3; i++) {
      if (!String(cp[i] || '').trim()) return null;
      if (!ad[i] || !String(ad[i].event || '').trim() || !String(ad[i].attitude || '').trim()) {
        return null;
      }
    }
    return {
      catchphrases: cp.map((t) => String(t).trim()),
      attitudes: ad.map((a) => ({
        event: String(a.event).trim(),
        attitude: String(a.attitude).trim()
      }))
    };
  },

  _fetchLayer3(locked, current) {
    const work = this._buildWorkForGacha();
    work.background = this.data.background;
    return aiGacha.drawLayer3(this.getPools(), locked || {}, current, work);
  },

  _spinLayer3AfterAi(norm, lockedLayer3, after) {
    if (!norm) return;
    cardAnim.endAiWaitingThenSpin(
      this,
      {
        catchphrases: norm.catchphrases,
        attitudes: norm.attitudes,
        hasLayer3: true,
        lockedLayer3: lockedLayer3 || { ...EMPTY_LOCKED_LAYER3 }
      },
      after
    );
  },

  onFlipLayer3Card() {
    if (this._phaseNum() !== 3) return;
    if (cardAnim.isCardBusy(this)) return;
    if (!this.data.hasLayer3) {
      cardAnim.startAiWaiting(this);
      this._fetchLayer3({}, null)
        .then((data) => {
          const norm = this._normalizeLayer3(data);
          if (!norm) {
            cardAnim.cancelAiWaiting(this);
            wx.showToast({
              title: '选项池为空，请先在选项库添加常用语/态度',
              icon: 'none'
            });
            return;
          }
          this._spinLayer3AfterAi(norm, { ...EMPTY_LOCKED_LAYER3 }, () => {
            this.syncWorkToStorage();
            // 仅标记未保存；保留 notebookFavoriteId，避免重抽后另存成重复 OC
            this.setData({ notebookSaved: false });
            this._clearGachaScopeApplied();
          });
        })
        .catch(() => {
          cardAnim.cancelAiWaiting(this);
          wx.showToast({ title: '生成失败', icon: 'none' });
        });
    } else {
      cardAnim.startCardSpin(this, {});
    }
  },

  onLockLayer3Toggle(e) {
    const key = e.currentTarget.dataset.lockKey;
    if (!key) return;
    const next = !this.data.lockedLayer3[key];
    this.setData({ [`lockedLayer3.${key}`]: next }, () => this.syncWorkToStorage());
  },

  onRedrawLayer3() {
    if (!this.data.hasLayer3) return;
    const current = {
      catchphrases: this.data.catchphrases || [],
      attitudes: this.data.attitudes || []
    };
    this._fetchLayer3(this.data.lockedLayer3, current)
      .then((data) => {
        const norm = this._normalizeLayer3(data);
        if (!norm) {
          wx.showToast({ title: '重抽失败', icon: 'none' });
          return;
        }
        this.setData(
          {
            catchphrases: norm.catchphrases,
            attitudes: norm.attitudes,
            hasLayer3: true,
            notebookSaved: false
          },
          () => this.syncWorkToStorage()
        );
        wx.showToast({ title: '已重抽', icon: 'none' });
      })
      .catch(() => wx.showToast({ title: '重抽失败', icon: 'none' }));
  },

  onCatchphraseInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    const arr = (this.data.catchphrases || []).slice();
    arr[index] = value;
    this.setData({ catchphrases: arr });
  },

  onAttitudeInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    const arr = (this.data.attitudes || []).slice();
    if (arr[index]) arr[index] = { ...arr[index], attitude: value };
    this.setData({ attitudes: arr });
  },

  _layer3ContentOk() {
    const c = this.data.catchphrases || [];
    const a = this.data.attitudes || [];
    if (c.length < 3 || a.length < 3) return false;
    for (let i = 0; i < 3; i++) {
      if (!String(c[i] || '').trim()) return false;
    }
    for (let i = 0; i < 3; i++) {
      if (!a[i] || !String(a[i].attitude || '').trim()) return false;
    }
    return true;
  },

  _autoSaveOcPersona() {
    if (!this.data.result || !this.data.layer3Ready) return null;
    this.syncWorkToStorage();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    // 已有收藏 id 时始终更新同一条；无 id 时 upsert 会按姓名合并
    if (this.data.notebookFavoriteId) {
      work.notebookFavoriteId = this.data.notebookFavoriteId;
    }
    const favId = upsertOcToFavorites(work);
    if (favId) {
      work.notebookFavoriteId = favId;
      wx.setStorageSync(STORAGE_OC_WORK, work);
      this.setData({ notebookSaved: true, notebookFavoriteId: favId });
    }
    return favId;
  },

  _saveToFavorites() {
    if (!this.data.result) {
      wx.showToast({ title: '暂无 OC 设定', icon: 'none' });
      return false;
    }
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请补全 3 条常用语与态度', icon: 'none' });
      return false;
    }
    this.syncWorkToStorage();
    const work = applyNotebookFlags(wx.getStorageSync(STORAGE_OC_WORK) || {});
    if (this.data.notebookFavoriteId) {
      work.notebookFavoriteId = this.data.notebookFavoriteId;
    }
    const favId = upsertOcToFavorites(work);
    if (!favId) {
      wx.showToast({ title: '存入失败，请重试', icon: 'none' });
      return false;
    }
    work.notebookFavoriteId = favId;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    this.setData({ notebookSaved: true, notebookFavoriteId: favId });
    return favId;
  },

  onSaveOrOpenNotebook() {
    if (this.data.notebookSaved && this.data.notebookFavoriteId) {
      wx.navigateTo({
        url:
          '/pages/ocNotebookEdit/ocNotebookEdit?id=' +
          encodeURIComponent(this.data.notebookFavoriteId)
      });
      return;
    }
    if (!this._saveToFavorites()) return;
    this._clearGachaScopeApplied();
    wx.showToast({ title: '已存入设定本', icon: 'success' });
  },

  onBackHome() {
    const nav = require('../../utils/nav.js');
    wx.showModal({
      title: '返回首页',
      content: '是否将当前 OC 存入设定本？',
      confirmText: '存入',
      cancelText: '不保存',
      success: (res) => {
        if (res.confirm) {
          if (!this._saveToFavorites()) return;
          this._clearGachaScopeApplied();
          wx.showToast({ title: '已存入设定本', icon: 'success', duration: 1200 });
          setTimeout(() => nav.goHome(), 400);
          return;
        }
        if (res.cancel) {
          if (this._layer3ContentOk()) this.syncWorkToStorage();
          if (this.data.hasLayer3) this._clearGachaScopeApplied();
          nav.goHome();
        }
      }
    });
  },

  onGoOcChat() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    this._autoSaveOcPersona();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const { revealOcInChatList } = require('../../utils/ocChatList.js');
    if (work.notebookFavoriteId) revealOcInChatList(work.notebookFavoriteId);
    const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
    if (!workHasBio(work)) {
      ensureOcBioForChat(work, work.notebookFavoriteId || '');
      return;
    }
    wx.navigateTo({ url: '/pages/ocChat/ocChat?newSession=1' });
  },

  onGoOcGroupChat() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    this._autoSaveOcPersona();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const { ensureOcBioForChat, workHasBio } = require('../../utils/ocChatGate.js');
    if (!workHasBio(work)) {
      ensureOcBioForChat(work, work.notebookFavoriteId || '');
      return;
    }
    require('../../utils/nav.js').goTo('groupChat');
  },

  onGoOcBio() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    this._autoSaveOcPersona();
    wx.navigateTo({ url: '/pages/ocBioHub/ocBioHub' });
  },

  onGoOcStory() {
    if (!this.data.layer3Ready) {
      wx.showToast({ title: '请先生成常用语与态度', icon: 'none' });
      return;
    }
    try {
      this._autoSaveOcPersona();
    } catch (err) {
      console.error('[index] auto save before story', err);
    }
    require('../../utils/nav.js').goTo('story');
  },

  onResultInput(e) {
    const key = e.currentTarget.dataset.key;
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value || '';
    if (!key || !this.data.result) return;
    const result = normalizeResult(this.data.result);
    if (key === 'personalities' || key === 'quirks') {
      const arr = (result[key] || []).slice();
      arr[Number(index)] = value;
      result[key] = arr;
    } else {
      result[key] = value;
    }
    const update = { result };
    if (key === 'hairColor') update.hairHex = colors.getHairColor(value);
    if (key === 'eyeColor') update.eyeHex = colors.getEyeColor(value);
    this.setData(update);
  },

  onLockToggle(e) {
    const key = e.currentTarget.dataset.lockKey;
    if (!key) return;
    const next = !this.data.locked[key];
    this.setData({ [`locked.${key}`]: next }, () => this.syncWorkToStorage());
  },

  onRedrawUnlocked() {
    if (!this.data.result) return;
    const pools = this.getPools();
    wx.showLoading({ title: '逻辑重抽中…', mask: true });
    aiGacha
      .drawLayer1(pools, { ...this.data.locked }, this.data.result, this._buildWorkForGacha())
      .then((raw) => {
        const next = normalizeResult(raw);
        const hairHex = colors.getHairColor(next.hairColor);
        const eyeHex = colors.getEyeColor(next.eyeColor);
        this.setData(
          { result: next, hairHex, eyeHex, saved: false },
          () => this.syncWorkToStorage()
        );
        wx.showToast({ title: '已重抽', icon: 'none' });
      })
      .catch(() => {
        wx.showToast({ title: '重抽失败', icon: 'none' });
      })
      .finally(() => wx.hideLoading());
  },

  onCopy() {
    if (!this.data.result) return;
    let text = gacha.toCopyText(this.data.result);
    const bg = this.data.background;
    if (bg) {
      text += '\n\n【背景故事】\n世界观：' + (bg.worldview || '');
      if (bg.origins && bg.origins.length) {
        text += '\n身世设定：\n' + (bg.origins || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
      }
      text += '\n人生大事件：\n' + (bg.lifeEvents || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
    }
    if ((this.data.catchphrases || []).length) {
      text += '\n\n【常用语】\n' + this.data.catchphrases.join('\n');
    }
    if ((this.data.attitudes || []).length) {
      text += '\n\n【态度】\n' + this.data.attitudes.map((a) => `${a.event} → ${a.attitude}`).join('\n');
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  },

  onSaveImage() {
    if (!this.data.result) return;
    wx.authorize({
      scope: 'scope.writePhotosAlbum',
      fail: () => {
        wx.showModal({
          title: '需要相册权限',
          content: '保存图片需要您授权相册写入权限',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting();
          }
        });
      },
      success: () => {
        if (this.data.layer3Done && this.data.background) {
          this._drawMindMapToCanvas((path) => {
            if (!path) return;
            wx.saveImageToPhotosAlbum({
              filePath: path,
              success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
              fail: (e) => wx.showToast({ title: e.errMsg || '保存失败', icon: 'none' })
            });
          });
        } else {
          this._drawCardToCanvas();
        }
      }
    });
  },

  onGenerateMindMap() {
    if (!this.data.result || !this.data.layer3Done) return;
    this.syncWorkToStorage();
    wx.navigateTo({ url: '/pages/mindmap/mindmap' });
  },

  _withExportCanvas(run) {
    const start = () => {
      if (typeof run === 'function') run();
    };
    if (this.data.exportCanvasOn) {
      start();
      return;
    }
    this.setData({ exportCanvasOn: true }, () => {
      setTimeout(start, 60);
    });
  },

  _hideExportCanvas() {
    setTimeout(() => {
      if (this.data.exportCanvasOn) this.setData({ exportCanvasOn: false });
    }, 200);
  },

  _drawCardToCanvas() {
    this._withExportCanvas(() => {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#card-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res?.[0]?.node) {
            this._hideExportCanvas();
            wx.showToast({ title: '生成失败', icon: 'none' });
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          const width = res[0].width || 600;
          const height = res[0].height || 800;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);

          const r = normalizeResult(this.data.result);
          const padding = 24;
          let y = 72;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.strokeStyle = '#e0ddd6';
          ctx.lineWidth = 1;
          ctx.strokeRect(2, 2, width - 4, height - 4);
          ctx.fillStyle = '#4a4540';
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText('【OC 设定】', padding, 36);
          ctx.font = '13px sans-serif';
          const lines = [
            ['姓名', r.name],
            ['种族', r.race],
            ['性别', r.gender],
            ['年龄', r.age],
            ['发色', r.hairColor],
            ['瞳色', r.eyeColor],
            ['性格', personalityBlend(r)],
            ['喜欢', r.likes],
            ['怪癖', quirkBlend(r)]
          ];
          lines.forEach(([label, value]) => {
            ctx.fillText(`${label}：${value || ''}`, padding, y);
            y += 28;
          });

          setTimeout(() => {
            wx.canvasToTempFilePath(
              {
                canvas,
                fileType: 'png',
                success: (s) => {
                  this._hideExportCanvas();
                  wx.saveImageToPhotosAlbum({
                    filePath: s.tempFilePath,
                    success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
                    fail: (e) => wx.showToast({ title: e.errMsg || '保存失败', icon: 'none' })
                  });
                },
                fail: () => {
                  this._hideExportCanvas();
                  wx.showToast({ title: '生成失败', icon: 'none' });
                }
              },
              this
            );
          }, 150);
        });
    });
  },

  _drawMindMapToCanvas(callback) {
    this._withExportCanvas(() => {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#mindmap-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res?.[0]?.node) {
            this._hideExportCanvas();
            if (callback) callback(null);
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          const width = res[0].width || 750;
          const height = res[0].height || 1200;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);
          mindmap.drawMindMap(ctx, width, height, {
            result: this.data.result,
            background: this.data.background,
            catchphrases: this.data.catchphrases,
            attitudes: this.data.attitudes
          });
          setTimeout(() => {
            wx.canvasToTempFilePath(
              {
                canvas,
                fileType: 'png',
                success: (s) => {
                  this._hideExportCanvas();
                  if (callback) callback(s.tempFilePath);
                },
                fail: () => {
                  this._hideExportCanvas();
                  if (callback) callback(null);
                }
              },
              this
            );
          }, 200);
        });
    });
  },

  onShareAppMessage() {
    const r = this.data.result;
    const title = r ? `我的 OC：${r.name}（${r.race}）` : '来抽一张 OC 设定卡吧';
    return { title, path: '/pages/index/index' };
  }
});
