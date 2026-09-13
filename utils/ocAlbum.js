/** OC 立绘图册 */
const ocImage = require('./ocImage.js');

/** 单册上限 15：所有图册统一（立绘 / 自拍 / 他拍 / 合影 / 自定义） */
const MAX_IMAGES_PER_ALBUM = 15;
const ALBUM_CARD_PREVIEW_COUNT = 10;
const ALBUM_LIMIT_HINT =
  '每个图册最多 15 张（立绘与其它图册相同）；超额自动拆到「原名·续N」。填写描述可帮助朋友圈/抖音按场景配图。';

const PRESET_ART_ID = 'preset_art';

const PRESET_ALBUMS = [
  { id: PRESET_ART_ID, name: '立绘', preset: true, featured: true },
  { id: 'preset_selfie', name: 'oc自拍', preset: true },
  { id: 'preset_others', name: 'oc他拍', preset: true },
  { id: 'preset_group', name: '合影', preset: true }
];

function newAlbumId() {
  return 'alb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizeAlbumImage(img) {
  if (!img || typeof img !== 'object') return null;
  const path = String(img.path || '').trim();
  if (!path) return null;
  return {
    id: String(img.id || ocImage.newOcImageId()),
    path: path,
    time: Number(img.time) || Date.now()
  };
}

function normalizeAlbum(raw, fallbackName) {
  const a = raw && typeof raw === 'object' ? raw : {};
  // 不在此处截断：超额由 splitOverflowAlbums 拆到新图册，避免静默丢图
  const images = (Array.isArray(a.images) ? a.images : [])
    .map(normalizeAlbumImage)
    .filter(Boolean);
  images.sort((x, y) => (x.time || 0) - (y.time || 0));
  const presetMeta = PRESET_ALBUMS.find((p) => p.id === a.id);
  return {
    id: String(a.id || newAlbumId()),
    name: String(a.name || (presetMeta && presetMeta.name) || fallbackName || '未命名图册').trim() || '未命名图册',
    description: String(a.description || '').trim().slice(0, 120),
    preset: !!(a.preset || presetMeta),
    images: images,
    createdAt: Number(a.createdAt) || Date.now()
  };
}

function continuationAlbumName(baseName, part) {
  const base = String(baseName || '未命名图册')
    .replace(/·续\d+$/, '')
    .trim() || '未命名图册';
  return (base + '·续' + part).slice(0, 24);
}

/**
 * 单册超过 15 张时：原册保留最新 15 张，更早的超额图按 15 张一批拆到新图册
 */
function splitOverflowAlbums(albums) {
  const list = Array.isArray(albums) ? albums : [];
  const out = [];
  list.forEach((raw) => {
    const alb = normalizeAlbum(raw);
    const imgs = (alb.images || []).slice().sort((a, b) => (a.time || 0) - (b.time || 0));
    if (imgs.length <= MAX_IMAGES_PER_ALBUM) {
      alb.images = imgs;
      out.push(alb);
      return;
    }
    const keep = imgs.slice(-MAX_IMAGES_PER_ALBUM);
    const overflow = imgs.slice(0, imgs.length - MAX_IMAGES_PER_ALBUM);
    alb.images = keep;
    out.push(alb);
    let part = 1;
    for (let i = 0; i < overflow.length; i += MAX_IMAGES_PER_ALBUM) {
      const chunk = overflow.slice(i, i + MAX_IMAGES_PER_ALBUM);
      out.push(
        normalizeAlbum({
          id: newAlbumId(),
          name: continuationAlbumName(alb.name, part),
          description: alb.description || '',
          preset: false,
          images: chunk,
          createdAt: Date.now() + part
        })
      );
      part += 1;
    }
  });
  return out;
}

function createPresetAlbums() {
  return PRESET_ALBUMS.map((p) =>
    normalizeAlbum({
      id: p.id,
      name: p.name,
      preset: true,
      images: [],
      createdAt: Date.now()
    })
  );
}

