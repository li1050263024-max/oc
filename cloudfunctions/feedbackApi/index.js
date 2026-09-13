const cloud = require('wx-server-sdk');

/** HTTP 触发时 DYNAMIC_CURRENT_ENV 可能为空，必须写死环境 ID */
const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({ env: CLOUD_ENV_ID });

const db = cloud.database();

const ADMIN_KEY = String(process.env.FEEDBACK_ADMIN_KEY || 'oc-feedback-admin-2026').trim();

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Feedback-Admin-Key, x-feedback-admin-key',
  'Access-Control-Max-Age': '86400'
};

function normalizeEvent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { body: raw };
    }
  }
  const ev = { ...raw };
  if (raw.detail && typeof raw.detail === 'object') Object.assign(ev, raw.detail);
  if (raw.data && typeof raw.data === 'object') Object.assign(ev, raw.data);
  return ev;
}

function parseQueryObject(qs) {
  if (qs == null || qs === '') return {};
  if (typeof qs === 'object' && !Array.isArray(qs)) return { ...qs };
  const out = {};
  String(qs)
    .replace(/^\?/, '')
    .split('&')
    .forEach((pair) => {
      if (!pair) return;
      const idx = pair.indexOf('=');
      const k = idx >= 0 ? pair.slice(0, idx) : pair;
      const v = idx >= 0 ? pair.slice(idx + 1) : '';
      try {
        out[decodeURIComponent(k)] = decodeURIComponent(v || '');
      } catch (e) {
        out[k] = v;
      }
    });
  return out;
}

function queryFromPath(pathStr) {
  const p = String(pathStr || '');
  const i = p.indexOf('?');
  if (i < 0) return {};
  return parseQueryObject(p.slice(i + 1));
}

function parseBody(ev) {
  let raw = ev.body;
  if (raw == null || raw === '') return {};
  if (ev.isBase64Encoded && typeof raw === 'string') {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function headerKey(ev, name) {
  const h = ev.headers || ev.header || {};
  const lower = name.toLowerCase();
  const key = Object.keys(h).find((k) => k.toLowerCase() === lower);
  return key ? h[key] : '';
}

function readParams(rawEvent) {
  const ev = normalizeEvent(rawEvent);
  const ctx = ev.requestContext || {};
  const qs = {};

  Object.assign(
    qs,
    parseQueryObject(ev.queryStringParameters),
    parseQueryObject(ev.queryString),
    parseQueryObject(ev.query),
    parseQueryObject(ev.rawQueryString),
    parseQueryObject(ctx.queryString),
    queryFromPath(ev.path),
    queryFromPath(ctx.path),
    queryFromPath(ev.resource),
    queryFromPath(ev.rawPath)
  );

  const multi =
    ev.multiValueQueryStringParameters ||
    ctx.multiValueQueryStringParameters ||
    {};
  if (multi.adminKey) {
    qs.adminKey = Array.isArray(multi.adminKey) ? multi.adminKey[0] : multi.adminKey;
  }

  const path = String(ev.path || ctx.path || '');
  const pathKey = path.match(/\/feedbackApi\/([^/?]+)/i);
  if (pathKey) {
    qs.adminKey = qs.adminKey || decodeURIComponent(pathKey[1]);
  }

  const body = parseBody(ev);
  const fromHeader = headerKey(ev, 'X-Feedback-Admin-Key');

  const adminKey = String(
    fromHeader ||
      body.adminKey ||
      qs.adminKey ||
      qs.adminkey ||
      ev.adminKey ||
      ''
  ).trim();

  const action = String(
    body.action || qs.action || ev.action || 'list'
  ).trim();

  const daysRaw = body.days || qs.days || ev.days;
  const days = Math.min(60, Math.max(1, parseInt(daysRaw, 10) || 14));

  return { action, adminKey, days, body, qs, ev };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genRedeemCode(len) {
  const n = Math.min(16, Math.max(8, Number(len) || 10));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return out;
}

function parsePositiveInt(raw, fallback, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, n);
}

async function createRedeemCodes(opts) {
  const kindRaw = String((opts && opts.kind) || 'rounds').toLowerCase();
  const kind =
    kindRaw === 'vip' || kindRaw === 'combo' ? kindRaw : 'rounds';
  const vipDays = Math.max(0, Math.floor(Number(opts && opts.vipDays) || 0));
  const permanent = !!(
    opts &&
    (opts.permanent === true ||
      opts.permanent === 1 ||
      opts.permanent === '1' ||
      (kind === 'vip' && vipDays === 0))
  );
  let rounds = Math.max(0, Math.floor(Number(opts && opts.rounds) || 0));
  let weeklyRounds = Math.max(
    0,
    Math.floor(Number(opts && opts.weeklyRounds) || 0)
  );
  let roundsExpireDays = Math.max(
    0,
    Math.floor(Number(opts && opts.roundsExpireDays) || 0)
  );
  if (kind === 'rounds') {
    rounds = parsePositiveInt(opts.rounds, 30, 100000);
    weeklyRounds = 0;
  } else if (kind === 'combo') {
    if (rounds <= 0) rounds = parsePositiveInt(opts.rounds, 30, 100000);
    if (!permanent && vipDays <= 0) {
      throw new Error('会员组合码请填写 vipDays，或设 permanent');
    }
    if (weeklyRounds <= 0) weeklyRounds = 100;
  } else if (kind === 'vip') {
    rounds = 0;
    roundsExpireDays = 0;
    if (!permanent && vipDays <= 0) {
      throw new Error('会员码请填写 vipDays（天数），或 permanent=true 永久');
    }
    if (weeklyRounds <= 0) weeklyRounds = 100;
  }
  const count = parsePositiveInt(opts.count, 1, 100);
  const maxUses = parsePositiveInt(opts.maxUses, 1, 10000);
  const note = String(opts.note || '').trim().slice(0, 200);
  const now = Date.now();
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code = genRedeemCode(10);
    let tries = 0;
    while (tries < 5) {
      try {
        const doc = {
          code,
          kind: kind,
          rounds: rounds,
          weeklyRounds: weeklyRounds,
          roundsExpireDays: rounds > 0 ? roundsExpireDays : 0,
          vipDays: permanent ? 0 : vipDays,
          permanent: permanent,
          maxUses,
          usedCount: 0,
          usedBy: [],
          lastUsedOpenid: '',
          lastUsedAt: 0,
          enabled: true,
          note,
          createTimeMs: now,
          createTime: new Date(now)
        };
        await db.collection('redeem_codes').add({ data: doc });
        codes.push(doc);
        break;
      } catch (e) {
        tries += 1;
        code = genRedeemCode(10);
        if (tries >= 5) throw e;
      }
    }
  }
  return {
    ok: true,
    kind: kind,
    rounds: rounds,
    weeklyRounds: weeklyRounds,
    roundsExpireDays: rounds > 0 ? roundsExpireDays : 0,
    vipDays: permanent ? 0 : vipDays,
    permanent: permanent,
    count: codes.length,
    codes: codes
  };
}

async function loadUsedOpenidsByCodes(codes) {
  const map = {};
  const list = Array.from(new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean)));
  if (!list.length) return map;
  // 从核销日志补全「谁用过」（兼容旧码未写 usedBy）
  try {
    const raw = await fetchRedeemLogsRaw(500);
    ((raw && raw.list) || []).forEach((row) => {
      const code = String((row && row.code) || '').trim();
      const oid = String((row && row.openid) || '').trim();
      if (!code || !oid) return;
      if (!map[code]) map[code] = [];
      if (map[code].indexOf(oid) < 0) map[code].push(oid);
    });
  } catch (_) {}
  return map;
}

function normalizeUsedByList(row, fromLogs) {
  const out = [];
  const seen = {};
  const push = (id) => {
    const s = String(id || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  };
  if (Array.isArray(row && row.usedBy)) {
    row.usedBy.forEach(push);
  }
  if (row && row.lastUsedOpenid) push(row.lastUsedOpenid);
  (fromLogs || []).forEach(push);
  return out;
}

async function listRedeemCodes(limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  let list = [];
  try {
    const res = await db
      .collection('redeem_codes')
      .orderBy('createTimeMs', 'desc')
      .limit(n)
      .get();
    list = (res && res.data) || [];
  } catch (e) {
    list = [];
  }
  const logMap = await loadUsedOpenidsByCodes(list.map((r) => r && r.code));
  list = list.map((row) => {
    const code = String((row && row.code) || '').trim();
    const usedByOpenids = normalizeUsedByList(row, logMap[code] || []);
    return Object.assign({}, row, {
      usedByOpenids: usedByOpenids,
      usedByText: usedByOpenids.join('、')
    });
  });
  return { ok: true, list, apiVer: 'feedbackApi-redeem-list-v2' };
}

function isCollectionMissingError(e) {
  const msg = String((e && (e.message || e.errMsg)) || e || '');
  return (
    msg.indexOf('collection not exists') !== -1 ||
    msg.indexOf('Db or Table not exist') !== -1 ||
    msg.indexOf('RESOURCE_NOT_FOUND') !== -1 ||
    msg.indexOf('not exist') !== -1
  );
}

async function fetchRedeemLogsRaw(limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    const res = await db
      .collection('redeem_logs')
      .orderBy('createTimeMs', 'desc')
      .limit(n)
      .get();
    return { list: (res && res.data) || [], warn: '' };
  } catch (e1) {
    if (isCollectionMissingError(e1)) {
      return {
        list: [],
        warn:
          '集合 redeem_logs 不存在：请在云开发数据库新建该集合（权限：所有用户不可读写），并确保用户端已部署 redeemCode 云函数'
      };
    }
    // 无索引 / orderBy 失败时降级：拉取后内存排序
    try {
      const res = await db.collection('redeem_logs').limit(n).get();
      const list = ((res && res.data) || []).slice();
      list.sort((a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0));
      return {
        list,
        warn: 'createTimeMs 排序索引可能未建，已降级为内存排序'
      };
    } catch (e2) {
      throw e2;
    }
  }
}

