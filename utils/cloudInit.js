/** 微信云开发初始化（与 feedbackConfig / 控制台环境一致） */
const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
const { trimOcChatPayload } = require('./cloudChatPayload.js');

let inited = false;

function initCloud() {
  if (!wx.cloud) return false;
  if (inited) return true;
  try {
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV || CLOUD_ENV_ID,
      traceUser: true
    });
    // 统一拦截云函数成功调用，上报模型 API 次数（避免各处漏记）
    if (!wx.cloud.__ocUsagePatched && typeof wx.cloud.callFunction === 'function') {
      const rawCall = wx.cloud.callFunction.bind(wx.cloud);
      wx.cloud.callFunction = function (options) {
        const name = options && options.name;
        let opts = options || {};
        if (name === 'ocChat' && opts.data) {
          opts = Object.assign({}, opts, {
            data: trimOcChatPayload(opts.data)
          });
        }
        const ret = rawCall(opts);
        if (ret && typeof ret.then === 'function') {
          return ret.then((res) => {
            try {
              if (
                name &&
                name !== 'usageStats' &&
                name !== 'submitFeedback' &&
                name !== 'listMyFeedback' &&
                name !== 'feedbackApi' &&
                name !== 'redeemCode'
              ) {
                require('./usageReport.js').trackApiCall(name);
              }
            } catch (_) {}
            return res;
          });
        }
        return ret;
      };
      wx.cloud.__ocUsagePatched = true;
    }
    inited = true;
    return true;
  } catch (err) {
    console.error('wx.cloud.init 失败', err);
    return false;
  }
}

function ensureCloudReady() {
  if (!wx.cloud) return false;
  return initCloud();
}

function callCloudFunction(options) {
  if (!ensureCloudReady()) {
    return Promise.reject(
      new Error('云开发未初始化，请重启小程序或在开发者工具中开通云开发')
    );
  }
  const opts = options || {};
  let data = opts.data;
  // ocChat 携带长历史时易触发 data exceed max size（约 100KB）
  if (opts.name === 'ocChat' && data) {
    data = trimOcChatPayload(data);
  }
  return wx.cloud.callFunction(Object.assign({}, opts, { data: data }));
}

module.exports = {
  CLOUD_ENV_ID,
  initCloud,
  ensureCloudReady,
  callCloudFunction
};
