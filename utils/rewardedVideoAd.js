/** 激励视频广告：观看满约 30 秒，且需点击进入广告详情（切后台）后才可领取 */
const AD_UNIT_ID = 'adunit-9593ce583aac5143';
const MIN_WATCH_MS = 30000;
const AD_CLOSE_TIMEOUT_MS = 120000;
/** show 失败后最多额外重试次数（激励视频，非原生模板） */
const SHOW_LOAD_RETRY = 4;
/** 无广告填充（1004）：多隔一会儿再试，提高命中率且避免刷屏 */
const SHOW_LOAD_RETRY_NO_FILL = 3;
const SHOW_RETRY_DELAYS_MS = [600, 1200, 2200, 3600];
const SHOW_RETRY_DELAYS_NO_FILL_MS = [2500, 5000, 8000];
/** 预加载最短间隔，避免无效拉取刷高请求量 */
const PRELOAD_COOLDOWN_MS = 30000;
/** 已加载素材超过该时间视为可能过期，展示前重新 load */
const READY_TTL_MS = 15 * 60 * 1000;
/** 同一错误上报到「错误内容」的最短间隔，避免重试刷屏 */
const ERROR_PANEL_DEDUP_MS = 8000;
/** 无填充类错误：属流量侧常见情况，不进「错误内容」硬抛 */
const SOFT_AD_ERR_CODES = {
  1000: true, // 后端错误
  1001: true, // 参数错误
  1002: true, // 广告单元无效
  1003: true, // 内部错误
  1004: true, // 无合适广告
  1005: true, // 广告组件审核中
  1006: true, // 广告组件被驳回
  1007: true, // 广告组件被封禁
  1008: true, // 广告单元已关闭
  close_timeout: true
};

let videoAd = null;
/** 创建广告时所在页面 route，跨页 show 会报错 */
let videoAdPageRoute = '';
let loadState = 'idle'; // idle | loading | ready | error
let lastLoadAttemptAt = 0;
let readyAt = 0;
let inflightLoad = null;
let adShowAt = 0;
let pendingClose = null;
let pendingResolve = null;
let closeTimer = null;
/** 广告展示中；全屏广告本身会触发一次 onHide，不能当作「点击」 */
let adSessionActive = false;
let adClickSuspected = false;
/** 会话内 hide 次数：第 1 次且过短多为广告盖住；之后或半屏落地算点击 */
let adHideCount = 0;
/** 忽略开播后短时间内的「首次」onHide（广告盖住小程序） */
const AD_COVER_IGNORE_MS = 1200;
let lastErrorPanelKey = '';
let lastErrorPanelAt = 0;
let realtimeLogger = null;
let lastShowError = null;
/** 页面级 / 半屏小程序 / 音频中断探针清理函数 */
let detachAdClickProbes = null;

function getRealtimeLogger() {
  if (realtimeLogger) return realtimeLogger;
  try {
    if (typeof wx.getRealtimeLogManager === 'function') {
      realtimeLogger = wx.getRealtimeLogManager();
    }
  } catch (_) {}
  return realtimeLogger;
}

function getDeviceHint() {
  try {
    const sys = wx.getSystemInfoSync();
    return {
      platform: sys.platform || '',
      system: sys.system || '',
      version: sys.version || '',
      SDKVersion: sys.SDKVersion || ''
    };
  } catch (_) {
    return {};
  }
}

function getCurrentPageRoute() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const cur = pages && pages.length ? pages[pages.length - 1] : null;
    if (!cur) return '';
    return String(cur.route || cur.__route__ || '');
  } catch (_) {
    return '';
  }
}

function isDestroyedOrWrongPageError(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '').toLowerCase();
  return (
    msg.indexOf('destroyed') >= 0 ||
    msg.indexOf('has been destroy') >= 0 ||
    msg.indexOf('only invoke show') >= 0 ||
    msg.indexOf('on the page where') >= 0
  );
}

/**
 * 激励视频可观测上报：
 * 1) 实时日志（需开通实时日志；FilterMsg 仅支持英文）
 * 2) wx.reportEvent 业务事件（需在 We 分析事件管理中建好同名事件）
 * 3) 最终失败额外进入「错误内容」
 */
