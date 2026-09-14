const ocAlbum = require('./ocAlbum.js');
const ocImage = require('./ocImage.js');
const { getOcsWithBio, getOcsForSocial } = require('./ocSocialEligible.js');
const { buildOcPromptFromWork } = require('./ocContext.js');
const { buildSocialPlotContext } = require('./ocSocialContext.js');
const { pickTopicForOc, formatTopicForPrompt, localDateKey } = require('./ocDouyinTopics.js');
const {
  getMeta,
  setMeta,
  getStoredFeed,
  getFeed,
  saveFeed,
  seedEngagement,
  ensureClipEngagement,
  newClipId
} = require('./ocDouyinStore.js');
const albumMatch = require('./ocAlbumMatch.js');
const douyinCaption = require('./ocDouyinCaption.js');
const douyinQuota = require('./ocDouyinQuota.js');

const GENERATE_COOLDOWN_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** 同一 OC 当天第 2 条与上一条的最小间隔（约 6～12 小时） */
const SECOND_POST_GAP_MIN_MS = 6 * HOUR_MS;
const SECOND_POST_GAP_SPAN_MS = 6 * HOUR_MS;
const MIN_IMAGES_PER_CLIP = albumMatch.DOUYIN_IMAGES_MIN || 3;
const MAX_IMAGES_PER_CLIP = albumMatch.DOUYIN_IMAGES_MAX || 5;
const MAX_CAPTION_PER_RUN = 10;
const MAX_NEW_POSTS_PER_RUN = 8;
let _running = false;

function hashOcId(ocId) {
  return Math.abs(
    String(ocId || '')
      .split('')
      .reduce((a, c) => a + c.charCodeAt(0), 0)
  );
}

/** 每个 OC 每天发 1 或 2 条（稳定按 id 分流） */
function ocDailyPostCap(ocId) {
  return 1 + (hashOcId(ocId) % 2);
}

function getOcLastPostAt(feed, ocId) {
  let max = 0;
  (feed || []).forEach((c) => {
    if (!c || String(c.ocId) !== String(ocId)) return;
    max = Math.max(max, Number(c.createdAt) || 0);
  });
  return max;
}

function countOcPostsOnDay(feed, ocId, now) {
  const key = localDateKey(now);
  let n = 0;
  (feed || []).forEach((c) => {
    if (!c || String(c.ocId) !== String(ocId)) return;
    // 图册更新补发不占每日 1～2 条名额
    if (c.fromAlbumUpdate) return;
    if (localDateKey(Number(c.createdAt) || 0) === key) n += 1;
  });
  return n;
}

/** 是否还可再发：每天 1～2 条；第 2 条需与上一条间隔数小时 */
function isOcDueToPost(feed, ocId, now, force) {
  const cap = ocDailyPostCap(ocId);
  const today = countOcPostsOnDay(feed, ocId, now);
  if (today >= cap) return false;
  if (force) return true;
  if (today === 0) return true;
  const lastAt = getOcLastPostAt(feed, ocId);
  if (!lastAt) return true;
  const gap =
    SECOND_POST_GAP_MIN_MS + (hashOcId(ocId) % (SECOND_POST_GAP_SPAN_MS + 1));
  return now - lastAt >= gap;
}

function pickPlanForOc(plans, feed, ocId) {
  const list = (plans || []).filter((p) => p && String(p.ocId) === String(ocId));
  if (!list.length) return null;
  const last = (feed || []).find((c) => c && String(c.ocId) === String(ocId));
  const lastAlbum = last && last.albumId ? String(last.albumId) : '';
  const rotated = list.find((p) => String(p.albumId) !== lastAlbum) || list[0];
  return rotated;
}

/** 合并信息流与台账，判断图册是否相对已发内容有更新 */
function getAlbumPostSnapshot(ocId, albumId, feed) {
  const oid = String(ocId || '');
  const aid = String(albumId || '');
  let lastPostAt = 0;
  const postedImg = {};
  (feed || []).forEach((c) => {
    if (!c || String(c.ocId) !== oid || String(c.albumId || '') !== aid) return;
    lastPostAt = Math.max(lastPostAt, Number(c.createdAt) || 0);
    (c.images || []).forEach((im) => {
      const id = String((im && im.id) || '');
      if (id) postedImg[id] = true;
    });
    if (c.imageId) postedImg[String(c.imageId)] = true;
  });
  try {
    const store = require('./ocDouyinStore.js');
    if (typeof store.getAlbumLedgerEntry === 'function') {
      const led = store.getAlbumLedgerEntry(oid, aid);
      if (led) {
        lastPostAt = Math.max(lastPostAt, Number(led.at) || 0);
        (led.ids || []).forEach((id) => {
          if (id) postedImg[String(id)] = true;
        });
      }
    }
  } catch (_) {}
  return { lastPostAt: lastPostAt, postedImg: postedImg };
}

