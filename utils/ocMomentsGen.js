const { getOcsForSocial } = require('./ocSocialEligible.js');
const { fallbackMomentPosts } = require('./ocSocialFallback.js');
const { buildMomentsCloudPayload, buildSocialPlotContext } = require('./ocSocialContext.js');
const {
  buildAllOcPlan,
  interleaveOcItems,
  assignMomentsCalendarTimestamps
} = require('./ocSocialMix.js');
const {
  getMeta,
  setMeta,
  appendMoments,
  newPostId,
  getMomentsFeed,
  planOcsForMomentsGeneration,
  getOcTodayPostContents
} = require('./ocMomentsStore.js');
const momentsComment = require('./ocMomentsComment.js');
const {
  beginDedupeSession,
  endDedupeSession,
  buildForbiddenForPrompt,
  claimContent,
  getActiveRegistry,
  normalizeForDedupe
} = require('./ocSocialDedupe.js');

function appendMomentsUnique(posts) {
  const reg = getActiveRegistry();
  const unique = [];
  (posts || []).forEach((p) => {
    const c = String((p && p.content) || '').trim();
    if (!c) return;
    const n = normalizeForDedupe(c);
    if (reg.used.has(n) || claimContent(c)) unique.push(p);
  });
  if (unique.length) appendMoments(unique);
  return unique.length;
}

const GENERATE_COOLDOWN_MS = 20 * 60 * 1000;
let _running = false;

const MOMENT_TEMPLATE_PATTERN =
  /今天在旧货市场|冷静点说|刚才又路过那家店|街角的灯还亮着|买了杯热的站|脑子里又闪过|今日状态：|心情记录：|路过，发一条|随手记一笔/i;

function normalizeMomentText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .trim();
}

function isMomentTooSimilar(a, b) {
  const x = normalizeMomentText(a);
  const y = normalizeMomentText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.slice(0, 10) === y.slice(0, 10)) return true;
  if (x.length >= 16 && y.length >= 16 && x.slice(0, 16) === y.slice(0, 16)) return true;
  return false;
}

function validateMomentContent(text, forbiddenList) {
  const t = String(text || '').trim();
  if (!t || t.length < 8) return false;
  if (MOMENT_TEMPLATE_PATTERN.test(t)) return false;
  const list = forbiddenList || [];
  for (let i = 0; i < list.length; i++) {
    if (isMomentTooSimilar(t, list[i])) return false;
  }
  return true;
}

function getEligibleOcs() {
  return getOcsForSocial().filter((oc) => oc && oc.hasBio);
}

function callGenerateCloud(payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('no cloud'));
      return;
    }
    wx.cloud.callFunction({
      name: 'generateOcMoments',
      data: payload,
      timeout: 55000,
      success: (res) => {
        const r = (res && res.result) || {};
        if (r.ok && Array.isArray(r.posts) && r.posts.length) {
          resolve(r.posts);
          return;
        }
        reject(new Error(r.errMsg || '生成失败'));
      },
      fail: (err) => reject(err || new Error('云函数调用失败'))
    });
  });
}

