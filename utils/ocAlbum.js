/** OC 立绘图册 */
const ocImage = require('./ocImage.js');

const MAX_IMAGES_PER_ALBUM = 50;
const ALBUM_CARD_PREVIEW_COUNT = 10;

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
  const images = (Array.isArray(a.images) ? a.images : [])
    .map(normalizeAlbumImage)
    .filter(Boolean)
    .slice(0, MAX_IMAGES_PER_ALBUM);
  images.sort((x, y) => (x.time || 0) - (y.time || 0));
  const presetMeta = PRESET_ALBUMS.find((p) => p.id === a.id);
  return {
    id: String(a.id || newAlbumId()),
    name: String(a.name || (presetMeta && presetMeta.name) || fallbackName || '未命名图册').trim() || '未命名图册',
    preset: !!(a.preset || presetMeta),
    images: images,
    createdAt: Number(a.createdAt) || Date.now()
  };
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
 */
function normalizeOcAlbums(work) {
  const w = work || {};
  let albums = Array.isArray(w.ocAlbums) ? w.ocAlbums.map((a) => normalizeAlbum(a)) : [];
  albums = ensurePresetAlbums(albums);

  const legacy = ocImage.normalizeOcImageList(w.ocImages || []);
  const hasAny = albums.some((a) => (a.images || []).length > 0);
  if (!hasAny && legacy.length) {
    const art = albums.find((a) => a.id === PRESET_ART_ID) || albums[0];
    if (art) {
      art.images = legacy.slice(0, MAX_IMAGES_PER_ALBUM);
    }
  }

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
    (alb.images || []).forEach((img) => {
      if (!img || !img.path || seen.has(img.path)) return;
      seen.add(img.path);
      out.push(img);
    });
  });
  return out;
}

function syncWorkImagesFromAlbums(work) {
  if (!work || typeof work !== 'object') return work;
  const albums = normalizeOcAlbums(work);
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
      previewImages: preview,
      previewCount: preview.length,
      canAddMore: (a.images || []).length < MAX_IMAGES_PER_ALBUM,
      featured: a.id === PRESET_ART_ID,
      coverPath: preview.length ? preview[0].path : ''
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
  PRESET_ART_ID,
  PRESET_ALBUMS,
  newAlbumId,
  normalizeAlbum,
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
  removeAlbum,
  addAlbum,
  addImageToAlbum,
  removeImageFromAlbum
};
