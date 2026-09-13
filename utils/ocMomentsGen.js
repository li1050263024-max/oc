const { getOcsForSocial } = require('./ocSocialEligible.js');
const { buildMomentsCloudPayload } = require('./ocSocialContext.js');
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
const momentsQuota = require('./ocMomentsQuota.js');
const {
  beginDedupeSession,
  endDedupeSession,
  buildForbiddenForPrompt,
  claimContent,
  getActiveRegistry,
  normalizeForDedupe
} = require('./ocSocialDedupe.js');

function makeNeedAdError(msg) {
  const err = new Error(msg || 'need_ad');
  err.code = 'NEED_AD';
  return err;
}

function isNeedAdError(err) {
  return !!(err && (err.code === 'NEED_AD' || /need_ad|看广告/i.test(String(err.message || ''))));
}

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
  /今天在旧货市场|冷静点说|刚才又路过那家店|街角的灯还亮着|买了杯热的站|脑子里又闪过|今日状态：|心情记录：|路过，发一条|随手记一笔|又是普通的一天|突然想说句|随便发发/i;

const MOMENT_STYLE_ANGLES = [
  '短句碎念：两三个短句，像随手打字，不要排比',
  '只写一个具体物件或细节，少抒情',
  '吐槽小事，带一点角色特有的刺/懒/傲',
  '半句没说完的余韵，结尾可留白',
  '时间感：刚发生/等会儿/夜里，但不要写「今天」开头',
  '只报情绪不做事件复盘，避免「路过某店」套路',
  '像对熟人嘀咕一句，不要正式作文',
  '反差：表面平静，末尾带一点人设刺点',
  '感官优先：味道/光线/声音之一，忌空喊心情',
  '极简：尽量不超过 28 字，信息密度高'
];

