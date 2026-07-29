const ocAlbum = require('./ocAlbum.js');
const { getOcsWithBio } = require('./ocSocialEligible.js');
const { buildOcPromptFromWork } = require('./ocContext.js');
const { buildSocialPlotContext } = require('./ocSocialContext.js');
const { pickTopicForOc, formatTopicForPrompt, localDateKey } = require('./ocDouyinTopics.js');
const {
  getMeta,
  setMeta,
  getFeed,
  appendClips,
  newClipId,
  getOcUsedImageIdsToday,
  markOcImagesUsed
} = require('./ocDouyinStore.js');

const GENERATE_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_CLIPS_PER_RUN = 8;
const MAX_PER_OC = 2;
let _running = false;

const FALLBACK_CAPTIONS = [
  '随手拍一张，心情还行。',
  '今天的光还可以。',
  '不出门也能营业一下。',
  '就发这张。',
  '状态一般，图先放着。'
];

function collectOcImageCandidates(oc, dateKey) {
  if (!oc || !oc.work) return [];
  const work = ocAlbum.syncWorkImagesFromAlbums(Object.assign({}, oc.work));
  const albums = ocAlbum.normalizeOcAlbums(work);
  const used = {};
  getOcUsedImageIdsToday(oc.id, dateKey).forEach((id) => {
    used[id] = true;
  });
  const out = [];
  albums.forEach((alb) => {
    (alb.images || []).forEach((img) => {
      if (!img || !img.path) return;
      const iid = String(img.id || img.path);
      if (used[iid]) return;
      out.push({
        imageId: iid,
        imagePath: img.path,
        albumId: alb.id,
        albumName: alb.name || ''
      });
    });
  });
  // 洗牌
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function pickFallbackCaption(oc, topic) {
  const base =
    FALLBACK_CAPTIONS[Math.floor(Math.random() * FALLBACK_CAPTIONS.length)] ||
    FALLBACK_CAPTIONS[0];
  const tags = (topic && topic.tags) || ['日常'];
  const nameHint = oc && oc.personalityText ? String(oc.personalityText).slice(0, 8) : '';
  const extra = nameHint ? '有点' + nameHint + '的感觉。' : '';
  return {
    content: (base + extra).slice(0, 60),
    tags: tags.slice(0, 3)
  };
}

function callDouyinCloud(payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('no cloud'));
      return;
    }
    wx.cloud.callFunction({
      name: 'generateOcMoments',
      data: Object.assign({ mode: 'douyin' }, payload || {}),
      timeout: 55000,
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
      fail: (err) => reject(err || new Error('云函数调用失败'))
    });
  });
}

