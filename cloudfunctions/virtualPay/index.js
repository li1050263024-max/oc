/**
 * 小程序虚拟支付 · 代币充值（short_series_coin）
 *
 * 环境变量（云函数配置）：
 * - XPAY_OFFER_ID   虚拟支付 OfferId
 * - XPAY_APP_KEY    现网 AppKey（沙箱用 XPAY_APP_KEY_SANDBOX）
 * - XPAY_ENV        0 现网 / 1 沙箱（默认 0）
 * - WX_APPID        小程序 AppId（code2session）
 * - WX_SECRET       小程序 AppSecret
 *
 * 公众平台：开通代币充值，兑换比例建议 1 元 = 100 代币，则 1000 代币 = ¥10。
 * 消息推送：xpay_coin_pay_notify / xpay_coin_deliver_notify → 本云函数
 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV || CLOUD_ENV_ID });

const db = cloud.database();
const _ = db.command;
const DAY_MS = 24 * 60 * 60 * 1000;
const VIP_WEEKLY_ROUNDS = 100;

/**
 * 仅开放一档代币充值：¥10 → 1000 代币（1 代币 = 1 额度点）
 * 公众平台代币兑换比例请设为 1 元 = 100 代币
 */
const COIN_PACK = {
  productId: 'coin_1000',
  title: '充值 10 元',
  desc: '到账 1000 额度，永久通用',
  goodsPrice: 1000,
  buyQuantity: 1000,
  rounds: 1000
};
const AD_FREE_COST = 300;
const AD_FREE_DAYS = 30;
const PRODUCTS = [COIN_PACK];

function productById(id) {
  const pid = String(id || '').trim();
  if (!pid || pid === COIN_PACK.productId) return COIN_PACK;
  return PRODUCTS.find((p) => p.productId === pid) || null;
}

function cfg() {
  const env = Number(process.env.XPAY_ENV) === 1 ? 1 : 0;
  const offerId = String(process.env.XPAY_OFFER_ID || '').trim();
  const appKey = String(
    env === 1
      ? process.env.XPAY_APP_KEY_SANDBOX || process.env.XPAY_APP_KEY || ''
      : process.env.XPAY_APP_KEY || ''
  ).trim();
  const appId = String(
    process.env.WX_APPID || 'wxc2a46482e8eac885'
  ).trim();
  const secret = String(process.env.WX_SECRET || '').trim();
  return { env, offerId, appKey, appId, secret };
}

function hmacSha256Hex(key, data) {
  return crypto.createHmac('sha256', String(key)).update(String(data), 'utf8').digest('hex');
}

function openidOf() {
  try {
    const wxContext = cloud.getWXContext();
    return String((wxContext && wxContext.OPENID) || '').trim();
  } catch (_) {
    return '';
  }
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(raw.slice(0, 200) || e.message));
          }
        });
      })
      .on('error', reject);
  });
}

