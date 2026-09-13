/**
 * 虚拟支付 · 道具直购客户端
 */
const { callCloudFunction, ensureCloudReady } = require('./cloudInit.js');
const membership = require('./ocMembership.js');

function listProducts() {
  if (!ensureCloudReady()) {
    return Promise.reject(new Error('云开发未就绪'));
  }
  return callCloudFunction({
    name: 'virtualPay',
    data: { action: 'listProducts' },
    timeout: 20000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.errMsg || '加载商品失败');
    return r;
  });
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res && res.code) resolve(res.code);
        else reject(new Error('wx.login 无 code'));
      },
      fail: (err) => reject(err || new Error('wx.login 失败'))
    });
  });
}

function requestVirtualPayment(payParams) {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestVirtualPayment !== 'function') {
      reject(new Error('当前基础库不支持虚拟支付，请升级微信'));
      return;
    }
    wx.requestVirtualPayment({
            mode: payParams.mode || 'short_series_coin',
      signData: payParams.signData,
      paySig: payParams.paySig,
      signature: payParams.signature,
      success: (res) => resolve(res || {}),
      fail: (err) => reject(err || new Error('支付失败'))
    });
  });
}

function pollUntilDelivered(outTradeNo, tries) {
  const max = Math.max(3, Number(tries) || 20);
  let i = 0;
  const tick = () => {
    i += 1;
    return callCloudFunction({
      name: 'virtualPay',
      data: { action: 'pollOrder', outTradeNo: outTradeNo },
      timeout: 20000
    }).then((res) => {
      const r = (res && res.result) || {};
      if (r.ok && r.status === 'delivered') return r;
      if (i >= max) return r;
      return new Promise((resolve) => {
        setTimeout(() => resolve(tick()), 1200);
      });
    });
  };
  return tick();
}

function applyDeliveredQuota(polled) {
  if (!polled || polled.status !== 'delivered') return;
  try {
    if (polled.extraRounds != null) {
      const ai = require('./aiChatQuota.js');
      if (typeof ai.writeExtraRounds === 'function') {
        ai.writeExtraRounds(Number(polled.extraRounds) || 0);
      }
    }
    if (polled.isVip) {
      membership.writeCache({
        isVip: !!polled.isVip,
        vipExpireAt: Number(polled.vipExpireAt) || 0,
        syncedAt: Date.now()
      });
    }
  } catch (_) {}
}

/** 支付后强制拉云端余额，避免轮询超时或跨页不刷新 */
function forceSyncQuotaAfterPay() {
  try {
    const ai = require('./aiChatQuota.js');
    if (typeof ai.syncExtraRoundsFromServer === 'function') {
      return ai.syncExtraRoundsFromServer();
    }
  } catch (_) {}
  return Promise.resolve(0);
}

/**
 * 购买道具：createOrder → requestVirtualPayment → poll 发货
 */
function buyProduct(productId) {
  if (!ensureCloudReady()) {
    return Promise.reject(new Error('云开发未就绪'));
  }
  const pid = String(productId || 'coin_1000').trim() || 'coin_1000';

  return wxLoginCode()
    .then((code) =>
      callCloudFunction({
        name: 'virtualPay',
        data: { action: 'createOrder', productId: pid, code: code },
        timeout: 30000
      })
    )
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.errMsg || '下单失败');
      return requestVirtualPayment(r).then(() => r);
    })
    .then((r) =>
      pollUntilDelivered(r.outTradeNo, 20).then((polled) => {
        applyDeliveredQuota(polled);
        // 无论是否已 delivered，都再拉一次余额；发货延迟时后台继续 poll
        const outTradeNo = r.outTradeNo;
        const finish = forceSyncQuotaAfterPay().then((extra) => {
          const polledExtra = Number(polled && polled.extraRounds) || 0;
          const synced = Number(extra) || 0;
          const merged = Math.max(polledExtra, synced);
          if (merged > 0) {
            try {
              const ai = require('./aiChatQuota.js');
              if (typeof ai.writeExtraRounds === 'function') {
                ai.writeExtraRounds(merged);
              }
            } catch (_) {}
          }
          return Object.assign({}, polled || {}, {
            outTradeNo: outTradeNo,
            extraRounds: merged,
            status: (polled && polled.status) || 'pending'
          });
        });
        if (!polled || polled.status !== 'delivered') {
          // 后台再轮询一段时间，到账后写本地
          pollUntilDelivered(outTradeNo, 30)
            .then((again) => {
              applyDeliveredQuota(again);
              return forceSyncQuotaAfterPay();
            })
            .catch(() => {});
        }
        return finish;
      })
    );
}

function buyAdFree() {
  if (!ensureCloudReady()) {
    return Promise.reject(new Error('云开发未就绪'));
  }
  return callCloudFunction({
    name: 'virtualPay',
    data: { action: 'buyAdFree' },
    timeout: 20000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.errMsg || '开通失败');
    try {
      if (r.extraRounds != null) {
        const ai = require('./aiChatQuota.js');
        if (typeof ai.writeExtraRounds === 'function') {
          ai.writeExtraRounds(Number(r.extraRounds) || 0);
        }
      }
      membership.writeCache({
        isVip: true,
        vipExpireAt: Number(r.vipExpireAt) || 0,
        syncedAt: Date.now()
      });
    } catch (_) {}
    return r;
  });
}

module.exports = {
  listProducts,
  buyProduct,
  buyAdFree,
  pollUntilDelivered
};
