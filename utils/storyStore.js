const {
  getFavorites,
  getFavoriteById,
  updateFavoriteItem,
  workFromFavoriteItem
} = require('./favorite.js');
const { buildOcPromptFromWork } = require('./ocContext.js');
const { personalityBlend, quirkBlend } = require('./ocResult.js');
const { isLayer3Ready } = require('./ocWork.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

const DEFAULT_COLLECTION_ID = 'sc_default';
const DEFAULT_COLLECTION_NAME = '默认故事集';
/** 故事集数量不再区分会员；保留常量仅兼容旧引用 */
const FREE_COLLECTION_LIMIT = 9999;
const VIP_COLLECTION_LIMIT = 9999;
const COLLECTION_LIMIT = 9999;

function syncWorkOcStories(favoriteId, list, collections) {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.result || work.notebookFavoriteId !== favoriteId) return;
  work.ocStories = (list || []).map((s) => ({ ...s }));
  if (collections) {
    work.ocStoryCollections = (collections || []).map((c) => ({ ...c }));
  }
  wx.setStorageSync(STORAGE_OC_WORK, work);
}

function newCollectionId() {
  return 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function getCollectionLimit() {
  return COLLECTION_LIMIT;
}

function makeDefaultCollection() {
  return {
    id: DEFAULT_COLLECTION_ID,
    name: DEFAULT_COLLECTION_NAME,
    isDefault: true,
    time: Date.now()
  };
}

function normalizeCollection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim() || '未命名故事集';
  if (!id) return null;
  return {
    id: id,
    name: name,
    isDefault: !!raw.isDefault || id === DEFAULT_COLLECTION_ID,
    time: Number(raw.time) || Date.now()
  };
}

/**
 * 确保有默认故事集，并把旧故事迁入默认集（发版兼容）
 * @returns {{ collections: array, stories: array, changed: boolean }}
 */
function ensureCollectionsMigrated(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item) {
    return { collections: [makeDefaultCollection()], stories: [], changed: false };
  }
  let collections = (Array.isArray(item.ocStoryCollections) ? item.ocStoryCollections : [])
    .map(normalizeCollection)
    .filter(Boolean);
  let stories = getStoriesFromItem(item);
  let changed = false;

  if (!collections.length) {
    collections = [makeDefaultCollection()];
    changed = true;
  } else if (!collections.some((c) => c.id === DEFAULT_COLLECTION_ID || c.isDefault)) {
    collections.unshift(makeDefaultCollection());
    changed = true;
  } else {
    // 保证默认集名称至少有一个 isDefault
    collections = collections.map((c) => {
      if (c.id === DEFAULT_COLLECTION_ID && !c.isDefault) {
        changed = true;
        return Object.assign({}, c, { isDefault: true });
      }
      return c;
    });
  }

  const validIds = {};
  collections.forEach((c) => {
    validIds[c.id] = true;
  });
  const defaultId =
    (collections.find((c) => c.isDefault) || collections[0] || makeDefaultCollection()).id;

  stories = stories.map((s) => {
    if (!s) return s;
    const cid = String(s.collectionId || '').trim();
    if (!cid || !validIds[cid]) {
      changed = true;
      return Object.assign({}, s, { collectionId: defaultId });
    }
    return s;
  });

  if (changed) {
    const work = workFromFavoriteItem(item) || { result: item.result };
    work.ocStories = stories;
    work.ocStoryCollections = collections;
    updateFavoriteItem(favoriteId, work);
    syncWorkOcStories(favoriteId, stories, collections);
  }

  return { collections: collections, stories: stories, changed: changed };
}

function listCollections(favoriteId) {
  return ensureCollectionsMigrated(favoriteId).collections.slice();
}

function getStoriesInCollection(favoriteId, collectionId) {
  const migrated = ensureCollectionsMigrated(favoriteId);
  const cid = String(collectionId || DEFAULT_COLLECTION_ID);
  return migrated.stories.filter((s) => String(s.collectionId || '') === cid);
}

