/**
 * 虚拟支付 · 代币充值客户端
 * 注意：short_series_coin 无道具发货推送，到账依赖 poll/reconcile 写 user_quota
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
      data: {
        action: 'pollOrder',
        outTradeNo: outTradeNo,
        // 支付控件 success 后提示云端可发货（代币充值无道具推送时的主路径）
        clientPaid: true
      },
      timeout: 20000
    }).then((res) => {
      const r = (res && res.result) || {};
      if (r.ok && r.status === 'delivered' && Number(r.extraRounds) > 0) return r;
      if (r.ok && r.status === 'delivered' && i >= 3) return r;
      if (i >= max) return r;
      return new Promise((resolve) => {
        setTimeout(() => resolve(tick()), 1200);
      });
    });
  };
  return tick();
}

function applyDeliveredQuota(polled) {
  if (!polled || polled.status !== 'delivered') return 0;
  let written = 0;
  try {
    const ai = require('./aiChatQuota.js');
    if (polled.extraRounds != null && typeof ai.writeExtraRounds === 'function') {
      const server = Math.max(0, Number(polled.extraRounds) || 0);
      const local =
        typeof ai.readExtraRounds === 'function' ? ai.readExtraRounds() : 0;
      written = Math.max(server, local);
      ai.writeExtraRounds(written);
    }
    if (polled.isVip) {
      membership.writeCache({
        isVip: !!polled.isVip,
        vipExpireAt: Number(polled.vipExpireAt) || 0,
        syncedAt: Date.now()
      });
    }
  } catch (_) {}
  return written;
}

/** 支付后只拉 balance，禁止 flush 绝对覆盖刚到账额度 */
function forceSyncQuotaAfterPay() {
  try {
    const ai = require('./aiChatQuota.js');
    if (typeof ai.syncExtraRoundsFromServer === 'function') {
      return ai.syncExtraRoundsFromServer({ skipFlush: true });
    }
  } catch (_) {}
  return Promise.resolve(0);
}

/** 扫描近期订单并补发到额度（打开商店 / 支付后调用） */
function reconcileMyOrders(opts) {
  if (!ensureCloudReady()) {
    return Promise.reject(new Error('云开发未就绪'));
  }
  const forcePending = !!(opts && opts.forcePending);
  return callCloudFunction({
    name: 'virtualPay',
    data: { action: 'reconcileMyOrders', forcePending: forcePending },
    timeout: 45000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.errMsg || '对账失败');
    try {
      const ai = require('./aiChatQuota.js');
      if (r.extraRounds != null && typeof ai.writeExtraRounds === 'function') {
        const server = Math.max(0, Number(r.extraRounds) || 0);
        const local =
          typeof ai.readExtraRounds === 'function' ? ai.readExtraRounds() : 0;
        ai.writeExtraRounds(Math.max(server, local));
      }
      if (r.isVip) {
        membership.writeCache({
          isVip: !!r.isVip,
          vipExpireAt: Number(r.vipExpireAt) || 0,
          syncedAt: Date.now()
        });
      }
    } catch (_) {}
    return r;
  });
}

/**
 * 购买：createOrder → requestVirtualPayment → poll 发货 → reconcile
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
      pollUntilDelivered(r.outTradeNo, 25).then((polled) => {
        const outTradeNo = r.outTradeNo;
        applyDeliveredQuota(polled);

        // 支付成功后强制扫单补发，解决「钱扣了额度仍 0」
        return reconcileMyOrders()
          .catch(() => forceSyncQuotaAfterPay().then((extra) => ({ extraRounds: extra })))
          .then((rec) => {
            const polledExtra = Number(polled && polled.extraRounds) || 0;
            const synced = Number(rec && rec.extraRounds) || 0;
            let local = 0;
            try {
              const ai = require('./aiChatQuota.js');
              if (typeof ai.readExtraRounds === 'function') local = ai.readExtraRounds();
            } catch (_) {}
            const merged = Math.max(polledExtra, synced, local);
            if (merged >= 0) {
              try {
                const ai = require('./aiChatQuota.js');
                if (typeof ai.writeExtraRounds === 'function') {
                  ai.writeExtraRounds(merged);
                }
              } catch (_) {}
            }
            const delivered =
              !!(polled && polled.status === 'delivered') ||
              merged > 0 ||
              !!(rec && (rec.granted || rec.repaired));
            if (!delivered || merged <= 0) {
              pollUntilDelivered(outTradeNo, 40)
                .then((again) => {
                  applyDeliveredQuota(again);
                  return reconcileMyOrders().catch(() => {});
                })
                .catch(() => {});
            }
            return Object.assign({}, polled || {}, {
              outTradeNo: outTradeNo,
              extraRounds: merged,
              status: delivered ? 'delivered' : (polled && polled.status) || 'pending',
              reconciled: true
            });
          });
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
  pollUntilDelivered,
  reconcileMyOrders
};