async function loadQuotaMapByOpenids(openids) {
  const map = {};
  const ids = Array.from(new Set((openids || []).filter(Boolean)));
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    try {
      const res = await db
        .collection('user_quota')
        .where({ openid: db.command.in(chunk) })
        .limit(100)
        .get();
      ((res && res.data) || []).forEach((row) => {
        if (row && row.openid) map[row.openid] = row;
      });
    } catch (_) {
      // user_quota 可能未建：逐条忽略
    }
  }
  return map;
}

function resolveRedeemLogsTimeRange(opts, hasKeyword) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rawFrom = opts && opts.fromMs != null && opts.fromMs !== '' ? Number(opts.fromMs) : NaN;
  const rawTo = opts && opts.toMs != null && opts.toMs !== '' ? Number(opts.toMs) : NaN;
  const hasExplicit =
    (Number.isFinite(rawFrom) && rawFrom > 0) || (Number.isFinite(rawTo) && rawTo > 0);
  // 搜索用户/兑换码：默认不限时间；显式选了时间则仍按时间收窄
  if (hasKeyword && !hasExplicit) {
    return { fromMs: null, toMs: null, mode: 'search' };
  }
  if (hasExplicit) {
    return {
      fromMs: Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : null,
      toMs: Number.isFinite(rawTo) && rawTo > 0 ? rawTo : null,
      mode: 'custom'
    };
  }
  // 默认仅最近 3 天
  return {
    fromMs: now - 3 * DAY_MS,
    toMs: now + 60 * 1000,
    mode: 'recent3d'
  };
}

function filterLogsByTimeRange(list, fromMs, toMs) {
  if (fromMs == null && toMs == null) return list || [];
  return (list || []).filter((row) => {
    const t = Number((row && row.createTimeMs) || 0) || 0;
    if (!t) return false;
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  });
}

async function listRedeemLogs(limit, openidKeyword, rangeOpts) {
  const kw = String(openidKeyword || '')
    .trim()
    .slice(0, 128);
  const range = resolveRedeemLogsTimeRange(rangeOpts || {}, !!kw);
  let fetched = { list: [], warn: '' };
  let list = [];
  // 时间筛选时多取一些再内存过滤
  const fetchLimit = Math.max(Number(limit) || 100, range.fromMs != null || range.toMs != null ? 200 : 100);

  if (kw) {
    // 精确 openid / 兑换码
    const tryExact = async (field, value) => {
      try {
        const res = await db
          .collection('redeem_logs')
          .where({ [field]: value })
          .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
          .get();
        return ((res && res.data) || []).slice();
      } catch (_) {
        return null;
      }
    };
    let exact = await tryExact('openid', kw);
    if (!exact || !exact.length) exact = await tryExact('code', kw);
    if (exact && exact.length) {
      exact.sort((a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0));
      list = exact;
    } else {
      fetched = await fetchRedeemLogsRaw(Math.max(fetchLimit, 150));
      list = (fetched.list || []).filter((row) => {
        const oid = String((row && row.openid) || '');
        const code = String((row && row.code) || '');
        return oid.indexOf(kw) >= 0 || code.indexOf(kw) >= 0;
      });
      if (!list.length && !fetched.warn) {
        fetched.warn = '未找到匹配的兑换记录';
      }
    }
  } else {
    fetched = await fetchRedeemLogsRaw(fetchLimit);
    list = fetched.list || [];
  }

  list = filterLogsByTimeRange(list, range.fromMs, range.toMs);
  if (
    !list.length &&
    !fetched.warn &&
    !kw &&
    (range.mode === 'recent3d' || range.mode === 'custom')
  ) {
    fetched.warn =
      range.mode === 'recent3d'
        ? '近 3 天暂无兑换记录（可改时间筛选，或搜索用户 ID / 兑换码）'
        : '该时间范围内暂无兑换记录';
  }

  const openids = list.map((r) => r && r.openid).filter(Boolean);
  const quotaMap = await loadQuotaMapByOpenids(openids);

  // 同批日志内累计兑入（便于无 user_quota 时也能看出总量）
  const redeemedInBatch = {};
  list.forEach((r) => {
    const oid = r && r.openid;
    if (!oid) return;
    redeemedInBatch[oid] = (redeemedInBatch[oid] || 0) + (Number(r.rounds) || 0);
  });

  const enriched = list.map((row) => {
    const oid = row.openid || '';
    const q = quotaMap[oid] || {};
    const extraRounds = Math.max(0, Number(q.extraRounds) || 0);
    const batchTotal = Math.max(0, redeemedInBatch[oid] || 0);
    const redeemedTotal = Math.max(
      0,
      Number(q.redeemedTotal) || 0,
      batchTotal
    );
    const storedConsumed = Math.max(0, Number(q.extraConsumed) || 0);
    // 兑换池已消耗：优先云端 extraConsumed；不要用「兑入-剩余」硬推（兑入字段可能不全）
    const extraConsumed = storedConsumed;
    const freeUsed = Math.max(0, Number(q.freeUsed) || 0);
    const freeAllowed = Math.max(0, Number(q.freeAllowed) || 30);
    const kind = String(row.kind || '').toLowerCase();
    const kindLabel =
      kind === 'vip'
        ? '会员'
        : kind === 'combo'
          ? '会员+轮次'
          : Number(row.vipDays) > 0 || row.permanent
            ? '会员'
            : '对话轮次';
    return Object.assign({}, row, {
      extraRounds,
      redeemedTotal,
      extraConsumed,
      quotaUsed: extraConsumed,
      quotaLeft: extraRounds,
      freeUsed,
      freeAllowed,
      kindLabel,
      // 便于后台展示
      weekFreeLabel: freeUsed + '/' + freeAllowed,
      poolLabel: '已耗 ' + extraConsumed + ' / 剩余 ' + extraRounds
    });
  });

  return {
    ok: true,
    list: enriched,
    keyword: kw || undefined,
    fromMs: range.fromMs,
    toMs: range.toMs,
    rangeMode: range.mode,
    warn: fetched.warn || '',
    apiVer: 'feedbackApi-redeem-logs-v6'
  };
}

async function fetchVirtualOrdersRaw(limit) {
  const lim = Math.min(300, Math.max(1, Number(limit) || 100));
  try {
    const res = await db
      .collection('virtual_orders')
      .orderBy('createTimeMs', 'desc')
      .limit(lim)
      .get();
    return { list: ((res && res.data) || []).slice(), warn: '' };
  } catch (e1) {
    try {
      const res = await db.collection('virtual_orders').limit(lim).get();
      const list = ((res && res.data) || []).slice();
      list.sort(
        (a, b) =>
          (Number(b.createTimeMs) || Number(b.deliveredAt) || 0) -
          (Number(a.createTimeMs) || Number(a.deliveredAt) || 0)
      );
      return {
        list: list,
        warn: 'virtual_orders 未建 createTimeMs 索引，已降级拉取'
      };
    } catch (e2) {
      return {
        list: [],
        warn:
          '读取 virtual_orders 失败：' +
          String((e2 && (e2.message || e2.errMsg)) || e2 || e1)
      };
    }
  }
}

