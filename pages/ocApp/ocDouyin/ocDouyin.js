const douyinStore = require('../../../utils/ocDouyinStore.js');
const douyinGen = require('../../../utils/ocDouyinGen.js');
const douyinBgm = require('../../../utils/ocDouyinBgm.js');
const douyinComment = require('../../../utils/ocDouyinComment.js');
const douyinQuota = require('../../../utils/ocDouyinQuota.js');
const membership = require('../../../utils/ocMembership.js');
const { hasAnyOcForSocial, getOcsWithBio } = require('../../../utils/ocSocialEligible.js');
const chatAvatar = require('../../../utils/chatAvatar.js');
const nav = require('../../../utils/nav.js');

Page({
  data: {
    feed: [],
    current: 0,
    loading: true,
    generating: false,
    emptyHint: '暂无内容',
    windowHeight: 600,
    windowWidth: 375,
    menuTop: 48,
    menuHeight: 32,
    commentOpen: false,
    commentClipId: '',
    commentList: [],
    commentTotal: 0,
    commentTotalText: '',
    commentText: '',
    commentLoading: false,
    bgmReady: false,
    bgmPlaying: false,
    bgmName: '',
    bgmExtractFreeLeft: true,
    bgmExtractHint: '本周体验次数加载中…',
    bgmMenuOpen: false,
    bgmLibOpen: false,
    bgmTracks: [],
    bgmTracksLoading: false,
    bgmTracksHint: '',
    bgmActiveFileId: '',
    shareSheetOpen: false,
    shareClipText: '',
    extractSheetOpen: false,
    extractSheetVip: false,
    extractOaVisible: false,
    expandedCaptions: {},
    adSheetOpen: false,
    adUnlockBusy: false,
    adSheetText: '今日抖音 AI 生成已达上限，看激励广告可继续解锁'
  },

  onLoad(options) {
    this._alive = true;
    this._imageIndexMap = {};
    this._imageOrientCache = {};
    this._focusClipId =
      options && options.clipId ? decodeURIComponent(options.clipId) : '';
    try {
      const sys = wx.getSystemInfoSync();
      const winH = Number(sys.windowHeight) || 600;
      const winW = Number(sys.windowWidth) || 375;
      const insetBottom =
        (sys.safeAreaInsets && Number(sys.safeAreaInsets.bottom)) ||
        (sys.safeArea && sys.screenHeight
          ? Math.max(0, Number(sys.screenHeight) - Number(sys.safeArea.bottom || sys.screenHeight))
          : 0) ||
        0;
      // 底部 tab 栏：100rpx + 安全区，换算为 px，信息流高度让出，避免挡住竖滑
      const tabBarH = Math.round((100 * winW) / 750) + insetBottom;
      this._tabBarH = tabBarH;
      this.setData({
        windowHeight: Math.max(200, winH - tabBarH),
        windowWidth: winW
      });
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      if (menu && menu.height) {
        this.setData({
          menuTop: menu.top,
          menuHeight: menu.height
        });
      } else {
        const status = Number(sys.statusBarHeight) || 20;
        this.setData({
          menuTop: status + 4,
          menuHeight: 32
        });
      }
    } catch (_) {}
  },

  onUnload() {
    this._alive = false;
    this._destroyBgmAudio();
  },

  onHide() {
    this._pauseBgm();
  },

  _syncBgmExtractFree() {
    douyinBgm
      .fetchVideoExtractQuota()
      .then((q) => {
        if (!this._alive || !q) return;
        const left = Math.max(0, Number(q.left) || 0);
        this.setData({
          bgmExtractFreeLeft: left > 0,
          bgmExtractHint: left > 0 ? '免费剩余 ' + left + ' 次 · 之后 10 点/次' : '免费已用完 · 10 点/次'
        });
      })
      .catch(() => {
        if (!this._alive) return;
        this.setData({
          bgmExtractFreeLeft: true,
          bgmExtractHint: '免费 3 次 · 之后 10 点/次'
        });
      });
  },

  onShow() {
    try {
      douyinBgm.ensureBgmPackLoaded();
    } catch (_) {}
    this._syncBgmExtractFree();
    membership.syncMembership().finally(() => {
      if (!this._alive) return;
      if (!hasAnyOcForSocial()) {
        this.setData({
          feed: [],
          loading: false,
          emptyHint: '请先在设定本中保存带小传的 OC'
        });
        return;
      }
      // 从大图预览返回：不要整页 refresh，否则横屏标记会被冲掉闪成竖屏
      if (this._fromImagePreview) {
        this._fromImagePreview = false;
        this._applyOrientForFeed(this.data.feed, this.data.current);
        return;
      }
      this.refreshFeed();
      this._ensureGenerate();
      setTimeout(() => {
        if (!this._alive || this._skipBgmAutoPlay) return;
        this._syncBgmState(true);
      }, 80);
    });
  },

  _ensureInnerAudioOption() {
    if (this._innerAudioOptReady) return;
    this._innerAudioOptReady = true;
    try {
      if (typeof wx.setInnerAudioOption === 'function') {
        wx.setInnerAudioOption({
          obeyMuteSwitch: false,
          speakerOn: true,
          mixWithOther: true
        });
      }
    } catch (_) {}
  },

  _initBgmAudio() {
    this._ensureInnerAudioOption();
    if (this._bgmAudio) return;
    try {
      if (typeof wx.createInnerAudioContext !== 'function') return;
      let audio;
      try {
        audio = wx.createInnerAudioContext({ useWebAudioImplement: false });
      } catch (_) {
        audio = wx.createInnerAudioContext();
      }
      audio.loop = true;
      try {
        audio.volume = 1;
      } catch (_) {}
      try {
        audio.obeyMuteSwitch = false;
      } catch (_) {}
      audio.onPlay(() => {
        if (!this._bgmWantPlay) {
          try {
            audio.pause();
          } catch (_) {}
          if (this._alive) this.setData({ bgmPlaying: false });
          return;
        }
        if (this._alive) this.setData({ bgmPlaying: true });
      });
      audio.onPause(() => {
        if (this._alive) this.setData({ bgmPlaying: false });
      });
      audio.onStop(() => {
        if (this._alive) this.setData({ bgmPlaying: false });
      });
      audio.onEnded(() => {
        // loop=true 一般不会走到；兜底
        if (this._alive && !audio.loop) this.setData({ bgmPlaying: false });
      });
      audio.onError((err) => {
        console.warn('[ocDouyin] bgm error', err);
        if (this._alive) this.setData({ bgmPlaying: false });
        const msg = String((err && (err.errMsg || err.errCode)) || '');
        // 临时 https 403 / 解码失败：用 cloud:// 重新下载再试一次
        if (
          !this._bgmRetrying &&
          (/decode|Unable to decode|403|fail/i.test(msg) ||
            douyinBgm.isCloudTempHttps(this._bgmSrc))
        ) {
          const ocId = this._bgmOcId || this._currentOcId();
          const meta = douyinBgm.getBgm(ocId);
          const fid = meta && meta.fileID;
          if (fid && /^cloud:\/\//i.test(fid)) {
            this._bgmRetrying = true;
            this._resolveBgmSrc(fid).then((localPath) => {
              this._bgmRetrying = false;
              if (!this._alive || !localPath || !this._bgmWantPlay) return;
              this._playBgm(localPath, { fromUser: false, skipCloudProbe: true });
            });
            return;
          }
        }
        let tip = '音频播放失败';
        if (/domain|合法域名|url not in/i.test(msg)) tip = '音频域名未配置，请改用上传';
        else if (/cloud|fileid|403|404/i.test(msg)) tip = '音频地址无效，请重新选曲';
        else if (/format|decode|编码/i.test(msg)) tip = '音频加载失败，请重新选曲';
        wx.showToast({ title: tip, icon: 'none', duration: 2500 });
      });
      this._bgmAudio = audio;
    } catch (e) {
      console.warn('[ocDouyin] create audio fail', e);
    }
  },

  _destroyBgmAudio() {
    clearTimeout(this._bgmPlayTimer);
    this._bgmPlayTimer = null;
    const audio = this._bgmAudio;
    this._bgmAudio = null;
    this._bgmSrc = '';
    this._bgmPlayPath = '';
    if (!audio) return;
    try {
      audio.stop();
    } catch (_) {}
    try {
      audio.destroy();
    } catch (_) {}
  },

  _pauseBgm() {
    this._bgmWantPlay = false;
    clearTimeout(this._bgmPlayTimer);
    this._bgmPlayTimer = null;
    const audio = this._bgmAudio;
    if (audio) {
      try {
        if (typeof audio.offCanplay === 'function') audio.offCanplay();
      } catch (_) {}
      try {
        audio.pause();
      } catch (_) {}
      try {
        // 部分机型 pause 无效，再 stop 一次
        if (typeof audio.stop === 'function' && this.data.bgmPlaying) {
          // 不 stop，保留进度；仅 pause
        }
      } catch (_) {}
    }
    if (this._alive) this.setData({ bgmPlaying: false });
  },

  _isBgmActuallyPlaying() {
    const audio = this._bgmAudio;
    if (audio) {
      try {
        if (typeof audio.paused === 'boolean') return !audio.paused;
      } catch (_) {}
    }
    return !!this.data.bgmPlaying;
  },

  _currentClip() {
    const feed = this.data.feed || [];
    return feed[this.data.current] || feed[0] || null;
  },

  _currentOcId() {
    const clip = this._currentClip();
    return (clip && clip.ocId) || '';
  },

  _currentClipId() {
    const clip = this._currentClip();
    return (clip && clip.id) || '';
  },

  _clipBgmMeta(clipId, ocId) {
    return (
      douyinBgm.getClipBgm(clipId) ||
      douyinBgm.getBgm(ocId) ||
      null
    );
  },

  /** cloud:// → 本机临时文件；云临时 https 若带 fileID 也走下载 */
  _resolveBgmSrc(src) {
    const p = String(src || '').trim();
    if (!p) return Promise.resolve('');
    if (/^cloud:\/\//i.test(p)) {
      return douyinBgm.resolveCloudTempUrl(p);
    }
    if (douyinBgm.isCloudTempHttps(p)) {
      const meta = this._clipBgmMeta(this._bgmClipId, this._bgmOcId || this._currentOcId());
      const fid = meta && meta.fileID;
      if (fid && /^cloud:\/\//i.test(fid)) {
        return douyinBgm.resolveCloudTempUrl(fid);
      }
    }
    return Promise.resolve(p);
  },

  /**
   * 播放 BGM。
   * 重要：用户点击触发时必须同步调用 play()，不能 setTimeout，
   * 否则 iOS/部分基础库会因失去「用户手势」而静音失败。
   */
  _playBgm(src, opts) {
    const options = opts || {};
    if (!src) return;
    this._initBgmAudio();
    const audio = this._bgmAudio;
    if (!audio) {
      wx.showToast({ title: '当前环境不支持音频', icon: 'none' });
      return;
    }

    const applyPlay = (playSrc) => {
      if (!this._alive || !this._bgmAudio || !playSrc) return;
      this._bgmWantPlay = true;
      try {
        audio.volume = 1;
        try {
          audio.obeyMuteSwitch = false;
        } catch (_) {}
        const prev = this._bgmSrc || '';
        if (prev && prev !== playSrc) {
          try {
            audio.stop();
          } catch (_) {}
        }
        if (audio.src !== playSrc) {
          audio.src = playSrc;
        }
        this._bgmSrc = playSrc;
        this._bgmPlayPath = playSrc;
        // 用户点击才乐观亮「播放中」；自动播等 onPlay，避免无声却在转
        if (this._alive) {
          this.setData(
            options.fromUser
              ? { bgmPlaying: true, bgmReady: true }
              : { bgmReady: true }
          );
        }
        // 同步 play，保留点击手势
        audio.play();
        // 再兜底一次：个别机型需 canplay 后才真正出声
        if (typeof audio.onCanplay === 'function') {
          const once = () => {
            try {
              audio.offCanplay(once);
            } catch (_) {}
            try {
              if (this._alive && this._bgmAudio && this._bgmWantPlay) {
                this._bgmAudio.play();
              }
            } catch (_) {}
          };
          try {
            audio.onCanplay(once);
          } catch (_) {}
        }
      } catch (e) {
        console.warn('[ocDouyin] play bgm', e);
        if (this._alive) this.setData({ bgmPlaying: false });
        wx.showToast({ title: '播放失败，请重试', icon: 'none' });
      }
    };

    if (/^cloud:\/\//i.test(src) || douyinBgm.isCloudTempHttps(src)) {
      this._resolveBgmSrc(src).then((url) => {
        if (!this._alive || !url) return;
        applyPlay(url);
      });
      return;
    }
    applyPlay(src);
  },

  async _syncBgmState(autoPlay, clipOverride) {
    const clip =
      clipOverride && typeof clipOverride === 'object'
        ? clipOverride
        : this._currentClip();
    const clipId = (clip && clip.id) || '';
    const ocId = (clip && clip.ocId) || '';
    this._bgmClipId = clipId;
    this._bgmOcId = ocId || '';
    if (!clipId && !ocId) {
      this._pauseBgm();
      this._bgmPlayPath = '';
      this.setData({ bgmReady: false, bgmPlaying: false, bgmName: '', bgmActiveFileId: '' });
      return;
    }
    // 每条抖音首次加载随机绑一首；已绑过则复用；用户点唱片可换
    const meta = await douyinBgm.ensureRandomBgmForClip(clipId, ocId);
    if (!this._alive) return;
    const cur = this._currentClip();
    if ((cur && cur.id) !== clipId && clipId) return;
    if (!meta) {
      this._pauseBgm();
      this._bgmPlayPath = '';
      this.setData({ bgmReady: false, bgmPlaying: false, bgmName: '', bgmActiveFileId: '' });
      return;
    }
    this._bgmPlayPath = meta.path;
    this.setData({
      bgmReady: true,
      bgmName: meta.name || 'BGM',
      bgmActiveFileId: meta.fileID || ''
    });
    if (autoPlay) this._playBgm(meta.path);
  },

  onTapBgmDisc() {
    if (this._bgmBusy) return;
    this._openBgmMenu();
  },

  onLongPressBgmDisc() {
    if (this._bgmBusy) return;
    this._openBgmMenu();
  },

  onCloseBgmMenu() {
    this.setData({ bgmMenuOpen: false, bgmLibOpen: false });
  },

  onBgmPanelNop() {},

  _openBgmMenu() {
    const clipId = this._currentClipId();
    if (!clipId) {
      wx.showToast({ title: '当前没有内容', icon: 'none' });
      return;
    }
    const cur = this._clipBgmMeta(clipId, this._currentOcId()) || {};
    this.setData({
      bgmMenuOpen: true,
      bgmLibOpen: false,
      bgmActiveFileId: cur.fileID || ''
    });
  },

  onOpenBgmLibrary() {
    const clipId = this._currentClipId();
    if (!clipId) {
      wx.showToast({ title: '当前没有内容', icon: 'none' });
      return;
    }
    const cur = this._clipBgmMeta(clipId, this._currentOcId()) || {};
    this.setData({
      bgmLibOpen: true,
      bgmMenuOpen: true,
      bgmTracksLoading: true,
      bgmTracksHint: '',
      bgmActiveFileId: cur.fileID || this.data.bgmActiveFileId || ''
    });
    this._loadBgmLibrary();
  },

  onCloseBgmLibrary() {
    // 回到主菜单抽屉
    this.setData({ bgmLibOpen: false, bgmMenuOpen: true });
  },

  _loadBgmLibrary() {
    douyinBgm
      .listCloudBgmLibraryWithSeed()
      .then((res) => {
        if (!this._alive) return;
        const payload = res && Array.isArray(res.tracks) ? res : { tracks: res || [], hint: '' };
        const list = (payload.tracks || []).map((t) =>
          Object.assign({}, t, {
            active: !!(
              (t.fileID && t.fileID === this.data.bgmActiveFileId) ||
              (!t.fileID && t.url && t.url === this._bgmPlayPath)
            )
          })
        );
        const emptyHint = '曲库还是空的，可等云端同步或用视频提取';
        this.setData({
          bgmTracks: list,
          bgmTracksLoading: false,
          bgmTracksHint: list.length ? payload.hint || '' : payload.hint || emptyHint
        });
      })
      .catch((e) => {
        if (!this._alive) return;
        this.setData({
          bgmTracks: [],
          bgmTracksLoading: false,
          bgmTracksHint: (e && e.message) || '曲库加载失败'
        });
      });
  },

  onSelectBgmTrack(e) {
    const clipId = this._currentClipId();
    const ocId = this._currentOcId();
    if (!clipId) {
      wx.showToast({ title: '当前没有内容', icon: 'none' });
      return;
    }
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const idx = Number(ds.index);
    const track = (this.data.bgmTracks || [])[idx];
    if (!track) return;
    // 优先 cloud:// 下载再播，避免曲库里的临时 https 403
    const playSrc =
      track.fileID && /^cloud:\/\//i.test(track.fileID)
        ? track.fileID
        : track.url || track.fileID || '';
    if (playSrc) this._playBgm(playSrc, { fromUser: true });
    douyinBgm
      .assignCloudTrackToClip(clipId, track)
      .then((meta) => {
        if (ocId) {
          try {
            douyinBgm.assignCloudTrackToOc(ocId, track);
          } catch (_) {}
        }
        return meta;
      })
      .then((meta) => {
        if (!this._alive || !meta) return;
        this._bgmClipId = clipId;
        this._bgmPlayPath = meta.path;
        const list = (this.data.bgmTracks || []).map((t) =>
          Object.assign({}, t, { active: !!(t.fileID && t.fileID === track.fileID) })
        );
        this.setData({
          bgmReady: true,
          bgmName: meta.name || track.name || 'BGM',
          bgmActiveFileId: track.fileID || '',
          bgmTracks: list
        });
        if (meta.path && meta.path !== playSrc) {
          this._playBgm(meta.path, { fromUser: true });
        }
      })
      .catch((err) => {
        wx.showToast({
          title: (err && err.message) || '选用失败',
          icon: 'none'
        });
      });
  },

  onBgmMenuPlay() {
    const clipId = this._currentClipId();
    if (!clipId) {
      wx.showToast({ title: '当前没有内容', icon: 'none' });
      return;
    }
    const cached = this._bgmPlayPath || this._bgmSrc || '';
    if (cached && !/^cloud:\/\//i.test(cached)) {
      this._playBgm(cached, { fromUser: true });
      return;
    }
    douyinBgm.ensureRandomBgmForClip(clipId, this._currentOcId()).then((meta) => {
      if (!this._alive) return;
      if (meta && meta.path) {
        this._bgmPlayPath = meta.path;
        this.setData({
          bgmReady: true,
          bgmName: meta.name || 'BGM',
          bgmActiveFileId: meta.fileID || ''
        });
        this._playBgm(meta.path, { fromUser: true });
        return;
      }
      wx.showToast({ title: '请先从 BGM 曲库选择', icon: 'none' });
    });
  },

  onBgmMenuPause() {
    this._pauseBgm();
  },

  onBgmMenuVideo() {
    this.setData({ bgmMenuOpen: false, bgmLibOpen: false });
    setTimeout(() => this._extractBgmFromVideo(), 200);
  },

  onBgmMenuUploadLocal() {
    this.setData({ bgmMenuOpen: false, bgmLibOpen: false });
    setTimeout(() => this._uploadBgm(), 200);
  },

  onOpenStorageClean() {
    this.setData({ bgmMenuOpen: false, bgmLibOpen: false });
    try {
      const clean = require('../../../utils/ocLocalStorageClean.js');
      clean.openStorageCleanPage();
    } catch (_) {
      wx.navigateTo({
        url: '/pages/ocApp/ocStorageClean/ocStorageClean',
        fail: () => wx.showToast({ title: '打开清理页失败', icon: 'none' })
      });
    }
  },

  _handleStorageFull(err) {
    const msg = (err && err.message) || '';
    const full =
      (err && (err.storageFull || err.code === 'STORAGE_FULL')) ||
      /存储空间不足|storage|空间不足|10MB/i.test(msg);
    if (!full) return false;
    try {
      const clean = require('../../../utils/ocLocalStorageClean.js');
      clean.promptStorageCleanup({ message: msg });
    } catch (_) {
      wx.showModal({
        title: '本地存储空间不足',
        content: msg || '请删除部分内容后重试',
        showCancel: false
      });
    }
    return true;
  },

  async _extractBgmFromVideo() {
    if (this._bgmBusy) return;
    const ocId = this._currentOcId();
    if (!ocId) {
      wx.showToast({ title: '当前没有 OC', icon: 'none' });
      return;
    }
    this._bgmBusy = true;
    this._skipBgmAutoPlay = true;
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    try {
      const quota = await douyinBgm.fetchVideoExtractQuota();
      if (quota && quota.left <= 0 && !quota.offline) {
        this.setData({
          extractSheetOpen: true,
          extractSheetVip: !!quota.isVip,
          extractOaVisible: false,
          bgmMenuOpen: false,
          bgmLibOpen: false
        });
        this._syncBgmExtractFree();
        return;
      }
      const video = await douyinBgm.pickVideoFile();
      await new Promise((r) => setTimeout(r, 280));
      if (!this._alive) return;
      wx.showLoading({
        title: '提取中…',
        mask: true
      });
      this._pauseBgm();
      const clipId = this._currentClipId();
      const track = await douyinBgm.extractAudioFromVideoToLocal(ocId, video);
      try {
        wx.hideLoading();
      } catch (_) {}
      if (!this._alive || !track) return;
      if (this._currentOcId() !== ocId) return;
      const meta = track.meta || douyinBgm.getBgm(ocId);
      if (meta && clipId) douyinBgm.setClipBgm(clipId, meta);
      const playPath = (meta && meta.path) || '';
      if (playPath) this._bgmPlayPath = playPath;
      this._bgmClipId = clipId;
      const q = track.quota || {};
      const left = Math.max(0, Number(q.left) || 0);
      const limit = Math.max(0, Number(q.limit) || 0);
      const vip = !!q.isVip;
      this.setData({
        bgmReady: !!playPath,
        bgmName: (meta && meta.name) || '视频BGM',
        bgmActiveFileId: '',
        bgmPlaying: false,
        bgmExtractFreeLeft: left > 0,
        bgmExtractHint: '免费剩余 ' + left + ' 次 · 之后 10 点/次'
      });
      this._syncBgmExtractFree();
      setTimeout(() => {
        if (!this._alive) return;
        if (this._currentOcId() !== ocId) return;
        if (playPath) this._playBgm(playPath, { fromUser: true });
        wx.showToast({
          title: track.keptOnCloud ? '已绑定并播放' : '已存本机并播放',
          icon: 'none',
          duration: 2000
        });
      }, 350);
    } catch (e) {
      try {
        wx.hideLoading();
      } catch (_) {}
      if (e && e.cancelled) return;
      if (this._handleStorageFull(e)) return;
      wx.showToast({
        title: (e && e.message) || '提取失败',
        icon: 'none',
        duration: 2800
      });
    } finally {
      this._bgmBusy = false;
      setTimeout(() => {
        this._skipBgmAutoPlay = false;
      }, 1200);
    }
  },

  onBgmMenuClear() {
    const clipId = this._currentClipId();
    if (!clipId) return;
    this._pauseBgm();
    douyinBgm.clearClipBgm(clipId);
    this._bgmSrc = '';
    this._bgmPlayPath = '';
    const list = (this.data.bgmTracks || []).map((t) => Object.assign({}, t, { active: false }));
    this.setData({
      bgmReady: false,
      bgmPlaying: false,
      bgmName: '',
      bgmActiveFileId: '',
      bgmTracks: list
    });
    wx.showToast({ title: '已删除 BGM', icon: 'none' });
  },

  async _uploadBgmToLibrary() {
    if (this._bgmBusy) return;
    const ocId = this._currentOcId();
    if (!ocId) {
      wx.showToast({ title: '当前没有 OC', icon: 'none' });
      return;
    }
    this._bgmBusy = true;
    this._skipBgmAutoPlay = true;
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    try {
      // 管理者可一次多选（最多 20 首）
      const picked = await douyinBgm.pickAudioFile(20);
      const files = Array.isArray(picked) ? picked : [picked];
      await new Promise((r) => setTimeout(r, 280));
      if (!this._alive) return;
      wx.showLoading({ title: '批量上传 ' + files.length + ' 首…', mask: true });
      this._pauseBgm();
      const result = await douyinBgm.uploadAudiosToCloudLibrary(ocId, files, {
        assignFirst: true
      });
      try {
        wx.hideLoading();
      } catch (_) {}
      if (!this._alive) return;
      const track = result && result.first;
      const meta = (track && track.meta) || douyinBgm.getBgm(ocId);
      const playPath = (meta && meta.path) || (track && (track.url || track.fileID)) || '';
      if (playPath) this._bgmPlayPath = playPath;
      this.setData({
        bgmReady: !!playPath,
        bgmName: (meta && meta.name) || (track && track.name) || 'BGM',
        bgmActiveFileId: (track && track.fileID) || '',
        bgmTracksLoading: true
      });
      this._loadBgmLibrary();
      const tip =
        '已入库 ' +
        (result.ok || 0) +
        ' 首' +
        (result.fail ? '，失败 ' + result.fail : '');
      setTimeout(() => {
        if (!this._alive) return;
        if (playPath) this._playBgm(playPath, { fromUser: true });
        wx.showToast({ title: tip, icon: 'none', duration: 2200 });
      }, 200);
    } catch (e) {
      try {
        wx.hideLoading();
      } catch (_) {}
      if (e && e.cancelled) return;
      wx.showToast({
        title: (e && e.message) || '上传失败',
        icon: 'none',
        duration: 2600
      });
    } finally {
      this._bgmBusy = false;
      setTimeout(() => {
        this._skipBgmAutoPlay = false;
      }, 1200);
    }
  },

  _pasteBgmUrl() {
    const ocId = this._currentOcId();
    const clipId = this._currentClipId();
    if (!ocId) {
      wx.showToast({ title: '当前没有 OC', icon: 'none' });
      return;
    }
    const applyUrl = (url) => {
      const u = String(url || '').trim();
      if (!u) return;
      this._bgmBusy = true;
      this._skipBgmAutoPlay = true;
      wx.showLoading({ title: '下载音频中…', mask: true });
      douyinBgm
        .saveBgmFromUrl(ocId, u)
        .then((meta) => {
          try {
            wx.hideLoading();
          } catch (_) {}
          if (!this._alive || !meta) return;
          if (this._currentOcId() !== ocId) return;
          if (clipId) douyinBgm.setClipBgm(clipId, meta);
          this._bgmClipId = clipId;
          this._bgmPlayPath = meta.path;
          this.setData({
            bgmReady: true,
            bgmName: meta.name || '网络 BGM',
            bgmActiveFileId: meta.fileID || ''
          });
          this._playBgm(meta.path, { fromUser: true });
          wx.showToast({ title: '已入库并播放', icon: 'none' });
          // 粘贴链接入库后刷新曲库（若面板还开着）
          if (this.data.bgmLibOpen) this._loadBgmLibrary();
        })
        .catch((e) => {
          try {
            wx.hideLoading();
          } catch (_) {}
          wx.showToast({
            title: (e && e.message) || '链接无效',
            icon: 'none',
            duration: 2800
          });
        })
        .finally(() => {
          this._bgmBusy = false;
          setTimeout(() => {
            this._skipBgmAutoPlay = false;
          }, 1200);
        });
    };

    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}

    if (typeof wx.getClipboardData === 'function') {
      wx.getClipboardData({
        success: (res) => {
          const clip = String((res && res.data) || '').trim();
          if (douyinBgm.isAudioUrl(clip)) {
            wx.showModal({
              title: '使用剪贴板链接？',
              content: clip.slice(0, 120) + (clip.length > 120 ? '…' : ''),
              confirmText: '使用',
              cancelText: '手动输入',
              success: (r) => {
                if (r.confirm) applyUrl(clip);
                else this._promptBgmUrl(applyUrl);
              }
            });
            return;
          }
          this._promptBgmUrl(applyUrl);
        },
        fail: () => this._promptBgmUrl(applyUrl)
      });
      return;
    }
    this._promptBgmUrl(applyUrl);
  },

  _promptBgmUrl(applyUrl) {
    wx.showModal({
      title: '粘贴音频链接',
      editable: true,
      placeholderText: 'https://...mp3',
      success: (r) => {
        if (!r.confirm) return;
        applyUrl(r.content);
      }
    });
  },

  async _uploadBgm() {
    if (this._bgmBusy) return;
    const ocId = this._currentOcId();
    const clipId = this._currentClipId();
    if (!ocId) {
      wx.showToast({ title: '当前没有 OC', icon: 'none' });
      return;
    }
    this._bgmBusy = true;
    this._skipBgmAutoPlay = true;
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    try {
      const file = await douyinBgm.pickAudioFile();
      await new Promise((r) => setTimeout(r, 300));
      if (!this._alive) return;
      wx.showLoading({ title: '保存中…', mask: true });
      // 上传前停掉当前播放，避免旧路径冲突
      this._pauseBgm();
      const meta = await douyinBgm.saveUploadedAudio(ocId, file.path, file.name, file.size);
      try {
        wx.hideLoading();
      } catch (_) {}
      if (!this._alive || !meta) return;
      if (this._currentOcId() !== ocId) return;
      if (clipId) douyinBgm.setClipBgm(clipId, meta);
      this._bgmClipId = clipId;
      this._bgmPlayPath = meta.path;
      this.setData({
        bgmReady: true,
        bgmName: meta.name || '自定义 BGM',
        bgmPlaying: false,
        bgmActiveFileId: meta.fileID || ''
      });
      // 延后播放，避开选文件返回 / toast 的闪退窗口
      setTimeout(() => {
        if (!this._alive) return;
        if (this._currentOcId() !== ocId) return;
        this._playBgm(meta.path, { fromUser: true });
        wx.showToast({ title: 'BGM 已更换', icon: 'none', duration: 1600 });
      }, 450);
    } catch (e) {
      try {
        wx.hideLoading();
      } catch (_) {}
      if (e && e.cancelled) return;
      if (this._handleStorageFull(e)) return;
      wx.showToast({
        title: (e && e.message) || '上传失败',
        icon: 'none',
        duration: 2600
      });
    } finally {
      this._bgmBusy = false;
      setTimeout(() => {
        this._skipBgmAutoPlay = false;
      }, 1200);
    }
  },

  onShareAppMessage() {
    const feed = this.data.feed || [];
    const cur =
      (this._shareClipId &&
        feed.find((x) => x && x.id === this._shareClipId)) ||
      feed[this.data.current] ||
      feed[0] ||
      {};
    const name = cur.ocName || 'OC';
    const caption = String(cur.content || '').slice(0, 36);
    const path = cur.id
      ? '/pages/ocApp/ocDouyin/ocDouyin?clipId=' + encodeURIComponent(cur.id)
      : '/pages/ocApp/ocDouyin/ocDouyin';
    // 点「分享给朋友」后关掉面板
    if (this.data.shareSheetOpen) {
      this.setData({ shareSheetOpen: false });
    }
    return {
      title: caption ? name + '：' + caption : '来看 ' + name + ' 的 OC 抖音',
      path: path
    };
  },

  async _ensureGenerate() {
    if (this._genLock) return;
    this._genLock = true;
    this.setData({ generating: true });
    try {
      // 进页轻量同步；不再二次 hydrate 扫盘（此前会卡死模拟器）
      await douyinGen.ensureDouyinForPageOpen();
      if (this._alive) {
        this.refreshFeed();
        const feed = douyinStore.getFeed();
        if (!feed.length) {
          this.setData({
            emptyHint: '请先在设定本相册里上传 OC 图片'
          });
        } else if (!this._skipBgmAutoPlay) {
          this._syncBgmState(true);
        }
      }
    } catch (e) {
      console.warn('[ocDouyin] generate', e);
    } finally {
      this._genLock = false;
      if (this._alive) this.setData({ generating: false, loading: false });
    }
  },

  _pathOrientKey(path) {
    return String(path || '').trim();
  },

  /** 探测是否横屏图（宽 > 高）；结果按路径缓存 */
  _probeLandscape(path) {
    const key = this._pathOrientKey(path);
    if (!key) return Promise.resolve(false);
    if (!this._imageOrientCache) this._imageOrientCache = {};
    if (Object.prototype.hasOwnProperty.call(this._imageOrientCache, key)) {
      return Promise.resolve(!!this._imageOrientCache[key]);
    }
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: key,
        success: (res) => {
          const w = Number(res && res.width) || 0;
          const h = Number(res && res.height) || 0;
          const land = w > 0 && h > 0 && w > h;
          this._imageOrientCache[key] = land;
          resolve(land);
        },
        fail: () => {
          this._imageOrientCache[key] = false;
          resolve(false);
        }
      });
    });
  },

  _withOrientFields(img, landscape) {
    if (!img) return null;
    const next = Object.assign({}, img, {
      broken: false,
      src: img.path || img.src || ''
    });
    if (typeof landscape === 'boolean') next.landscape = landscape;
    else if (typeof img.landscape === 'boolean') next.landscape = img.landscape;
    return next;
  },

  /** 为当前可见条及邻条补横竖屏标记 */
  async _applyOrientForFeed(feed, preferIndex) {
    const list = feed || this.data.feed || [];
    if (!list.length) return;
    const cur = Math.max(0, Number(preferIndex != null ? preferIndex : this.data.current) || 0);
    const indexes = [cur, cur - 1, cur + 1].filter((i, n, arr) => i >= 0 && i < list.length && arr.indexOf(i) === n);
    for (let n = 0; n < indexes.length; n++) {
      if (!this._alive) return;
      const i = indexes[n];
      const item = list[i];
      if (!item || !item.images || !item.images.length) continue;
      const idx = Math.min(
        Math.max(0, Number(item.imageIndex) || 0),
        item.images.length - 1
      );
      const img = item.images[idx];
      if (!img || !img.path) continue;
      if (typeof img.landscape === 'boolean') {
        // 已有标记时仍同步到 currentImage
        if (!item.currentImage || item.currentImage.landscape !== img.landscape) {
          this.setData({
            ['feed[' + i + '].currentImage']: this._withOrientFields(img, img.landscape)
          });
        }
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const land = await this._probeLandscape(img.path);
      if (!this._alive) return;
      const nextImg = this._withOrientFields(img, land);
      const images = (item.images || []).slice();
      images[idx] = Object.assign({}, images[idx], { landscape: land });
      this.setData({
        ['feed[' + i + '].images']: images,
        ['feed[' + i + '].currentImage']: nextImg
      });
    }
  },

  onToggleCaption(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const key = 'expandedCaptions.' + id;
    this.setData({
      [key]: !this.data.expandedCaptions[id]
    });
  },

  refreshFeed() {
    const raw = douyinStore.prepareFeedForDisplay(douyinStore.getFeed());
    const idxMap = this._imageIndexMap || {};
    const cache = this._imageOrientCache || {};
    const feed = raw.map((item) => {
      let images =
        Array.isArray(item.images) && item.images.length
          ? item.images
          : item.imagePath
            ? [{ id: item.imageId || '0', path: item.imagePath }]
            : [];
      // 保证每张有稳定 id；刷新时不继承 broken，避免切图误报后永久灰掉
      images = images.map((img, i) => {
        const id = String((img && (img.id || img.path)) || 'img_' + i);
        const path = (img && img.path) || '';
        const key = this._pathOrientKey(path);
        const known = Object.prototype.hasOwnProperty.call(cache, key);
        return Object.assign({}, img, {
          id: id,
          path: path,
          src: path,
          broken: false,
          landscape: known ? !!cache[key] : undefined
        });
      });
      const imageIndex = Math.min(
        Math.max(0, Number(idxMap[item.id]) || 0),
        Math.max(0, images.length - 1)
      );
      const rawCur = images[imageIndex] || null;
      const currentImage = rawCur
        ? this._withOrientFields(rawCur, rawCur.landscape)
        : null;
      return Object.assign({}, item, {
        avatarDisplay: item.isUserPost ? '' : item.avatarUrl || '',
        avatarLetter: item.isUserPost
          ? '我'
          : String(item.displayName || item.ocName || 'O').slice(0, 1),
        images: images,
        imageIndex: imageIndex,
        currentImage: currentImage,
        imagePath: (images[0] && images[0].path) || item.imagePath || ''
      });
    });
    let emptyHint = '暂无内容';
    if (!feed.length) {
      if (!getOcsWithBio().length) emptyHint = '请先在设定本中保存带小传的 OC';
      else emptyHint = '请先在设定本相册里上传 OC 图片';
    }
    let cur = Math.min(this.data.current || 0, Math.max(0, feed.length - 1));
    if (this._focusClipId && feed.length) {
      const focusId = this._focusClipId;
      const idx = feed.findIndex((c) => c && c.id === focusId);
      if (idx >= 0) {
        cur = idx;
        this._focusClipId = '';
      } else if (!douyinStore.isClipUnlocked(focusId)) {
        this._focusClipId = '';
        wx.showToast({ title: '该作品不在当前信息流内', icon: 'none' });
      }
    }
    this.setData({
      feed: feed,
      loading: false,
      emptyHint: emptyHint,
      current: cur
    });
    this._resolveOcAvatars(feed);
    this._applyOrientForFeed(feed, cur);
  },

  async _resolveOcAvatars(feed) {
    const list = feed || [];
    for (let i = 0; i < list.length; i++) {
      if (!this._alive) return;
      const item = list[i];
      if (!item || !item.ocId || item.avatarDisplay) continue;
      try {
        const url = await chatAvatar.resolveOcAvatar(item.ocId, item.avatarUrl);
        if (url && this._alive) {
          this.setData({ ['feed[' + i + '].avatarDisplay']: url });
        }
      } catch (_) {}
    }
  },

  onSwiperChange(e) {
    const cur = (e && e.detail && e.detail.current) || 0;
    const feed = this.data.feed || [];
    const prevClipId = this._bgmClipId || '';
    const nextClip = feed[cur] || null;
    const nextClipId = (nextClip && nextClip.id) || '';
    this.setData({ current: cur });
    this._applyOrientForFeed(feed, cur);
    // 竖滑换条：切换该条抖音绑定的 BGM（无则随机一首）
    if (nextClipId && nextClipId !== prevClipId) {
      this._syncBgmState(true, nextClip);
    }
  },

  _setClipImageIndex(clipIndex, nextIdx) {
    const feed = this.data.feed || [];
    const item = feed[clipIndex];
    if (!item || !item.images || !item.images.length) return;
    const max = item.images.length - 1;
    const idx = Math.max(0, Math.min(max, nextIdx));
    if (!this._imageIndexMap) this._imageIndexMap = {};
    this._imageIndexMap[item.id] = idx;
    const raw = item.images[idx] || null;
    const apply = (land) => {
      if (!this._alive) return;
      const img = raw
        ? this._withOrientFields(Object.assign({}, raw, { landscape: land }), land)
        : null;
      const images = (item.images || []).slice();
      if (img) images[idx] = Object.assign({}, images[idx] || {}, img);
      this.setData({
        ['feed[' + clipIndex + '].images']: images,
        ['feed[' + clipIndex + '].imageIndex']: idx,
        ['feed[' + clipIndex + '].currentImage']: img
      });
    };
    if (!raw) {
      this.setData({
        ['feed[' + clipIndex + '].imageIndex']: idx,
        ['feed[' + clipIndex + '].currentImage']: null
      });
      return;
    }
    if (typeof raw.landscape === 'boolean') {
      apply(raw.landscape);
      return;
    }
    // 先按竖屏铺上，探测后再切横屏样式，避免闪空
    apply(false);
    this._probeLandscape(raw.path || raw.src).then((land) => {
      if (!this._alive) return;
      const curItem = (this.data.feed || [])[clipIndex];
      if (!curItem || (curItem.imageIndex || 0) !== idx) return;
      apply(land);
    });
  },

  onStepImage(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const clipIndex = ds.clipIndex;
    const dir = Number(ds.dir) || 0;
    if (clipIndex == null || !dir) return;
    const feed = this.data.feed || [];
    const item = feed[clipIndex];
    if (!item) return;
    this._setClipImageIndex(clipIndex, (item.imageIndex || 0) + dir);
  },

  onImgTouchStart(e) {
    const t = e && e.changedTouches && e.changedTouches[0];
    if (!t) return;
    this._imgTouch = {
      x: t.clientX,
      y: t.clientY,
      clipIndex:
        e && e.currentTarget && e.currentTarget.dataset
          ? e.currentTarget.dataset.clipIndex
          : null
    };
  },

  onImgTouchEnd(e) {
    const start = this._imgTouch;
    this._imgTouch = null;
    if (!start || start.clipIndex == null) return;
    const t = e && e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 48) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
    const feed = this.data.feed || [];
    const item = feed[start.clipIndex];
    if (!item || !item.images || item.images.length < 2) return;
    const dir = dx < 0 ? 1 : -1;
    this._setClipImageIndex(start.clipIndex, (item.imageIndex || 0) + dir);
  },

  onToggleLike(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    douyinStore.toggleLike(id);
    this.refreshFeed();
  },

  onToggleFavorite(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const on = douyinStore.toggleFavorite(id);
    this.refreshFeed();
    wx.showToast({
      title: on ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1200
    });
  },

  _loadCommentView(clipId) {
    const list = douyinStore.prepareCommentsForDisplay(clipId);
    // 顶部「评论 N」与侧栏展示数一致（仅显示用）
    let feedItem = (this.data.feed || []).find((x) => x && x.id === clipId);
    if (!feedItem) {
      try {
        const prepared = douyinStore.prepareFeedForDisplay(douyinStore.getFeed());
        feedItem = (prepared || []).find((x) => x && x.id === clipId);
      } catch (_) {}
    }
    let totalText = '';
    let total = 0;
    if (feedItem && (feedItem.commentCountText || feedItem.commentCount != null)) {
      totalText = String(feedItem.commentCountText || feedItem.commentCount || '');
      total = Number(feedItem.commentCount) || 0;
    } else {
      list.forEach((c) => {
        total += 1 + (c.replyCount || 0);
      });
      totalText = String(total);
    }
    return { list: list, total: total, totalText: totalText };
  },

  async onOpenComment(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const cachedRaw = douyinStore.getComments(id);
    const cached = this._loadCommentView(id);
    this.setData({
      commentOpen: true,
      commentClipId: id,
      commentList: cached.list,
      commentTotal: cached.total,
      commentTotalText: cached.totalText || String(cached.total || 0),
      commentText: '',
      commentLoading: !cachedRaw.length
    });
    try {
      await douyinComment.ensureCommentsForClip(id);
      if (this._alive && this.data.commentClipId === id) {
        const view = this._loadCommentView(id);
        this.setData({
          commentList: view.list,
          commentTotal: view.total,
          commentTotalText: view.totalText || String(view.total || 0),
          commentLoading: false
        });
        this.refreshFeed();
      }
    } catch (err) {
      console.warn('[ocDouyin] seed comments', err);
      if (this._alive && this.data.commentClipId === id) {
        this.setData({ commentLoading: false });
      }
    }
  },

  onCloseComment() {
    this.setData({
      commentOpen: false,
      commentClipId: '',
      commentList: [],
      commentTotal: 0,
      commentTotalText: '',
      commentText: '',
      commentLoading: false
    });
  },

  onCommentInput(e) {
    this.setData({ commentText: (e && e.detail && e.detail.value) || '' });
  },

  onExpandCommentReplies(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    const list = (this.data.commentList || []).map((c) => {
      if (!c || c.id !== id) return c;
      return Object.assign({}, c, { repliesExpanded: true });
    });
    this.setData({ commentList: list });
  },

  onToggleCommentLike(e) {
    const cid = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const clipId = this.data.commentClipId;
    if (!cid || !clipId) return;
    douyinStore.toggleCommentLike(clipId, cid);
    const view = this._loadCommentView(clipId);
    // 保留展开状态
    const expanded = {};
    (this.data.commentList || []).forEach((c) => {
      if (c && c.repliesExpanded) expanded[c.id] = true;
    });
    view.list = view.list.map((c) =>
      expanded[c.id] ? Object.assign({}, c, { repliesExpanded: true }) : c
    );
    this.setData({
      commentList: view.list,
      commentTotal: view.total,
      commentTotalText: view.totalText || String(view.total || 0)
    });
  },

  onTapCommentReplyHint(e) {
    const author =
      e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.author;
    this.setData({
      commentText: author ? '回复 @' + author + ' ' : ''
    });
  },

  async onSubmitComment() {
    const id = this.data.commentClipId;
    const text = String(this.data.commentText || '').trim();
    if (!id) return;
    if (!text) {
      wx.showToast({ title: '写点内容再发', icon: 'none' });
      return;
    }
    const userItem = douyinStore.addComment(id, text);
    this.refreshFeed();
    const view = this._loadCommentView(id);
    this.setData({
      commentText: '',
      commentList: view.list,
      commentTotal: view.total,
      commentTotalText: view.totalText || String(view.total || 0)
    });
    try {
      const replied = await douyinComment.handleUserCommentReply(
        id,
        text,
        userItem && userItem.id
      );
      if (replied && replied.skipped) return;
      if (this._alive && this.data.commentClipId === id) {
        this.refreshFeed();
        const next = this._loadCommentView(id);
        this.setData({
          commentList: next.list,
          commentTotal: next.total,
          commentTotalText: next.totalText || String(next.total || 0)
        });
      }
    } catch (err) {
      console.warn('[ocDouyin] reply', err);
    }
  },

  onShareTap(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const clip =
      (this.data.feed || []).find((x) => x && x.id === id) ||
      (this.data.feed || [])[this.data.current] ||
      null;
    if (!clip) return;
    const shareText =
      '@' +
      (clip.ocName || 'OC') +
      '\n' +
      String(clip.content || '') +
      (clip.tagText ? '\n' + clip.tagText : '');
    this._shareClipId = clip.id || '';
    this.setData({
      shareSheetOpen: true,
      shareClipText: shareText
    });
  },

  onCloseShareSheet() {
    this.setData({ shareSheetOpen: false });
  },

  onCloseExtractSheet() {
    this.setData({ extractSheetOpen: false, extractOaVisible: false });
  },

  onExtractOpenOa() {
    this.setData({ extractOaVisible: true });
  },

  onExtractCloseOa() {
    this.setData({ extractOaVisible: false });
  },

  onExtractGoRedeem() {
    this.setData({ extractSheetOpen: false, extractOaVisible: false });
    wx.navigateTo({
      url: '/pages/redeemCode/redeemCode',
      fail: () => wx.showToast({ title: '打开兑换页失败', icon: 'none' })
    });
  },

  onExtractNop() {},

  onShareCopyCaption() {
    const text = String(this.data.shareClipText || '').trim();
    if (!text) {
      wx.showToast({ title: '无文案可复制', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setData({ shareSheetOpen: false });
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  onTapOc(e) {
    const ocId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.ocId;
    if (!ocId) return;
    wx.navigateTo({
      url: '/pages/ocApp/ocDouyinProfile/ocDouyinProfile?id=' + encodeURIComponent(ocId),
      fail() {
        wx.showToast({ title: '无法打开主页', icon: 'none' });
      }
    });
  },

  onGoOcApp() {
    nav.switchMainTab('ocapp');
  },

  onPreviewImage(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const clipIndex = ds.clipIndex;
    const src = ds.src;
    const feed = this.data.feed || [];
    const item = feed[clipIndex] || feed[this.data.current] || null;
    if (!item) return;
    const urls = (item.images || []).map((x) => x.path).filter(Boolean);
    const current = src || urls[item.imageIndex || 0] || item.imagePath;
    if (!current) return;
    // 预览返回走 onShow：靠此标记跳过 refreshFeed，避免横屏标记被冲掉
    // 注意：previewImage 的 complete 在「打开预览」时就会触发，不能在这里清标记
    this._fromImagePreview = true;
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    wx.previewImage({
      current: current,
      urls: urls.length ? urls : [current]
    });
  },

  onCloseAdSheet() {
    this.setData({ adSheetOpen: false });
  },

  onAdPanelNop() {},

  onWatchAdUnlock() {
    if (this.data.adUnlockBusy) return;
    this.setData({ adUnlockBusy: true });
    douyinQuota
      .unlockMoreByRewardedAd()
      .then((r) => {
        if (!this._alive) return;
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.errMsg) || '解锁失败', icon: 'none' });
          return;
        }
        this.setData({ adSheetOpen: false });
        wx.showToast({
          title: '已解锁 ' + (r.unlocked || douyinQuota.AD_BONUS_CALLS) + ' 次',
          icon: 'success'
        });
        this._runDouyinAiRefresh();
      })
      .finally(() => {
        if (this._alive) this.setData({ adUnlockBusy: false });
      });
  },

  _runDouyinAiRefresh() {
    if (this._genLock) return;
    this._genLock = true;
    this.setData({ generating: true });
    Promise.resolve()
      .then(() => douyinGen.generateDouyinBatch({ force: true, cloudCaption: true }))
      .then((res) => {
        if (!this._alive) return;
        if (res && res.needAd && !membership.isMember()) {
          this.setData({
            adSheetOpen: true,
            adSheetText:
              (res.errMsg || '今日抖音 AI 已达上限') +
              '（看完广告可再解锁 ' +
              douyinQuota.AD_BONUS_CALLS +
              ' 次）'
          });
        } else if (res && res.needAd && membership.isMember()) {
          douyinQuota.ensureMemberAdBypass();
        }
        return douyinGen.hydrateFeedImagePaths({ light: true });
      })
      .then(() => {
        if (this._alive) this.refreshFeed();
      })
      .catch((e) => {
        console.warn('[ocDouyin] refresh', e && (e.message || e));
      })
      .finally(() => {
        this._genLock = false;
        if (this._alive) this.setData({ generating: false });
      });
  },

  onUserPostTap() {
    wx.navigateTo({
      url: '/pages/ocApp/ocDouyin/ocDouyinCompose',
      fail: () => wx.showToast({ title: '打开发帖页失败', icon: 'none' })
    });
  },

  onTabHome() {
    if ((this.data.current || 0) !== 0) {
      this.setData({ current: 0 });
    }
  },

  onRefreshTap() {
    if (this._genLock) return;
    const info = douyinQuota.getQuotaInfo();
    if (info.needAd) {
      if (membership.isMember()) {
        douyinQuota.ensureMemberAdBypass();
      } else {
        this.setData({
          adSheetOpen: true,
          adSheetText:
            '今日免费 ' +
            douyinQuota.FREE_DAILY_CALLS +
            ' 次已用完（看完广告可再解锁 ' +
            douyinQuota.AD_BONUS_CALLS +
            ' 次）'
        });
        this._genLock = true;
        this.setData({ generating: true });
        Promise.resolve()
          .then(() => douyinGen.generateDouyinBatch({ force: true, cloudCaption: false }))
          .then(() => douyinGen.hydrateFeedImagePaths({ light: true }))
          .then(() => {
            if (this._alive) this.refreshFeed();
          })
          .catch((e) => {
            console.warn('[ocDouyin] refresh local', e && (e.message || e));
          })
          .finally(() => {
            this._genLock = false;
            if (this._alive) this.setData({ generating: false });
          });
        return;
      }
    }
    this._runDouyinAiRefresh();
  },

  async onImageError(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const clipIndex = ds.clipIndex;
    const imgIndex = ds.imgIndex != null ? ds.imgIndex : null;
    const imgId = ds.imgId != null ? String(ds.imgId) : '';
    if (clipIndex == null) return;
    const feed = this.data.feed || [];
    const item = feed[clipIndex];
    if (!item || !item.images) return;
    const idx = imgIndex != null ? imgIndex : item.imageIndex || 0;
    const img = item.images[idx];
    if (!img) return;
    // 切图后旧节点晚到的 error：忽略
    if (imgId && String(img.id || '') !== imgId) return;
    if ((item.imageIndex || 0) !== idx) return;

    try {
      const fixed = await douyinGen.resolveAlbumImagePath(item.ocId, {
        id: img.id,
        path: img.path
      });
      if (fixed) {
        const exists = await new Promise((resolve) => {
          try {
            wx.getFileSystemManager().access({
              path: fixed,
              success: () => resolve(true),
              fail: () => resolve(false)
            });
          } catch (_) {
            resolve(false);
          }
        });
        // 文件还在：多半是开发者工具换 src 误报，保留展示
        if (exists || fixed !== img.path) {
          const nextImg = Object.assign({}, img, {
            path: fixed,
            src: fixed,
            broken: false
          });
          const patch = {
            ['feed[' + clipIndex + '].images[' + idx + ']']: Object.assign({}, nextImg)
          };
          if ((item.imageIndex || 0) === idx) {
            patch['feed[' + clipIndex + '].currentImage'] = nextImg;
          }
          this.setData(patch);
          return;
        }
      }
    } catch (_) {}

    // 确认文件不在才标 broken，不自动跳走（避免连环标红）
    const brokenImg = Object.assign({}, img, { broken: true, src: '' });
    const patch = {
      ['feed[' + clipIndex + '].images[' + idx + ']']: brokenImg
    };
    if ((item.imageIndex || 0) === idx) {
      patch['feed[' + clipIndex + '].currentImage'] = brokenImg;
    }
    this.setData(patch);
  }
});