/**
 * 图册更新：该 OC 已有发帖但此册未发过，或已发过但有新图/更新时间。
 * 全新 OC 的首刷走每日节奏，不走「更新必发」。
 */
function isAlbumNewOrUpdated(plan, feed) {
  if (!plan) return false;
  const oid = String(plan.ocId || '');
  const aid = String(plan.albumId || '');
  if (!oid || !aid) return false;
  const ocHasAnyPost = (feed || []).some((c) => c && String(c.ocId) === oid);
  let ledgerHasOc = false;
  try {
    const store = require('./ocDouyinStore.js');
    if (typeof store.ocHasAlbumLedger === 'function') {
      ledgerHasOc = store.ocHasAlbumLedger(oid);
    }
  } catch (_) {}
  if (!ocHasAnyPost && !ledgerHasOc) return false;

  const snap = getAlbumPostSnapshot(oid, aid, feed);
  if (!snap.lastPostAt) return true;
  if ((Number(plan.latestTime) || 0) > snap.lastPostAt) return true;
  const imgs = plan.images || [];
  for (let i = 0; i < imgs.length; i++) {
    const id = String((imgs[i] && imgs[i].id) || '');
    if (id && !snap.postedImg[id]) return true;
  }
  return false;
}

function listUpdatedAlbumPlans(plans, feed, ocId) {
  return (plans || [])
    .filter(
      (p) =>
        p &&
        String(p.ocId) === String(ocId) &&
        isAlbumNewOrUpdated(p, feed)
    )
    .sort((a, b) => (Number(b.latestTime) || 0) - (Number(a.latestTime) || 0));
}

const FALLBACK_CAPTIONS = [
  '随手拍一张，心情还行。',
  '今天的光还可以。',
  '不出门也能营业一下。',
  '就发这张。',
  '状态一般，图先放着。'
];

function captionKey(text) {
  return douyinCaption.normalizeCaptionKey
    ? douyinCaption.normalizeCaptionKey(text)
    : String(text || '')
        .replace(/\s+/g, '')
        .slice(0, 40);
}

function collectFeedCaptionKeys(feed) {
  const keys = {};
  (feed || []).forEach((c) => {
    const k = captionKey(c && c.content);
    if (k) keys[k] = true;
  });
  return keys;
}

function albumClipId(ocId, albumId) {
  return 'dyalb_' + String(ocId || '') + '_' + String(albumId || '');
}

async function resolveAlbumImagePath(ocId, img, opts) {
  if (!img) return '';
  const options = opts || {};
  const raw = String(img.path || '').trim();
  // 轻量模式：有路径就先用，进页时不做全量磁盘探测（避免模拟器卡死）
  if (options.light && raw) return raw;
  if (raw) {
    const ok = await ocImage.resolveLocalImagePath(raw);
    if (ok) return ok;
  }
  const imageId = String(img.id || '').trim();
  if (ocId && imageId) {
    // 优先原扩展名，再试常见扩展；命中即停
    const prefer = ocImage.extractImageExt(raw) || 'jpg';
    const exts = [prefer, 'jpg', 'jpeg', 'png', 'webp'].filter(
      (e, idx, arr) => e && arr.indexOf(e) === idx
    );
    for (let i = 0; i < exts.length; i++) {
      const rebuilt = ocImage.getOcImageListPath(ocId, imageId, exts[i]);
      // eslint-disable-next-line no-await-in-loop
      const ok2 = await ocImage.resolveLocalImagePath(rebuilt);
      if (ok2) return ok2;
    }
    try {
      const found = await ocImage.findUserImageByIdToken(ocId, imageId);
      if (found) return found;
    } catch (_) {}
  }
  // 校验失败仍保留原路径，避免整册被滤成只剩 1 张
  return raw;
}

/**
 * 收集某 OC 下每个「有图图册」→ 一条抖音素材（每条随机 3～5 张，图不够则有几张取几张）
 */