function ensurePresetAlbums(list) {
  const albums = Array.isArray(list) ? list.map((a) => normalizeAlbum(a)).filter(Boolean) : [];
  const byId = {};
  albums.forEach((a) => {
    byId[a.id] = a;
  });
  const presets = PRESET_ALBUMS.map((p) => {
    if (byId[p.id]) {
      byId[p.id].preset = true;
      if (!String(byId[p.id].name || '').trim()) byId[p.id].name = p.name;
      return byId[p.id];
    }
    return normalizeAlbum({
      id: p.id,
      name: p.name,
      preset: true,
      images: [],
      createdAt: Date.now()
    });
  });
  const customs = albums.filter((a) => !PRESET_ALBUMS.some((p) => p.id === a.id));
  return presets.concat(customs);
}

/**
 * 从旧版 ocImages 迁移到图册；无图册时创建预设并把历史立绘放进「立绘」
 * 已有 ocAlbums 结构时以图册为准，允许删空（避免最后一张被扁平列表回填）
 */
function normalizeOcAlbums(work) {
  const w = work || {};
  const hadAlbumsField = Array.isArray(w.ocAlbums);
  let albums = hadAlbumsField ? w.ocAlbums.map((a) => normalizeAlbum(a)) : [];
  albums = ensurePresetAlbums(albums);

  const legacy = ocImage.normalizeOcImageList(w.ocImages || []);
  const hasAny = albums.some((a) => (a.images || []).length > 0);
  if (!hadAlbumsField && !hasAny && legacy.length) {
    const art = albums.find((a) => a.id === PRESET_ART_ID) || albums[0];
    if (art) {
      // 历史立绘可能超过 15 张，交给 splitOverflowAlbums 拆册
      art.images = legacy.slice();
    }
  }

  albums = splitOverflowAlbums(albums);
  albums = ensurePresetAlbums(albums);
  return albums;
}

function flattenAlbumImages(albums) {
  const out = [];
  const seen = new Set();
  const list = albums || [];
  // 立绘图册优先，作为头像主图来源
  const ordered = list
    .slice()
    .sort((a, b) => Number(b && b.id === PRESET_ART_ID) - Number(a && a.id === PRESET_ART_ID));
  ordered.forEach((alb) => {
    // 图册内最新在前，保证头像/主图取到刚上传的
    const imgs = ((alb && alb.images) || [])
      .slice()
      .sort((x, y) => (Number(y.time) || 0) - (Number(x.time) || 0));
    imgs.forEach((img) => {
      if (!img || !img.path || seen.has(img.path)) return;
      seen.add(img.path);
      out.push(img);
    });
  });
  return out;
}

function syncWorkImagesFromAlbums(work) {
  if (!work || typeof work !== 'object') return work;
  // 已有图册时以图册为唯一来源，清空扁平列表再规范化，防止删空回填
  const source = Array.isArray(work.ocAlbums)
    ? { ocAlbums: work.ocAlbums, ocImages: [] }
    : work;
  const albums = normalizeOcAlbums(source);
  work.ocAlbums = albums;
  const flat = flattenAlbumImages(albums);
  work.ocImages = flat;
  work.ocImagePath = ocImage.primaryImagePath(flat, work.ocImagePath || '');
  return work;
}

function albumCardPreview(album) {
  const images = (album && album.images) || [];
  const sorted = images.slice().sort((a, b) => (b.time || 0) - (a.time || 0));
  return sorted.slice(0, ALBUM_CARD_PREVIEW_COUNT);
}

function buildAlbumCards(albums) {
  return (albums || []).map((a) => {
    const preview = albumCardPreview(a);
    return Object.assign({}, a, {
      count: (a.images || []).length,
      maxImages: MAX_IMAGES_PER_ALBUM,
      previewImages: preview,
      previewCount: preview.length,
      canAddMore: (a.images || []).length < MAX_IMAGES_PER_ALBUM,
      featured: a.id === PRESET_ART_ID,
      coverPath: preview.length ? preview[0].path : '',
      descHint: String(a.description || '').trim()
        ? String(a.description).trim().slice(0, 36)
        : ''
    });
  });
}

/** 立绘置顶全宽，其余两列网格 */
function buildAlbumLayout(albums) {
  const cards = buildAlbumCards(albums);
  const featured = cards.find((c) => c.id === PRESET_ART_ID) || null;
  const grid = cards.filter((c) => c.id !== PRESET_ART_ID);
  return { featured: featured, grid: grid, cards: cards };
}

function findAlbum(albums, albumId) {
  return (albums || []).find((a) => a && a.id === albumId) || null;
}