/** 虚拟支付充值订单（virtual_orders；搜索时可兜底 redeem_logs VPAY） */
async function listVirtualPayOrders(limit, openidKeyword, rangeOpts) {
  const kw = String(openidKeyword || '')
    .trim()
    .slice(0, 128);
  const range = resolveRedeemLogsTimeRange(rangeOpts || {}, !!kw);
  const fetchLimit = Math.max(
    Number(limit) || 80,
    range.fromMs != null || range.toMs != null ? 200 : 80
  );

  let fetched = await fetchVirtualOrdersRaw(fetchLimit);
  let list = (fetched.list || []).slice();

  if (kw) {
    list = list.filter((row) => {
      const oid = String((row && row.openid) || '');
      const oto = String((row && (row.outTradeNo || row._id)) || '');
      const pid = String((row && row.productId) || '');
      return oid.indexOf(kw) >= 0 || oto.indexOf(kw) >= 0 || pid.indexOf(kw) >= 0;
    });
    if (!list.length) {
      try {
        const logs = await listRedeemLogs(120, kw, rangeOpts);
        const payLogs = ((logs && logs.list) || []).filter(
          (r) =>
            String(r.source || '') === 'virtual_pay' ||
            String(r.code || '').indexOf('VPAY:') === 0
        );
        if (payLogs.length) {
          list = payLogs.map((r) => ({
            _id: String(r.code || '').replace(/^VPAY:/, '') || r._id,
            outTradeNo: String(r.code || '').replace(/^VPAY:/, ''),
            openid: r.openid,
            productId: r.productId || '',
            status: 'delivered',
            grantRounds: Number(r.rounds) || 0,
            createTimeMs: Number(r.createTimeMs) || 0,
            deliveredAt: Number(r.createTimeMs) || 0,
            source: 'redeem_logs',
            goodsPrice: 0
          }));
          fetched.warn = '';
        } else if (!fetched.warn) {
          fetched.warn = '未找到匹配的充值记录';
        }
      } catch (_) {
        if (!fetched.warn) fetched.warn = '未找到匹配的充值记录';
      }
    }
  }

  list = filterLogsByTimeRange(list, range.fromMs, range.toMs);
  if (
    !list.length &&
    !fetched.warn &&
    !kw &&
    (range.mode === 'recent3d' || range.mode === 'custom')
  ) {
    fetched.warn =
      range.mode === 'recent3d'
        ? '近 3 天暂无充值记录'
        : '该时间范围内暂无充值记录';
  }

  const openids = list.map((r) => r && r.openid).filter(Boolean);
  const quotaMap = await loadQuotaMapByOpenids(openids);

  const enriched = list.map((row) => {
    const oid = row.openid || '';
    const q = quotaMap[oid] || {};
    const status = String(row.status || '').toLowerCase();
    const statusLabel =
      status === 'delivered'
        ? '已到账'
        : status === 'pending'
          ? '待发货'
          : status === 'refunded'
            ? '已退款'
            : status || '未知';
    const priceFen = Math.max(0, Number(row.goodsPrice) || 0);
    const priceYuan = priceFen > 0 ? (priceFen / 100).toFixed(2) : '';
    return Object.assign({}, row, {
      outTradeNo: row.outTradeNo || row._id || '',
      statusLabel: statusLabel,
      grantRounds: Math.max(
        0,
        Number(row.grantRounds) ||
          Number(row.rounds) ||
          Number(row.buyQuantity) ||
          0
      ),
      priceYuan: priceYuan,
      priceFen: priceFen,
      quotaLeft: Math.max(0, Number(q.extraRounds) || 0),
      createTimeMs: Number(row.createTimeMs) || Number(row.deliveredAt) || 0
    });
  });

  enriched.sort(
    (a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0)
  );

  return {
    ok: true,
    list: enriched.slice(0, Math.max(1, Number(limit) || 80)),
    warn: fetched.warn || '',
    fromMs: range.fromMs,
    toMs: range.toMs,
    rangeMode: range.mode,
    apiVer: 'feedbackApi-pay-logs-v1'
  };
}

async function fetchShareLogsRaw(limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    const res = await db
      .collection('share_logs')
      .orderBy('createTimeMs', 'desc')
      .limit(n)
      .get();
    return { list: (res && res.data) || [], warn: '' };
  } catch (e1) {
    if (isCollectionMissingError(e1)) {
      return {
        list: [],
        warn:
          '集合 share_logs 不存在：请在云开发数据库新建该集合（权限：所有用户不可读写），并重新部署 usageStats / feedbackApi'
      };
    }
    try {
      const res = await db.collection('share_logs').limit(n).get();
      const list = ((res && res.data) || []).slice();
      list.sort((a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0));
      return {
        list,
        warn: 'createTimeMs 排序索引可能未建，已降级为内存排序'
      };
    } catch (e2) {
      throw e2;
    }
  }
}

async function listShareLogs(limit, openidKeyword) {
  const kw = String(openidKeyword || '')
    .trim()
    .slice(0, 128);
  let fetched = { list: [], warn: '' };
  let list = [];

  if (kw) {
    try {
      const res = await db
        .collection('share_logs')
        .where({ openid: kw })
        .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
        .get();
      list = ((res && res.data) || []).slice();
      list.sort((a, b) => (Number(b.createTimeMs) || 0) - (Number(a.createTimeMs) || 0));
    } catch (_) {
      list = [];
    }
    if (!list.length) {
      fetched = await fetchShareLogsRaw(Math.max(Number(limit) || 80, 150));
      list = (fetched.list || []).filter((row) => {
        const oid = String((row && row.openid) || '');
        return oid === kw || oid.indexOf(kw) >= 0;
      });
      if (!list.length && !fetched.warn) {
        fetched.warn = '未找到匹配的分享记录';
      }
    }
  } else {
    fetched = await fetchShareLogsRaw(limit);
    list = fetched.list || [];
  }

  list = list.map((row) => {
    const ch = String((row && row.channel) || '').trim();
    const channelLabel =
      ch === 'group' ? '群聊' : ch === 'dm' ? '单聊' : ch || '—';
    return Object.assign({}, row, {
      channelLabel: channelLabel,
      sourceLabel: '分享续期'
    });
  });
  return {
    ok: true,
    list: list,
    keyword: kw || undefined,
    warn: fetched.warn || '',
    apiVer: 'feedbackApi-share-logs-v2'
  };
}

async function setRedeemCodeEnabled(id, enabled) {
  const docId = String(id || '').trim();
  if (!docId) return { ok: false, err: '缺少兑换码 id' };
  await db.collection('redeem_codes').doc(docId).update({
    data: { enabled: !!enabled }
  });
  return { ok: true };
}

function httpResp(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: body == null ? '' : JSON.stringify(body)
  };
}

async function fetchFeedbackList() {
  const res = await db
    .collection('feedback')
    .orderBy('createTimeMs', 'desc')
    .limit(200)
    .get();
  return res.data || [];
}

async function fetchUsageSummary(days) {
  const limit = Math.min(60, Math.max(1, Number(days) || 14));
  let list = [];
  let warn = '';
  try {
    const res = await db
      .collection('usage_daily')
      .orderBy('dateKey', 'desc')
      .limit(limit)
      .get();
    list = (res && res.data) || [];
  } catch (e) {
    try {
      const res = await db.collection('usage_daily').limit(limit).get();
      list = ((res && res.data) || []).slice();
      list.sort((a, b) => String(b.dateKey || '').localeCompare(String(a.dateKey || '')));
      warn = 'usage_daily 无 dateKey 索引，已降级排序';
    } catch (e2) {
      warn =
        '集合 usage_daily 不存在或不可读：请新建该集合并部署云函数 usageStats（小程序对话后才会写入）';
      list = [];
    }
  }
  const totals = {
    chatRounds: 0,
    apiCalls: 0,
    unlockAd: 0,
    unlockShare: 0,
    unlockFailOpen: 0,
    unlockRoundsAd: 0,
    unlockRoundsShare: 0,
    unlockRoundsFailOpen: 0
  };
  list.forEach((row) => {
    if (row && !row.dateKey && row._id) row.dateKey = row._id;
    totals.chatRounds += Number(row.chatRounds) || 0;
    totals.apiCalls += Number(row.apiCalls) || 0;
    totals.unlockAd += Number(row.unlockAd) || 0;
    totals.unlockShare += Number(row.unlockShare) || 0;
    totals.unlockFailOpen += Number(row.unlockFailOpen) || 0;
    totals.unlockRoundsAd += Number(row.unlockRoundsAd) || 0;
    totals.unlockRoundsShare += Number(row.unlockRoundsShare) || 0;
    totals.unlockRoundsFailOpen += Number(row.unlockRoundsFailOpen) || 0;
  });
  return { ok: true, days: limit, list, totals, warn, apiVer: 'feedbackApi-usage-v5', env: CLOUD_ENV_ID };
}