async function collectAlbumClipsForOc(oc, opts) {
  if (!oc || !oc.work) return [];
  const options = opts || {};
  const work = ocAlbum.syncWorkImagesFromAlbums(Object.assign({}, oc.work));
  let albums = ocAlbum.normalizeOcAlbums(work);
  // 按话题/查询与图册描述相关性排序（高相关靠前）
  if (options.relevanceQuery) {
    albums = albumMatch.sortAlbumsByRelevance(albums, options.relevanceQuery);
  }
  const out = [];
  for (let a = 0; a < albums.length; a++) {
    const alb = albums[a];
    const rawImgs = ((alb && alb.images) || []).slice();
    if (!rawImgs.length) continue;
    // 最新在前
    rawImgs.sort((x, y) => (Number(y.time) || 0) - (Number(x.time) || 0));
    const wantCount = Math.min(
      rawImgs.length,
      MIN_IMAGES_PER_CLIP +
        Math.floor(
          Math.random() * (MAX_IMAGES_PER_CLIP - MIN_IMAGES_PER_CLIP + 1)
        )
    );
    const images = [];
    for (let i = 0; i < rawImgs.length && images.length < wantCount; i++) {
      const img = rawImgs[i];
      // eslint-disable-next-line no-await-in-loop
      const imagePath = await resolveAlbumImagePath(oc.id, img, options);
      if (!imagePath) continue;
      // 真机偶发 sync-0 / 文件未就绪：有路径就先纳入，勿因 fileExists 失败整册被滤空
      if (!options.light) {
        // eslint-disable-next-line no-await-in-loop
        const alive = await ocImage.fileExists(imagePath);
        if (!alive && !imagePath) continue;
      }
      images.push({
        id: String(img.id || img.path || ''),
        path: imagePath,
        time: Number(img.time) || 0
      });
    }
    if (!images.length) continue;
    out.push({
      ocId: oc.id,
      ocName: oc.name || 'OC',
      avatarUrl: oc.avatarUrl || '',
      albumId: alb.id,
      albumName: alb.name || '',
      albumDescription: String(alb.description || '').trim(),
      images: images,
      imagePath: images[0].path,
      imageId: images[0].id,
      latestTime: images[0].time || 0,
      relevanceScore: albumMatch.scoreAlbumRelevance(
        options.relevanceQuery || '',
        alb
      )
    });
  }
  return out;
}

async function collectAllAlbumPlans(opts) {
  // 抖音：有小传优先；若小传 OC 不够，仍把「有图」的社交 OC 算进来，避免只出一条
  const socialWatch = require('./ocSocialWatch.js');
  try {
    socialWatch.syncWatchWithBioOcs('douyin');
  } catch (_) {}
  const withBio = getOcsWithBio().filter((oc) => oc && oc.id);
  const bioIds = {};
  withBio.forEach((oc) => {
    bioIds[oc.id] = true;
  });
  const extras = getOcsForSocial().filter((oc) => oc && oc.id && !bioIds[oc.id]);
  const ocs = socialWatch.filterOcsByWatch('douyin', withBio.concat(extras));
  const dateKey = localDateKey(Date.now());
  const plans = [];
  for (let i = 0; i < ocs.length; i++) {
    const oc = ocs[i];
    const topic = pickTopicForOc(oc, dateKey + '_' + (oc && oc.id));
    const relevanceQuery =
      (opts && opts.relevanceQuery) ||
      formatTopicForPrompt(topic) +
        ' ' +
        ((topic && topic.tags) || []).join(' ');
    // eslint-disable-next-line no-await-in-loop
    const clips = await collectAlbumClipsForOc(
      oc,
      Object.assign({}, opts || {}, { relevanceQuery: relevanceQuery })
    );
    clips.forEach((c) => plans.push({ oc: oc, plan: c, topic: topic }));
  }
  // 相关分优先，其次最新图时间
  plans.sort((a, b) => {
    const sa = Number((a.plan && a.plan.relevanceScore) || 0);
    const sb = Number((b.plan && b.plan.relevanceScore) || 0);
    if (sb !== sa) return sb - sa;
    const ta = a.plan.latestTime || 0;
    const tb = b.plan.latestTime || 0;
    if (tb !== ta) return tb - ta;
    const ocCmp = String(a.plan.ocId).localeCompare(String(b.plan.ocId));
    if (ocCmp) return ocCmp;
    return String(a.plan.albumId || '').localeCompare(String(b.plan.albumId || ''));
  });

  // 封面图去重：同一 imageId / 路径只保留时间最新的一条，避免刷出重复抖音
  const seenImg = {};
  const seenPath = {};
  const deduped = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i] && plans[i].plan;
    if (!plan) continue;
    const imgId = String(plan.imageId || '').trim();
    const imgPath = String(plan.imagePath || '').trim().toLowerCase();
    if (imgId && seenImg[imgId]) continue;
    if (imgPath && seenPath[imgPath]) continue;
    if (imgId) seenImg[imgId] = true;
    if (imgPath) seenPath[imgPath] = true;
    // 同一图册内后续图也占用，减少「换册同图」
    (plan.images || []).forEach((im) => {
      const id2 = String((im && im.id) || '').trim();
      const p2 = String((im && im.path) || '').trim().toLowerCase();
      if (id2) seenImg[id2] = true;
      if (p2) seenPath[p2] = true;
    });
    deduped.push(plans[i]);
  }
  return deduped;
}