function renameAlbum(albums, albumId, name) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const target = list.find((a) => a.id === albumId);
  if (!target) return list;
  const nextName = String(name || '').trim();
  if (nextName) target.name = nextName.slice(0, 24);
  return list;
}

function setAlbumDescription(albums, albumId, description) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const target = list.find((a) => a.id === albumId);
  if (!target) return list;
  target.description = String(description || '').trim().slice(0, 120);
  return list;
}

function removeAlbum(albums, albumId) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const target = list.find((a) => a.id === albumId);
  if (!target) return list;
  if (target.preset) return list;
  return list.filter((a) => a.id !== albumId);
}

function addAlbum(albums, name) {
  const list = ensurePresetAlbums((albums || []).map((a) => normalizeAlbum(a)));
  list.push(
    normalizeAlbum({
      id: newAlbumId(),
      name: String(name || '未命名图册').trim() || '未命名图册',
      preset: false,
      images: [],
      createdAt: Date.now()
    })
  );
  return list;
}

function addImageToAlbum(albums, albumId, image) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const target = list.find((a) => a.id === albumId);
  if (!target) return list;
  const img = normalizeAlbumImage(image);
  if (!img) return list;
  if (target.images.length >= MAX_IMAGES_PER_ALBUM) return list;
  if (target.images.some((x) => x.path === img.path)) return list;
  target.images.push(img);
  return list;
}

function nextContinuationPart(albums, baseName) {
  const prefix = String(baseName || '未命名图册')
    .replace(/·续\d+$/, '')
    .trim() || '未命名图册';
  let max = 0;
  (albums || []).forEach((a) => {
    const n = String((a && a.name) || '');
    if (n === prefix) return;
    const m = n.match(/^(.+)·续(\d+)$/);
    if (!m) return;
    if (String(m[1]) !== prefix) return;
    max = Math.max(max, Number(m[2]) || 0);
  });
  return max + 1;
}

/**
 * 批量加入图册；本册满 15 张后自动新建「原名·续N」承接超额
 * @returns {{ albums: Array, added: number, spillAlbumIds: string[] }}
 */
function addImagesToAlbumWithOverflow(albums, albumId, images) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const origin = list.find((a) => a && a.id === albumId);
  if (!origin) return { albums: list, added: 0, spillAlbumIds: [] };
  let currentId = albumId;
  let added = 0;
  const spillAlbumIds = [];
  const baseName = origin.name;

  (images || []).forEach((image) => {
    const img = normalizeAlbumImage(image);
    if (!img) return;
    let target = list.find((a) => a && a.id === currentId);
    if (!target) return;
    if (target.images.some((x) => x.path === img.path)) return;
    if (target.images.length >= MAX_IMAGES_PER_ALBUM) {
      const part = nextContinuationPart(list, baseName);
      const spill = normalizeAlbum({
        id: newAlbumId(),
        name: continuationAlbumName(baseName, part),
        description: origin.description || '',
        preset: false,
        images: [],
        createdAt: Date.now() + part
      });
      list.push(spill);
      currentId = spill.id;
      spillAlbumIds.push(spill.id);
      target = spill;
    }
    target.images.push(img);
    added += 1;
  });

  return { albums: list, added: added, spillAlbumIds: spillAlbumIds };
}

function removeImageFromAlbum(albums, albumId, imageId) {
  const list = (albums || []).map((a) => normalizeAlbum(a));
  const target = list.find((a) => a.id === albumId);
  if (!target) return list;
  target.images = target.images.filter((img) => img.id !== imageId);
  return list;
}

module.exports = {
  MAX_IMAGES_PER_ALBUM,
  ALBUM_CARD_PREVIEW_COUNT,
  ALBUM_LIMIT_HINT,
  PRESET_ART_ID,
  PRESET_ALBUMS,
  newAlbumId,
  normalizeAlbum,
  splitOverflowAlbums,
  normalizeOcAlbums,
  createPresetAlbums,
  ensurePresetAlbums,
  flattenAlbumImages,
  syncWorkImagesFromAlbums,
  albumCardPreview,
  buildAlbumCards,
  buildAlbumLayout,
  findAlbum,
  renameAlbum,
  setAlbumDescription,
  removeAlbum,
  addAlbum,
  addImageToAlbum,
  addImagesToAlbumWithOverflow,
  removeImageFromAlbum
};