function reportAdEvent(level, stage, detail) {
  const device = getDeviceHint();
  const extra = detail || {};
  const errCode = extra.errCode != null ? extra.errCode : '';
  const line = [
    'rewarded_ad',
    'stage=' + stage,
    errCode !== '' ? 'errCode=' + errCode : '',
    extra.ok != null ? 'ok=' + extra.ok : '',
    'platform=' + (device.platform || ''),
    'system=' + String(device.system || '').slice(0, 40),
    'lib=' + (device.SDKVersion || '')
  ]
    .filter(Boolean)
    .join(' ');

  if (level === 'error') {
    console.error(line, extra);
  } else {
    console.info(line, extra);
  }

  const logger = getRealtimeLogger();
  if (logger) {
    try {
      if (level === 'error' && typeof logger.error === 'function') {
        logger.error(line, extra);
      } else if (typeof logger.info === 'function') {
        logger.info(line, extra);
      }
      if (typeof logger.setFilterMsg === 'function') logger.setFilterMsg('rewardedAd');
      if (typeof logger.addFilterMsg === 'function') {
        logger.addFilterMsg(String(stage).replace(/[^A-Za-z]/g, '') || 'stage');
        if (device.platform) {
          logger.addFilterMsg(String(device.platform).replace(/[^A-Za-z]/g, ''));
        }
        logger.addFilterMsg(level === 'error' ? 'adFail' : 'adOk');
      }
    } catch (_) {}
  }

  try {
    if (typeof wx.reportEvent === 'function') {
      wx.reportEvent('rewarded_ad', {
        stage: String(stage || ''),
        err_code: String(errCode),
        ok: Number(extra.ok != null ? extra.ok : level === 'error' ? 0 : 1),
        platform: String(device.platform || ''),
        lib: String(device.SDKVersion || '')
      });
    }
  } catch (_) {}
}

function isSoftAdError(errOrCode) {
  if (errOrCode == null) return false;
  if (typeof errOrCode === 'object') {
    const code = errOrCode.errCode != null ? errOrCode.errCode : errOrCode.code;
    if (code != null && SOFT_AD_ERR_CODES[code]) return true;
    const msg = String(errOrCode.errMsg || errOrCode.message || '').toLowerCase();
    return (
      msg.indexOf('no advertisement') >= 0 ||
      msg.indexOf('no ad') >= 0 ||
      msg.indexOf('close_timeout') >= 0
    );
  }
  return !!SOFT_AD_ERR_CODES[errOrCode];
}

function reportAdFailure(stage, err, extra) {
  const code = err && (err.errCode != null ? err.errCode : err.code);
  const msg = (err && (err.errMsg || err.message)) || String(err || '');
  lastShowError = {
    errCode: code != null ? code : 'unknown',
    errMsg: String(msg).slice(0, 180)
  };
  const soft = isSoftAdError(lastShowError);
  reportAdEvent(
    soft ? 'info' : 'error',
    stage,
    Object.assign(
      { errCode: lastShowError.errCode, errMsg: lastShowError.errMsg, soft: soft ? 1 : 0 },
      extra || {}
    )
  );

  // 无填充 / 关闭超时等属预期内失败，不上报「错误内容」避免刷屏
  if (soft || stage !== 'final') return;
  const key = String(code != null ? code : msg).slice(0, 48);
  const now = Date.now();
  if (key === lastErrorPanelKey && now - lastErrorPanelAt < ERROR_PANEL_DEDUP_MS) return;
  lastErrorPanelKey = key;
  lastErrorPanelAt = now;
  const line =
    'rewarded_ad fail stage=final errCode=' +
    lastShowError.errCode +
    ' errMsg=' +
    lastShowError.errMsg;
  setTimeout(() => {
    throw new Error(line);
  }, 0);
}

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function markAdClickSuspected(reason) {
  if (!adSessionActive || !pendingClose) return;
  if (!adClickSuspected) {
    adClickSuspected = true;
    try {
      reportAdEvent('info', 'click_signal', { ok: 1, reason: String(reason || '') });
    } catch (_) {}
  }
}