async function listUserQuota(limit, openidKeyword) {
  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  const kw = String(openidKeyword || '')
    .trim()
    .replace(/\s+/g, '');
  let list = [];
  let warn = '';

  function enrichRow(row) {
    const extraRounds = Math.max(0, Number(row.extraRounds) || 0);
    const redeemedTotal = Math.max(0, Number(row.redeemedTotal) || 0);
    const extraConsumed = Math.max(
      0,
      row.extraConsumed != null
        ? Number(row.extraConsumed) || 0
        : Math.max(0, redeemedTotal - extraRounds)
    );
    const freeUsed = Math.max(0, Number(row.freeUsed) || 0);
    const vipExpireAt = Number(row.vipExpireAt) || 0;
    const vipPaused = isVipPausedRow(row);
    const isVip = isVipActiveRow(row);
    const freeAllowed = FREE_WEEKLY_ROUNDS;
    return Object.assign({}, row, {
      extraRounds,
      redeemedTotal,
      extraConsumed,
      freeUsed,
      freeAllowed,
      quotaUsed: extraConsumed,
      quotaLeft: extraRounds,
      isVip: isVip,
      vipPaused: vipPaused,
      vipRecord: isVipRecordRow(row),
      vipExpireAt: vipExpireAt
    });
  }

  // 按用户 id / openid 搜索（精确或包含）
  if (kw) {
    try {
      // 1) 精确 openid
      let res = await db.collection('user_quota').where({ openid: kw }).limit(20).get();
      list = (res && res.data) || [];
      // 2) 用文档 _id 查
      if (!list.length) {
        try {
          const byId = await db.collection('user_quota').doc(kw).get();
          if (byId && byId.data && Object.keys(byId.data).length) {
            list = [Object.assign({ _id: kw }, byId.data)];
          }
        } catch (_) {}
      }
      // 3) 模糊：拉取一批后内存过滤（openid 含关键字）
      if (!list.length) {
        try {
          const res2 = await db
            .collection('user_quota')
            .orderBy('updateTimeMs', 'desc')
            .limit(200)
            .get();
          list = ((res2 && res2.data) || []).filter((row) => {
            const oid = String((row && row.openid) || '');
            const id = String((row && row._id) || '');
            return oid.indexOf(kw) >= 0 || id.indexOf(kw) >= 0;
          });
          if (!list.length) warn = '未找到匹配用户：' + kw;
        } catch (eFuzzy) {
          // RegExp 兜底
          try {
            const res3 = await db
              .collection('user_quota')
              .where({
                openid: db.RegExp({
                  regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                  options: 'i'
                })
              })
              .limit(50)
              .get();
            list = (res3 && res3.data) || [];
            if (!list.length) warn = '未找到匹配用户：' + kw;
          } catch (eRe) {
            return {
              ok: false,
              err: String((eRe && (eRe.message || eRe.errMsg)) || eRe),
              list: [],
              apiVer: 'feedbackApi-user-quota-v4'
            };
          }
        }
      }
    } catch (e) {
      return {
        ok: false,
        err: String((e && (e.message || e.errMsg)) || e),
        list: [],
        apiVer: 'feedbackApi-user-quota-v4'
      };
    }
    return {
      ok: true,
      list: list.map(enrichRow),
      warn,
      keyword: kw,
      apiVer: 'feedbackApi-user-quota-v4'
    };
  }

  try {
    const res = await db
      .collection('user_quota')
      .orderBy('updateTimeMs', 'desc')
      .limit(n)
      .get();
    list = (res && res.data) || [];
  } catch (e1) {
    if (isCollectionMissingError(e1)) {
      return {
        ok: true,
        list: [],
        warn:
          '集合 user_quota 不存在：请新建（所有用户不可读写），用户兑换/对话同步后会出现数据',
        apiVer: 'feedbackApi-user-quota-v4'
      };
    }
    try {
      const res = await db.collection('user_quota').limit(n).get();
      list = ((res && res.data) || []).slice();
      list.sort(
        (a, b) => (Number(b.updateTimeMs) || 0) - (Number(a.updateTimeMs) || 0)
      );
      warn = 'user_quota 排序已降级（可建 updateTimeMs 索引）';
    } catch (e2) {
      return {
        ok: false,
        err: String((e2 && (e2.message || e2.errMsg)) || e2),
        list: [],
        apiVer: 'feedbackApi-user-quota-v4'
      };
    }
  }
  const enriched = list.map(enrichRow);
  // 若 user_quota 仍空，用兑换日志里的 openid 兜底拼一行（至少能看见兑过码的用户）
  if (!enriched.length) {
    try {
      const logs = await listRedeemLogs(100);
      const seen = {};
      const fromLogs = [];
      (logs.list || []).forEach((row) => {
        const oid = row && row.openid;
        if (!oid || seen[oid]) return;
        seen[oid] = true;
        fromLogs.push({
          openid: oid,
          freeUsed: Number(row.freeUsed) || 0,
          freeAllowed: Number(row.freeAllowed) || 0,
          extraRounds: Number(row.extraRounds) || 0,
          extraConsumed: Number(row.extraConsumed) || 0,
          redeemedTotal: Number(row.redeemedTotal) || 0,
          quotaUsed: Number(row.quotaUsed) || 0,
          quotaLeft: Number(row.quotaLeft) || 0,
          updateTimeMs: Number(row.createTimeMs) || 0,
          weekKey: row.weekKey || ''
        });
      });
      if (fromLogs.length) {
        return {
          ok: true,
          list: fromLogs,
          warn: (warn ? warn + '；' : '') + 'user_quota 为空，已用兑换记录兜底',
          apiVer: 'feedbackApi-user-quota-v4'
        };
      }
    } catch (_) {}
  }
  return {
    ok: true,
    list: enriched,
    warn,
    apiVer: 'feedbackApi-user-quota-v4'
  };
}

/** 与客户端 utils/aiChatQuota.js 保持一致：每周免费 30 轮 */
const FREE_WEEKLY_ROUNDS = 30;
const VIP_WEEKLY_ROUNDS = 100;

