const cloud = require('wx-server-sdk');

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({ env: CLOUD_ENV_ID });

const db = cloud.database();
const _ = db.command;

/**
 * 以 openid 为文档 _id，避免并发 balance/sync 造出重复空文档。
 * 若历史上已有「随机 _id + openid 字段」文档，优先复用并合并。
 */
async function getOrCreateQuota(openid) {
  const col = db.collection('user_quota');
  const byId = col.doc(openid);
  try {
    const got = await byId.get();
    if (got && got.data && Object.keys(got.data).length) {
      return Object.assign({ _id: openid }, got.data);
    }
  } catch (_) {}

  try {
    const res = await col.where({ openid }).limit(20).get();
    const rows = (res && res.data) || [];
    if (rows.length) {
      rows.sort(
        (a, b) =>
          Number(b.extraRounds || 0) - Number(a.extraRounds || 0) ||
          Number(b.redeemedTotal || 0) - Number(a.redeemedTotal || 0) ||
          Number(b.updateTimeMs || 0) - Number(a.updateTimeMs || 0)
      );
      const best = rows[0];
      return best;
    }
  } catch (_) {}

  const doc = {
    openid,
    extraRounds: 0,
    redeemedTotal: 0,
    extraConsumed: 0,
    weekKey: '',
    freeUsed: 0,
    freeAllowed: 30,
    createTimeMs: Date.now(),
    updateTimeMs: Date.now()
  };
  try {
    await byId.set({ data: doc });
    return Object.assign({ _id: openid }, doc);
  } catch (e) {
    try {
      const add = await col.add({ data: doc });
      return Object.assign({ _id: add._id }, doc);
    } catch (e2) {
      const res = await col.where({ openid }).limit(1).get();
      if (res.data && res.data.length) return res.data[0];
      throw e2;
    }
  }
}

async function getBalance(openid) {
  const row = await getOrCreateQuota(openid);
  const extraRounds = Math.max(0, Number(row.extraRounds) || 0);
  const redeemedTotal = Math.max(0, Number(row.redeemedTotal) || 0);
  const extraConsumed = Math.max(
    0,
    row.extraConsumed != null
      ? Number(row.extraConsumed) || 0
      : Math.max(0, redeemedTotal - extraRounds)
  );
  return {
    ok: true,
    extraRounds,
    redeemedTotal,
    extraConsumed,
    quotaUsed: extraConsumed,
    quotaLeft: extraRounds,
    weekKey: row.weekKey || '',
    freeUsed: Math.max(0, Number(row.freeUsed) || 0),
    freeAllowed: Math.max(30, Number(row.freeAllowed) || 0) || 30,
    adminClearedAt: Number(row.adminClearedAt) || 0
  };
}

/**
 * 客户端只允许：上报免费用量、上报额外池消耗增量。
 * 禁止用本地 extraRounds 直接覆盖云端（会把兑换额度刷成 0）。
 */
async function syncBalance(openid, payload) {
  const quota = await getOrCreateQuota(openid);
  const patch = { updateTimeMs: Date.now() };

  const d = Math.max(0, Math.floor(Number(payload && payload.deltaConsumed) || 0));
  if (d > 0) {
    const cur = Math.max(0, Number(quota.extraRounds) || 0);
    const consume = Math.min(d, cur);
    if (consume > 0) {
      patch.extraRounds = _.inc(-consume);
      patch.extraConsumed = _.inc(consume);
    }
  }

  if (payload && payload.weekKey) {
    patch.weekKey = String(payload.weekKey).slice(0, 32);
  }
  if (payload && payload.freeUsed != null) {
    const nextFree = Math.max(0, Math.floor(Number(payload.freeUsed) || 0));
    const prevFree = Math.max(0, Number(quota.freeUsed) || 0);
    const forceFreeReset = !!(
      payload.forceFreeReset ||
      payload.forceReset ||
      payload.resetFree
    );
    // 规则升级 / 换周：允许把 freeUsed 调低；平时只增不减
    if (
      forceFreeReset ||
      (payload.weekKey && String(payload.weekKey) !== String(quota.weekKey || ''))
    ) {
      patch.freeUsed = nextFree;
      if (forceFreeReset) {
        patch.adminClearedAt = 0;
        patch.adminClearedNote = 'schema-upgrade-reset';
      }
    } else {
      patch.freeUsed = Math.max(prevFree, nextFree);
    }
  }
  if (payload && payload.freeAllowed != null) {
    patch.freeAllowed = Math.max(
      30,
      Math.floor(Number(payload.freeAllowed) || 0) || 30
    );
  } else if (payload && payload.freeUsed != null) {
    // 上报免费用量时，若库里 freeAllowed 为 0，补成每周 30
    const prevAllowed = Math.max(0, Number(quota.freeAllowed) || 0);
    if (prevAllowed < 30) patch.freeAllowed = 30;
  }

  if (Object.keys(patch).length <= 1) {
    return getBalance(openid);
  }
  await db.collection('user_quota').doc(quota._id).update({ data: patch });
  return getBalance(openid);
}

