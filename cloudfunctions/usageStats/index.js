const cloud = require('wx-server-sdk');

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({ env: CLOUD_ENV_ID });

const db = cloud.database();
const _ = db.command;

const ADMIN_KEY = String(process.env.FEEDBACK_ADMIN_KEY || 'oc-feedback-admin-2026').trim();
const COLLECTION = 'usage_daily';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Feedback-Admin-Key, x-feedback-admin-key',
  'Access-Control-Max-Age': '86400'
};

function localDateKey(ts) {
  const t = (Number(ts) || Date.now()) + 8 * 3600000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function emptyDoc(dateKey) {
  return {
    dateKey,
    chatRounds: 0,
    chatRoundsDm: 0,
    chatRoundsGroup: 0,
    apiCalls: 0,
    apiByName: {},
    unlockAd: 0,
    unlockShare: 0,
    unlockFailOpen: 0,
    unlockRoundsAd: 0,
    unlockRoundsShare: 0,
    unlockRoundsFailOpen: 0,
    reportCount: 0,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
}

async function incDaily(dateKey, patch, apiByName) {
  const data = { updatedAt: db.serverDate(), dateKey };
  Object.keys(patch).forEach((k) => {
    const v = num(patch[k]);
    if (v > 0) data[k] = _.inc(v);
  });
  if (apiByName && typeof apiByName === 'object') {
    Object.keys(apiByName).forEach((name) => {
      const v = num(apiByName[name]);
      if (!name || v <= 0) return;
      data['apiByName.' + name] = _.inc(v);
    });
  }
  data.reportCount = _.inc(1);

  let existing = null;
  try {
    const res = await db
      .collection(COLLECTION)
      .where({ dateKey: dateKey })
      .limit(1)
      .get();
    if (res && res.data && res.data.length) existing = res.data[0];
  } catch (_) {}

  if (existing && existing._id) {
    try {
      await db.collection(COLLECTION).doc(existing._id).update({ data });
      return true;
    } catch (err) {
      console.error('[usageStats] update', err);
      return false;
    }
  }

  const init = emptyDoc(dateKey);
  Object.keys(patch).forEach((k) => {
    const v = num(patch[k]);
    if (v > 0) init[k] = v;
  });
  if (apiByName && typeof apiByName === 'object') {
    Object.keys(apiByName).forEach((name) => {
      const v = num(apiByName[name]);
      if (name && v > 0) init.apiByName[name] = v;
    });
  }
  init.reportCount = 1;
  try {
    await db.collection(COLLECTION).add({ data: init });
    return true;
  } catch (err2) {
    console.error('[usageStats] add', err2);
    return false;
  }
}

function normalizeEvent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  const ev = Object.assign({}, raw);
  if (raw.body && typeof raw.body === 'string') {
    try {
      Object.assign(ev, JSON.parse(raw.body));
    } catch (e) {}
  } else if (raw.body && typeof raw.body === 'object') {
    Object.assign(ev, raw.body);
  }
  if (raw.queryStringParameters) Object.assign(ev, raw.queryStringParameters);
  return ev;
}

function readAdminKey(ev) {
  const h = ev.headers || ev.header || {};
  const hk = Object.keys(h).find(
    (k) => String(k).toLowerCase() === 'x-feedback-admin-key'
  );
  return String(
    (hk && h[hk]) || ev.adminKey || ev.adminkey || ''
  ).trim();
}

/**
 * 写入单条分享获额明细（供管理后台按用户查看）
 * 集合 share_logs：权限建议「所有用户不可读写」
 */
async function appendShareLog(openid, rounds, channel, dateKey) {
  const oid = String(openid || '').trim();
  if (!oid) return { ok: false, err: '缺少 openid' };
  const r = Math.max(0, Math.floor(Number(rounds) || 0));
  if (r <= 0) return { ok: false, err: '轮次无效' };
  const dk = dateKey || localDateKey();
  const now = Date.now();
  try {
    await db.collection('share_logs').add({
      data: {
        openid: oid,
        rounds: r,
        channel: String(channel || '').trim().slice(0, 16) || 'dm',
        dateKey: dk,
        source: 'share',
        createTimeMs: now,
        createTime: db.serverDate()
      }
    });
    return { ok: true, dateKey: dk, rounds: r };
  } catch (e) {
    return {
      ok: false,
      err:
        '写入 share_logs 失败（请新建集合 share_logs）：' +
        String((e && (e.message || e.errMsg)) || e)
    };
  }
}

async function handleLogShare(ev) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || String(ev.openid || '').trim();
  return appendShareLog(
    openid,
    ev.rounds,
    ev.channel,
    ev.dateKey || localDateKey()
  );
}