async function generateContentsForOc(oc, count, beforeTime, batchForbidden) {
  const plotContext = buildSocialPlotContext(oc);
  const ocToday = getOcTodayPostContents(oc.id, beforeTime);
  const forbiddenContents = buildForbiddenForPrompt(30, 2200)
    .split('\n')
    .map((s) => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .concat(ocToday)
    .concat((batchForbidden || []).map((s) => String(s).trim()).filter(Boolean))
    .slice(0, 45);

  let posts = [];
  try {
    posts = await callGenerateCloud(
      buildMomentsCloudPayload(oc, count, { forbiddenContents })
    );
  } catch (e) {
    return pickFallbackMomentsForOc(oc, count, beforeTime, plotContext, forbiddenContents);
  }

  const mapped = posts
    .map((p) => ({
      content: String((p && p.content) || '').trim(),
      avatarUrl: oc.avatarUrl || ''
    }))
    .filter((p) => p.content);

  const out = [];
  const usedInBatch = forbiddenContents.slice();
  mapped.forEach((p) => {
    if (!validateMomentContent(p.content, usedInBatch)) return;
    if (claimContent(p.content)) {
      out.push(p);
      usedInBatch.push(p.content);
      return;
    }
    const fbList = pickFallbackMomentsForOc(oc, 1, beforeTime, plotContext, usedInBatch);
    if (fbList.length && fbList[0].content) {
      out.push(fbList[0]);
      usedInBatch.push(fbList[0].content);
    }
  });

  if (out.length < count) {
    const need = count - out.length;
    const extra = pickFallbackMomentsForOc(oc, need, beforeTime, plotContext, usedInBatch);
    extra.forEach((p) => {
      if (out.length >= count) return;
      if (p && p.content) out.push(p);
    });
  }
  return out.slice(0, count);
}

function pickFallbackMomentsForOc(oc, count, beforeTime, plotContext, forbiddenList) {
  const n = Math.max(1, Number(count) || 1);
  const forbidden = forbiddenList || [];
  const out = [];
  const seen = forbidden.slice();
  for (let i = 0; i < n + 3; i++) {
    if (out.length >= n) break;
    const fbList = fallbackMomentPosts(oc, 1, beforeTime, plotContext);
    for (let j = 0; j < fbList.length; j++) {
      const c = String(fbList[j].content || '').trim();
      if (!c || !validateMomentContent(c, seen)) continue;
      if (!claimContent(c)) continue;
      out.push({ content: c, avatarUrl: oc.avatarUrl || '' });
      seen.push(c);
      break;
    }
  }
  return out;
}

async function generateAllOcsMomentsInterleaved(beforeTime, lastOpenTime) {
  const planEntries = planOcsForMomentsGeneration(getEligibleOcs(), beforeTime);
  if (!planEntries.length) return [];

  const plan = buildAllOcPlan(planEntries);
  const groups = [];
  const batchForbidden = [];

  for (let i = 0; i < plan.length; i++) {
    const { oc, count } = plan[i];
    let items = [];
    try {
      items = await generateContentsForOc(oc, count, beforeTime, batchForbidden);
    } catch (err) {
      console.warn('[ocMomentsGen]', oc.id, err);
    }
    if (!items.length) {
      const plotContext = buildSocialPlotContext(oc);
      items = fallbackMomentPosts(oc, count, beforeTime, plotContext).map((p) => ({
        content: p.content,
        avatarUrl: oc.avatarUrl || ''
      }));
      items = items.filter((p) => {
        if (!p.content) return false;
        if (!claimContent(p.content)) return false;
        return true;
      });
    }
    items.forEach((p) => {
      if (p && p.content) batchForbidden.push(p.content);
    });
    groups.push({ oc, items });
  }

  const interleaved = interleaveOcItems(groups);
  const stamped = assignMomentsCalendarTimestamps(interleaved, beforeTime);

  return stamped.map((item) => ({
    id: newPostId(),
    ocId: item.oc.id,
    ocName: item.oc.name,
    avatarUrl: item.avatarUrl || item.oc.avatarUrl || '',
    content: item.content,
    createdAt: item.createdAt,
    authorType: 'oc',
    source: 'ai_open'
  }));
}

function seedFallbackAllOcsInterleaved(beforeTime, lastOpenTime) {
  const planEntries = planOcsForMomentsGeneration(getEligibleOcs(), beforeTime);
  if (!planEntries.length) return [];
  const plan = buildAllOcPlan(planEntries);
  const groups = plan.map(({ oc, count }) => ({
    oc,
    items: pickFallbackMomentsForOc(
      oc,
      count,
      beforeTime,
      buildSocialPlotContext(oc),
      getOcTodayPostContents(oc.id, beforeTime)
    )
  }));
  const interleaved = interleaveOcItems(groups);
  const stamped = assignMomentsCalendarTimestamps(interleaved, beforeTime);
  return stamped.map((item) => ({
    id: newPostId(),
    ocId: item.oc.id,
    ocName: item.oc.name,
    avatarUrl: item.avatarUrl || item.oc.avatarUrl || '',
    content: item.content,
    createdAt: item.createdAt,
    authorType: 'oc',
    source: 'fallback'
  }));
}

async function generateMomentsBatch(options) {
  const opts = options || {};
  const force = !!opts.force;
  const beforeTime = Number(opts.beforeTime || opts.openTime) || Date.now();
  const meta = getMeta();
  const now = Date.now();
  const feedEmpty = getMomentsFeed().length === 0;

  if (_running) return { skipped: true, reason: 'running' };

  if (!force && !feedEmpty && meta.lastGeneratedAt && now - meta.lastGeneratedAt < GENERATE_COOLDOWN_MS) {
    return { skipped: true, reason: 'cooldown' };
  }

  const eligible = getEligibleOcs();
  if (!eligible.length) {
    return { skipped: true, reason: 'no_oc' };
  }

  _running = true;
  setMeta({ generating: true });

  const lastOpen = meta.lastPageOpenAt || meta.lastAppOpenAt || beforeTime - 6 * 3600000;

  try {
    if (feedEmpty && opts.seedFallbackFirst) {
      const seeded = seedFallbackAllOcsInterleaved(beforeTime, lastOpen);
      const count = appendMomentsUnique(seeded);
      if (seeded.length) {
        try {
          await momentsComment.commentFromGroupMatesForPosts(seeded);
        } catch (e) {
          console.warn('[ocMomentsGen] group comments seed', e);
        }
      }
      setMeta({
        lastGeneratedAt: Date.now(),
        generating: false,
        lastAppOpenAt: opts.context === 'app' ? beforeTime : meta.lastAppOpenAt,
        lastPageOpenAt: opts.context === 'page' ? beforeTime : meta.lastPageOpenAt
      });
      return { ok: true, count, ocCount: eligible.length, seeded: true };
    }

    const generated = await generateAllOcsMomentsInterleaved(beforeTime, lastOpen);
    const count = appendMomentsUnique(generated);
    if (generated.length) {
      try {
        await momentsComment.commentFromGroupMatesForPosts(generated);
      } catch (e) {
        console.warn('[ocMomentsGen] group comments', e);
      }
    }
    setMeta({
      lastGeneratedAt: Date.now(),
      generating: false,
      lastAppOpenAt: opts.context === 'app' ? beforeTime : meta.lastAppOpenAt,
      lastPageOpenAt: opts.context === 'page' ? beforeTime : meta.lastPageOpenAt
    });
    return { ok: true, count, ocCount: eligible.length };
  } catch (err) {
    setMeta({ generating: false });
    return { ok: false, errMsg: (err && err.message) || '生成失败' };
  } finally {
    _running = false;
  }
}

async function maybeGenerateMomentsOnAppOpen(options) {
  return generateMomentsBatch(
    Object.assign({}, options || {}, { context: 'app', seedFallbackFirst: getMomentsFeed().length === 0 })
  );
}

async function ensureMomentsForPageOpen(beforeTime) {
  const eligible = getEligibleOcs();
  if (!eligible.length) {
    return { skipped: true, reason: 'no_oc' };
  }

  beginDedupeSession();
  try {
    const feedEmpty = getMomentsFeed().length === 0;
    const lastOpen = getMeta().lastPageOpenAt || getMeta().lastAppOpenAt || beforeTime - 6 * 3600000;

    if (feedEmpty) {
      const seeded = seedFallbackAllOcsInterleaved(beforeTime, lastOpen);
      appendMomentsUnique(seeded);
      if (seeded.length) {
        try {
          await momentsComment.commentFromGroupMatesForPosts(seeded);
        } catch (e) {
          console.warn('[ocMomentsGen] group comments page seed', e);
        }
      }
    }

    return await generateMomentsBatch({
      beforeTime,
      context: 'page',
      force: true,
      seedFallbackFirst: false
    });
  } finally {
    endDedupeSession();
  }
}

module.exports = {
  getEligibleOcs,
  maybeGenerateMomentsOnAppOpen,
  ensureMomentsForPageOpen,
  generateAllOcsMomentsInterleaved,
  seedFallbackAllOcsInterleaved
};