/** 本周标识：以当周周一的日期键为准（东八区近似用 UTC+8） */
function currentWeekKey(ts) {
  const t = (Number(ts) || Date.now()) + 8 * 3600000;
  const d = new Date(t);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(monday.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dayNum;
}

/**
 * 管理端强制清空【单个】用户额度（禁止批量）：
 * - 兑换池 extraRounds → 0（剩余累加进 extraConsumed）
 * - 本周免费视为用尽 freeUsed = freeAllowed
 * - 保留 redeemedTotal（历史兑换记录）
 * - 必须提供确认密码 confirmPassword
 */
async function clearUserQuota(openidRaw, options) {
  const openid = String(openidRaw || '').trim();
  if (!openid) {
    return { ok: false, err: '缺少 openid（仅支持单用户清空）' };
  }
  // 禁止误传 all / * 等批量标记
  const lower = openid.toLowerCase();
  if (
    lower === 'all' ||
    lower === '*' ||
    lower === 'everyone' ||
    openid.indexOf(',') >= 0
  ) {
    return { ok: false, err: '禁止批量清空，请指定单个用户 openid' };
  }

  const confirmPassword = String(
    (options && (options.confirmPassword || options.password || options.confirmPwd)) ||
      ''
  ).trim();
  const CLEAR_CONFIRM_PASSWORD = '223356';
  if (confirmPassword !== CLEAR_CONFIRM_PASSWORD) {
    return { ok: false, err: '确认密码错误，已取消清空' };
  }

  const clearExtra = options && options.clearExtra === false ? false : true;
  const clearFree = options && options.clearFree === false ? false : true;
  const note = String((options && options.note) || '').trim().slice(0, 200);

  let doc = null;
  try {
    const byId = await db.collection('user_quota').doc(openid).get();
    if (byId && byId.data) doc = byId.data;
  } catch (_) {}
  if (!doc) {
    try {
      const res = await db
        .collection('user_quota')
        .where({ openid: openid })
        .limit(2)
        .get();
      if (res && res.data && res.data.length > 1) {
        return {
          ok: false,
          err: '匹配到多条额度记录，请用完整 openid 精确指定单人后重试'
        };
      }
      if (res && res.data && res.data.length) doc = res.data[0];
    } catch (_) {}
  }
  if (!doc || !doc._id) {
    return { ok: false, err: '未找到该用户额度记录' };
  }

  const before = {
    freeUsed: Math.max(0, Number(doc.freeUsed) || 0),
    freeAllowed: Math.max(0, Number(doc.freeAllowed) || FREE_WEEKLY_ROUNDS),
    extraRounds: Math.max(0, Number(doc.extraRounds) || 0),
    extraConsumed: Math.max(0, Number(doc.extraConsumed) || 0),
    redeemedTotal: Math.max(0, Number(doc.redeemedTotal) || 0),
    weekKey: String(doc.weekKey || '')
  };

  const patch = {
    updatedAt: Date.now(),
    adminClearedAt: Date.now(),
    adminClearedNote: note || 'admin force clear'
  };
  if (clearExtra) {
    patch.extraRounds = 0;
    patch.extraConsumed = before.extraConsumed + before.extraRounds;
  }
  if (clearFree) {
    patch.freeUsed = Math.max(before.freeAllowed, before.freeUsed);
    patch.freeAllowed = before.freeAllowed || FREE_WEEKLY_ROUNDS;
    if (!before.weekKey) patch.weekKey = currentWeekKey();
  }

  await db.collection('user_quota').doc(doc._id).update({ data: patch });

  let afterDoc = null;
  try {
    const again = await db.collection('user_quota').doc(doc._id).get();
    afterDoc = again && again.data ? again.data : null;
  } catch (_) {}

  return {
    ok: true,
    openid: openid,
    cleared: 1,
    before: before,
    after: afterDoc
      ? {
          freeUsed: Math.max(0, Number(afterDoc.freeUsed) || 0),
          freeAllowed: Math.max(0, Number(afterDoc.freeAllowed) || FREE_WEEKLY_ROUNDS),
          extraRounds: Math.max(0, Number(afterDoc.extraRounds) || 0),
          extraConsumed: Math.max(0, Number(afterDoc.extraConsumed) || 0),
          redeemedTotal: Math.max(0, Number(afterDoc.redeemedTotal) || 0),
          weekKey: String(afterDoc.weekKey || '')
        }
      : null,
    apiVer: 'feedbackApi-user-quota-clear-v2'
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VIP_CONFIRM_PASSWORD = '223356';

const DEFAULT_MEMBERSHIP_PANEL = {
  visible: false,
  title: '会员权益',
  lines: [],
  footer: ''
};

function isVipPausedRow(row) {
  return !!(
    row &&
    (row.vipPaused === true || row.vipPaused === 1 || row.vipPaused === '1')
  );
}

function isVipActiveRow(row) {
  if (!row) return false;
  if (isVipPausedRow(row)) return false;
  if (!(row.isVip === true || row.isVip === 1 || row.isVip === '1')) return false;
  const exp = Number(row.vipExpireAt) || 0;
  if (exp > 0 && Date.now() > exp) return false;
  return true;
}

/** 文档上仍标记为会员（含已暂停、未过期） */
function isVipRecordRow(row) {
  if (!row) return false;
  if (!(row.isVip === true || row.isVip === 1 || row.isVip === '1')) return false;
  const exp = Number(row.vipExpireAt) || 0;
  if (exp > 0 && Date.now() > exp) return false;
  return true;
}

function normalizeMembershipPanel(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const lines = Array.isArray(src.lines)
    ? src.lines.map((x) => String(x || '').trim()).filter(Boolean)
    : DEFAULT_MEMBERSHIP_PANEL.lines.slice();
  return {
    visible: src.visible === true || src.visible === 1 || src.visible === '1',
    title:
      String(src.title || DEFAULT_MEMBERSHIP_PANEL.title).trim() ||
      DEFAULT_MEMBERSHIP_PANEL.title,
    lines: lines.length ? lines : DEFAULT_MEMBERSHIP_PANEL.lines.slice(),
    footer: String(
      src.footer != null ? src.footer : DEFAULT_MEMBERSHIP_PANEL.footer
    ).trim(),
    updateTimeMs: Number(src.updateTimeMs) || 0
  };
}

async function getMembershipPanelConfig() {
  try {
    const got = await db.collection('oc_app_config').doc('membership_panel').get();
    return {
      ok: true,
      membershipPanel: normalizeMembershipPanel((got && got.data) || {}),
      apiVer: 'feedbackApi-membership-panel-v1'
    };
  } catch (e) {
    return {
      ok: true,
      membershipPanel: normalizeMembershipPanel(DEFAULT_MEMBERSHIP_PANEL),
      warn:
        '配置未找到时用默认（请新建集合 oc_app_config，文档 id=membership_panel）',
      apiVer: 'feedbackApi-membership-panel-v1'
    };
  }
}

async function setMembershipPanelConfig(body) {
  const next = normalizeMembershipPanel({
    visible: body && body.visible,
    title: body && body.title,
    lines:
      typeof (body && body.linesText) === 'string'
        ? String(body.linesText)
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean)
        : body && body.lines,
    footer: body && body.footer
  });
  next.updateTimeMs = Date.now();
  try {
    await db.collection('oc_app_config').doc('membership_panel').set({
      data: next
    });
  } catch (e) {
    return {
      ok: false,
      err:
        String((e && (e.message || e.errMsg)) || e) +
        '（请先新建集合 oc_app_config，权限：所有用户不可读写）'
    };
  }
  return {
    ok: true,
    membershipPanel: next,
    apiVer: 'feedbackApi-membership-panel-v1'
  };
}

async function resolveUserQuotaDoc(openidRaw) {
  const openid = String(openidRaw || '').trim();
  if (!openid) return { ok: false, err: '缺少 openid' };
  let doc = null;
  try {
    const byId = await db.collection('user_quota').doc(openid).get();
    if (byId && byId.data && Object.keys(byId.data).length) {
      doc = Object.assign({ _id: openid }, byId.data);
    }
  } catch (_) {}
  if (!doc) {
    try {
      const res = await db
        .collection('user_quota')
        .where({ openid: openid })
        .limit(2)
        .get();
      if (res && res.data && res.data.length > 1) {
        return {
          ok: false,
          err: '匹配到多条额度记录，请用完整 openid'
        };
      }
      if (res && res.data && res.data.length) doc = res.data[0];
    } catch (_) {}
  }
  if (!doc) {
    // 开通时可新建
    return { ok: true, openid: openid, doc: null };
  }
  return { ok: true, openid: openid, doc: doc };
}

function computeVipExpireAdmin(quota, vipDays, permanent) {
  const now = Date.now();
  if (permanent || vipDays <= 0) return 0;
  const curExp = Number((quota && quota.vipExpireAt) || 0);
  const curVip = isVipActiveRow(quota);
  if (curVip && curExp === 0) return 0;
  const start = curVip && curExp > now ? curExp : now;
  return start + vipDays * DAY_MS;
}

/**
 * 管理端开通/关闭会员（日常开通仍以兑换码为主）
 */
async function setUserVip(openidRaw, options) {
  const confirmPassword = String(
    (options && (options.confirmPassword || options.password || options.confirmPwd)) ||
      ''
  ).trim();
  if (confirmPassword !== VIP_CONFIRM_PASSWORD) {
    return { ok: false, err: '确认密码错误' };
  }
  const enable =
    options &&
    (options.enable === true ||
      options.enable === 1 ||
      options.enable === '1' ||
      options.action === 'open');
  const found = await resolveUserQuotaDoc(openidRaw);
  if (!found.ok) return found;
  const openid = found.openid;
  const permanent = !!(options && (options.permanent === true || options.permanent === 1));
  const vipDays = Math.max(0, Math.floor(Number((options && options.vipDays) || 0) || 0));

  if (enable) {
    if (!permanent && vipDays <= 0) {
      return { ok: false, err: '开通会员需填写天数，或勾选永久' };
    }
    const base = found.doc || {
      openid: openid,
      extraRounds: 0,
      redeemedTotal: 0,
      extraConsumed: 0,
      isVip: false,
      vipExpireAt: 0
    };
    const vipExpireAt = computeVipExpireAdmin(base, vipDays, permanent);
    const patch = {
      openid: openid,
      isVip: true,
      vipPaused: false,
      vipExpireAt: vipExpireAt,
      freeAllowed: FREE_WEEKLY_ROUNDS,
      updateTimeMs: Date.now(),
      adminVipNote: String((options && options.note) || 'admin open vip').slice(0, 200)
    };
    if (!found.doc) {
      await db.collection('user_quota').doc(openid).set({
        data: Object.assign(
          {
            freeUsed: 0,
            freeAllowed: FREE_WEEKLY_ROUNDS,
            weekKey: '',
            createTimeMs: Date.now()
          },
          base,
          patch
        )
      });
    } else {
      await db.collection('user_quota').doc(found.doc._id).update({ data: patch });
    }
    return {
      ok: true,
      openid: openid,
      isVip: true,
      vipExpireAt: vipExpireAt,
      permanent: permanent || vipExpireAt === 0,
      apiVer: 'feedbackApi-user-vip-v1'
    };
  }

  // 关闭会员
  if (!found.doc || !found.doc._id) {
    return { ok: false, err: '未找到该用户额度记录' };
  }
  await db.collection('user_quota').doc(found.doc._id).update({
    data: {
      isVip: false,
      vipPaused: false,
      vipExpireAt: 0,
      freeAllowed: FREE_WEEKLY_ROUNDS,
      updateTimeMs: Date.now(),
      adminVipNote: String((options && options.note) || 'admin close vip').slice(0, 200)
    }
  });
  return {
    ok: true,
    openid: openid,
    isVip: false,
    vipPaused: false,
    vipExpireAt: 0,
    apiVer: 'feedbackApi-user-vip-v1'
  };
}

/**
 * 暂停会员权益（保留到期时间，可恢复）
 */
async function pauseUserVip(openidRaw, options) {
  const confirmPassword = String(
    (options && (options.confirmPassword || options.password || options.confirmPwd)) ||
      ''
  ).trim();
  if (confirmPassword !== VIP_CONFIRM_PASSWORD) {
    return { ok: false, err: '确认密码错误' };
  }
  const found = await resolveUserQuotaDoc(openidRaw);
  if (!found.ok) return found;
  if (!found.doc || !found.doc._id) {
    return { ok: false, err: '未找到该用户额度记录' };
  }
  if (!isVipRecordRow(found.doc)) {
    return { ok: false, err: '该用户当前不是会员，无法暂停' };
  }
  await db.collection('user_quota').doc(found.doc._id).update({
    data: {
      vipPaused: true,
      freeAllowed: FREE_WEEKLY_ROUNDS,
      updateTimeMs: Date.now(),
      adminVipNote: String((options && options.note) || 'admin pause vip').slice(0, 200)
    }
  });
  return {
    ok: true,
    openid: found.openid,
    isVip: false,
    vipPaused: true,
    vipExpireAt: Number(found.doc.vipExpireAt) || 0,
    apiVer: 'feedbackApi-user-vip-pause-v1'
  };
}

/**
 * 恢复已暂停的会员权益
 */
async function resumeUserVip(openidRaw, options) {
  const confirmPassword = String(
    (options && (options.confirmPassword || options.password || options.confirmPwd)) ||
      ''
  ).trim();
  if (confirmPassword !== VIP_CONFIRM_PASSWORD) {
    return { ok: false, err: '确认密码错误' };
  }
  const found = await resolveUserQuotaDoc(openidRaw);
  if (!found.ok) return found;
  if (!found.doc || !found.doc._id) {
    return { ok: false, err: '未找到该用户额度记录' };
  }
  const row = found.doc;
  if (!(row.isVip === true || row.isVip === 1 || row.isVip === '1')) {
    return { ok: false, err: '该用户没有可恢复的会员记录' };
  }
  const exp = Number(row.vipExpireAt) || 0;
  if (exp > 0 && Date.now() > exp) {
    return { ok: false, err: '会员已过期，请重新开通' };
  }
  await db.collection('user_quota').doc(row._id).update({
    data: {
      vipPaused: false,
      freeAllowed: FREE_WEEKLY_ROUNDS,
      updateTimeMs: Date.now(),
      adminVipNote: String((options && options.note) || 'admin resume vip').slice(0, 200)
    }
  });
  return {
    ok: true,
    openid: found.openid,
    isVip: true,
    vipPaused: false,
    vipExpireAt: exp,
    apiVer: 'feedbackApi-user-vip-pause-v1'
  };
}

function normalizeAppFeatures(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    imgSecCheckEnabled:
      src.imgSecCheckEnabled === true ||
      src.imgSecCheckEnabled === 1 ||
      src.imgSecCheckEnabled === '1',
    updateTimeMs: Number(src.updateTimeMs) || 0
  };
}

async function getAppFeaturesConfig() {
  try {
    const got = await db.collection('oc_app_config').doc('app_features').get();
    return {
      ok: true,
      features: normalizeAppFeatures((got && got.data) || {}),
      apiVer: 'feedbackApi-app-features-v1'
    };
  } catch (e) {
    return {
      ok: true,
      features: normalizeAppFeatures({}),
      warn:
        '配置未找到时默认关闭图片审核（请确认集合 oc_app_config 存在）',
      apiVer: 'feedbackApi-app-features-v1'
    };
  }
}

async function setAppFeaturesConfig(body) {
  const prev = await getAppFeaturesConfig();
  const next = normalizeAppFeatures((prev && prev.features) || {});
  if (body && Object.prototype.hasOwnProperty.call(body, 'imgSecCheckEnabled')) {
    next.imgSecCheckEnabled =
      body.imgSecCheckEnabled === true ||
      body.imgSecCheckEnabled === 1 ||
      body.imgSecCheckEnabled === '1' ||
      body.imgSecCheckEnabled === 'true';
  }
  next.updateTimeMs = Date.now();
  try {
    await db.collection('oc_app_config').doc('app_features').set({
      data: next
    });
  } catch (e) {
    return {
      ok: false,
      err:
        String((e && (e.message || e.errMsg)) || e) +
        '（请先新建集合 oc_app_config，权限：所有用户不可读写）'
    };
  }
  return {
    ok: true,
    features: next,
    apiVer: 'feedbackApi-app-features-v1'
  };
}

function cnDateKey(ts) {
  const t = (Number(ts) || Date.now()) + 8 * 3600000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

async function findUsageByDateKey(dateKey) {
  try {
    const res = await db
      .collection('usage_daily')
      .where({ dateKey: dateKey })
      .limit(1)
      .get();
    if (res && res.data && res.data.length) return res.data[0];
  } catch (_) {}
  return null;
}

/**
 * 微信云库存在「update 文档不存在仍成功」的坑，禁止盲 update。
 * 流程：where 查找 → 有则 update(_id) → 无则 add → 再 where 校验。
 */
async function upsertUsageDailyDiag(dateKey) {
  const _ = db.command;
  const inc = {
    chatRounds: _.inc(1),
    chatRoundsDm: _.inc(1),
    apiCalls: _.inc(1),
    reportCount: _.inc(1),
    updatedAt: db.serverDate(),
    'apiByName.diag': _.inc(1)
  };
  const init = {
    dateKey,
    chatRounds: 1,
    chatRoundsDm: 1,
    chatRoundsGroup: 0,
    apiCalls: 1,
    apiByName: { diag: 1 },
    unlockAd: 0,
    unlockShare: 0,
    unlockFailOpen: 0,
    unlockRoundsAd: 0,
    unlockRoundsShare: 0,
    unlockRoundsFailOpen: 0,
    reportCount: 1,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
    source: 'feedbackApi-diag',
    env: CLOUD_ENV_ID
  };

  let existing = await findUsageByDateKey(dateKey);
  if (existing && existing._id) {
    try {
      await db.collection('usage_daily').doc(existing._id).update({ data: inc });
    } catch (e) {
      return {
        ok: false,
        method: 'update-existing',
        err: String((e && (e.message || e.errMsg)) || e)
      };
    }
  } else {
    try {
      await db.collection('usage_daily').add({ data: init });
    } catch (eAdd) {
      return {
        ok: false,
        method: 'add',
        err: String((eAdd && (eAdd.message || eAdd.errMsg)) || eAdd)
      };
    }
  }

  const after = await findUsageByDateKey(dateKey);
  if (!after) {
    return {
      ok: false,
      method: existing ? 'update-existing' : 'add',
      err: '写后 where(dateKey) 仍读不到'
    };
  }
  return {
    ok: true,
    method: existing ? 'update-existing' : 'add',
    data: after
  };
}

async function diagUsage() {
  const steps = [];
  const dateKey = cnDateKey();
  let usageCount = 0;
  let quotaCount = 0;
  let logCount = 0;
  let writeOk = false;
  let readBack = null;
  let writeMethod = '';

  steps.push({
    id: 'env',
    ok: true,
    detail: 'cloud.init env=' + CLOUD_ENV_ID + ' dateKey=' + dateKey + ' strategy=where+add/update'
  });

  try {
    const res = await db.collection('usage_daily').limit(20).get();
    const list = (res && res.data) || [];
    usageCount = list.length;
    steps.push({
      id: 'read_usage_daily',
      ok: true,
      detail:
        '可读 usage_daily，当前约 ' +
        usageCount +
        ' 条。样例：' +
        list
          .slice(0, 5)
          .map((r) => (r.dateKey || r._id) + '(rounds=' + (r.chatRounds || 0) + ')')
          .join(', ')
    });
  } catch (e) {
    steps.push({
      id: 'read_usage_daily',
      ok: false,
      detail: '读 usage_daily 失败：' + String((e && (e.message || e.errMsg)) || e)
    });
  }

  try {
    const wr = await upsertUsageDailyDiag(dateKey);
    writeOk = !!wr.ok;
    writeMethod = wr.method || '';
    readBack = wr.data || null;
    steps.push({
      id: 'write_usage_daily',
      ok: writeOk,
      detail: writeOk
        ? '写入成功 method=' +
          writeMethod +
          ' _id=' +
          (readBack._id || '—') +
          ' chatRounds=' +
          (readBack.chatRounds || 0)
        : '写入失败 method=' + writeMethod + ' ' + (wr.err || '')
    });
  } catch (e) {
    steps.push({
      id: 'write_usage_daily',
      ok: false,
      detail: '写入异常：' + String((e && (e.message || e.errMsg)) || e)
    });
  }

  try {
    const again = await findUsageByDateKey(dateKey);
    if (again) readBack = again;
    steps.push({
      id: 'readback_today',
      ok: !!again,
      detail: again
        ? '回读成功：_id=' +
          again._id +
          ' chatRounds=' +
          (again.chatRounds || 0) +
          ' apiCalls=' +
          (again.apiCalls || 0)
        : '回读仍为空'
    });
  } catch (e) {
    steps.push({
      id: 'readback_today',
      ok: false,
      detail: '回读异常：' + String((e && (e.message || e.errMsg)) || e)
    });
  }

  try {
    const res = await db.collection('user_quota').limit(5).get();
    const list = (res && res.data) || [];
    quotaCount = list.length;
    const sample = list[0]
      ? 'openid=' +
        String(list[0].openid || '').slice(0, 12) +
        '… extra=' +
        (list[0].extraRounds || 0) +
        ' free=' +
        (list[0].freeUsed || 0)
      : '无样本';
    steps.push({
      id: 'read_user_quota',
      ok: true,
      detail: '可读 user_quota，抽样 ' + quotaCount + ' 条。' + sample
    });
  } catch (e) {
    steps.push({
      id: 'read_user_quota',
      ok: false,
      detail: '读 user_quota 失败：' + String((e && (e.message || e.errMsg)) || e)
    });
  }

  try {
    const res = await db.collection('redeem_logs').limit(5).get();
    const list = (res && res.data) || [];
    logCount = list.length;
    steps.push({
      id: 'read_redeem_logs',
      ok: true,
      detail: '可读 redeem_logs，抽样 ' + logCount + ' 条'
    });
  } catch (e) {
    steps.push({
      id: 'read_redeem_logs',
      ok: false,
      detail: '读 redeem_logs 失败：' + String((e && (e.message || e.errMsg)) || e)
    });
  }

  const failed = steps.filter((s) => !s.ok);
  let verdict = '';
  if (writeOk && readBack) {
    verdict =
      '写入+回读正常。请再跑脚本看 usageSummary.list；云开发记录管理应能看到今天文档。';
  } else if (!writeOk) {
    verdict = 'add/update 失败：' + ((steps.find((s) => s.id === 'write_usage_daily') || {}).detail || '');
  } else {
    verdict = '写后仍读不到，请把全文发给开发者。';
  }

  return {
    ok: true,
    apiVer: 'feedbackApi-diag-v3',
    env: CLOUD_ENV_ID,
    dateKey,
    writeOk,
    writeMethod,
    usageCount,
    quotaCount,
    logCount,
    readBack: readBack
      ? {
          _id: readBack._id,
          dateKey: readBack.dateKey || dateKey,
          chatRounds: readBack.chatRounds || 0,
          apiCalls: readBack.apiCalls || 0
        }
      : null,
    steps,
    failedCount: failed.length,
    verdict
  };
}

async function getCloudDoc(colName, docId) {
  try {
    const res = await db.collection(colName).doc(docId).get();
    if (res && res.data && Object.keys(res.data).length) {
      return Object.assign({ _id: docId }, res.data);
    }
  } catch (_) {}
  return null;
}

function summarizeNotebook(doc) {
  if (!doc) return null;
  const favs = Array.isArray(doc.favorites) ? doc.favorites : [];
  const deleted = Array.isArray(doc.deletedOcIds) ? doc.deletedOcIds : [];
  const names = favs.slice(0, 8).map((f) => {
    const n = f && f.result && f.result.name ? String(f.result.name) : '';
    return n || '(未命名)';
  });
  return {
    openid: doc.openid || doc._id || '',
    ocCount: favs.length,
    familyCount: Array.isArray(doc.families) ? doc.families.length : 0,
    deletedCount: deleted.length,
    ocNamesPreview: names,
    updatedAt: Number(doc.updatedAt) || 0,
    syncedAt: Number(doc.syncedAt) || 0
  };
}

function summarizeChatMeta(doc) {
  if (!doc) return null;
  const ocSessions = doc.ocSessions && typeof doc.ocSessions === 'object' ? doc.ocSessions : {};
  const ocIds = Object.keys(ocSessions);
  let sessionCount = 0;
  ocIds.forEach((id) => {
    const list = ocSessions[id];
    if (Array.isArray(list)) sessionCount += list.length;
  });
  return {
    openid: doc.openid || doc._id || '',
    ocWithChat: ocIds.length,
    sessionCount: sessionCount,
    hiddenOcCount: Array.isArray(doc.hiddenOcIds) ? doc.hiddenOcIds.length : 0,
    updatedAt: Number(doc.updatedAt) || 0,
    syncedAt: Number(doc.syncedAt) || 0
  };
}

async function listUserDataBackups(limit, openidKeyword) {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  const kw = String(openidKeyword || '')
    .trim()
    .replace(/\s+/g, '');
  let list = [];
  let warn = '';

  if (kw) {
    const doc = await getCloudDoc('user_notebook', kw);
    if (doc) {
      list = [doc];
    } else {
      try {
        const res = await db
          .collection('user_notebook')
          .where({
            openid: db.RegExp({
              regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              options: 'i'
            })
          })
          .limit(20)
          .get();
        list = (res && res.data) || [];
      } catch (e) {
        return {
          ok: false,
          err: String((e && (e.message || e.errMsg)) || e),
          list: [],
          apiVer: 'feedbackApi-user-data-v1'
        };
      }
      if (!list.length) warn = '未找到匹配用户：' + kw;
    }
  } else {
    try {
      const res = await db
        .collection('user_notebook')
        .orderBy('syncedAt', 'desc')
        .limit(n)
        .get();
      list = (res && res.data) || [];
    } catch (e1) {
      if (isCollectionMissingError(e1)) {
        return {
          ok: true,
          list: [],
          warn:
            '集合 user_notebook 不存在：请部署 userDataSync 云函数，并在控制台新建该集合（仅云函数可读写）',
          apiVer: 'feedbackApi-user-data-v1'
        };
      }
      try {
        const res2 = await db.collection('user_notebook').limit(n).get();
        list = ((res2 && res2.data) || []).slice();
        list.sort(
          (a, b) => (Number(b.syncedAt) || Number(b.updatedAt) || 0) - (Number(a.syncedAt) || Number(a.updatedAt) || 0)
        );
        warn = 'user_notebook 排序已降级（可为 syncedAt 建降序索引）';
      } catch (e2) {
        return {
          ok: false,
          err: String((e2 && (e2.message || e2.errMsg)) || e2),
          list: [],
          apiVer: 'feedbackApi-user-data-v1'
        };
      }
    }
  }

  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const nb = list[i];
    const openid = String((nb && (nb.openid || nb._id)) || '').trim();
    if (!openid) continue;
    const chatMeta = await getCloudDoc('user_chat_meta', openid);
    rows.push({
      openid: openid,
      notebook: summarizeNotebook(nb),
      chatMeta: summarizeChatMeta(chatMeta)
    });
  }
  return {
    ok: true,
    list: rows,
    warn,
    keyword: kw || undefined,
    apiVer: 'feedbackApi-user-data-v1'
  };
}

function sessionDocIdAdmin(openid, ocId, sessionId) {
  const a = String(openid || '').slice(0, 40);
  const b = String(ocId || '').replace(/[^\w\-]/g, '').slice(0, 40);
  const c = String(sessionId || 'default').replace(/[^\w\-]/g, '').slice(0, 40);
  return a + '_dm_' + b + '_' + c;
}

async function getUserDataBackup(openidRaw) {
  const openid = String(openidRaw || '').trim();
  if (!openid) return { ok: false, err: '缺少 openid' };

  const notebook = await getCloudDoc('user_notebook', openid);
  const chatMetaDoc = await getCloudDoc('user_chat_meta', openid);
  const chatSessions = [];
  const ocSessions =
    chatMetaDoc && chatMetaDoc.ocSessions && typeof chatMetaDoc.ocSessions === 'object'
      ? chatMetaDoc.ocSessions
      : {};
  const ocIds = Object.keys(ocSessions);
  let fetched = 0;
  for (let i = 0; i < ocIds.length && fetched < 24; i++) {
    const ocId = ocIds[i];
    const sessions = Array.isArray(ocSessions[ocId]) ? ocSessions[ocId] : [];
    for (let j = 0; j < sessions.length && fetched < 24; j++) {
      const sid = (sessions[j] && sessions[j].id) || 'default';
      const docId = sessionDocIdAdmin(openid, ocId, sid);
      const msgDoc = await getCloudDoc('user_chat_msgs', docId);
      fetched += 1;
      chatSessions.push({
        ocId: ocId,
        sessionId: sid,
        title: (sessions[j] && sessions[j].title) || '对话',
        messageCount: msgDoc && Array.isArray(msgDoc.messages) ? msgDoc.messages.length : 0,
        updatedAt: msgDoc ? Number(msgDoc.updatedAt) || 0 : 0,
        messages: msgDoc && Array.isArray(msgDoc.messages) ? msgDoc.messages.slice(-40) : [],
        memory: msgDoc ? String(msgDoc.memory || '').slice(0, 400) : ''
      });
    }
  }

  if (!notebook && !chatMetaDoc && !chatSessions.length) {
    return { ok: false, err: '该用户暂无云同步数据' };
  }

  return {
    ok: true,
    openid: openid,
    notebook: notebook
      ? {
          favorites: (notebook.favorites || []).map((f) => ({
            id: f && f.id,
            name: f && f.result && f.result.name,
            time: f && f.time,
            source: f && f.source
          })),
          families: notebook.families || [],
          deletedOcIds: notebook.deletedOcIds || [],
          updatedAt: Number(notebook.updatedAt) || 0,
          syncedAt: Number(notebook.syncedAt) || 0
        }
      : null,
    chatMeta: chatMetaDoc
      ? {
          ocSessions: chatMetaDoc.ocSessions || {},
          hiddenOcIds: chatMetaDoc.hiddenOcIds || [],
          updatedAt: Number(chatMetaDoc.updatedAt) || 0,
          syncedAt: Number(chatMetaDoc.syncedAt) || 0
        }
      : null,
    chatSessions: chatSessions,
    apiVer: 'feedbackApi-user-data-v1'
  };
}

exports.main = async (event) => {
  const ev = normalizeEvent(event);
  const method = (ev.httpMethod || ev.method || event.httpMethod || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  const { action, adminKey, days, body } = readParams(event);

  if (!adminKey) {
    return httpResp(403, {
      ok: false,
      err:
        '未收到管理密钥。请在腾讯云路由里开启「路径透传」，或把访问路径改为 /feedbackApi/oc-feedback-admin-2026 后重新部署本函数'
    });
  }

  if (adminKey !== ADMIN_KEY) {
    return httpResp(403, { ok: false, err: '管理密钥错误' });
  }

  if (action === 'list') {
    try {
      const list = await fetchFeedbackList();
      return httpResp(200, { ok: true, list });
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  // 复用已绑定的 /feedbackApi，管理页可走 HTTP 加载用量
  if (action === 'usageSummary' || action === 'summary' || action === 'usage') {
    try {
      const data = await fetchUsageSummary(days);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (action === 'diagUsage' || action === 'diag' || action === 'usageDiag') {
    try {
      const data = await diagUsage();
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, {
        ok: false,
        err: String(e.message || e),
        apiVer: 'feedbackApi-diag-v3'
      });
    }
  }

  if (action === 'userQuotaList' || action === 'userQuota' || action === 'usersUsage') {
    try {
      const data = await listUserQuota(
        body.limit || 100,
        body.openid || body.userId || body.keyword || body.q || ''
      );
      if (!data.ok) return httpResp(500, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userQuotaClear' ||
    action === 'clearUserQuota' ||
    action === 'userQuotaReset'
  ) {
    try {
      // 明确拒绝批量清空类请求
      if (
        body.clearAll ||
        body.all === true ||
        String(body.mode || '').toLowerCase() === 'all'
      ) {
        return httpResp(400, {
          ok: false,
          err: '禁止一键清空全部额度，仅支持单用户清空'
        });
      }
      const data = await clearUserQuota(
        body.openid || body.userId || body.id || '',
        {
          clearExtra: body.clearExtra,
          clearFree: body.clearFree,
          note: body.note,
          confirmPassword:
            body.confirmPassword || body.password || body.confirmPwd || ''
        }
      );
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userVipSet' ||
    action === 'userVipOpen' ||
    action === 'userVipClose' ||
    action === 'setUserVip'
  ) {
    try {
      const enable =
        action === 'userVipClose'
          ? false
          : action === 'userVipOpen'
            ? true
            : body.enable !== false && body.enable !== 0 && body.enable !== '0';
      const data = await setUserVip(body.openid || body.userId || body.id || '', {
        enable: enable,
        vipDays: body.vipDays,
        permanent: body.permanent,
        note: body.note,
        confirmPassword:
          body.confirmPassword || body.password || body.confirmPwd || ''
      });
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userVipPause' ||
    action === 'pauseUserVip' ||
    action === 'vipPause'
  ) {
    try {
      const data = await pauseUserVip(body.openid || body.userId || body.id || '', {
        note: body.note,
        confirmPassword:
          body.confirmPassword || body.password || body.confirmPwd || ''
      });
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userVipResume' ||
    action === 'resumeUserVip' ||
    action === 'vipResume'
  ) {
    try {
      const data = await resumeUserVip(body.openid || body.userId || body.id || '', {
        note: body.note,
        confirmPassword:
          body.confirmPassword || body.password || body.confirmPwd || ''
      });
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'membershipPanelGet' ||
    action === 'getMembershipPanel' ||
    action === 'appConfigGet'
  ) {
    try {
      const data = await getMembershipPanelConfig();
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'membershipPanelSet' ||
    action === 'setMembershipPanel' ||
    action === 'appConfigSet'
  ) {
    try {
      const data = await setMembershipPanelConfig(body || {});
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'appFeaturesGet' ||
    action === 'getAppFeatures' ||
    action === 'featuresGet'
  ) {
    try {
      const data = await getAppFeaturesConfig();
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'appFeaturesSet' ||
    action === 'setAppFeatures' ||
    action === 'featuresSet'
  ) {
    try {
      const data = await setAppFeaturesConfig(body || {});
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  // —— 兑换码管理（不影响现有广告/分享额度模式）——
  if (action === 'redeemList' || action === 'redeemCodes') {
    try {
      const data = await listRedeemCodes(body.limit || 100);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (action === 'redeemCreate') {
    try {
      const data = await createRedeemCodes({
        kind: body.kind,
        rounds: body.rounds,
        weeklyRounds: body.weeklyRounds,
        roundsExpireDays: body.roundsExpireDays,
        vipDays: body.vipDays,
        permanent: body.permanent,
        count: body.count,
        maxUses: body.maxUses,
        note: body.note
      });
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, {
        ok: false,
        err:
          String(e.message || e) +
          '（请先在云数据库新建集合 redeem_codes，权限：所有用户不可读写）'
      });
    }
  }

  if (action === 'redeemDisable' || action === 'redeemEnable') {
    try {
      const data = await setRedeemCodeEnabled(
        body.id,
        action === 'redeemEnable'
      );
      if (!data.ok) return httpResp(400, data);
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (action === 'redeemLogs') {
    try {
      const data = await listRedeemLogs(
        body.limit || 50,
        body.openid || body.userId || body.keyword || body.q || body.code || '',
        {
          fromMs: body.fromMs != null ? body.fromMs : body.from,
          toMs: body.toMs != null ? body.toMs : body.to
        }
      );
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'payLogs' ||
    action === 'virtualOrders' ||
    action === 'listVirtualOrders' ||
    action === 'rechargeLogs'
  ) {
    try {
      const data = await listVirtualPayOrders(
        body.limit || 80,
        body.openid || body.userId || body.keyword || body.q || body.outTradeNo || '',
        {
          fromMs: body.fromMs != null ? body.fromMs : body.from,
          toMs: body.toMs != null ? body.toMs : body.to
        }
      );
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (action === 'shareLogs' || action === 'shareUnlockLogs') {
    try {
      const data = await listShareLogs(
        body.limit || 50,
        body.openid || body.userId || body.keyword || body.q || ''
      );
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userDataList' ||
    action === 'userDataBackups' ||
    action === 'listUserData'
  ) {
    try {
      const data = await listUserDataBackups(
        body.limit || 50,
        body.openid || body.userId || body.keyword || body.q || ''
      );
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (
    action === 'userDataGet' ||
    action === 'userDataDetail' ||
    action === 'getUserData'
  ) {
    try {
      const data = await getUserDataBackup(
        body.openid || body.userId || body.keyword || body.q || ''
      );
      return httpResp(200, data);
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  if (action === 'update') {
    try {
      const id = String(body.id || '').trim();
      if (!id) {
        return httpResp(400, { ok: false, err: '缺少反馈 id' });
      }
      const patch = {};
      if (body.status === 'read' || body.status === 'unread') {
        patch.status = body.status;
        if (body.status === 'read') {
          patch.readTimeMs = Date.now();
        }
      }
      if (body.reply !== undefined) {
        patch.reply = String(body.reply || '').trim().slice(0, 2000);
        patch.replyTimeMs = patch.reply ? Date.now() : 0;
        if (patch.reply) {
          patch.status = 'read';
          patch.readTimeMs = Date.now();
        }
      }
      if (!Object.keys(patch).length) {
        return httpResp(400, { ok: false, err: '无有效更新字段' });
      }
      await db.collection('feedback').doc(id).update({ data: patch });
      return httpResp(200, { ok: true });
    } catch (e) {
      return httpResp(500, { ok: false, err: String(e.message || e) });
    }
  }

  return httpResp(400, {
    ok: false,
    err: '未知 action',
    got: action,
    tip: '请右键云函数 feedbackApi → 上传并部署：云端安装依赖',
    apiVer: 'feedbackApi-diag-v3'
  });
};