function pickMomentStyleAngle(usedAngles) {
  const used = usedAngles || [];
  const pool = MOMENT_STYLE_ANGLES.filter((s) => used.indexOf(s) < 0);
  const list = pool.length ? pool : MOMENT_STYLE_ANGLES;
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeMomentText(text) {
  return String(text || '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function charBigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function bigramOverlapRatio(a, b) {
  const x = charBigrams(a);
  const y = charBigrams(b);
  if (!x.length || !y.length) return 0;
  const setY = {};
  y.forEach((g) => {
    setY[g] = true;
  });
  let hit = 0;
  x.forEach((g) => {
    if (setY[g]) hit += 1;
  });
  return hit / Math.min(x.length, y.length);
}

function isMomentTooSimilar(a, b) {
  const x = normalizeMomentText(a);
  const y = normalizeMomentText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.slice(0, 8) === y.slice(0, 8)) return true;
  if (x.length >= 14 && y.length >= 14 && x.slice(0, 14) === y.slice(0, 14)) return true;
  if (x.length >= 12 && y.length >= 12 && bigramOverlapRatio(x, y) >= 0.58) return true;
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
  const socialWatch = require('./ocSocialWatch.js');
  try {
    socialWatch.syncWatchWithBioOcs('moments');
  } catch (_) {}
  const list = getOcsForSocial().filter((oc) => oc && oc.hasBio);
  return socialWatch.filterOcsByWatch('moments', list);
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

async function generateOneMomentForOc(oc, beforeTime, usedInBatch, albumHint, usedAngles) {
  const forbiddenContents = (usedInBatch || []).slice(0, 45);
  const quota = momentsQuota.tryConsumeCall(beforeTime);
  if (!quota.ok) {
    throw makeNeedAdError(quota.errMsg);
  }
  const anglesTried = [];
  let lastContent = '';
  // 同一次额度内最多试 2 次：换文风槽位，避免句式撞车
  for (let attempt = 0; attempt < 2; attempt++) {
    const styleAngle = pickMomentStyleAngle((usedAngles || []).concat(anglesTried));
    anglesTried.push(styleAngle);
    let posts = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      posts = await callGenerateCloud(
        buildMomentsCloudPayload(oc, 1, {
          forbiddenContents: forbiddenContents.concat(lastContent ? [lastContent] : []),
          albumHint: albumHint || '',
          styleAngle: styleAngle
        })
      );
    } catch (err) {
      if (attempt === 0) continue;
      momentsQuota.refundCall(beforeTime);
      if (isNeedAdError(err)) throw err;
      console.warn('[ocMomentsGen] cloud fail', oc && oc.id, err);
      return null;
    }
    const content = String((posts[0] && posts[0].content) || '').trim();
    lastContent = content;
    if (
      content &&
      validateMomentContent(content, forbiddenContents) &&
      claimContent(content)
    ) {
      if (usedAngles && usedAngles.indexOf(styleAngle) < 0) usedAngles.push(styleAngle);
      return { content: content, avatarUrl: oc.avatarUrl || '' };
    }
  }
  // 仅走 AI：失败则跳过该条，不用本地模板兜底
  momentsQuota.refundCall(beforeTime);
  return null;
}

/**
 * 逐条生成：高概率先选图册再写文案（贴合描述），否则纯文字
 */
async function generateContentsForOc(oc, count, beforeTime, batchForbidden) {
  const albumMatch = require('./ocAlbumMatch.js');
  const n = Math.max(1, Number(count) || 1);
  const ocToday = getOcTodayPostContents(oc.id, beforeTime);
  const usedInBatch = buildForbiddenForPrompt(30, 2200)
    .split('\n')
    .map((s) => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .concat(ocToday)
    .concat((batchForbidden || []).map((s) => String(s).trim()).filter(Boolean))
    .slice(0, 45);

  const out = [];
  const usedAngles = [];
  for (let i = 0; i < n; i++) {
    let albumHint = '';
    let imgMeta = {
      withImage: false,
      images: [],
      albumId: '',
      albumName: '',
      albumDescription: ''
    };
    // 先掷骰：要配图则先选图册，再带描述生成文案
    const albumsReady = albumMatch.albumsWithImages((oc && oc.work) || {});
    const wantImage =
      albumsReady.length > 0 && Math.random() < albumMatch.MOMENTS_IMAGE_PROB;
    if (wantImage) {
      const album = albumMatch.pickAlbumForQuery(
        albumsReady,
        usedInBatch.slice(-5).join(' ')
      );
      if (album) {
        const slice = albumMatch.pickImageSlice(
          album,
          albumMatch.MOMENTS_IMAGES_MIN,
          albumMatch.MOMENTS_IMAGES_MAX
        );
        // eslint-disable-next-line no-await-in-loop
        const images = await albumMatch.resolveImages(oc.id, slice, { light: true });
        if (images.length) {
          imgMeta = {
            withImage: true,
            images: images,
            albumId: album.id || '',
            albumName: album.name || '',
            albumDescription: String(album.description || '').trim()
          };
          albumHint = albumMatch.formatAlbumHint(album.name, album.description);
        }
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const post = await generateOneMomentForOc(
      oc,
      beforeTime,
      usedInBatch,
      albumHint,
      usedAngles
    );
    if (!post || !post.content) continue;
    usedInBatch.push(post.content);
    // 掷中要图但预选失败：正文出来后按相关性补配图
    if (!imgMeta.withImage && wantImage && albumsReady.length) {
      const album = albumMatch.pickAlbumForQuery(albumsReady, post.content);
      if (album) {
        const slice = albumMatch.pickImageSlice(
          album,
          albumMatch.MOMENTS_IMAGES_MIN,
          albumMatch.MOMENTS_IMAGES_MAX
        );
        // eslint-disable-next-line no-await-in-loop
        const images = await albumMatch.resolveImages(oc.id, slice, { light: true });
        if (images.length) {
          imgMeta = {
            withImage: true,
            images: images,
            albumId: album.id || '',
            albumName: album.name || '',
            albumDescription: String(album.description || '').trim()
          };
        }
      }
    } else if (imgMeta.withImage && post.content) {
      // 有正文后若原图册不相关，可换更相关的图册（仍保证有图）
      const albums = albumMatch.albumsWithImages((oc && oc.work) || {});
      const better = albumMatch.pickAlbumForQuery(albums, post.content);
      if (
        better &&
        better.id &&
        imgMeta.albumId &&
        better.id !== imgMeta.albumId &&
        albumMatch.scoreAlbumRelevance(post.content, better) >
          albumMatch.scoreAlbumRelevance(post.content, {
            name: imgMeta.albumName,
            description: imgMeta.albumDescription
          })
      ) {
        const slice = albumMatch.pickImageSlice(
          better,
          albumMatch.MOMENTS_IMAGES_MIN,
          albumMatch.MOMENTS_IMAGES_MAX
        );
        // eslint-disable-next-line no-await-in-loop
        const images = await albumMatch.resolveImages(oc.id, slice, { light: true });
        if (images.length) {
          imgMeta = {
            withImage: true,
            images: images,
            albumId: better.id || '',
            albumName: better.name || '',
            albumDescription: String(better.description || '').trim()
          };
        }
      }
    }
    out.push({
      content: post.content,
      avatarUrl: post.avatarUrl || oc.avatarUrl || '',
      images: imgMeta.images || [],
      albumId: imgMeta.albumId || '',
      albumName: imgMeta.albumName || ''
    });
  }
  return out;
}

async function generateAllOcsMomentsInterleaved(beforeTime, lastOpenTime) {
  const planEntries = planOcsForMomentsGeneration(getEligibleOcs(), beforeTime);
  if (!planEntries.length) return { posts: [], needAd: false };

  const plan = buildAllOcPlan(planEntries);
  const groups = [];
  const batchForbidden = [];
  let needAd = false;

  for (let i = 0; i < plan.length; i++) {
    const { oc, count } = plan[i];
    let items = [];
    try {
      items = await generateContentsForOc(oc, count, beforeTime, batchForbidden);
    } catch (err) {
      if (isNeedAdError(err)) {
        needAd = true;
        break;
      }
      console.warn('[ocMomentsGen]', oc && oc.id, err);
    }
    items.forEach((p) => {
      if (p && p.content) batchForbidden.push(p.content);
    });
    if (items.length) groups.push({ oc, items });
  }

  const interleaved = interleaveOcItems(groups);
  const stamped = assignMomentsCalendarTimestamps(interleaved, beforeTime);

  const posts = stamped.map((item) => ({
    id: newPostId(),
    ocId: item.oc.id,
    ocName: item.oc.name,
    avatarUrl: item.avatarUrl || item.oc.avatarUrl || '',
    content: item.content,
    images: Array.isArray(item.images) ? item.images : [],
    albumId: item.albumId || '',
    albumName: item.albumName || '',
    createdAt: item.createdAt,
    authorType: 'oc',
    source: 'ai_open'
  }));
  return { posts: posts, needAd: needAd };
}

async function generateMomentsBatch(options) {
  const opts = options || {};
  const force = !!opts.force;
  const beforeTime = Number(opts.beforeTime || opts.openTime) || Date.now();
  const meta = getMeta();
  const now = Date.now();
  const feedEmpty = getMomentsFeed().length === 0;

  // 防止上次异常卡住
  if (_running && meta.generating && meta.lastGeneratedAt && now - meta.lastGeneratedAt > 3 * 60 * 1000) {
    _running = false;
    setMeta({ generating: false });
  }
  if (_running) return { skipped: true, reason: 'running' };

  if (!force && !feedEmpty && meta.lastGeneratedAt && now - meta.lastGeneratedAt < GENERATE_COOLDOWN_MS) {
    return { skipped: true, reason: 'cooldown' };
  }

  const eligible = getEligibleOcs();
  if (!eligible.length) {
    return { skipped: true, reason: 'no_oc' };
  }

  const quotaInfo = momentsQuota.getQuotaInfo(beforeTime);
  if (quotaInfo.needAd) {
    if (typeof momentsQuota.ensureMemberAdBypass === 'function') {
      momentsQuota.ensureMemberAdBypass(beforeTime);
    }
    const afterBypass = momentsQuota.getQuotaInfo(beforeTime);
    if (afterBypass.needAd) {
      return {
        ok: false,
        needAd: true,
        quota: afterBypass,
        errMsg: '今日朋友圈 AI 已达上限，看广告可解锁更多'
      };
    }
  }

  _running = true;
  setMeta({ generating: true });

  try {
    const result = await generateAllOcsMomentsInterleaved(beforeTime);
    const generated = (result && result.posts) || [];
    const needAd = !!(result && result.needAd);
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
    return {
      ok: true,
      count: count,
      ocCount: eligible.length,
      needAd: needAd,
      quota: momentsQuota.getQuotaInfo(beforeTime),
      creditSpent: 0
    };
  } catch (err) {
    setMeta({ generating: false });
    if (isNeedAdError(err)) {
      return {
        ok: false,
        needAd: true,
        quota: momentsQuota.getQuotaInfo(beforeTime),
        errMsg: err.message || '需看广告解锁'
      };
    }
    return { ok: false, errMsg: (err && err.message) || '生成失败' };
  } finally {
    _running = false;
  }
}

async function maybeGenerateMomentsOnAppOpen(options) {
  return generateMomentsBatch(Object.assign({}, options || {}, { context: 'app' }));
}

async function ensureMomentsForPageOpen(beforeTime) {
  const eligible = getEligibleOcs();
  if (!eligible.length) {
    return { skipped: true, reason: 'no_oc' };
  }

  beginDedupeSession();
  try {
    return await generateMomentsBatch({
      beforeTime,
      context: 'page',
      force: true
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
  generateMomentsBatch
};