function createCollection(favoriteId, name) {
  const title = String(name || '').trim();
  if (!title) return { ok: false, errMsg: '请输入故事集名称' };
  if (title.length > 40) return { ok: false, errMsg: '名称过长' };
  const migrated = ensureCollectionsMigrated(favoriteId);
  const limit = getCollectionLimit();
  if (migrated.collections.length >= limit) {
    return {
      ok: false,
      needVip: false,
      errMsg: '故事集数量过多，请先整理后再建',
      limit: limit
    };
  }
  const col = {
    id: newCollectionId(),
    name: title,
    isDefault: false,
    time: Date.now()
  };
  const collections = migrated.collections.concat([col]);
  const item = getFavoriteById(favoriteId);
  if (!item) return { ok: false, errMsg: '未找到 OC' };
  const work = workFromFavoriteItem(item) || { result: item.result };
  work.ocStories = migrated.stories;
  work.ocStoryCollections = collections;
  const ok = updateFavoriteItem(favoriteId, work);
  if (ok) syncWorkOcStories(favoriteId, migrated.stories, collections);
  return ok ? { ok: true, collection: col, collections: collections } : { ok: false, errMsg: '创建失败' };
}

function renameCollection(favoriteId, collectionId, name) {
  const title = String(name || '').trim();
  if (!title) return { ok: false, errMsg: '请输入故事集名称' };
  const migrated = ensureCollectionsMigrated(favoriteId);
  const id = String(collectionId || '');
  const idx = migrated.collections.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, errMsg: '故事集不存在' };
  const collections = migrated.collections.slice();
  collections[idx] = Object.assign({}, collections[idx], { name: title });
  const item = getFavoriteById(favoriteId);
  if (!item) return { ok: false, errMsg: '未找到 OC' };
  const work = workFromFavoriteItem(item) || { result: item.result };
  work.ocStories = migrated.stories;
  work.ocStoryCollections = collections;
  const ok = updateFavoriteItem(favoriteId, work);
  if (ok) syncWorkOcStories(favoriteId, migrated.stories, collections);
  return ok ? { ok: true, collections: collections } : { ok: false, errMsg: '重命名失败' };
}

function moveStoryToCollection(favoriteId, storyId, collectionId) {
  const migrated = ensureCollectionsMigrated(favoriteId);
  const sid = String(storyId || '');
  const cid = String(collectionId || '');
  if (!migrated.collections.some((c) => c.id === cid)) {
    return { ok: false, errMsg: '目标故事集不存在' };
  }
  const stories = migrated.stories.map((s) => {
    if (!s || s.id !== sid) return s;
    return Object.assign({}, s, { collectionId: cid });
  });
  if (!stories.some((s) => s && s.id === sid)) {
    return { ok: false, errMsg: '故事不存在' };
  }
  const item = getFavoriteById(favoriteId);
  if (!item) return { ok: false, errMsg: '未找到 OC' };
  const work = workFromFavoriteItem(item) || { result: item.result };
  work.ocStories = stories;
  work.ocStoryCollections = migrated.collections;
  const ok = updateFavoriteItem(favoriteId, work);
  if (ok) syncWorkOcStories(favoriteId, stories, migrated.collections);
  return ok ? { ok: true } : { ok: false, errMsg: '移动失败' };
}

/** 弹出选择故事集；成功回调 collection */
function pickCollection(favoriteId, options) {
  const opts = options || {};
  const cols = listCollections(favoriteId);
  if (!cols.length) {
    return Promise.reject(new Error('暂无故事集'));
  }
  const title = opts.title || '选择故事集';
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: cols.map((c) => c.name),
      alertText: title,
      success: (res) => {
        const picked = cols[res.tapIndex];
        if (!picked) {
          reject(new Error('未选择'));
          return;
        }
        resolve(picked);
      },
      fail: (err) => {
        // 用户取消
        if (err && /cancel/i.test(String(err.errMsg || ''))) {
          reject(new Error('cancel'));
          return;
        }
        reject(err || new Error('选择失败'));
      }
    });
  });
}