async function redeem(openid, rawCode) {
  const code = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!code || code.length < 6) {
    return { ok: false, err: '请输入有效兑换码' };
  }

  const found = await db
    .collection('redeem_codes')
    .where({ code })
    .limit(1)
    .get();
  if (!found.data || !found.data.length) {
    return { ok: false, err: '兑换码无效' };
  }
  const row = found.data[0];
  if (row.enabled === false) {
    return { ok: false, err: '兑换码已停用' };
  }
  const maxUses = Math.max(1, Number(row.maxUses) || 1);
  const usedCount = Number(row.usedCount) || 0;
  if (usedCount >= maxUses) {
    return { ok: false, err: '兑换码已使用' };
  }
  const rounds = Math.max(0, Number(row.rounds) || 0);
  if (!rounds) {
    return { ok: false, err: '兑换码额度无效' };
  }

  try {
    await db
      .collection('redeem_codes')
      .doc(row._id)
      .update({
        data: {
          usedCount: _.inc(1)
        }
      });
  } catch (e) {
    return { ok: false, err: '核销失败，请稍后重试' };
  }

  const after = await db.collection('redeem_codes').doc(row._id).get();
  const afterUsed = Number((after.data && after.data.usedCount) || 0);
  if (afterUsed > maxUses) {
    await db
      .collection('redeem_codes')
      .doc(row._id)
      .update({ data: { usedCount: maxUses } });
    return { ok: false, err: '兑换码已使用' };
  }

  const quota = await getOrCreateQuota(openid);
  const nextExtra = Math.max(0, Number(quota.extraRounds) || 0) + rounds;
  await db
    .collection('user_quota')
    .doc(quota._id)
    .update({
      data: {
        extraRounds: nextExtra,
        redeemedTotal: _.inc(rounds),
        updateTimeMs: Date.now()
      }
    });

  const now = Date.now();
  let logWarn = '';
  try {
    await db.collection('redeem_logs').add({
      data: {
        code,
        codeId: row._id,
        openid,
        rounds,
        createTimeMs: now,
        createTime: db.serverDate()
      }
    });
  } catch (e) {
    logWarn =
      '兑换成功，但兑换记录写入失败（请新建集合 redeem_logs）：' +
      String((e && (e.message || e.errMsg)) || e);
  }

  return {
    ok: true,
    rounds,
    extraRounds: nextExtra,
    warn: logWarn || undefined
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  if (!openid) {
    return { ok: false, err: '未登录，请重启小程序后再试' };
  }

  const action = String((event && event.action) || 'redeem').trim();

  try {
    if (action === 'balance') {
      return await getBalance(openid);
    }
    if (action === 'syncBalance' || action === 'sync') {
      return await syncBalance(openid, event || {});
    }
    if (action === 'redeem') {
      return await redeem(openid, event && event.code);
    }
    return { ok: false, err: '未知 action' };
  } catch (e) {
    const msg = String(e.message || e.errMsg || e);
    if (
      msg.indexOf('collection not exists') !== -1 ||
      msg.indexOf('Db or Table not exist') !== -1 ||
      msg.indexOf('RESOURCE_NOT_FOUND') !== -1
    ) {
      return {
        ok: false,
        err: '请先在云开发创建集合 redeem_codes / redeem_logs / user_quota（所有用户不可读写）'
      };
    }
    return { ok: false, err: msg };
  }
};