function currentWeekKey() {
  const t = Date.now() + 8 * 3600000;
  const d = new Date(t);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(monday.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dayNum;
}

/**
 * 用量上报时同步写 user_quota.freeUsed（后台「用户额度」依赖此字段）。
 * 这条路径已验证能稳定写入 usage_daily，比只靠 ocChat 更可靠。
 */
async function syncUserFreeQuota(openid, ev) {
  const oid = String(openid || '').trim();
  if (!oid) return { ok: false, err: 'no openid' };

  const chatRounds = num(ev && ev.chatRounds);
  const reportedUsed =
    ev && ev.freeUsed != null
      ? Math.max(0, Math.floor(Number(ev.freeUsed) || 0))
      : null;
  if (chatRounds <= 0 && reportedUsed == null) {
    return { ok: true, skipped: true };
  }

  const weekKey = String((ev && ev.weekKey) || currentWeekKey()).slice(0, 32);
  const freeAllowed = Math.max(
    30,
    Math.floor(Number(ev && ev.freeAllowed) || 0) || 30
  );
  const forceFreeReset = !!(
    ev &&
    (ev.forceFreeReset || ev.forceReset || ev.resetFree)
  );

  const col = db.collection('user_quota');
  let doc = null;
  try {
    const byId = await col.doc(oid).get();
    if (byId && byId.data && Object.keys(byId.data).length) {
      doc = Object.assign({ _id: oid }, byId.data);
    }
  } catch (_) {}
  if (!doc) {
    try {
      const res = await col.where({ openid: oid }).limit(1).get();
      if (res && res.data && res.data.length) doc = res.data[0];
    } catch (_) {}
  }

  const now = Date.now();
  let nextUsed = 0;
  if (doc && doc._id) {
    const prevWeek = String(doc.weekKey || '');
    const prevFree = Math.max(0, Number(doc.freeUsed) || 0);
    const weekChanged = !!(weekKey && weekKey !== prevWeek);
    if (forceFreeReset && reportedUsed != null) {
      nextUsed = reportedUsed;
    } else if (reportedUsed != null) {
      nextUsed = weekChanged ? reportedUsed : Math.max(prevFree, reportedUsed);
    } else {
      nextUsed = weekChanged ? chatRounds : prevFree + chatRounds;
    }
    try {
      const patch = {
        openid: oid,
        weekKey: weekKey,
        freeUsed: nextUsed,
        freeAllowed: Math.max(
          freeAllowed,
          Math.max(0, Number(doc.freeAllowed) || 0),
          30
        ),
        updateTimeMs: now,
        updatedAt: now
      };
      if (forceFreeReset) {
        patch.adminClearedAt = 0;
        patch.adminClearedNote = 'schema-upgrade-reset';
      }
      await col.doc(doc._id).update({
        data: patch
      });
      return { ok: true, freeUsed: nextUsed, method: 'update' };
    } catch (e) {
      return { ok: false, err: String((e && (e.message || e.errMsg)) || e) };
    }
  }

  nextUsed = reportedUsed != null ? reportedUsed : chatRounds;
  const init = {
    openid: oid,
    extraRounds: 0,
    extraConsumed: 0,
    redeemedTotal: 0,
    freeUsed: nextUsed,
    freeAllowed: freeAllowed,
    weekKey: weekKey,
    createTimeMs: now,
    updateTimeMs: now
  };
  try {
    await col.doc(oid).set({ data: init });
    return { ok: true, freeUsed: nextUsed, method: 'set' };
  } catch (e2) {
    try {
      await col.add({ data: init });
      return { ok: true, freeUsed: nextUsed, method: 'add' };
    } catch (e3) {
      return { ok: false, err: String((e3 && (e3.message || e3.errMsg)) || e3) };
    }
  }
}

async function handleReport(ev) {
  const dateKey = localDateKey();
  const patch = {
    chatRounds: ev.chatRounds,
    chatRoundsDm: ev.chatRoundsDm,
    chatRoundsGroup: ev.chatRoundsGroup,
    apiCalls: ev.apiCalls,
    unlockAd: ev.unlockAd,
    unlockShare: ev.unlockShare,
    unlockFailOpen: ev.unlockFailOpen,
    unlockRoundsAd: ev.unlockRoundsAd,
    unlockRoundsShare: ev.unlockRoundsShare,
    unlockRoundsFailOpen: ev.unlockRoundsFailOpen
  };
  const ok = await incDaily(dateKey, patch, ev.apiByName);

  let quotaSync = null;
  try {
    const wxContext = cloud.getWXContext();
    const openid = (wxContext && wxContext.OPENID) || '';
    if (openid && (num(ev.chatRounds) > 0 || ev.freeUsed != null)) {
      quotaSync = await syncUserFreeQuota(openid, ev);
    }
  } catch (e) {
    quotaSync = { ok: false, err: String((e && e.message) || e) };
  }

  return {
    ok,
    dateKey,
    quotaSync: quotaSync || undefined,
    apiVer: 'usageStats-quota-sync-v1'
  };
}

async function handleSummary(ev) {
  const key = readAdminKey(ev);
  if (!key || key !== ADMIN_KEY) {
    return { ok: false, errMsg: '管理密钥无效', statusCode: 403 };
  }
  const days = Math.min(60, Math.max(1, num(ev.days) || 14));
  let list = [];
  let warn = '';
  try {
    const res = await db
      .collection(COLLECTION)
      .orderBy('dateKey', 'desc')
      .limit(days)
      .get();
    list = (res && res.data) || [];
  } catch (e1) {
    try {
      const res = await db.collection(COLLECTION).limit(days).get();
      list = ((res && res.data) || []).slice();
      list.sort((a, b) =>
        String(b.dateKey || b._id || '').localeCompare(String(a.dateKey || a._id || ''))
      );
      warn = '无 dateKey 索引，已降级排序；可在控制台为 usage_daily.dateKey 建降序索引';
    } catch (e2) {
      return {
        ok: false,
        errMsg: String((e2 && (e2.message || e2.errMsg)) || e2),
        statusCode: 500
      };
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
    if (!row.dateKey && row._id) row.dateKey = row._id;
    totals.chatRounds += Number(row.chatRounds) || 0;
    totals.apiCalls += Number(row.apiCalls) || 0;
    totals.unlockAd += Number(row.unlockAd) || 0;
    totals.unlockShare += Number(row.unlockShare) || 0;
    totals.unlockFailOpen += Number(row.unlockFailOpen) || 0;
    totals.unlockRoundsAd += Number(row.unlockRoundsAd) || 0;
    totals.unlockRoundsShare += Number(row.unlockRoundsShare) || 0;
    totals.unlockRoundsFailOpen += Number(row.unlockRoundsFailOpen) || 0;
  });
  return { ok: true, days, list, totals, warn };
}

function httpResult(body, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

exports.main = async (event, context) => {
  const ev = normalizeEvent(event);
  const method = String(
    (event && (event.httpMethod || event.method)) || ''
  ).toUpperCase();

  if (method === 'OPTIONS') {
    return httpResult({ ok: true }, 204);
  }

  const action = String(ev.action || 'report').trim();
  let result;
  try {
    if (action === 'report' || action === 'inc') {
      result = await handleReport(ev);
    } else if (action === 'logShare' || action === 'shareLog') {
      result = await handleLogShare(ev);
    } else if (action === 'summary' || action === 'list') {
      result = await handleSummary(ev);
    } else {
      result = { ok: false, errMsg: '未知 action' };
    }
  } catch (err) {
    console.error('[usageStats]', err);
    result = { ok: false, errMsg: (err && err.message) || '统计失败' };
  }

  // HTTP 触发时包一层
  if (method === 'GET' || method === 'POST' || (event && event.requestContext)) {
    return httpResult(result, result.statusCode || (result.ok ? 200 : 400));
  }
  return result;
};