function attachAdClickProbes() {
  if (typeof detachAdClickProbes === 'function') {
    try {
      detachAdClickProbes();
    } catch (_) {}
    detachAdClickProbes = null;
  }
  const cleanups = [];

  // 底部抽屉 / 半屏落地页一出现（高度变化）即视为已点击
  try {
    if (typeof wx.onEmbeddedMiniProgramHeightChange === 'function') {
      const onH = function (res) {
        const elapsed = adShowAt ? Date.now() - adShowAt : 0;
        // 开播瞬间全屏盖住不算；之后任意抽屉高度变化都算点击
        if (elapsed < 350) return;
        const h =
          res && (res.height != null ? Number(res.height) : Number(res.heightRatio));
        if (Number.isFinite(h) && h <= 0) return;
        markAdClickSuspected(
          Number.isFinite(h) ? 'drawer_h_' + Math.round(h * 100) / 100 : 'drawer_open'
        );
      };
      wx.onEmbeddedMiniProgramHeightChange(onH);
      cleanups.push(function () {
        try {
          if (typeof wx.offEmbeddedMiniProgramHeightChange === 'function') {
            wx.offEmbeddedMiniProgramHeightChange(onH);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // 抽屉顶起时常改窗口尺寸：同样视为已点进详情
  try {
    if (typeof wx.onWindowResize === 'function') {
      const onResize = function () {
        const elapsed = adShowAt ? Date.now() - adShowAt : 0;
        if (elapsed < 350) return;
        markAdClickSuspected('drawer_resize');
      };
      wx.onWindowResize(onResize);
      cleanups.push(function () {
        try {
          if (typeof wx.offWindowResize === 'function') {
            wx.offWindowResize(onResize);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // 抽屉/落地页常打断广告音频 → 视为已点击
  try {
    if (typeof wx.onAudioInterruptionBegin === 'function') {
      const onAudio = function () {
        const elapsed = adShowAt ? Date.now() - adShowAt : 0;
        if (elapsed < 350) return;
        markAdClickSuspected('drawer_audio');
      };
      wx.onAudioInterruptionBegin(onAudio);
      cleanups.push(function () {
        try {
          if (typeof wx.offAudioInterruptionBegin === 'function') {
            wx.offAudioInterruptionBegin(onAudio);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // 部分机型半屏落地只触发 wx.onAppHide，不走 App() 生命周期
  try {
    if (typeof wx.onAppHide === 'function') {
      const onAppHide = function () {
        markAdSessionBackground();
      };
      wx.onAppHide(onAppHide);
      cleanups.push(function () {
        try {
          if (typeof wx.offAppHide === 'function') {
            wx.offAppHide(onAppHide);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
  try {
    if (typeof wx.onAppShow === 'function') {
      const onAppShow = function () {
        markAdSessionForeground();
      };
      wx.onAppShow(onAppShow);
      cleanups.push(function () {
        try {
          if (typeof wx.offAppShow === 'function') {
            wx.offAppShow(onAppShow);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // 页面 onHide/onShow：半屏盖住时有时只触发 Page 而不触发 App
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages && pages.length ? pages[pages.length - 1] : null;
    if (page && !page.__ocAdClickProbe) {
      page.__ocAdClickProbe = true;
      const origHide = page.onHide;
      const origShow = page.onShow;
      page.onHide = function () {
        markAdSessionBackground();
        if (typeof origHide === 'function') return origHide.apply(this, arguments);
      };
      page.onShow = function () {
        markAdSessionForeground();
        if (typeof origShow === 'function') return origShow.apply(this, arguments);
      };
      cleanups.push(function () {
        try {
          page.onHide = origHide;
          page.onShow = origShow;
          page.__ocAdClickProbe = false;
        } catch (_) {}
      });
    }
  } catch (_) {}

  detachAdClickProbes = function () {
    for (let i = 0; i < cleanups.length; i++) {
      try {
        cleanups[i]();
      } catch (_) {}
    }
  };
}

function beginAdSession() {
  adSessionActive = true;
  adClickSuspected = false;
  adHideCount = 0;
  attachAdClickProbes();
}

function endAdSession() {
  adSessionActive = false;
  if (typeof detachAdClickProbes === 'function') {
    try {
      detachAdClickProbes();
    } catch (_) {}
    detachAdClickProbes = null;
  }
}

function isAdSessionActive() {
  return !!adSessionActive && !!pendingClose;
}

/**
 * App/Page.onHide：
 * - 开播后极短时间内的「第 1 次」hide：视为广告全屏盖住，不算点击
 * - 之后任意 hide（含底部抽屉顶起）：视为已点击
 */
function markAdSessionBackground() {
  if (!isAdSessionActive()) return;
  try {
    require('./appRelaunch.js').markSkipAppRelaunch();
  } catch (_) {}
  adHideCount += 1;
  const elapsed = adShowAt ? Date.now() - adShowAt : 0;
  if (adHideCount === 1 && elapsed < AD_COVER_IGNORE_MS) return;
  // 抽屉出现时多数机型会再 hide 一次；第一次超时后的 hide 也算点击
  markAdClickSuspected(adHideCount >= 2 ? 'drawer_hide' : 'hide_after_cover');
}

/**
 * App/Page.onShow：广告未关闭前回前台，通常是从落地页返回广告，视为已点击。
 * （广告正常关闭时会先 endAdSession，不会误判）
 */
function markAdSessionForeground() {
  if (!isAdSessionActive()) return;
  try {
    require('./appRelaunch.js').markSkipAppRelaunch();
  } catch (_) {}
  const elapsed = adShowAt ? Date.now() - adShowAt : 0;
  if (elapsed < AD_COVER_IGNORE_MS) return;
  markAdClickSuspected('foreground');
}

function finishPending(result) {
  const resolve = pendingResolve;
  pendingResolve = null;
  pendingClose = false;
  adShowAt = 0;
  endAdSession();
  clearCloseTimer();
  if (!resolve) return;
  const payload =
    result && typeof result === 'object'
      ? result
      : { ok: !!result, rewarded: !!result };
  if (
    !payload.ok &&
    payload.earlyClose &&
    payload.watchedMs > 0 &&
    payload.watchedMs < MIN_WATCH_MS
  ) {
    wx.showToast({ title: '需观看满 30 秒才能领取', icon: 'none' });
  }
  resolve(payload);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadyFresh() {
  return loadState === 'ready' && readyAt > 0 && Date.now() - readyAt < READY_TTL_MS;
}

function destroyVideoAd() {
  if (!videoAd) {
    videoAdPageRoute = '';
    return;
  }
  try {
    if (typeof videoAd.destroy === 'function') videoAd.destroy();
  } catch (_) {}
  videoAd = null;
  videoAdPageRoute = '';
  loadState = 'idle';
  readyAt = 0;
  inflightLoad = null;
}

/**
 * 确保广告实例属于「当前页面」。
 * 微信要求：只能在创建 rewardedVideoAd 的页面上调用 show()。
 */
function ensureVideoAd(forceRecreate) {
  const route = getCurrentPageRoute();
  // videoAdPageRoute 为空时也要按当前页重建，否则跨页 show 会报错
  const needRecreate =
    !!forceRecreate || !videoAd || !!(route && route !== videoAdPageRoute);
  if (needRecreate) destroyVideoAd();
  if (videoAd) return videoAd;
  if (!wx.createRewardedVideoAd) return null;
  videoAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
  videoAdPageRoute = route || getCurrentPageRoute();
  videoAd.onLoad(() => {
    loadState = 'ready';
    readyAt = Date.now();
  });
  videoAd.onError((err) => {
    loadState = 'error';
    readyAt = 0;
    reportAdFailure('onError', err);
  });
  videoAd.onClose((res) => {
    // 从广告/落地页返回时再次标记，避免中间 onShow 抢先 reLaunch
    try {
      require('./appRelaunch.js').markSkipAppRelaunch();
    } catch (_) {}
    if (!pendingClose || !pendingResolve) return;
    const watchedMs = adShowAt ? Date.now() - adShowAt : 0;
    const isEnded = !!(res && res.isEnded);
    const watchedEnough = isEnded || watchedMs >= MIN_WATCH_MS;
    const clicked = !!adClickSuspected;
    loadState = 'idle';
    readyAt = 0;
    if (watchedEnough) {
      reportAdEvent('info', 'rewarded', {
        ok: 1,
        isEnded: isEnded,
        watchedMs: watchedMs,
        clicked: clicked ? 1 : 0
      });
      finishPending({
        ok: true,
        rewarded: true,
        loadFailed: false,
        earlyClose: false,
        watchedMs: watchedMs,
        isEnded: isEnded,
        clicked: clicked
      });
      // 看完后预拉下一条，降低下次「无填充」概率
      setTimeout(() => {
        try {
          preloadRewardedVideoAd({ force: true });
        } catch (_) {}
      }, 1200);
    } else {
      reportAdEvent('info', 'closed_early', {
        ok: 0,
        isEnded: isEnded,
        watchedMs: watchedMs,
        clicked: clicked ? 1 : 0
      });
      finishPending({
        ok: false,
        rewarded: false,
        loadFailed: false,
        earlyClose: true,
        watchedMs: watchedMs,
        isEnded: isEnded,
        clicked: clicked
      });
    }
  });
  return videoAd;
}

function loadAd(ad, opts) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!ad || typeof ad.load !== 'function') {
    return Promise.reject(new Error('ad_unavailable'));
  }
  if (isReadyFresh() && !force) {
    return Promise.resolve();
  }
  if (inflightLoad) {
    if (!force) return inflightLoad;
    return inflightLoad.catch(() => {}).then(() => {
      if (isReadyFresh()) return;
      return startLoad(ad);
    });
  }
  if (!force && lastLoadAttemptAt && now - lastLoadAttemptAt < PRELOAD_COOLDOWN_MS) {
    return Promise.resolve();
  }
  return startLoad(ad);
}

function startLoad(ad) {
  lastLoadAttemptAt = Date.now();
  loadState = 'loading';
  inflightLoad = ad
    .load()
    .then(() => {
      loadState = 'ready';
      readyAt = Date.now();
      inflightLoad = null;
    })
    .catch((err) => {
      loadState = 'error';
      readyAt = 0;
      inflightLoad = null;
      throw err;
    });
  return inflightLoad;
}

/**
 * 按需预加载。务必在将要播放广告的页面调用。
 */
function preloadRewardedVideoAd(opts) {
  const force = !!(opts && opts.force);
  const ad = ensureVideoAd(false);
  if (!ad) return Promise.resolve(false);
  return loadAd(ad, { force })
    .then(() => true)
    .catch(() => false);
}

function showOnce(ad) {
  adShowAt = Date.now();
  return ad.show().then(() => {
    reportAdEvent('info', 'shown', { ok: 1 });
  });
}

function retryDelayMs(remainRetries, maxRetries, softNoFill) {
  const table = softNoFill ? SHOW_RETRY_DELAYS_NO_FILL_MS : SHOW_RETRY_DELAYS_MS;
  const idx = Math.max(0, maxRetries - remainRetries);
  return table[Math.min(idx, table.length - 1)];
}

function showWithRetries(ad, remainRetries, maxRetries) {
  const prepare = isReadyFresh()
    ? Promise.resolve()
    : loadAd(ad, { force: true });

  return prepare
    .then(() => showOnce(ad))
    .catch((err) => {
      const softNoFill = isSoftAdError(err);
      reportAdFailure('show_retry', err, { remainRetries: remainRetries, soft: softNoFill ? 1 : 0 });
      if (remainRetries <= 0) throw err;
      // 1004 等无填充：少重试，避免短时间反复拉取
      if (softNoFill && remainRetries > SHOW_LOAD_RETRY_NO_FILL) {
        remainRetries = SHOW_LOAD_RETRY_NO_FILL;
      }
      loadState = 'error';
      readyAt = 0;
      const wait = retryDelayMs(remainRetries, maxRetries, softNoFill);
      return delay(wait).then(() => {
        const forceRecreate =
          isDestroyedOrWrongPageError(err) ||
          softNoFill ||
          remainRetries <= Math.ceil(maxRetries / 2);
        const nextAd = ensureVideoAd(forceRecreate);
        if (!nextAd) throw err;
        return loadAd(nextAd, { force: true }).then(() =>
          showWithRetries(nextAd, remainRetries - 1, maxRetries)
        );
      });
    });
}

/**
 * 展示激励视频（对齐微信官方：show 失败则 load 后再 show）
 * @returns {Promise<{ok:boolean,rewarded:boolean,loadFailed:boolean,earlyClose:boolean,errCode?:*,errMsg?:string}>}
 */
function showRewardedVideoAd() {
  return new Promise((resolve) => {
    lastShowError = null;
    beginAdSession();
    // 激励视频/落地页会触发 App 进后台，需跳过回前台 reLaunch 首页
    try {
      require('./appRelaunch.js').markSkipAppRelaunch();
    } catch (_) {}
    // 每次展示都按当前页对齐实例，避免跨页 show
    const ad = ensureVideoAd(false);
    if (!ad) {
      endAdSession();
      reportAdFailure('unsupported', {
        errCode: 'unsupported',
        errMsg: '当前环境不支持激励广告'
      });
      resolve({
        ok: false,
        rewarded: false,
        loadFailed: true,
        earlyClose: false,
        clicked: false,
        errCode: 'unsupported',
        errMsg: '当前环境不支持激励广告'
      });
      return;
    }

    if (pendingResolve) {
      finishPending({
        ok: false,
        rewarded: false,
        loadFailed: false,
        earlyClose: false,
        errCode: 'interrupted'
      });
    }

    pendingResolve = resolve;
    pendingClose = true;
    adShowAt = Date.now();
    reportAdEvent('info', 'attempt', {
      ok: 1,
      page: getCurrentPageRoute() || videoAdPageRoute || ''
    });
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      reportAdFailure('close_timeout', {
        errCode: 'close_timeout',
        errMsg: '激励视频广告等待关闭超时'
      });
      try {
        destroyVideoAd();
      } catch (_) {}
      finishPending({
        ok: false,
        rewarded: false,
        loadFailed: true,
        earlyClose: false,
        errCode: 'close_timeout',
        errMsg: '激励视频广告等待关闭超时'
      });
    }, AD_CLOSE_TIMEOUT_MS);

    const currentAd = ensureVideoAd(false);
    if (!currentAd) {
      finishPending({
        ok: false,
        rewarded: false,
        loadFailed: true,
        earlyClose: false,
        errCode: 'unsupported',
        errMsg: '当前环境不支持激励广告'
      });
      return;
    }

    // 官方推荐：先 show，失败再 load → show
    adShowAt = Date.now();
    currentAd
      .show()
      .then(() => {
        reportAdEvent('info', 'shown', { ok: 1 });
      })
      .catch(() => {
        return currentAd
          .load()
          .then(() => {
            adShowAt = Date.now();
            return currentAd.show();
          })
          .then(() => {
            reportAdEvent('info', 'shown', { ok: 1, retry: 1 });
          });
      })
      .catch((err) => {
        // 仍失败时走原有重试（跨页 destroy / 无填充等）
        return showWithRetries(
          ensureVideoAd(isDestroyedOrWrongPageError(err)) || currentAd,
          SHOW_LOAD_RETRY,
          SHOW_LOAD_RETRY
        ).catch((err2) => {
          reportAdFailure('final', err2 || err);
          const code = lastShowError && lastShowError.errCode;
          const msg = lastShowError && lastShowError.errMsg;
          finishPending({
            ok: false,
            rewarded: false,
            loadFailed: true,
            earlyClose: false,
            errCode: code != null ? code : (err2 && err2.errCode) || (err && err.errCode),
            errMsg:
              msg ||
              (err2 && (err2.errMsg || err2.message)) ||
              (err && (err.errMsg || err.message)) ||
              'load_failed'
          });
        });
      });
  });
}

function isAdGraceEnvironment() {
  try {
    const sys = wx.getSystemInfoSync();
    return sys.platform === 'devtools' || !wx.createRewardedVideoAd;
  } catch (_) {
    return false;
  }
}

/** 把激励视频错误码转成用户可读文案（拉取失败绝不发奖） */
function formatAdLoadErrMsg(result) {
  const code = result && result.errCode;
  const raw = String((result && result.errMsg) || '');
  if (code === 1004 || /no.?ad|无合适|无广告|1004/i.test(raw)) {
    return '暂无广告可看，请稍后再试';
  }
  if (code === 'unsupported' || /不支持/.test(raw)) {
    return '当前环境不支持激励广告，请用真机';
  }
  if (code === 'close_timeout') {
    return '广告响应超时，请重试';
  }
  if (code === 1005 || code === 1006 || code === 1007 || code === 1008) {
    return '广告位暂不可用，请稍后再试';
  }
  return '广告加载失败，请稍后重试';
}

module.exports = {
  AD_UNIT_ID,
  MIN_WATCH_MS,
  preloadRewardedVideoAd,
  showRewardedVideoAd,
  destroyVideoAd,
  isAdGraceEnvironment,
  markAdSessionBackground,
  markAdSessionForeground,
  isAdSessionActive,
  formatAdLoadErrMsg
};