async function generateCaptionForClip(oc, topic, albumName) {
  const setting = buildOcPromptFromWork(oc.work).slice(0, 2800);
  const bio = String(oc.bioText || (oc.work && oc.work.generatedBio) || '').slice(0, 1200);
  const plot = buildSocialPlotContext(oc).slice(0, 1200);
  try {
    const posts = await callDouyinCloud({
      ocName: oc.name || 'OC',
      ocSetting: setting,
      ocBio: bio,
      chatSummary: plot,
      topicHint: formatTopicForPrompt(topic),
      albumHint: albumName ? '图册类型：' + albumName : '',
      postCount: 1
    });
    const first = posts[0] || {};
    const content = String(first.content || first.caption || '').trim();
    let tags = Array.isArray(first.tags) ? first.tags : topic.tags || [];
    tags = tags.map((t) => String(t || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, 4);
    if (!content || content.length < 4) return pickFallbackCaption(oc, topic);
    return { content: content.slice(0, 80), tags: tags.length ? tags : topic.tags || [] };
  } catch (_) {
    return pickFallbackCaption(oc, topic);
  }
}

/**
 * 收集有图的 OC，为未用过的图片生成抖音条
 */
async function generateDouyinBatch(options) {
  const opts = options || {};
  const force = !!opts.force;
  if (_running) return { ok: false, skipped: true, reason: 'busy' };
  const meta = getMeta();
  const now = Date.now();
  if (
    !force &&
    meta.lastGeneratedAt &&
    now - meta.lastGeneratedAt < GENERATE_COOLDOWN_MS &&
    getFeed().length
  ) {
    return { ok: true, skipped: true, reason: 'cooldown' };
  }

  const ocs = getOcsWithBio().filter((oc) => oc && oc.id);
  if (!ocs.length) return { ok: false, reason: 'no_oc' };

  const dateKey = localDateKey(now);
  const plans = [];
  ocs.forEach((oc) => {
    const imgs = collectOcImageCandidates(oc, dateKey).slice(0, MAX_PER_OC);
    imgs.forEach((img) => {
      plans.push({ oc: oc, img: img });
    });
  });
  if (!plans.length) {
    return { ok: false, reason: 'no_images' };
  }

  // 交错不同 OC
  plans.sort((a, b) => String(a.oc.id).localeCompare(String(b.oc.id)));
  const interleaved = [];
  const byOc = {};
  plans.forEach((p) => {
    if (!byOc[p.oc.id]) byOc[p.oc.id] = [];
    byOc[p.oc.id].push(p);
  });
  const ids = Object.keys(byOc);
  let guard = 0;
  while (interleaved.length < MAX_CLIPS_PER_RUN && guard < 100) {
    guard += 1;
    let added = false;
    ids.forEach((id) => {
      if (interleaved.length >= MAX_CLIPS_PER_RUN) return;
      if (byOc[id] && byOc[id].length) {
        interleaved.push(byOc[id].shift());
        added = true;
      }
    });
    if (!added) break;
  }

  _running = true;
  setMeta({ generating: true, lastGeneratedAt: now });
  const created = [];
  const usedByOc = {};

  try {
    for (let i = 0; i < interleaved.length; i++) {
      const { oc, img } = interleaved[i];
      const topic = pickTopicForOc(oc, dateKey + '_' + i + '_' + oc.id);
      const cap = await generateCaptionForClip(oc, topic, img.albumName);
      const clip = {
        id: newClipId(),
        ocId: oc.id,
        ocName: oc.name || 'OC',
        avatarUrl: oc.avatarUrl || '',
        imagePath: img.imagePath,
        imageId: img.imageId,
        albumId: img.albumId,
        albumName: img.albumName,
        content: cap.content,
        tags: cap.tags || [],
        topicId: topic.id,
        createdAt: now - i * 1000,
        source: 'douyin'
      };
      created.push(clip);
      if (!usedByOc[oc.id]) usedByOc[oc.id] = [];
      usedByOc[oc.id].push(img.imageId);
    }
    if (created.length) {
      appendClips(created);
      Object.keys(usedByOc).forEach((oid) => {
        markOcImagesUsed(oid, usedByOc[oid], dateKey);
      });
    }
    return { ok: true, count: created.length };
  } finally {
    _running = false;
    setMeta({ generating: false, lastPageOpenAt: now, lastGeneratedAt: now });
  }
}

async function ensureDouyinForPageOpen() {
  const feed = getFeed();
  if (!feed.length) {
    return generateDouyinBatch({ force: true });
  }
  return generateDouyinBatch({ force: false });
}

function hasAnyOcWithImages() {
  const ocs = getOcsWithBio();
  const dateKey = localDateKey();
  for (let i = 0; i < ocs.length; i++) {
    if (collectOcImageCandidates(ocs[i], dateKey).length) return true;
    // 即使今天用完也算有图
    const work = ocAlbum.syncWorkImagesFromAlbums(Object.assign({}, ocs[i].work || {}));
    const flat = ocAlbum.flattenAlbumImages(ocAlbum.normalizeOcAlbums(work));
    if (flat.length) return true;
  }
  return false;
}

module.exports = {
  generateDouyinBatch,
  ensureDouyinForPageOpen,
  hasAnyOcWithImages,
  collectOcImageCandidates
};