function pickFallbackCaption(oc, topic, avoidList) {
  if (typeof douyinCaption.pickLocalHotCaption === 'function') {
    try {
      return douyinCaption.pickLocalHotCaption(oc, topic, avoidList || []);
    } catch (_) {}
  }
  const base =
    FALLBACK_CAPTIONS[Math.floor(Math.random() * FALLBACK_CAPTIONS.length)] ||
    FALLBACK_CAPTIONS[0];
  const tags = (topic && topic.tags) || ['日常'];
  return {
    content: String(base).slice(0, 120),
    tags: tags.slice(0, 3)
  };
}

function callDouyinCloud(payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('no cloud'));
      return;
    }
    // 缩短超时：进页绝不依赖云函数；失败快速走本地兜底
    wx.cloud.callFunction({
      name: 'generateOcMoments',
      data: Object.assign({ mode: 'douyin' }, payload || {}),
      timeout: 8000,
      success: (res) => {
        const r = (res && res.result) || {};
        if (r.ok && Array.isArray(r.posts) && r.posts.length) {
          resolve(r.posts);
          return;
        }
        if (r.ok && r.content) {
          resolve([{ content: r.content, tags: r.tags || [] }]);
          return;
        }
        reject(new Error(r.errMsg || '生成失败'));
      },
      fail: (err) => {
        // 不把 timeout 原样抛给上层刷屏；统一成可吞掉的轻量错误
        const msg =
          (err && (err.errMsg || err.message)) || '云函数调用失败';
        const soft = new Error(/timeout/i.test(msg) ? 'caption_timeout' : msg);
        soft.soft = true;
        reject(soft);
      }
    });
  });
}

