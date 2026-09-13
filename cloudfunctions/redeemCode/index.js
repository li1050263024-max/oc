const cloud = require('wx-server-sdk');

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
cloud.init({ env: CLOUD_ENV_ID });

const db = cloud.database();
const _ = db.command;

const VIDEO_EXTRACT_FREE_WEEKLY = 3;
const VIDEO_EXTRACT_VIP_WEEKLY = 15;
const FREE_WEEKLY_ROUNDS = 30;
const VIP_WEEKLY_ROUNDS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 与客户端一致：以周一为周起点（按东八区日历日） */
function cnWeekKey(ts) {
  const t = Number(ts) || Date.now();
  const d = new Date(t + 8 * 3600 * 1000);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function isVipPaused(row) {
  return !!(
    row &&
    (row.vipPaused === true || row.vipPaused === 1 || row.vipPaused === '1')
  );
}

function isVipActive(row) {
  if (!row) return false;
  if (isVipPaused(row)) return false;
  if (!(row.isVip === true || row.isVip === 1 || row.isVip === '1')) return false;
  const exp = Number(row.vipExpireAt) || 0;
  if (exp > 0 && Date.now() > exp) return false;
  return true;
}

/**
 * 以 openid 为文档 _id，避免并发 balance/sync 造出重复空文档。
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
      return rows[0];
    }
  } catch (_) {}

  const doc = {
    openid,
    extraRounds: 0,
    redeemedTotal: 0,
    extraConsumed: 0,
    weekKey: '',
    freeUsed: 0,
    freeAllowed: FREE_WEEKLY_ROUNDS,
    isVip: false,
    vipExpireAt: 0,
    videoExtractWeekKey: '',
    videoExtractUsed: 0,
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

function videoExtractState(row) {
  const vip = isVipActive(row);
  const limit = vip ? VIDEO_EXTRACT_VIP_WEEKLY : VIDEO_EXTRACT_FREE_WEEKLY;
  const weekKey = cnWeekKey(Date.now());
  const sameWeek = String(row.videoExtractWeekKey || '') === weekKey;
  const used = sameWeek ? Math.max(0, Number(row.videoExtractUsed) || 0) : 0;
  return {
    isVip: vip,
    weekKey,
    used,
    limit,
    left: Math.max(0, limit - used)
  };
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
  const vipExpireAt = Number(row.vipExpireAt) || 0;
  const isVip = isVipActive(row);
  const customWeekly = Math.max(0, Math.floor(Number(row.vipWeeklyRounds) || 0));
  const weeklyCap = isVip
    ? customWeekly > 0
      ? customWeekly
      : VIP_WEEKLY_ROUNDS
    : FREE_WEEKLY_ROUNDS;
  const extraExpireAt = Number(row.extraRoundsExpireAt) || 0;
  const extraValid =
    extraExpireAt > 0 ? Date.now() <= extraExpireAt : true;
  const effectiveExtra = extraValid ? extraRounds : 0;
  // 额度已过期：落库清零，避免前端反复看到脏数据
  if (!extraValid && extraRounds > 0) {
    try {
      await db.collection('user_quota').doc(row._id || openid).update({
        data: { extraRounds: 0, updateTimeMs: Date.now() }
      });
    } catch (_) {}
  }
  const ve = videoExtractState(row);
  return {
    ok: true,
    extraRounds: effectiveExtra,
    redeemedTotal,
    extraConsumed,
    quotaUsed: extraConsumed,
    quotaLeft: effectiveExtra,
    extraRoundsExpireAt: extraExpireAt,
    weekKey: row.weekKey || '',
    freeUsed: Math.max(0, Number(row.freeUsed) || 0),
    freeAllowed: weeklyCap,
    vipWeeklyRounds: isVip ? weeklyCap : 0,
    adminClearedAt: Number(row.adminClearedAt) || 0,
    isVip: isVip,
    vipPaused: isVipPaused(row),
    vipExpireAt: vipExpireAt,
    videoExtractWeekKey: ve.weekKey,
    videoExtractUsed: ve.used,
    videoExtractLimit: ve.limit,
    videoExtractLeft: ve.left
  };
}

async function syncBalance(openid, payload) {
  const quota = await getOrCreateQuota(openid);
  const patch = { updateTimeMs: Date.now() };

  const added = Math.max(0, Math.floor(Number(payload && payload.deltaExtraAdded) || 0));
  const d = Math.max(0, Math.floor(Number(payload && payload.deltaConsumed) || 0));
  // 广告等本地加额：先加再扣，避免被 balance 回拉抹掉
  if (added > 0 || d > 0) {
    const cur = Math.max(0, Number(quota.extraRounds) || 0);
    const afterAdd = cur + added;
    const consume = Math.min(d, afterAdd);
    const next = Math.max(0, afterAdd - consume);
    if (next !== cur) {
      patch.extraRounds = next;
    }
    if (consume > 0) {
      patch.extraConsumed = _.inc(consume);
    }
    if (added > 0) {
      patch.extraEarned = _.inc(added);
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
  const merged = Object.assign({}, quota, patch);
  const vipNow = isVipActive(merged);
  const customWeekly = Math.max(0, Math.floor(Number(merged.vipWeeklyRounds) || 0));
  const weeklyCap = vipNow
    ? customWeekly > 0
      ? customWeekly
      : VIP_WEEKLY_ROUNDS
    : FREE_WEEKLY_ROUNDS;
  if (payload && payload.freeAllowed != null) {
    patch.freeAllowed = Math.max(
      weeklyCap,
      Math.floor(Number(payload.freeAllowed) || 0) || weeklyCap
    );
  } else {
    patch.freeAllowed = weeklyCap;
  }

  if (Object.keys(patch).length <= 1) {
    return getBalance(openid);
  }
  await db.collection('user_quota').doc(quota._id).update({ data: patch });
  return getBalance(openid);
}

/** 预扣 1 次视频提取（失败可 refund） */
async function videoExtractBegin(openid) {
  const quota = await getOrCreateQuota(openid);
  const ve = videoExtractState(quota);
  if (ve.left <= 0) {
    return {
      ok: false,
      err: ve.isVip
        ? '本周视频提取已达上限（会员 15 次）'
        : '本周体验次数已用完（非会员 3 次），开通会员可提至每周 15 次',
      videoExtractUsed: ve.used,
      videoExtractLimit: ve.limit,
      videoExtractLeft: 0,
      isVip: ve.isVip
    };
  }
  await db.collection('user_quota').doc(quota._id).update({
    data: {
      videoExtractWeekKey: ve.weekKey,
      videoExtractUsed: ve.used + 1,
      updateTimeMs: Date.now()
    }
  });
  return {
    ok: true,
    videoExtractUsed: ve.used + 1,
    videoExtractLimit: ve.limit,
    videoExtractLeft: Math.max(0, ve.limit - ve.used - 1),
    isVip: ve.isVip,
    weekKey: ve.weekKey
  };
}

/** 提取失败时退回 1 次 */
async function videoExtractRefund(openid) {
  const quota = await getOrCreateQuota(openid);
  const ve = videoExtractState(quota);
  const nextUsed = Math.max(0, ve.used - 1);
  await db.collection('user_quota').doc(quota._id).update({
    data: {
      videoExtractWeekKey: ve.weekKey,
      videoExtractUsed: nextUsed,
      updateTimeMs: Date.now()
    }
  });
  return {
    ok: true,
    videoExtractUsed: nextUsed,
    videoExtractLimit: ve.limit,
    videoExtractLeft: Math.max(0, ve.limit - nextUsed),
    isVip: ve.isVip
  };
}

function computeVipExpire(quota, vipDays, permanent) {
  const now = Date.now();
  if (permanent || vipDays <= 0) {
    return 0;
  }
  const curExp = Number(quota.vipExpireAt) || 0;
  const curVip = isVipActive(quota);
  if (curVip && curExp === 0) {
    // 已是永久会员，保持永久
    return 0;
  }
  const start = curVip && curExp > now ? curExp : now;
  return start + vipDays * DAY_MS;
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

  const kind = String(row.kind || '').toLowerCase();
  const vipDays = Math.max(0, Math.floor(Number(row.vipDays) || 0));
  const permanent = !!(
    row.permanent === true ||
    row.permanent === 1 ||
    (kind === 'vip' && vipDays === 0 && !(Number(row.rounds) > 0))
  );
  const rounds = Math.max(0, Math.floor(Number(row.rounds) || 0));
  const weeklyRounds = Math.max(0, Math.floor(Number(row.weeklyRounds) || 0));
  const roundsExpireDays = Math.max(
    0,
    Math.floor(Number(row.roundsExpireDays) || 0)
  );
  const grantVip =
    kind === 'vip' ||
    kind === 'combo' ||
    vipDays > 0 ||
    permanent ||
    row.isVipCode === true;
  const grantRounds = rounds > 0;

  if (!grantVip && !grantRounds) {
    return { ok: false, err: '兑换码额度无效' };
  }

  try {
    await db
      .collection('redeem_codes')
      .doc(row._id)
      .update({
        data: {
          usedCount: _.inc(1),
          usedBy: _.addToSet(openid),
          lastUsedOpenid: openid,
          lastUsedAt: Date.now()
        }
      });
  } catch (e) {
    // 旧库无 addToSet 时降级为仅计数 + 末次用户
    try {
      await db
        .collection('redeem_codes')
        .doc(row._id)
        .update({
          data: {
            usedCount: _.inc(1),
            lastUsedOpenid: openid,
            lastUsedAt: Date.now()
          }
        });
    } catch (e2) {
      return { ok: false, err: '核销失败，请稍后重试' };
    }
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
  const patch = { updateTimeMs: Date.now() };
  let nextExtra = Math.max(0, Number(quota.extraRounds) || 0);

  if (grantRounds) {
    nextExtra = nextExtra + rounds;
    patch.extraRounds = nextExtra;
    patch.redeemedTotal = _.inc(rounds);
    if (roundsExpireDays > 0) {
      const prevExp = Number(quota.extraRoundsExpireAt) || 0;
      const nextExp = Date.now() + roundsExpireDays * DAY_MS;
      // 已有更晚到期则保留更晚；否则按本码天数
      patch.extraRoundsExpireAt =
        prevExp > nextExp && prevExp > Date.now() ? prevExp : nextExp;
    } else {
      // 不限时间额度：清除到期
      patch.extraRoundsExpireAt = 0;
    }
  }

  let nextVipExpire = Number(quota.vipExpireAt) || 0;
  const nextWeekly =
    weeklyRounds > 0 ? weeklyRounds : VIP_WEEKLY_ROUNDS;
  if (grantVip) {
    patch.isVip = true;
    patch.vipPaused = false;
    nextVipExpire = computeVipExpire(quota, vipDays, permanent);
    patch.vipExpireAt = nextVipExpire;
    patch.vipWeeklyRounds = nextWeekly;
    patch.freeAllowed = nextWeekly;
  }

  await db.collection('user_quota').doc(quota._id).update({ data: patch });

  const now = Date.now();
  let logWarn = '';
  try {
    await db.collection('redeem_logs').add({
      data: {
        code,
        codeId: row._id,
        openid,
        rounds: grantRounds ? rounds : 0,
        kind: grantVip ? (grantRounds ? 'combo' : 'vip') : 'rounds',
        vipDays: grantVip ? (permanent ? 0 : vipDays) : 0,
        permanent: grantVip && permanent,
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
    rounds: grantRounds ? rounds : 0,
    extraRounds: nextExtra,
    isVip: grantVip ? true : isVipActive(Object.assign({}, quota, patch)),
    vipExpireAt: grantVip ? nextVipExpire : Number(quota.vipExpireAt) || 0,
    vipDays: grantVip ? (permanent ? 0 : vipDays) : 0,
    permanent: !!(grantVip && permanent),
    kind: grantVip ? (grantRounds ? 'combo' : 'vip') : 'rounds',
    warn: logWarn || undefined
  };
}

const DEFAULT_MEMBERSHIP_PANEL = {
  visible: false,
  title: '会员权益',
  lines: [
    '月卡 ¥9.9（兑换码开通）',
    '每周对话额度 100 轮（非会员每周 30 轮）',
    '朋友圈 / 抖音：选择 OC 人数不限',
    '抖音信息流：最多展示 50 条（普通用户 10 条）',
    '视频抽音：每周 15 次（非会员每周体验 3 次）',
    '抖音路人评论：20 条（普通用户 5 条）',
    '故事集：不再区分会员，可自由创建'
  ],
  footer: '请在「兑换码」页输入会员码开通 · 月卡 ¥9.9 · 含每周 100 对话'
};

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
    ).trim()
  };
}

function normalizeAppFeatures(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    // 默认关闭：后台打开后小程序才审图
    imgSecCheckEnabled:
      src.imgSecCheckEnabled === true ||
      src.imgSecCheckEnabled === 1 ||
      src.imgSecCheckEnabled === '1'
  };
}

async function getAppFeatures() {
  try {
    const got = await db.collection('oc_app_config').doc('app_features').get();
    return normalizeAppFeatures((got && got.data) || {});
  } catch (_) {
    return normalizeAppFeatures({});
  }
}

async function getAppConfig() {
  let features = normalizeAppFeatures({});
  try {
    features = await getAppFeatures();
  } catch (_) {}
  try {
    const got = await db.collection('oc_app_config').doc('membership_panel').get();
    const data = (got && got.data) || {};
    return {
      ok: true,
      membershipPanel: normalizeMembershipPanel(data),
      features: features
    };
  } catch (e) {
    return {
      ok: true,
      membershipPanel: normalizeMembershipPanel(DEFAULT_MEMBERSHIP_PANEL),
      features: features,
      warn: String((e && (e.message || e.errMsg)) || e)
    };
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  if (!openid) {
    return { ok: false, err: '未登录，请重启小程序后再试' };
  }

  const action = String((event && event.action) || 'redeem').trim();

  try {
    if (action === 'getAppConfig' || action === 'appConfig') {
      return await getAppConfig();
    }
    if (action === 'balance') {
      return await getBalance(openid);
    }
    if (action === 'syncBalance' || action === 'sync') {
      return await syncBalance(openid, event || {});
    }
    if (action === 'redeem') {
      return await redeem(openid, event && event.code);
    }
    if (action === 'videoExtractBegin') {
      return await videoExtractBegin(openid);
    }
    if (action === 'videoExtractRefund') {
      return await videoExtractRefund(openid);
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