function httpsPostJson(url, body) {
  const data = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(raw.slice(0, 200) || e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function code2Session(code) {
  const { appId, secret } = cfg();
  if (!appId || !secret) {
    throw new Error('请配置云函数环境变量 WX_APPID / WX_SECRET');
  }
  const url =
    'https://api.weixin.qq.com/sns/jscode2session?appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&js_code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code';
  const json = await httpsGet(url);
  if (!json || !json.session_key) {
    throw new Error(
      (json && (json.errmsg || json.errMsg)) || 'code2session 失败'
    );
  }
  return {
    sessionKey: json.session_key,
    openid: json.openid || ''
  };
}

async function getAccessToken() {
  const { appId, secret } = cfg();
  if (!appId || !secret) throw new Error('缺少 WX_APPID / WX_SECRET');
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(secret);
  const json = await httpsGet(url);
  if (!json || !json.access_token) {
    throw new Error((json && json.errmsg) || '获取 access_token 失败');
  }
  return json.access_token;
}

function genOutTradeNo() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return ('T' + t + r).slice(0, 32);
}

async function getOrCreateQuota(openid) {
  const col = db.collection('user_quota');
  const oid = String(openid || '').trim();
  if (!oid) throw new Error('缺少 openid');

  // 统一以 openid 作为文档 ID，避免 where 查到旧文档导致加额与 balance 读不一致
  let primary = null;
  try {
    const got = await col.doc(oid).get();
    if (got && got.data && Object.keys(got.data).length) {
      primary = Object.assign({ _id: oid }, got.data);
    }
  } catch (_) {}

  let legacy = null;
  try {
    const res = await col.where({ openid: oid }).limit(20).get();
    const rows = ((res && res.data) || []).filter((r) => r && r._id !== oid);
    if (rows.length) {
      rows.sort(
        (a, b) =>
          Number(b.extraRounds || 0) - Number(a.extraRounds || 0) ||
          Number(b.updateTimeMs || 0) - Number(a.updateTimeMs || 0)
      );
      legacy = rows[0];
    }
  } catch (_) {}

  if (!primary && legacy) {
    const migrated = Object.assign({}, legacy, {
      openid: oid,
      updateTimeMs: Date.now()
    });
    delete migrated._id;
    await col.doc(oid).set({ data: migrated });
    primary = Object.assign({ _id: oid }, migrated);
  }

  if (!primary) {
    const doc = {
      openid: oid,
      extraRounds: 0,
      redeemedTotal: 0,
      extraConsumed: 0,
      freeUsed: 0,
      freeAllowed: 30,
      isVip: false,
      vipExpireAt: 0,
      createTimeMs: Date.now(),
      updateTimeMs: Date.now()
    };
    await col.doc(oid).set({ data: doc });
    return Object.assign({ _id: oid }, doc);
  }

  // 若旧文档额度更高，合并进主文档
  if (legacy) {
    const pExtra = Math.max(0, Number(primary.extraRounds) || 0);
    const lExtra = Math.max(0, Number(legacy.extraRounds) || 0);
    if (lExtra > pExtra) {
      const patch = {
        extraRounds: lExtra,
        redeemedTotal: Math.max(
          Number(primary.redeemedTotal) || 0,
          Number(legacy.redeemedTotal) || 0
        ),
        updateTimeMs: Date.now()
      };
      await col.doc(oid).update({ data: patch });
      primary = Object.assign({}, primary, patch);
    }
  }
  return primary;
}

function computeVipExpire(quota, vipDays) {
  const days = Math.max(1, Math.floor(Number(vipDays) || 30));
  const now = Date.now();
  const prev = Number(quota && quota.vipExpireAt) || 0;
  const base = prev > now ? prev : now;
  return base + days * DAY_MS;
}

async function deliverProduct(openid, product, orderMeta) {
  const quota = await getOrCreateQuota(openid);
  const patch = { updateTimeMs: Date.now() };
  let nextExtra = Math.max(0, Number(quota.extraRounds) || 0);
  const rounds = Math.max(0, Math.floor(Number(product.rounds) || 0));
  const vipDays = Math.max(0, Math.floor(Number(product.vipDays) || 0));
  const outTradeNo = String((orderMeta && (orderMeta.outTradeNo || orderMeta._id)) || '');

  if (rounds > 0) {
    // 用 _.inc，避免与 syncBalance 并发时绝对写互相覆盖
    patch.extraRounds = _.inc(rounds);
    patch.redeemedTotal = _.inc(rounds);
    patch.extraRoundsExpireAt = 0;
    nextExtra += rounds;
  }

  let nextVipExpire = Number(quota.vipExpireAt) || 0;
  if (vipDays > 0) {
    patch.isVip = true;
    patch.vipPaused = false;
    nextVipExpire = computeVipExpire(quota, vipDays);
    patch.vipExpireAt = nextVipExpire;
    patch.vipWeeklyRounds = Math.max(
      VIP_WEEKLY_ROUNDS,
      Math.floor(Number(product.weeklyRounds) || VIP_WEEKLY_ROUNDS)
    );
    patch.freeAllowed = patch.vipWeeklyRounds;
  }

  // 一律写 openid 文档，保证与 balance 读路径一致
  try {
    await db.collection('user_quota').doc(openid).update({ data: patch });
  } catch (e) {
    // 文档异常时兜底 set.merge
    const base = Object.assign({}, quota);
    delete base._id;
    if (rounds > 0) {
      base.extraRounds = Math.max(0, Number(base.extraRounds) || 0) + rounds;
      base.redeemedTotal = Math.max(0, Number(base.redeemedTotal) || 0) + rounds;
      base.extraRoundsExpireAt = 0;
    }
    if (vipDays > 0) {
      base.isVip = true;
      base.vipPaused = false;
      base.vipExpireAt = nextVipExpire;
    }
    base.updateTimeMs = Date.now();
    await db.collection('user_quota').doc(openid).set({ data: base });
  }

  // redeem_logs 按订单号去重，避免 notify+poll 双记
  const code = 'VPAY:' + outTradeNo;
  if (outTradeNo) {
    try {
      const existed = await db.collection('redeem_logs').where({ code: code }).limit(1).get();
      if (!(existed && existed.data && existed.data.length)) {
        await db.collection('redeem_logs').add({
          data: {
            code: code,
            openid,
            rounds: rounds,
            kind: vipDays > 0 ? (rounds > 0 ? 'combo' : 'vip') : 'rounds',
            vipDays: vipDays,
            permanent: false,
            source: 'virtual_pay',
            productId: product.productId,
            createTimeMs: Date.now(),
            createTime: db.serverDate()
          }
        });
      }
    } catch (_) {}
  }

  // 以落库后的真实余额为准（并发 _.inc 后更准）
  let freshExtra = nextExtra;
  try {
    const fresh = await getOrCreateQuota(openid);
    freshExtra = Math.max(0, Number(fresh.extraRounds) || 0);
    if (vipDays > 0) {
      nextVipExpire = Number(fresh.vipExpireAt) || nextVipExpire;
    }
  } catch (_) {}

  return {
    extraRounds: freshExtra,
    isVip: vipDays > 0 ? true : !!(quota.isVip && (!quota.vipExpireAt || quota.vipExpireAt > Date.now())),
    vipExpireAt: nextVipExpire,
    rounds: rounds,
    vipDays: vipDays
  };
}

async function markDelivered(outTradeNo, patch) {
  await db
    .collection('virtual_orders')
    .doc(outTradeNo)
    .update({
      data: Object.assign(
        {
          status: 'delivered',
          deliveredAt: Date.now()
        },
        patch || {}
      )
    });
}

async function hasVpayLog(outTradeNo) {
  const code = 'VPAY:' + String(outTradeNo || '').trim();
  if (!code || code === 'VPAY:') return false;
  try {
    const existed = await db.collection('redeem_logs').where({ code: code }).limit(1).get();
    return !!(existed && existed.data && existed.data.length);
  } catch (_) {
    return false;
  }
}

/** 确保订单已加额度（幂等）。以订单 grantRounds 为准，占坑用 quotaGranted。 */
async function ensureOrderGranted(order, extras) {
  if (!order) return { ok: false, errMsg: '无订单' };
  const outTradeNo = String(order.outTradeNo || order._id || '').trim();
  if (!outTradeNo) return { ok: false, errMsg: '缺少订单号' };
  const openid = String(order.openid || '').trim();
  if (!openid) return { ok: false, errMsg: '订单无 openid' };
  const product = productById(order.productId) || COIN_PACK;
  const expectRounds = Math.max(0, Math.floor(Number(product.rounds) || 0));

  // 已真正加过额（有 grantRounds 且非 pendingApply，或已有 VPAY 日志）→ 绝不二次 _.inc
  const hasGrantMark = Number(order.grantRounds) > 0 && !order.grantPendingApply;
  const hasLog = await hasVpayLog(outTradeNo);
  if (hasGrantMark || hasLog) {
    if (order.status !== 'delivered' || !order.quotaGranted || !hasGrantMark) {
      try {
        await markDelivered(outTradeNo, {
          mchOrderNo: extras && extras.mchOrderNo,
          recovered: true,
          quotaGranted: true,
          grantRounds: Number(order.grantRounds) || expectRounds
        });
      } catch (_) {}
    }
    const quota = await getOrCreateQuota(openid);
    return {
      ok: true,
      already: true,
      grant: {
        extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
        rounds: Number(order.grantRounds) || expectRounds,
        vipDays: Number(order.grantVipDays) || 0,
        isVip: !!(
          quota.isVip &&
          (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
        ),
        vipExpireAt: Number(quota.vipExpireAt) || 0
      }
    };
  }

  // 原子占坑：grantRounds 仍为 0/不存在 才可发货
  let claimed = 0;
  try {
    const claim = await db
      .collection('virtual_orders')
      .where({
        _id: outTradeNo,
        grantRounds: _.lte(0)
      })
      .update({
        data: {
          quotaGranted: true,
          grantClaimAt: Date.now(),
          status: 'delivering',
          deliveringAt: Date.now(),
          // 先写入预期额度占位，防止并发二次进入；真正加额成功后再确认
          grantRounds: expectRounds,
          grantPendingApply: true
        }
      });
    claimed = (claim && claim.stats && claim.stats.updated) || 0;
  } catch (_) {
    claimed = 0;
  }

  if (!claimed) {
    try {
      const got = await db.collection('virtual_orders').doc(outTradeNo).get();
      const cur = got && got.data;
      if (cur && Number(cur.grantRounds) > 0 && !cur.grantPendingApply) {
        const quota = await getOrCreateQuota(openid);
        return {
          ok: true,
          already: true,
          grant: {
            extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
            rounds: Number(cur.grantRounds) || expectRounds,
            vipDays: Number(cur.grantVipDays) || 0,
            isVip: !!(
              quota.isVip &&
              (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
            ),
            vipExpireAt: Number(quota.vipExpireAt) || 0
          }
        };
      }
      // grantPendingApply：上次占坑后加额可能失败，允许补加额一次（仍靠 VPAY 防双加）
      if (cur && cur.grantPendingApply && !(await hasVpayLog(outTradeNo))) {
        claimed = 1;
        order = Object.assign({}, order, cur);
      } else if (!cur || !(Number(cur.grantRounds) > 0)) {
        await db.collection('virtual_orders').doc(outTradeNo).update({
          data: {
            quotaGranted: true,
            grantClaimAt: Date.now(),
            status: 'delivering',
            deliveringAt: Date.now(),
            grantRounds: expectRounds,
            grantPendingApply: true
          }
        });
        claimed = 1;
      } else {
        const quota = await getOrCreateQuota(openid);
        return {
          ok: true,
          already: true,
          grant: {
            extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
            rounds: Number(cur.grantRounds) || expectRounds,
            vipDays: 0,
            isVip: false,
            vipExpireAt: 0
          }
        };
      }
    } catch (_) {
      return { ok: false, busy: true, errMsg: '发货占坑失败' };
    }
  }
  if (!claimed) {
    return { ok: false, busy: true, errMsg: '发货未就绪' };
  }

  // 若 VPAY 已存在（并发），不再加额
  if (await hasVpayLog(outTradeNo)) {
    await markDelivered(outTradeNo, {
      mchOrderNo: extras && extras.mchOrderNo,
      grantRounds: expectRounds,
      quotaGranted: true,
      grantPendingApply: false
    });
    const quota = await getOrCreateQuota(openid);
    return {
      ok: true,
      already: true,
      grant: {
        extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
        rounds: expectRounds,
        vipDays: 0,
        isVip: !!(
          quota.isVip &&
          (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
        ),
        vipExpireAt: Number(quota.vipExpireAt) || 0
      }
    };
  }

  const grant = await deliverProduct(openid, product, { outTradeNo: outTradeNo });
  await markDelivered(outTradeNo, {
    mchOrderNo: extras && extras.mchOrderNo,
    grantRounds: grant.rounds,
    grantVipDays: grant.vipDays,
    quotaGranted: true,
    grantPendingApply: false,
    repaired: !!(order.status === 'delivered')
  });
  return { ok: true, grant: grant, already: false };
}

/**
 * 纠正重复到账：
 * A) 一笔订单却加了 2 倍额度
 * B) 短时间内两笔同商品同额度 delivered（只付一次却生成/发货两单）——作废多余订单并扣回额度
 */
async function repairDoubledQuota(openid) {
  const oid = String(openid || '').trim();
  if (!oid) return { ok: false, fixed: false };
  const since = Date.now() - 14 * DAY_MS;
  let rows = [];
  try {
    const res = await db.collection('virtual_orders').where({ openid: oid }).limit(40).get();
    rows = ((res && res.data) || []).filter((r) => {
      if (!r || String(r.status || '') === 'refunded' || String(r.status || '') === 'duplicate') {
        return false;
      }
      const created = Number(r.createTimeMs) || 0;
      return !created || created >= since;
    });
  } catch (_) {
    return { ok: false, fixed: false };
  }

  const grantedOrders = rows
    .filter(
      (r) =>
        r &&
        String(r.status) === 'delivered' &&
        (Number(r.grantRounds) > 0 || r.quotaGranted)
    )
    .map((r) =>
      Object.assign({}, r, {
        _oid: String(r.outTradeNo || r._id || ''),
        _g: Math.max(
          0,
          Number(r.grantRounds) ||
            Number((productById(r.productId) || COIN_PACK).rounds) ||
            0
        ),
        _t: Number(r.createTimeMs) || Number(r.deliveredAt) || 0,
        _pid: String(r.productId || COIN_PACK.productId)
      })
    )
    .filter((r) => r._oid && r._g > 0)
    .sort((a, b) => a._t - b._t);

  const quota = await getOrCreateQuota(oid);
  let extra = Math.max(0, Number(quota.extraRounds) || 0);

  // —— B) 同商品多笔 delivered：保留最早一单；近时重复 / forcePending 补发单一律作废 ——
  const keep = {};
  const dupes = [];
  for (let i = 0; i < grantedOrders.length; i++) {
    const cur = grantedOrders[i];
    const prev = keep[cur._pid];
    if (!prev) {
      keep[cur._pid] = cur;
      continue;
    }
    const near = Math.abs(cur._t - prev._t) <= 30 * 60 * 1000;
    const forced = !!(cur.forcePending || cur.reconcileHint);
    // 近 30 分钟同商品，或带强制补发标记的后单 → 视为重复
    if (near || forced) {
      dupes.push(cur);
    } else {
      // 间隔较久：视为另一次真实购买，保留
      keep[cur._pid + '::' + cur._oid] = cur;
    }
  }

  if (dupes.length) {
    let claw = 0;
    for (let i = 0; i < dupes.length; i++) {
      const d = dupes[i];
      claw += d._g;
      try {
        await db
          .collection('virtual_orders')
          .doc(d._oid)
          .update({
            data: {
              status: 'duplicate',
              duplicateOf: Object.keys(keep)
                .map((k) => keep[k]._oid)
                .filter(Boolean)[0] || '',
              duplicateFixedAt: Date.now(),
              quotaGranted: true,
              note: '重复/强制补发单，已作废并扣回额度'
            }
          });
      } catch (_) {}
    }
    const next = Math.max(0, extra - claw);
    if (next !== extra) {
      await db.collection('user_quota').doc(oid).update({
        data: {
          extraRounds: next,
          updateTimeMs: Date.now(),
          doubleGrantFixedAt: Date.now(),
          doubleGrantFixedFrom: extra,
          doubleGrantFixedReason: 'duplicate_orders'
        }
      });
    }
    return {
      ok: true,
      fixed: true,
      from: extra,
      to: next,
      uniqueOrders: Object.keys(keep).length,
      voided: dupes.map((d) => d._oid),
      reason: 'duplicate_orders'
    };
  }

  // —— A) 有效唯一订单合计 G，额度却是 2G ——
  const valid = Object.keys(keep).map((k) => keep[k]);
  // 若 keep 空（上面没进 B），用 grantedOrders 去重
  const uniqMap = {};
  (valid.length ? valid : grantedOrders).forEach((r) => {
    if (!uniqMap[r._oid]) uniqMap[r._oid] = r;
  });
  const uniqList = Object.keys(uniqMap).map((k) => uniqMap[k]);
  const uniqueCount = uniqList.length;
  const sumGrant = uniqList.reduce((s, r) => s + r._g, 0);
  extra = Math.max(0, Number((await getOrCreateQuota(oid)).extraRounds) || 0);

  if (uniqueCount === 1 && sumGrant > 0 && extra === sumGrant * 2) {
    await db.collection('user_quota').doc(oid).update({
      data: {
        extraRounds: sumGrant,
        updateTimeMs: Date.now(),
        doubleGrantFixedAt: Date.now(),
        doubleGrantFixedFrom: extra,
        doubleGrantFixedReason: 'double_inc'
      }
    });
    return {
      ok: true,
      fixed: true,
      from: extra,
      to: sumGrant,
      uniqueOrders: uniqueCount,
      reason: 'double_inc'
    };
  }

  return {
    ok: true,
    fixed: false,
    extraRounds: extra,
    sumGrant: sumGrant,
    uniqueOrders: uniqueCount,
    rawOrders: rows.length,
    deliveredOrders: grantedOrders.length
  };
}

async function deliverOrderDoc(order, extras) {
  if (!order) return { ok: false, errMsg: '无订单' };
  const outTradeNo = String(order.outTradeNo || order._id || '').trim();
  if (!outTradeNo) return { ok: false, errMsg: '缺少订单号' };

  // 已 delivered：仍校验是否真正加过额，未加则补发
  if (order.status === 'delivered') {
    return ensureOrderGranted(order, extras);
  }

  // 原子占坑：仅 pending/paid 可进入发货，防止 notify 与 poll 并发双发
  let claimed = 0;
  try {
    const claim = await db
      .collection('virtual_orders')
      .where({
        _id: outTradeNo,
        status: _.in(['pending', 'paid'])
      })
      .update({
        data: {
          status: 'delivering',
          deliveringAt: Date.now()
        }
      });
    claimed = (claim && claim.stats && claim.stats.updated) || 0;
  } catch (_) {
    claimed = 0;
  }
  if (!claimed) {
    try {
      const got = await db.collection('virtual_orders').doc(outTradeNo).get();
      const cur = got && got.data;
      if (cur && cur.status === 'delivered') {
        return ensureOrderGranted(Object.assign({ _id: outTradeNo }, cur), extras);
      }
      if (cur && cur.status === 'delivering') {
        const at = Number(cur.deliveringAt) || 0;
        const age = Date.now() - at;
        // 另一路正在发货：让客户端继续 poll，切勿当成已到账
        if (age >= 0 && age < 20000) {
          return { ok: false, busy: true, errMsg: '发货中' };
        }
        // 超时卡死：直接补发（ensure 内有 VPAY 幂等）
        return ensureOrderGranted(Object.assign({ _id: outTradeNo }, cur, order), extras);
      } else if (cur && (cur.status === 'pending' || cur.status === 'paid')) {
        await db.collection('virtual_orders').doc(outTradeNo).update({
          data: { status: 'delivering', deliveringAt: Date.now() }
        });
        claimed = 1;
        order = Object.assign({}, order, cur, { status: 'delivering' });
      }
    } catch (_) {}
  }
  if (!claimed && order.status !== 'delivering') {
    // 无法占坑时仍尝试幂等补发（例如权限/竞态）
    return ensureOrderGranted(order, extras);
  }

  return ensureOrderGranted(order, extras);
}

/**
 * 补发近期货币充值订单到 user_quota。
 * 代币充值（short_series_coin）平台不推道具发货，只能靠支付成功后的补发。
 */
async function reconcileMyOrders(openid, event) {
  const oid = String(openid || '').trim();
  if (!oid) return { ok: false, errMsg: '缺少 openid' };
  let rows = [];
  try {
    const res = await db
      .collection('virtual_orders')
      .where({ openid: oid })
      .orderBy('createTimeMs', 'desc')
      .limit(30)
      .get();
    rows = (res && res.data) || [];
  } catch (_) {
    try {
      const res = await db.collection('virtual_orders').where({ openid: oid }).limit(30).get();
      rows = ((res && res.data) || []).slice();
      rows.sort(
        (a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0)
      );
    } catch (e2) {
      return { ok: false, errMsg: '读取订单失败：' + String((e2 && e2.message) || e2) };
    }
  }

  const forcePending = !!(event && event.forcePending);
  const since = Date.now() - 14 * DAY_MS;
  let repaired = 0;
  let granted = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const st = String(row.status || '');
    if (st === 'refunded' || st === 'duplicate') continue;
    const created = Number(row.createTimeMs) || 0;
    if (created && created < since) continue;

    // 未付款 pending：仅微信查单确认后才发货；禁止 forcePending 盲发（会把点「刷新」当成付款）
    if (st === 'pending' && !row.clientPaidAt) {
      let paid = false;
      try {
        const c = cfg();
        if (c.appKey && c.offerId) {
          const token = await getAccessToken();
          const outTradeNo = String(row.outTradeNo || row._id || '');
          const body = {
            openid: oid,
            env: c.env,
            order_id: { out_trade_no: outTradeNo }
          };
          const uri = '/xpay/query_order';
          const postBody = JSON.stringify(body);
          const paySig = hmacSha256Hex(c.appKey, uri + '&' + postBody);
          const url =
            'https://api.weixin.qq.com' +
            uri +
            '?access_token=' +
            encodeURIComponent(token) +
            '&pay_sig=' +
            encodeURIComponent(paySig);
          const q = await httpsPostJson(url, body);
          paid = !!(
            q &&
            (q.order_state === 1 ||
              q.status === 1 ||
              (q.order && (q.order.status === 1 || q.order.order_state === 1)))
          );
        }
      } catch (_) {
        paid = false;
      }
      if (!paid) continue;
      try {
        await db
          .collection('virtual_orders')
          .doc(String(row.outTradeNo || row._id))
          .update({
            data: {
              status: 'paid',
              clientPaidAt: Date.now(),
              reconcileHint: true
            }
          });
      } catch (_) {}
    }

    const order = Object.assign({ _id: row._id || row.outTradeNo }, row, {
      status: st === 'pending' ? 'paid' : st
    });
    try {
      const r = await ensureOrderGranted(order, {});
      if (r && r.ok) {
        if (!r.already) granted += 1;
        else if (r.grant) repaired += 1;
      }
    } catch (e) {
      console.warn('[virtualPay] reconcile one fail', e && e.message);
    }
  }

  const quota = await getOrCreateQuota(oid);
  let fix = { fixed: false };
  try {
    fix = await repairDoubledQuota(oid);
  } catch (e) {
    console.warn('[virtualPay] repairDoubledQuota', e && e.message);
  }
  const extraAfter = fix && fix.fixed ? Number(fix.to) : Math.max(0, Number(quota.extraRounds) || 0);
  // 若刚纠偏，重新读一次
  let extraRounds = extraAfter;
  if (fix && fix.fixed) {
    try {
      const q2 = await getOrCreateQuota(oid);
      extraRounds = Math.max(0, Number(q2.extraRounds) || 0);
    } catch (_) {}
  } else {
    extraRounds = Math.max(0, Number(quota.extraRounds) || 0);
  }
  return {
    ok: true,
    repaired: repaired,
    granted: granted,
    scanned: rows.length,
    extraRounds: extraRounds,
    doubleFixed: !!(fix && fix.fixed),
    doubleFixedFrom: fix && fix.from,
    isVip: !!(
      quota.isVip &&
      (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
    ),
    vipExpireAt: Number(quota.vipExpireAt) || 0,
    apiVer: 'virtualPay-quota-fix-v6',
    forcePending: forcePending
  };
}

/** 分步自检：尽量不改数据，回报卡在哪 */
async function diagnosePay(openid) {
  const oid = String(openid || '').trim();
  const steps = [];
  const c = cfg();
  steps.push({
    step: 1,
    name: '云函数版本',
    ok: true,
    detail: 'virtualPay-quota-fix-v6'
  });
  steps.push({
    step: 2,
    name: '识别 openid',
    ok: !!oid,
    detail: oid ? oid.slice(0, 6) + '…' + oid.slice(-4) : '空（未登录云开发）'
  });
  steps.push({
    step: 3,
    name: '环境变量',
    ok: !!(c.offerId && c.appKey && c.appId && c.secret),
    detail:
      'offerId=' +
      (c.offerId ? '有' : '缺') +
      ' appKey=' +
      (c.appKey ? '有' : '缺') +
      ' WX_APPID=' +
      (c.appId ? '有' : '缺') +
      ' WX_SECRET=' +
      (c.secret ? '有' : '缺') +
      ' env=' +
      c.env
  });

  let orderCount = 0;
  let latest = [];
  let orderErr = '';
  try {
    const res = await db.collection('virtual_orders').where({ openid: oid }).limit(10).get();
    const rows = ((res && res.data) || []).slice();
    rows.sort((a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0));
    orderCount = rows.length;
    latest = rows.slice(0, 5).map((r) => ({
      outTradeNo: String(r.outTradeNo || r._id || '').slice(0, 24),
      status: r.status || '',
      productId: r.productId || '',
      grantRounds: Number(r.grantRounds) || 0,
      clientPaidAt: Number(r.clientPaidAt) || 0,
      createTimeMs: Number(r.createTimeMs) || 0,
      ageMin: r.createTimeMs
        ? Math.round((Date.now() - Number(r.createTimeMs)) / 60000)
        : -1
    }));
  } catch (e) {
    orderErr = String((e && (e.message || e.errMsg)) || e);
  }
  steps.push({
    step: 4,
    name: '读取 virtual_orders',
    ok: !orderErr,
    detail: orderErr
      ? orderErr
      : '本用户订单 ' +
        orderCount +
        ' 条；最近：' +
        (latest.length
          ? latest
              .map(
                (x) =>
                  x.status + '/' + (x.grantRounds || 0) + '轮/' + x.ageMin + '分钟前'
              )
              .join('；')
          : '无订单')
  });

  let quotaExtra = -1;
  let quotaErr = '';
  try {
    const q = await getOrCreateQuota(oid);
    quotaExtra = Math.max(0, Number(q.extraRounds) || 0);
  } catch (e) {
    quotaErr = String((e && (e.message || e.errMsg)) || e);
  }
  steps.push({
    step: 5,
    name: '读取 user_quota',
    ok: !quotaErr,
    detail: quotaErr ? quotaErr : 'extraRounds=' + quotaExtra
  });

  let vpayLogs = 0;
  let logErr = '';
  try {
    const res = await db
      .collection('redeem_logs')
      .where({ openid: oid, source: 'virtual_pay' })
      .limit(10)
      .get();
    vpayLogs = ((res && res.data) || []).length;
  } catch (e1) {
    try {
      const res = await db.collection('redeem_logs').where({ openid: oid }).limit(20).get();
      vpayLogs = ((res && res.data) || []).filter(
        (r) =>
          String(r.source || '') === 'virtual_pay' ||
          String(r.code || '').indexOf('VPAY:') === 0
      ).length;
    } catch (e2) {
      logErr = String((e2 && (e2.message || e2.errMsg)) || e2);
    }
  }
  steps.push({
    step: 6,
    name: '读取 VPAY 发货日志',
    ok: !logErr,
    detail: logErr ? logErr : 'virtual_pay 日志 ' + vpayLogs + ' 条'
  });

  let hint = '';
  if (!oid) hint = 'openid 为空，请用真机登录后再试';
  else if (orderErr) hint = 'virtual_orders 读失败：检查集合是否已建';
  else if (!orderCount) hint = '没有本用户订单：支付时 openid 可能与现在不一致，或订单未写入';
  else if (quotaExtra === 0 && vpayLogs === 0)
    hint = '有订单但未发货：点「刷新到账」并确认已付款';
  else if (quotaExtra === 0 && vpayLogs > 0)
    hint = '已有发货日志但额度为0：可能配额文档分裂，再点刷新到账';
  else if (
    latest.filter((x) => x.status === 'delivered' && Number(x.grantRounds) > 0).length >= 2 &&
    quotaExtra >= 2000
  )
    hint =
      '检测到多笔已到账订单且额度为 ' +
      quotaExtra +
      '。若只付了一次，请点「刷新到账」自动作废重复单并改回正确额度';
  else if (quotaExtra > 0) hint = '云端已有额度 ' + quotaExtra + '，若页面仍显示0是本地未同步';
  else hint = '基础检查通过，可再点刷新到账';

  return {
    ok: true,
    apiVer: 'virtualPay-quota-fix-v6',
    openidMask: oid ? oid.slice(0, 6) + '…' + oid.slice(-4) : '',
    orderCount: orderCount,
    latestOrders: latest,
    extraRounds: quotaExtra,
    vpayLogs: vpayLogs,
    steps: steps,
    failedCount: steps.filter((s) => !s.ok).length,
    hint: hint
  };
}

async function handleDeliverNotify(event) {
  const openid = String(event.OpenId || event.openid || '').trim();
  const outTradeNo = String(event.OutTradeNo || event.outTradeNo || '').trim();
  const goods = event.GoodsInfo || event.goods_info || {};
  const productId = String(
    goods.ProductId || goods.product_id || event.ProductId || ''
  ).trim();
  const mchOrderNo = String(
    (event.WeChatPayInfo &&
      (event.WeChatPayInfo.MchOrderNo || event.WeChatPayInfo.mch_order_no)) ||
      event.MchOrderNo ||
      ''
  ).trim();

  if (!outTradeNo) {
    return { ErrCode: 0, ErrMsg: 'success' };
  }

  let order = null;
  try {
    const got = await db.collection('virtual_orders').doc(outTradeNo).get();
    if (got && got.data) order = Object.assign({ _id: outTradeNo }, got.data);
  } catch (_) {}

  if (!order) {
    // 兜底建单（极端情况）
    const product = productById(productId);
    if (!product || !openid) {
      return { ErrCode: 0, ErrMsg: 'success' };
    }
    order = {
      _id: outTradeNo,
      outTradeNo,
      openid,
      productId: product.productId,
      goodsPrice: product.goodsPrice,
      status: 'pending',
      createTimeMs: Date.now()
    };
    try {
      await db.collection('virtual_orders').doc(outTradeNo).set({ data: order });
    } catch (_) {}
  }

  if (order.status === 'delivered') {
    return { ErrCode: 0, ErrMsg: 'success' };
  }

  try {
    await deliverOrderDoc(order, { mchOrderNo: mchOrderNo });
  } catch (e) {
    console.error('[virtualPay] deliver fail', e);
    return { ErrCode: -1, ErrMsg: String((e && e.message) || e) };
  }
  return { ErrCode: 0, ErrMsg: 'success' };
}

async function listProducts() {
  return {
    ok: true,
    env: cfg().env,
    payMode: 'short_series_coin',
    adFreeCost: AD_FREE_COST,
    adFreeDays: AD_FREE_DAYS,
    products: [
      {
        productId: COIN_PACK.productId,
        title: COIN_PACK.title,
        desc: COIN_PACK.desc,
        goodsPrice: COIN_PACK.goodsPrice,
        priceYuan: '10.00',
        rounds: COIN_PACK.rounds,
        kind: 'coin'
      }
    ]
  };
}

async function createOrder(event, openid) {
  const c = cfg();
  if (!c.offerId || !c.appKey) {
    return {
      ok: false,
      errMsg: '请配置云函数环境变量 XPAY_OFFER_ID / XPAY_APP_KEY'
    };
  }
  const productId = String((event && event.productId) || COIN_PACK.productId).trim();
  const product = productById(productId) || COIN_PACK;

  const loginCode = String((event && event.code) || '').trim();
  if (!loginCode) return { ok: false, errMsg: '缺少登录 code' };

  let sessionKey = '';
  try {
    const sess = await code2Session(loginCode);
    sessionKey = sess.sessionKey;
    if (sess.openid && sess.openid !== openid) {
      // 以云函数上下文 openid 为准
    }
  } catch (e) {
    return { ok: false, errMsg: e.message || '登录态换取失败' };
  }

  const outTradeNo = genOutTradeNo();
  const buyQuantity = Math.max(1, Number(product.buyQuantity) || COIN_PACK.buyQuantity);
  const signObj = {
    offerId: c.offerId,
    buyQuantity: buyQuantity,
    env: c.env,
    currencyType: 'CNY',
    outTradeNo: outTradeNo,
    attach: product.productId
  };
  const signData = JSON.stringify(signObj);
  const paySig = hmacSha256Hex(c.appKey, 'requestVirtualPayment&' + signData);
  const signature = hmacSha256Hex(sessionKey, signData);

  const order = {
    openid: openid,
    outTradeNo: outTradeNo,
    productId: product.productId,
    goodsPrice: product.goodsPrice,
    buyQuantity: buyQuantity,
    status: 'pending',
    env: c.env,
    createTimeMs: Date.now(),
    createTime: db.serverDate()
  };
  try {
    await db.collection('virtual_orders').doc(outTradeNo).set({ data: order });
  } catch (e) {
    return { ok: false, errMsg: '写订单失败：' + String((e && e.message) || e) };
  }

  return {
    ok: true,
    mode: 'short_series_coin',
    signData: signData,
    paySig: paySig,
    signature: signature,
    outTradeNo: outTradeNo,
    product: {
      productId: product.productId,
      title: product.title,
      goodsPrice: product.goodsPrice
    }
  };
}

async function pollOrder(event, openid) {
  const outTradeNo = String((event && event.outTradeNo) || '').trim();
  if (!outTradeNo) return { ok: false, errMsg: '缺少订单号' };
  let order = null;
  try {
    const got = await db.collection('virtual_orders').doc(outTradeNo).get();
    if (got && got.data) order = Object.assign({ _id: outTradeNo }, got.data);
  } catch (_) {}
  if (!order) return { ok: false, errMsg: '订单不存在' };
  if (order.openid && order.openid !== openid) {
    return { ok: false, errMsg: '订单不属于当前用户' };
  }

  if (order.status === 'delivered') {
    // 假 delivered（未写 VPAY 日志）时补发
    const fix = await ensureOrderGranted(order, {});
    const quota = await getOrCreateQuota(openid);
    const grantExtra =
      fix && fix.grant && fix.grant.extraRounds != null
        ? Number(fix.grant.extraRounds)
        : Math.max(0, Number(quota.extraRounds) || 0);
    return {
      ok: true,
      status: 'delivered',
      extraRounds: Math.max(0, grantExtra, Number(quota.extraRounds) || 0),
      isVip: !!(
        quota.isVip &&
        (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
      ),
      vipExpireAt: Number(quota.vipExpireAt) || 0,
      via: fix && !fix.already ? 'repair_delivered' : 'delivered'
    };
  }

  // 客户端支付控件已 success：代币充值必须在此发货（无道具发货推送）
  if (event && event.clientPaid && (order.status === 'pending' || order.status === 'paid' || order.status === 'delivering')) {
    if (order.status === 'pending') {
      try {
        await db.collection('virtual_orders').doc(outTradeNo).update({
          data: { status: 'paid', clientPaidAt: Date.now() }
        });
        order.status = 'paid';
      } catch (_) {}
    }
    const r = await deliverOrderDoc(order, {});
    if (r && r.busy) {
      return { ok: true, status: 'pending', busy: true };
    }
    if (r && r.ok) {
      const quota = await getOrCreateQuota(openid);
      const grantExtra =
        r.grant && r.grant.extraRounds != null
          ? Number(r.grant.extraRounds)
          : Math.max(0, Number(quota.extraRounds) || 0);
      return {
        ok: true,
        status: 'delivered',
        extraRounds: Math.max(0, grantExtra, Number(quota.extraRounds) || 0),
        isVip: !!(
          quota.isVip &&
          (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
        ),
        vipExpireAt: Number(quota.vipExpireAt) || 0,
        via: 'client_paid'
      };
    }
  }

  // 可选：查微信单（现金单）；代币单可能查不到，失败则仍走 clientPaid/reconcile
  try {
    const c = cfg();
    if (c.appKey && c.offerId) {
      const token = await getAccessToken();
      const body = {
        openid: openid,
        env: c.env,
        order_id: { out_trade_no: outTradeNo }
      };
      // 不同文档字段略有差异，查单失败不影响主流程
      const uri = '/xpay/query_order';
      const postBody = JSON.stringify(body);
      const paySig = hmacSha256Hex(c.appKey, uri + '&' + postBody);
      const url =
        'https://api.weixin.qq.com' +
        uri +
        '?access_token=' +
        encodeURIComponent(token) +
        '&pay_sig=' +
        encodeURIComponent(paySig);
      const q = await httpsPostJson(url, body);
      const paid =
        q &&
        (q.order_state === 1 ||
          q.status === 1 ||
          (q.order && (q.order.status === 1 || q.order.order_state === 1)));
      if (paid && order.status !== 'delivered') {
        const r = await deliverOrderDoc(order, {});
        if (r && r.busy) {
          return { ok: true, status: 'pending', busy: true };
        }
        if (r && r.ok) {
          const quota = await getOrCreateQuota(openid);
          const grantExtra =
            r.grant && r.grant.extraRounds != null
              ? Number(r.grant.extraRounds)
              : Math.max(0, Number(quota.extraRounds) || 0);
          return {
            ok: true,
            status: 'delivered',
            extraRounds: Math.max(
              0,
              grantExtra,
              Number(quota.extraRounds) || 0
            ),
            isVip: !!(
              quota.isVip &&
              (!(Number(quota.vipExpireAt) > 0) ||
                Number(quota.vipExpireAt) > Date.now())
            ),
            vipExpireAt: Number(quota.vipExpireAt) || 0,
            via: 'query_order'
          };
        }
      }
    }
  } catch (e) {
    console.warn('[virtualPay] query_order skip', e && e.message);
  }

  // delivering 中：继续 pending，勿提前返回 delivered
  if (order.status === 'delivering') {
    return { ok: true, status: 'pending', busy: true };
  }

  return { ok: true, status: order.status || 'pending' };
}

async function buyAdFree(openid) {
  const quota = await getOrCreateQuota(openid);
  const extra = Math.max(0, Number(quota.extraRounds) || 0);
  if (extra < AD_FREE_COST) {
    return {
      ok: false,
      errMsg: '需要 ' + AD_FREE_COST + ' 代币（当前 ' + extra + '）'
    };
  }
  const nextExtra = extra - AD_FREE_COST;
  const nextVip = computeVipExpire(quota, AD_FREE_DAYS);
  await db.collection('user_quota').doc(openid).update({
    data: {
      extraRounds: _.inc(-AD_FREE_COST),
      extraConsumed: _.inc(AD_FREE_COST),
      isVip: true,
      vipPaused: false,
      vipExpireAt: nextVip,
      updateTimeMs: Date.now()
    }
  });
  try {
    await db.collection('redeem_logs').add({
      data: {
        code: 'ADFREE:' + Date.now(),
        openid,
        rounds: 0,
        kind: 'vip',
        vipDays: AD_FREE_DAYS,
        source: 'ad_free_card',
        createTimeMs: Date.now(),
        createTime: db.serverDate()
      }
    });
  } catch (_) {}
  return {
    ok: true,
    extraRounds: nextExtra,
    isVip: true,
    vipExpireAt: nextVip,
    days: AD_FREE_DAYS
  };
}

exports.main = async (event) => {
  // 消息推送发货：代币充值 + 兼容旧道具直购
  const evName = event && event.Event ? String(event.Event) : '';
  if (
    evName === 'xpay_goods_deliver_notify' ||
    evName === 'xpay_coin_pay_notify' ||
    evName === 'xpay_coin_deliver_notify'
  ) {
    return await handleDeliverNotify(event);
  }
  if (event && event.Event === 'xpay_refund_notify') {
    console.warn('[virtualPay] refund notify', event.OutTradeNo || event);
    return { ErrCode: 0, ErrMsg: 'success' };
  }
  if (event && String(event.MsgType || '') === 'event' && event.Event) {
    return { ErrCode: 0, ErrMsg: 'success' };
  }

  const openid = openidOf();
  const action = event && event.action != null ? String(event.action).trim() : '';
  try {
    if (action === 'listProducts') return await listProducts();
    if (!openid) return { ok: false, errMsg: '无法识别用户' };
    if (action === 'createOrder') return await createOrder(event, openid);
    if (action === 'pollOrder') return await pollOrder(event, openid);
    if (action === 'reconcileMyOrders') return await reconcileMyOrders(openid, event);
    if (action === 'diagnosePay') return await diagnosePay(openid);
    if (action === 'buyAdFree') return await buyAdFree(openid);
    return { ok: false, errMsg: '未知 action: ' + action, apiVer: 'virtualPay-quota-fix-v6' };
  } catch (e) {
    return { ok: false, errMsg: String((e && e.message) || e) };
  }
};