function favoriteHasBio(item) {
  return !!(item && item.generatedBio && String(item.generatedBio).trim());
}

function newStoryId() {
  return 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function newHistoryId() {
  return 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

const MAX_STORY_HISTORY = 40;

const LEGACY_SERIES_SUFFIX_RE = /【\.(\d+)】\s*$/;
const SERIES_SUFFIX_RE = /【(\d+)】\s*$/;

function buildChapterSuffix(index) {
  return '【' + index + '】';
}

/** 去掉末尾章节后缀（兼容旧版 【.2】 与新版 【2】） */
function getSeriesBaseTitle(title) {
  let t = String(title || '').trim();
  t = t.replace(LEGACY_SERIES_SUFFIX_RE, '').trim();
  t = t.replace(SERIES_SUFFIX_RE, '').trim();
  return t || '未命名故事';
}

function getChapterIndex(title) {
  const t = String(title || '').trim();
  let m = t.match(LEGACY_SERIES_SUFFIX_RE);
  if (m) return parseInt(m[1], 10);
  m = t.match(SERIES_SUFFIX_RE);
  if (m) return parseInt(m[1], 10);
  return 1;
}

/** 将标题中的 【.2】 规范为 【2】 */
function normalizeChapterTitle(title) {
  const t = String(title || '').trim();
  if (!t) return t;
  return t.replace(LEGACY_SERIES_SUFFIX_RE, (_, n) => buildChapterSuffix(n));
}

function buildNextChapterTitle(sourceTitle, stories) {
  const base = getSeriesBaseTitle(sourceTitle);
  let maxIdx = getChapterIndex(sourceTitle);
  (stories || []).forEach((s) => {
    if (getSeriesBaseTitle(s.title) !== base) return;
    maxIdx = Math.max(maxIdx, getChapterIndex(s.title));
  });
  return base + buildChapterSuffix(maxIdx + 1);
}

function getStoriesFromItem(item) {
  if (!item || !Array.isArray(item.ocStories)) return [];
  return item.ocStories.slice();
}

function _storyParagraphBlocks(content) {
  const t = String(content || '').trim();
  if (!t) return [];
  const blocks = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  return t.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

function storyFirstParagraph(content) {
  const blocks = _storyParagraphBlocks(content);
  return blocks[0] || String(content || '').trim().slice(0, 160);
}

/** 取正文前 n 段（空行分段，否则按行）用于列表预览 */
function storyPreviewParagraphs(content, n) {
  const count = typeof n === 'number' && n > 0 ? n : 3;
  const blocks = storyPreviewBlocks(content, count);
  if (!blocks.length) return '';
  return blocks.join('\n\n');
}

/** 前 n 段正文块（数组），长文无分段时均分为 n 段 */
function storyPreviewBlocks(content, n) {
  const count = typeof n === 'number' && n > 0 ? n : 3;
  let blocks = _storyParagraphBlocks(content);
  if (!blocks.length) return [];
  if (blocks.length >= count) return blocks.slice(0, count);
  if (blocks.length === 1 && blocks[0].length > 120) {
    const t = blocks[0];
    const size = Math.max(80, Math.ceil(t.length / count));
    const parts = [];
    for (let i = 0; i < count; i++) {
      const chunk = t.slice(i * size, (i + 1) * size).trim();
      if (chunk) parts.push(chunk);
    }
    if (parts.length) return parts;
  }
  return blocks;
}

function getStoryFromFavorite(favoriteId, storyId) {
  const item = getFavoriteById(favoriteId);
  if (!item || !storyId) return null;
  return getStoriesFromItem(item).find((s) => s.id === storyId) || null;
}

function getStoryHistoryList(story) {
  if (!story || !Array.isArray(story.history)) return [];
  return story.history.slice().sort((a, b) => (b.savedAt || b.time || 0) - (a.savedAt || a.time || 0));
}

function formatHistoryTime(ts) {
  const t = typeof ts === 'number' ? ts : Date.now();
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    ' ' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes())
  );
}

function mapHistoryForDisplay(story) {
  return getStoryHistoryList(story).map((h) =>
    Object.assign({}, h, {
      timeLabel: formatHistoryTime(h.savedAt || h.time)
    })
  );
}

function upsertStoryToFavorite(favoriteId, entry) {
  const migrated = ensureCollectionsMigrated(favoriteId);
  const item = getFavoriteById(favoriteId);
  if (!item) return false;
  const list = migrated.stories.slice();
  const existing = list.find((s) => s.id === entry.id);
  const defaultId =
    (migrated.collections.find((c) => c.isDefault) || migrated.collections[0] || {})
      .id || DEFAULT_COLLECTION_ID;
  let collectionId = String(
    (entry && entry.collectionId) ||
      (existing && existing.collectionId) ||
      defaultId
  ).trim();
  if (!migrated.collections.some((c) => c.id === collectionId)) {
    collectionId = defaultId;
  }
  const story = {
    id: entry.id || newStoryId(),
    title: normalizeChapterTitle(String(entry.title || '').trim()),
    userPrompt: String(entry.userPrompt || '').trim(),
    content: String(entry.content || '').trim(),
    time: entry.time || Date.now(),
    parentStoryId: entry.parentStoryId ? String(entry.parentStoryId) : '',
    collectionId: collectionId,
    history:
      entry.history != null
        ? entry.history.slice()
        : existing && Array.isArray(existing.history)
          ? existing.history.slice()
          : []
  };
  const idx = list.findIndex((s) => s.id === story.id);
  if (idx >= 0) {
    list[idx] = story;
  } else {
    list.unshift(story);
  }
  const work = workFromFavoriteItem(item) || { result: item.result };
  work.ocStories = list;
  work.ocStoryCollections = migrated.collections;
  const ok = updateFavoriteItem(favoriteId, work);
  if (ok) syncWorkOcStories(favoriteId, list, migrated.collections);
  return ok;
}

function saveStoryWithHistory(favoriteId, entry) {
  const item = getFavoriteById(favoriteId);
  if (!item) return false;
  const list = getStoriesFromItem(item);
  const existing = entry.id ? list.find((s) => s.id === entry.id) : null;
  let history =
    existing && Array.isArray(existing.history) ? existing.history.slice() : [];
  if (existing) {
    history.unshift({
      id: newHistoryId(),
      title: existing.title || '',
      content: existing.content || '',
      userPrompt: existing.userPrompt || '',
      time: existing.time || Date.now(),
      savedAt: Date.now()
    });
    if (history.length > MAX_STORY_HISTORY) {
      history = history.slice(0, MAX_STORY_HISTORY);
    }
  }
  return upsertStoryToFavorite(
    favoriteId,
    Object.assign({}, entry, { history: history })
  );
}

function saveStoryToFavorite(favoriteId, entry) {
  return upsertStoryToFavorite(favoriteId, entry);
}

function deleteStoryFromFavorite(favoriteId, storyId) {
  const migrated = ensureCollectionsMigrated(favoriteId);
  const item = getFavoriteById(favoriteId);
  if (!item) return false;
  const list = migrated.stories.filter((s) => s.id !== storyId);
  const work = workFromFavoriteItem(item) || { result: item.result };
  work.ocStories = list;
  work.ocStoryCollections = migrated.collections;
  const ok = updateFavoriteItem(favoriteId, work);
  if (ok) syncWorkOcStories(favoriteId, list, migrated.collections);
  return ok;
}

function _formatBackground(work) {
  const bg = work && work.background;
  if (!bg || !bg.worldview) return '';
  const lines = ['世界观：' + bg.worldview];
  const origins = (bg.origins || []).filter(Boolean);
  if (origins.length) lines.push('身世：' + origins.join('；'));
  const ev = (bg.lifeEvents || []).filter(Boolean);
  if (ev.length) lines.push('大事件：' + ev.join('；'));
  return lines.join('\n');
}

function bioPreviewLines(text, maxLines) {
  const n = typeof maxLines === 'number' && maxLines > 0 ? maxLines : 5;
  const t = String(text || '').trim();
  if (!t) return '';
  const lines = t.split(/\n/);
  if (lines.length <= n) return t;
  return lines.slice(0, n).join('\n') + '…';
}

function _formatLayer3(work) {
  const cp = (work && work.catchphrases) || [];
  const ad = (work && work.attitudes) || [];
  const lines = [];
  if (cp.filter(Boolean).length) {
    lines.push('常用语：' + cp.filter(Boolean).join(' / '));
  }
  if (ad.length) {
    lines.push(
      '态度：' +
        ad.map((a) => (a.event || '') + '→' + (a.attitude || '')).join('；')
    );
  }
  return lines.join('\n');
}

function _mapPickerEntry(id, item, work, r) {
  return {
    id: id,
    name: r.name || '未命名',
    race: r.race || '',
    gender: r.gender || '',
    age: r.age || '',
    hairColor: r.hairColor || '',
    eyeColor: r.eyeColor || '',
    personalityText: personalityBlend(r),
    quirkText: quirkBlend(r),
    hasBio: favoriteHasBio(item),
    bioText: String((item && item.generatedBio) || '').trim(),
    backgroundText: _formatBackground(work),
    layer3Text: _formatLayer3(work),
    summary: buildOcPromptFromWork(work),
    result: r
  };
}

function buildOcPickerList() {
  const list = getFavorites();
  const mapped = list.map((item) => {
    const work = workFromFavoriteItem(item) || item;
    const r = item.result || {};
    return _mapPickerEntry(item.id, item, work, r);
  });
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (!work.result || !isLayer3Ready(work)) return mapped;
  const favId = work.notebookFavoriteId;
  if (favId && mapped.some((m) => m.id === favId)) return mapped;
  const name = String(work.result.name || '').trim();
  if (mapped.some((m) => m.name === name && name)) return mapped;
  const pseudo = {
    generatedBio: work.generatedBio || '',
    result: work.result
  };
  mapped.unshift(
    _mapPickerEntry(favId || '__work__', pseudo, work, work.result)
  );
  return mapped;
}

function buildStoryPromptParts(favoriteId) {
  const item = getFavoriteById(favoriteId);
  if (!item || !favoriteHasBio(item)) return null;
  const work = workFromFavoriteItem(item);
  return {
    ocSetting: buildOcPromptFromWork(work),
    ocBio: String(item.generatedBio || '').trim()
  };
}

module.exports = {
  bioPreviewLines,
  formatBackgroundForWork: _formatBackground,
  formatLayer3ForWork: _formatLayer3,
  favoriteHasBio,
  newStoryId,
  getStoryHistoryList,
  formatHistoryTime,
  mapHistoryForDisplay,
  saveStoryWithHistory,
  getSeriesBaseTitle,
  getChapterIndex,
  buildChapterSuffix,
  normalizeChapterTitle,
  buildNextChapterTitle,
  storyFirstParagraph,
  storyPreviewParagraphs,
  storyPreviewBlocks,
  getStoriesFromItem,
  getStoryFromFavorite,
  upsertStoryToFavorite,
  saveStoryToFavorite,
  deleteStoryFromFavorite,
  buildOcPickerList,
  buildStoryPromptParts,
  DEFAULT_COLLECTION_ID,
  DEFAULT_COLLECTION_NAME,
  FREE_COLLECTION_LIMIT,
  VIP_COLLECTION_LIMIT,
  getCollectionLimit,
  ensureCollectionsMigrated,
  listCollections,
  getStoriesInCollection,
  createCollection,
  renameCollection,
  moveStoryToCollection,
  pickCollection
};
