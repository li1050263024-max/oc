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
    nextExtra += rounds;
    patch.extraRounds = nextExtra;
    patch.redeemedTotal = _.inc(rounds);
    patch.extraRoundsExpireAt = 0;
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
  await db.collection('user_quota').doc(openid).update({ data: patch });

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

  return {
    extraRounds: nextExtra,
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

async function deliverOrderDoc(order, extras) {
  if (!order) return { ok: false, errMsg: '无订单' };
  const outTradeNo = String(order.outTradeNo || order._id || '').trim();
  if (!outTradeNo) return { ok: false, errMsg: '缺少订单号' };
  if (order.status === 'delivered') {
    return { ok: true, already: true };
  }

  // 原子占坑：仅 pending 可进入发货，防止 notify 与 poll 并发双发
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
      if (cur && (cur.status === 'delivered' || cur.status === 'delivering')) {
        return { ok: true, already: true };
      }
      // 无 where 更新权限时的兜底：再读一次状态
      if (cur && cur.status === 'pending') {
        await db.collection('virtual_orders').doc(outTradeNo).update({
          data: { status: 'delivering', deliveringAt: Date.now() }
        });
        claimed = 1;
      }
    } catch (_) {}
  }
  if (!claimed) {
    return { ok: true, already: true };
  }

  const product = productById(order.productId);
  if (!product) return { ok: false, errMsg: '未知商品' };
  const openid = String(order.openid || '').trim();
  if (!openid) return { ok: false, errMsg: '订单无 openid' };

  const grant = await deliverProduct(openid, product, { outTradeNo: outTradeNo });
  await markDelivered(outTradeNo, {
    mchOrderNo: extras && extras.mchOrderNo,
    grantRounds: grant.rounds,
    grantVipDays: grant.vipDays
  });
  return { ok: true, grant: grant, already: false };
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
    const quota = await getOrCreateQuota(openid);
    return {
      ok: true,
      status: 'delivered',
      extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
      isVip: !!(
        quota.isVip &&
        (!(Number(quota.vipExpireAt) > 0) || Number(quota.vipExpireAt) > Date.now())
      ),
      vipExpireAt: Number(quota.vipExpireAt) || 0
    };
  }

  // 可选：查微信单（需 access_token）；失败则仍返回 pending，等消息推送
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
        if (r.ok) {
          const quota = await getOrCreateQuota(openid);
          return {
            ok: true,
            status: 'delivered',
            extraRounds: Math.max(0, Number(quota.extraRounds) || 0),
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
  await db.collection('user_quota').doc(quota._id).update({
    data: {
      extraRounds: nextExtra,
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
    if (action === 'buyAdFree') return await buyAdFree(openid);
    return { ok: false, errMsg: '未知 action' };
  } catch (e) {
    return { ok: false, errMsg: String((e && e.message) || e) };
  }
};
