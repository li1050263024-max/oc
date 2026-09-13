/**
 * 图册描述相关性 + 选图（朋友圈 / 抖音共用）
 */
const ocAlbum = require('./ocAlbum.js');
const ocImage = require('./ocImage.js');

/** 有图册时多数动态会配图（此前 0.3 导致大量无图） */
const MOMENTS_IMAGE_PROB = 0.78;
const MOMENTS_IMAGES_MIN = 1;
const MOMENTS_IMAGES_MAX = 3;
/** 抖音一条内容从新图册取 3～5 张（图不够则有几张取几张） */
const DOUYIN_IMAGES_MIN = 3;
const DOUYIN_IMAGES_MAX = 5;

function tokenize(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, ' ')
    .trim();
  if (!s) return [];
  const parts = s.split(/\s+/).filter((t) => t && t.length >= 2);
  const chars = [];
  const cn = String(text || '').replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cn.length - 1; i++) {
    chars.push(cn.slice(i, i + 2));
  }
  return parts.concat(chars).slice(0, 80);
}

/** 文本与图册名/描述的相关分（越高越相关） */
function scoreAlbumRelevance(queryText, album) {
  if (!album) return 0;
  const q = tokenize(queryText);
  if (!q.length) return 0;
  const hay = String((album.name || '') + ' ' + (album.description || '')).toLowerCase();
  if (!hay.trim()) return 0;
  let score = 0;
  const seen = {};
  q.forEach((t) => {
    if (!t || seen[t]) return;
    seen[t] = true;
    if (hay.indexOf(t) >= 0) score += t.length >= 2 ? 2 : 1;
  });
  return score;
}

function albumsWithImages(work) {
  const albums = ocAlbum.normalizeOcAlbums(work || {});
  return albums.filter((a) => a && (a.images || []).length > 0);
}

/**
 * 配图概率之上：需要图时优先相关图册，没有相关则随机
 * @returns {object|null} album
 */
function pickAlbumForQuery(albums, queryText) {
  const list = (albums || []).filter((a) => a && (a.images || []).length);
  if (!list.length) return null;
  const scored = list
    .map((a) => ({ album: a, score: scoreAlbumRelevance(queryText, a) }))
    .sort((x, y) => y.score - x.score);
  const related = scored.filter((x) => x.score > 0);
  if (related.length) {
    // 在相关档里加权随机，避免永远同一本
    const top = related.slice(0, Math.min(3, related.length));
    const idx = Math.floor(Math.random() * top.length);
    return top[idx].album;
  }
  return list[Math.floor(Math.random() * list.length)];
}

function sortImagesNewest(images) {
  return (images || [])
    .slice()
    .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
}

/**
 * 从单图册取 1～max 张（最新优先）
 */
function pickImageSlice(album, minCount, maxCount) {
  const sorted = sortImagesNewest((album && album.images) || []);
  if (!sorted.length) return [];
  const min = Math.max(1, Number(minCount) || 1);
  const max = Math.max(min, Number(maxCount) || min);
  const n = Math.min(
    sorted.length,
    Math.max(min, Math.min(max, min + Math.floor(Math.random() * (max - min + 1))))
  );
  return sorted.slice(0, n);
}

async function resolveImages(ocId, imgs, opts) {
  const options = opts || {};
  const out = [];
  for (let i = 0; i < (imgs || []).length; i++) {
    const img = imgs[i];
    const raw = String((img && img.path) || '').trim();
    let path = raw;
    if (!options.light && raw) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await ocImage.resolveLocalImagePath(raw);
      if (ok) path = ok;
      else {
        // eslint-disable-next-line no-await-in-loop
        const alive = await ocImage.fileExists(raw);
        if (!alive) continue;
      }
    }
    if (!path) continue;
    out.push({
      id: String((img && img.id) || path),
      path: path,
      time: Number((img && img.time) || 0) || 0
    });
  }
  return out;
}

/**
 * 朋友圈：高概率配图；每条 1 图册、1～3 张；按正文相关性选册
 */
async function attachMomentsImages(oc, content, opts) {
  const options = opts || {};
  if (Math.random() >= MOMENTS_IMAGE_PROB) {
    return { withImage: false, images: [], albumId: '', albumName: '', albumDescription: '' };
  }
  const work = (oc && oc.work) || {};
  const albums = albumsWithImages(work);
  if (!albums.length) {
    return { withImage: false, images: [], albumId: '', albumName: '', albumDescription: '' };
  }
  const album = pickAlbumForQuery(albums, content || options.queryText || '');
  if (!album) {
    return { withImage: false, images: [], albumId: '', albumName: '', albumDescription: '' };
  }
  const slice = pickImageSlice(album, MOMENTS_IMAGES_MIN, MOMENTS_IMAGES_MAX);
  const images = await resolveImages(oc && oc.id, slice, options);
  if (!images.length) {
    return { withImage: false, images: [], albumId: '', albumName: '', albumDescription: '' };
  }
  return {
    withImage: true,
    images: images,
    albumId: album.id || '',
    albumName: album.name || '',
    albumDescription: String(album.description || '').trim()
  };
}

function formatAlbumHint(albumName, albumDescription) {
  const name = String(albumName || '').trim();
  const desc = String(albumDescription || '').trim().slice(0, 120);
  if (!name && !desc) return '';
  if (name && desc) return '图册「' + name + '」：' + desc;
  if (desc) return '图册描述：' + desc;
  return '图册类型：' + name;
}

/** 抖音：按话题/文案对图册排序（相关性高的靠前） */
function sortAlbumsByRelevance(albums, queryText) {
  return (albums || [])
    .slice()
    .map((a) => ({ album: a, score: scoreAlbumRelevance(queryText, a) }))
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const tx = Math.max.apply(
        null,
        ((x.album.images || []).map((i) => Number(i.time) || 0)).concat([0])
      );
      const ty = Math.max.apply(
        null,
        ((y.album.images || []).map((i) => Number(i.time) || 0)).concat([0])
      );
      return ty - tx;
    })
    .map((x) => x.album);
}

module.exports = {
  MOMENTS_IMAGE_PROB,
  MOMENTS_IMAGES_MIN,
  MOMENTS_IMAGES_MAX,
  DOUYIN_IMAGES_MIN,
  DOUYIN_IMAGES_MAX,
  tokenize,
  scoreAlbumRelevance,
  albumsWithImages,
  pickAlbumForQuery,
  pickImageSlice,
  resolveImages,
  attachMomentsImages,
  formatAlbumHint,
  sortAlbumsByRelevance
};