async function generateCaptionForClip(oc, topic, albumName, albumDescription, salt, avoidList) {
  const setting = buildOcPromptFromWork(oc.work).slice(0, 2800);
  const bio = String(oc.bioText || (oc.work && oc.work.generatedBio) || '').slice(0, 1200);
  const plot = buildSocialPlotContext(oc, { channel: 'douyin' }).slice(0, 1600);
  const albumHint = albumMatch.formatAlbumHint(albumName, albumDescription);
  const brief = douyinCaption.pickCaptionBrief(oc, salt || '');
  const fallbackTopic = brief.topic || topic;
  const avoidCaptions = (brief.avoidCaptions || []).concat(avoidList || []).slice(0, 28);
  try {
    const posts = await callDouyinCloud({
      ocName: oc.name || 'OC',
      ocSetting: setting,
      ocBio: bio,
      chatSummary: plot,
      captionMode: brief.captionMode,
      topicHint: brief.topicHint,
      moodHint: brief.moodHint,
      styleHint: brief.styleHint,
      styleExamples: brief.styleExamples || [],
      avoidCaptions: avoidCaptions,
      albumHint: albumHint,
      postCount: 1
    });
    const first = posts[0] || {};
    const content = String(first.content || first.caption || '').trim();
    let tags = Array.isArray(first.tags) ? first.tags : brief.tags || [];
    tags = tags
      .map((t) => String(t || '').replace(/^#/, '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const key = captionKey(content);
    const avoidKeys = {};
    avoidCaptions.forEach((t) => {
      const k = captionKey(t);
      if (k) avoidKeys[k] = true;
    });
    if (!content || content.length < 4 || (key && avoidKeys[key])) {
      const fb = pickFallbackCaption(oc, fallbackTopic, avoidCaptions);
      return Object.assign({}, fb, { fromCloud: false });
    }
    return {
      content: content.slice(0, 120),
      tags: tags.length ? tags : brief.tags || (fallbackTopic && fallbackTopic.tags) || [],
      fromCloud: true
    };
  } catch (_) {
    const fb = pickFallbackCaption(oc, fallbackTopic, avoidCaptions);
    return Object.assign({}, fb, { fromCloud: false });
  }
}

function indexOldFeed() {
  const map = {};
  getStoredFeed().forEach((c) => {
    if (!c || !c.id) return;
    map[c.id] = c;
  });
  return map;
}

function saveFeedCapped(list) {
  // saveFeed 内已按非会员 10 / 会员 50 截断并写入图册台账
  return saveFeed(list || []);
}

/**
 * 按节奏增量发帖：每个 OC 每天 1～2 条，保留历史信息流
 */
async function generateDouyinBatch(options) {
  const opts = options || {};
  const force = !!opts.force;
  if (_running) return { ok: false, skipped: true, reason: 'busy' };
  const meta = getMeta();
  const now = Date.now();
  let feed = getStoredFeed().map(ensureClipEngagement);

  const allPlans = await collectAllAlbumPlans(opts);
  if (!allPlans.length && !feed.length) {
    return { ok: false, reason: 'no_images' };
  }

  // 按 OC 聚合素材（冷却判断也要用：有图册更新则跳过冷却）
  const byOc = {};
  allPlans.forEach((row) => {
    if (!row || !row.plan || !row.oc) return;
    const oid = String(row.plan.ocId || row.oc.id || '');
    if (!oid) return;
    if (!byOc[oid]) byOc[oid] = { oc: row.oc, plans: [], topic: row.topic };
    byOc[oid].plans.push(row.plan);
  });
  const hasAlbumUpdate = Object.keys(byOc).some(
    (oid) => listUpdatedAlbumPlans(byOc[oid].plans, feed, oid).length > 0
  );

  if (
    !force &&
    !hasAlbumUpdate &&
    meta.lastGeneratedAt &&
    now - meta.lastGeneratedAt < GENERATE_COOLDOWN_MS &&
    feed.length
  ) {
    await syncAlbumImagesOnly(opts);
    return { ok: true, skipped: true, reason: 'cooldown', count: getFeed().length };
  }

  _running = true;
  setMeta({ generating: true });
  const dateKey = localDateKey(now);
  // 进页轻量同步默认不打云；仅显式 cloudCaption / force 且未关掉时走云端
  const useCloudCaption =
    opts.cloudCaption != null ? !!opts.cloudCaption : !!force;
  // 云端文案最多 2 条/次，其余本地兜底，避免连续 timeout
  let captionBudget = useCloudCaption ? 2 : 0;
  let needAd = false;
  if (useCloudCaption && douyinQuota.getQuotaInfo(now).needAd) {
    captionBudget = 0;
    needAd = true;
  }
  let claimContent = null;
  try {
    claimContent = require('./ocSocialDedupe.js').claimContent;
  } catch (_) {
    claimContent = null;
  }
  const usedContents = collectFeedCaptionKeys(feed);
  const avoidListLive = Object.keys(usedContents).length
    ? (feed || [])
        .map((c) => (c && c.content) || '')
        .filter(Boolean)
        .slice(0, 36)
    : [];
  const newClips = [];

  const pushClipFromPlan = async (pack, plan, fromAlbumUpdate) => {
    if (!pack || !plan) return false;
    const id = newClipId();
    const topic = pack.topic || pickTopicForOc(pack.oc, dateKey + '_' + id);
    let content = '';
    let tags = [];
    if (captionBudget > 0) {
      const quota = douyinQuota.tryConsumeCall(now);
      if (!quota.ok) {
        captionBudget = 0;
        needAd = true;
      } else {
        captionBudget -= 1;
        let cloudOk = false;
        try {
          const cap = await generateCaptionForClip(
            pack.oc,
            topic,
            plan.albumName,
            plan.albumDescription,
            dateKey + '_' + id,
            avoidListLive
          );
          content = cap.content;
          tags = cap.tags || [];
          cloudOk = !!(content && cap.fromCloud);
        } catch (_) {
          content = '';
          tags = [];
        }
        if (!cloudOk) {
          douyinQuota.refundCall(now);
        }
      }
    }
    if (!content) {
      const cap = pickFallbackCaption(pack.oc, topic, avoidListLive);
      content = cap.content;
      tags = cap.tags || [];
    }
    const contentKey = captionKey(content);
    if (contentKey && usedContents[contentKey]) {
      const cap = pickFallbackCaption(pack.oc, topic, avoidListLive);
      content =
        cap.content +
        (pack.oc.name ? ' ·' + String(pack.oc.name).slice(0, 4) : '');
      tags = cap.tags || tags;
    }
    if (typeof claimContent === 'function' && content) {
      try {
        claimContent(content);
      } catch (_) {}
    }
    if (contentKey) usedContents[contentKey] = true;
    if (content) avoidListLive.push(content);

    const eng = seedEngagement(id);
    newClips.push({
      id: id,
      ocId: plan.ocId,
      ocName: plan.ocName,
      avatarUrl: plan.avatarUrl,
      albumId: plan.albumId,
      albumName: plan.albumName,
      albumDescription: plan.albumDescription || '',
      images: plan.images,
      imagePath: plan.imagePath,
      imageId: plan.imageId,
      content: content,
      tags: tags,
      likeBase: eng.likeBase,
      commentBase: eng.commentBase,
      favBase: eng.favBase,
      createdAt: now - newClips.length * 1000,
      source: 'douyin',
      fromAlbumUpdate: !!fromAlbumUpdate,
      _captionFallback: !useCloudCaption
    });

    try {
      const store = require('./ocDouyinStore.js');
      if (typeof store.markOcImagesUsed === 'function') {
        store.markOcImagesUsed(
          plan.ocId,
          (plan.images || []).map((im) => im && im.id).filter(Boolean),
          dateKey
        );
      }
      if (typeof store.rememberAlbumPost === 'function') {
        store.rememberAlbumPost(
          plan.ocId,
          plan.albumId,
          (plan.images || []).map((im) => im && im.id).filter(Boolean),
          now
        );
      }
    } catch (_) {}
    return true;
  };

  try {
    // 今日还没发过的 OC 优先（新勾选的角色不会被旧 OC 占满名额）
    const ocIds = Object.keys(byOc).sort((a, b) => {
      const ca = countOcPostsOnDay(feed, a, now);
      const cb = countOcPostsOnDay(feed, b, now);
      if (ca !== cb) return ca - cb;
      return String(a).localeCompare(String(b));
    });
    const zeroPostCount = ocIds.filter(
      (id) => countOcPostsOnDay(feed, id, now) === 0
    ).length;
    const updatePlanCount = ocIds.reduce(
      (n, id) => n + listUpdatedAlbumPlans(byOc[id].plans, feed, id).length,
      0
    );
    const maxNew = force
      ? MAX_NEW_POSTS_PER_RUN
      : Math.min(
          MAX_NEW_POSTS_PER_RUN,
          Math.max(3, zeroPostCount || 3, updatePlanCount || 0)
        );

    // 第一轮：图册更新必发（无视今日已发条数），每册一条，3～5 张
    for (let i = 0; i < ocIds.length; i++) {
      if (newClips.length >= maxNew) break;
      const oid = ocIds[i];
      const pack = byOc[oid];
      const updated = listUpdatedAlbumPlans(
        pack.plans,
        feed.concat(newClips),
        oid
      );
      for (let u = 0; u < updated.length; u++) {
        if (newClips.length >= maxNew) break;
        // eslint-disable-next-line no-await-in-loop
        await pushClipFromPlan(pack, updated[u], true);
      }
    }

    // 第二轮：按天节奏 1～2 条
    for (let i = 0; i < ocIds.length; i++) {
      if (newClips.length >= maxNew) break;
      const oid = ocIds[i];
      const pack = byOc[oid];
      if (!isOcDueToPost(feed.concat(newClips), oid, now, force)) continue;

      const alreadyAlbumIds = {};
      newClips.forEach((c) => {
        if (c && String(c.ocId) === String(oid) && c.albumId) {
          alreadyAlbumIds[String(c.albumId)] = true;
        }
      });
      const plan =
        pickPlanForOc(
          (pack.plans || []).filter(
            (p) => p && !alreadyAlbumIds[String(p.albumId || '')]
          ),
          feed,
          oid
        ) || pickPlanForOc(pack.plans, feed, oid);
      if (!plan) continue;
      // eslint-disable-next-line no-await-in-loop
      await pushClipFromPlan(pack, plan, false);
    }

    // 旧数据：无帖但有素材时，把历史 album 条迁移保留；并升级互动数
    if (!feed.length && !newClips.length && allPlans.length) {
      // 兜底：每个 OC 先发 1 条，避免空信息流
      const seenOc = {};
      allPlans.forEach((row, idx) => {
        if (!row || !row.plan || !row.oc) return;
        const oid = String(row.plan.ocId);
        if (seenOc[oid]) return;
        seenOc[oid] = true;
        const plan = row.plan;
        const id = albumClipId(plan.ocId, plan.albumId);
        const eng = seedEngagement(id);
        const cap = pickFallbackCaption(
          row.oc,
          row.topic || { tags: ['日常'] },
          avoidListLive
        );
        if (cap.content) avoidListLive.push(cap.content);
        newClips.push({
          id: id,
          ocId: plan.ocId,
          ocName: plan.ocName,
          avatarUrl: plan.avatarUrl,
          albumId: plan.albumId,
          albumName: plan.albumName,
          albumDescription: plan.albumDescription || '',
          images: plan.images,
          imagePath: plan.imagePath,
          imageId: plan.imageId,
          content: cap.content,
          tags: cap.tags || ['日常'],
          likeBase: eng.likeBase,
          commentBase: eng.commentBase,
          favBase: eng.favBase,
          createdAt: now - idx * 3600000,
          source: 'douyin',
          _captionFallback: true
        });
        try {
          const store = require('./ocDouyinStore.js');
          if (typeof store.rememberAlbumPost === 'function') {
            store.rememberAlbumPost(
              plan.ocId,
              plan.albumId,
              (plan.images || []).map((im) => im && im.id).filter(Boolean),
              now - idx * 3600000
            );
          }
        } catch (_) {}
      });
    }

    if (newClips.length) {
      feed = newClips.concat(feed).map(ensureClipEngagement);
      saveFeedCapped(feed);
    } else if (feed.length) {
      saveFeedCapped(feed);
    }

    await syncAlbumImagesOnly(opts);
    return {
      ok: true,
      count: getFeed().length,
      added: newClips.length,
      needAd: needAd,
      errMsg: needAd
        ? '今日抖音 AI 次数已用完，看广告可解锁更多'
        : ''
    };
  } finally {
    _running = false;
    setMeta({ generating: false, lastPageOpenAt: now, lastGeneratedAt: now });
  }
}

/** 只刷新已有抖音条对应图册的图片，不重建整条信息流 */
async function syncAlbumImagesOnly(opts) {
  const feed = getStoredFeed();
  if (!feed.length) return;
  const plans = await collectAllAlbumPlans(opts || { light: true });
  const byKey = {};
  plans.forEach((row) => {
    const plan = row && row.plan;
    if (!plan) return;
    byKey[String(plan.ocId) + '\0' + String(plan.albumId)] = plan;
  });
  const next = feed.map((clip) => {
    const base = ensureClipEngagement(clip);
    if (!base || !base.albumId) return base;
    const plan = byKey[String(base.ocId) + '\0' + String(base.albumId)];
    if (!plan) return base;
    return Object.assign({}, base, {
      ocName: plan.ocName || base.ocName,
      avatarUrl: plan.avatarUrl || base.avatarUrl,
      albumName: plan.albumName || base.albumName,
      albumDescription: plan.albumDescription || base.albumDescription || '',
      images: plan.images,
      imagePath: plan.imagePath,
      imageId: plan.imageId
    });
  });
  saveFeedCapped(next);
}

let _lastPageSyncAt = 0;
const PAGE_SYNC_MIN_GAP_MS = 8000;

async function ensureDouyinForPageOpen() {
  const now = Date.now();
  const feedCached = getStoredFeed();
  try {
    const meta = getMeta();
    if (meta && meta.needPageResync) {
      _lastPageSyncAt = 0;
      setMeta({ needPageResync: false });
    }
  } catch (_) {}
  // 短时间重复进页：直接用缓存，避免模拟器被大量 fileExists 拖死
  if (feedCached.length && now - _lastPageSyncAt < PAGE_SYNC_MIN_GAP_MS) {
    fillMissingCaptionsInBackground();
    return { ok: true, count: getFeed().length, skipped: true, reason: 'recent' };
  }

  // 路径修复放到后台，不阻塞首屏
  setTimeout(() => {
    ocImage.repairFavoriteAlbumImagePaths().catch((e) => {
      console.warn('[ocDouyin] repair paths', e);
    });
  }, 600);

  // 进页：本地文案 + 轻量同步，绝不阻塞等云函数
  const gen = await generateDouyinBatch({ light: true, cloudCaption: false });
  _lastPageSyncAt = Date.now();
  const feed = getFeed();
  if (!feed.length) {
    return { ok: false, reason: (gen && gen.reason) || 'no_images' };
  }
  console.info(
    '[ocDouyin] feed ready',
    feed.length,
    'added=' + ((gen && gen.added) || 0),
    feed.map((c) => (c && c.ocName) + '/' + (c && c.albumName)).join(' | ')
  );
  fillMissingCaptionsInBackground();
  return { ok: true, count: feed.length, added: (gen && gen.added) || 0 };
}

let _captionFillRunning = false;
function fillMissingCaptionsInBackground() {
  if (_captionFillRunning) return;
  _captionFillRunning = true;
  try {
    // 首屏只用本地文案，避免打开页就打云函数刷 Error: timeout
    const list = getStoredFeed();
    let changed = false;
    const next = list.map((clip) => {
      if (!clip) return clip;
      // 用户自发帖允许无文案，禁止后台补默认文案
      if (clip.isUserPost || clip.authorType === 'user') return clip;
      if (clip.content && String(clip.content).trim().length >= 4) return clip;
      const topic = { tags: (clip.tags && clip.tags.length ? clip.tags : ['日常']) };
      const cap = pickFallbackCaption({ personalityText: '' }, topic);
      changed = true;
      return Object.assign({}, clip, {
        content: cap.content,
        tags: clip.tags && clip.tags.length ? clip.tags : cap.tags
      });
    });
    if (changed) saveFeedCapped(next);
  } catch (e) {
    console.warn('[ocDouyin] fill captions', e);
  } finally {
    _captionFillRunning = false;
  }
}

async function hydrateFeedImagePaths(opts) {
  const options = Object.assign({ light: true }, opts || {});
  const list = getStoredFeed();
  if (!list.length) return [];
  // 轻量：不改路径，避免进页二次全量探测
  if (options.light) return getFeed();
  const next = [];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const clip = list[i];
    if (!clip) continue;
    const imgs =
      Array.isArray(clip.images) && clip.images.length
        ? clip.images
        : [{ id: clip.imageId, path: clip.imagePath }];
    const resolvedImgs = [];
    for (let j = 0; j < imgs.length; j++) {
      const img = imgs[j];
      // eslint-disable-next-line no-await-in-loop
      const resolved = await resolveAlbumImagePath(clip.ocId, {
        id: img.id,
        path: img.path
      });
      if (!resolved) {
        changed = true;
        continue;
      }
      if (resolved !== img.path) changed = true;
      resolvedImgs.push({
        id: String(img.id || ''),
        path: resolved,
        time: Number(img.time) || 0
      });
    }
    if (!resolvedImgs.length) {
      changed = true;
      continue;
    }
    next.push(
      Object.assign({}, clip, {
        images: resolvedImgs,
        imagePath: resolvedImgs[0].path,
        imageId: resolvedImgs[0].id
      })
    );
  }
  if (changed || next.length !== list.length) saveFeedCapped(next);
  return getFeed();
}

async function hasAnyOcWithImages() {
  const plans = await collectAllAlbumPlans({ light: true });
  return plans.length > 0;
}

/** 兼容旧调用名 */
async function collectOcImageCandidates(oc) {
  const clips = await collectAlbumClipsForOc(oc);
  const out = [];
  clips.forEach((c) => {
    (c.images || []).forEach((img) => {
      out.push({
        imageId: img.id,
        imagePath: img.path,
        albumId: c.albumId,
        albumName: c.albumName
      });
    });
  });
  return out;
}

module.exports = {
  generateDouyinBatch,
  ensureDouyinForPageOpen,
  hasAnyOcWithImages,
  collectOcImageCandidates,
  collectAlbumClipsForOc,
  hydrateFeedImagePaths,
  resolveAlbumImagePath,
  MAX_IMAGES_PER_CLIP
};
