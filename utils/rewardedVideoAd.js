/** @deprecated 激励视频广告已下线，请勿再引用。保留文件仅作历史备份。 */
const AD_UNIT_ID = 'adunit-9593ce583aac5143';
const MIN_WATCH_MS = 15000;
const AD_CLOSE_TIMEOUT_MS = 120000;
/** show 失败后最多额外重试次数 */
const SHOW_LOAD_RETRY = 3;
/** 无广告填充（1004）时少重试，避免刷错误日志 */
const SHOW_LOAD_RETRY_NO_FILL = 1;
const SHOW_RETRY_DELAYS_MS = [800, 1600, 2800];
const SHOW_RETRY_DELAYS_NO_FILL_MS = [2000, 3500];
/** 预加载最短间隔，避免无效拉取刷高请求量 */
const PRELOAD_COOLDOWN_MS = 45000;
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
let lastErrorPanelKey = '';
let lastErrorPanelAt = 0;
let realtimeLogger = null;
let lastShowError = null;

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

function finishPending(result) {
  const resolve = pendingResolve;
  pendingResolve = null;
  pendingClose = false;
  adShowAt = 0;
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
    wx.showToast({ title: '需观看满15秒才能继续', icon: 'none' });
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
    if (!pendingClose || !pendingResolve) return;
    const watchedMs = adShowAt ? Date.now() - adShowAt : 0;
    const ok = !!(res && res.isEnded) || watchedMs >= MIN_WATCH_MS;
    loadState = 'idle';
    readyAt = 0;
    if (ok) {
      reportAdEvent('info', 'rewarded', {
        ok: 1,
        isEnded: !!(res && res.isEnded),
        watchedMs: watchedMs
      });
      finishPending({
        ok: true,
        rewarded: true,
        loadFailed: false,
        earlyClose: false,
        watchedMs: watchedMs,
        isEnded: !!(res && res.isEnded)
      });
    } else {
      reportAdEvent('info', 'closed_early', {
        ok: 0,
        isEnded: !!(res && res.isEnded),
        watchedMs: watchedMs
      });
      finishPending({
        ok: false,
        rewarded: false,
        loadFailed: false,
        earlyClose: true,
        watchedMs: watchedMs,
        isEnded: !!(res && res.isEnded)
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
 * @returns {Promise<{ok:boolean,rewarded:boolean,loadFailed:boolean,earlyClose:boolean,errCode?:*,errMsg?:string}>}
 */
function showRewardedVideoAd() {
  return new Promise((resolve) => {
    lastShowError = null;
    // 每次展示都按当前页对齐实例，避免跨页 show
    const ad = ensureVideoAd(false);
    if (!ad) {
      reportAdFailure('unsupported', {
        errCode: 'unsupported',
        errMsg: '当前环境不支持激励广告'
      });
      resolve({
        ok: false,
        rewarded: false,
        loadFailed: true,
        earlyClose: false,
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
      // 超时后销毁实例，避免残留回调干扰下次播放
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

    const waitInflight = inflightLoad ? inflightLoad.catch(() => {}) : Promise.resolve();
    waitInflight
      .then(() => {
        // 等待期间可能已切页，再对齐一次
        const currentAd = ensureVideoAd(false);
        if (!currentAd) throw new Error('ad_unavailable');
        return showWithRetries(currentAd, SHOW_LOAD_RETRY, SHOW_LOAD_RETRY);
      })
      .catch((err) => {
        reportAdFailure('final', err);
        const code = lastShowError && lastShowError.errCode;
        const msg = lastShowError && lastShowError.errMsg;
        finishPending({
          ok: false,
          rewarded: false,
          loadFailed: true,
          earlyClose: false,
          errCode: code != null ? code : err && err.errCode,
          errMsg: msg || (err && (err.errMsg || err.message)) || 'load_failed'
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

module.exports = {
  AD_UNIT_ID,
  MIN_WATCH_MS,
  preloadRewardedVideoAd,
  showRewardedVideoAd,
  destroyVideoAd,
  isAdGraceEnvironment
};
