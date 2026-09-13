const { safeGetFavorites } = require('./favoriteStore.js');
const { workFromFavoriteItem } = require('./favorite.js');
const { personalityBlend, quirkBlend } = require('./ocResult.js');
const ocImage = require('./ocImage.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

function mapEligibleItem(id, name, work, chatRemark, imageMeta) {
  const r = (work && work.result) || {};
  const display = (chatRemark && String(chatRemark).trim()) || name || '未命名';
  const meta = imageMeta || {};
  const avatarUrl =
    meta.chatAvatarPath ||
    ocImage.primaryImagePath(meta.ocImages, meta.ocImagePath) ||
    (work && work.chatAvatarPath) ||
    (work && ocImage.primaryImagePath(work.ocImages, work.ocImagePath)) ||
    '';
  const bioText = String((work && work.generatedBio) || '').trim();
  let albumImageCount = 0;
  try {
    const ocAlbum = require('./ocAlbum.js');
    const albums = ocAlbum.normalizeOcAlbums(work || {});
    (albums || []).forEach((a) => {
      albumImageCount += ((a && a.images) || []).length;
    });
  } catch (_) {}
  const hasPortrait = !!(avatarUrl || albumImageCount > 0);
  return {
    id,
    name: display,
    work,
    avatarUrl,
    race: r.race || '—',
    gender: r.gender || '—',
    age: r.age || '—',
    personalityText: personalityBlend(r),
    quirkText: quirkBlend(r),
    bioText,
    hasBio: !!bioText,
    hasPortrait: hasPortrait,
    albumImageCount: albumImageCount
  };
}

function _hasValidResult(item) {
  return !!(item && item.result && String(item.result.name || '').trim());
}

function _canonicalOcName(item) {
  if (!item) return '';
  const fromWork = item.work && item.work.result && item.work.result.name;
  return String(fromWork || item.name || '')
    .trim()
    .replace(/\s+/g, '');
}

/** 同名去重时优先保留「有小传 / 有图」更完整的那条 */
function _ocRichScore(row) {
  if (!row) return 0;
  let s = 0;
  if (row.hasBio) s += 20;
  if (row.hasPortrait) s += 10;
  s += Math.min(30, Number(row.albumImageCount) || 0);
  if (row.avatarUrl) s += 3;
  return s;
}

/**
 * 设定本中可用于社交入口的 OC（有姓名即可出现在对话列表；
 * 无小传时聊天会再弹窗引导填写）
 * 按 id 去重；同名时保留资料更完整的一条，避免新 OC 被旧空壳顶掉。
 */
function getOcsForSocial() {
  const mapped = [];
  const seenId = {};
  const seenNameIdx = {};

  const pushUnique = (row) => {
    if (!row || !row.id) return;
    if (seenId[row.id]) return;
    const nameKey = _canonicalOcName(row);
    if (nameKey && seenNameIdx[nameKey] != null) {
      const prevIdx = seenNameIdx[nameKey];
      const prev = mapped[prevIdx];
      if (_ocRichScore(row) > _ocRichScore(prev)) {
        delete seenId[prev.id];
        seenId[row.id] = true;
        mapped[prevIdx] = row;
      }
      return;
    }
    seenId[row.id] = true;
    if (nameKey) seenNameIdx[nameKey] = mapped.length;
    mapped.push(row);
  };

  const favs = safeGetFavorites();
  if (Array.isArray(favs)) {
    favs.forEach((item) => {
      if (!_hasValidResult(item)) return;
      const work = workFromFavoriteItem(item);
      if (!work || !work.result) return;
      pushUnique(
        mapEligibleItem(item.id, item.result.name || '未命名', work, item.chatRemark, {
          chatAvatarPath: item.chatAvatarPath,
          ocImagePath: item.ocImagePath,
          ocImages: item.ocImages
        })
      );
    });
  }

  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (work.result && String(work.result.name || '').trim()) {
    const favId = work.notebookFavoriteId || '__work__';
    // 进行中存档若已在收藏（同 id 或同名），不要再插一条
    pushUnique(
      mapEligibleItem(favId, work.result.name || '进行中 OC', work, '', {
        chatAvatarPath: work.chatAvatarPath,
        ocImagePath: work.ocImagePath,
        ocImages: work.ocImages
      })
    );
  }

  return mapped;
}

function hasAnyOcForSocial() {
  return getOcsForSocial().length > 0;
}

/** 仅含已有小传的 OC（朋友圈生成等） */
function getOcsWithBio() {
  return getOcsForSocial().filter((oc) => oc && oc.hasBio);
}

function hasAnyOcWithBio() {
  return getOcsWithBio().length > 0;
}

/** @deprecated 别名 */
function getOcsWithSettingAndBio() {
  return getOcsWithBio();
}

function hasAnyOcWithSettingAndBio() {
  return hasAnyOcWithBio();
}

module.exports = {
  getOcsForSocial,
  hasAnyOcForSocial,
  getOcsWithBio,
  hasAnyOcWithBio,
  getOcsWithSettingAndBio,
  hasAnyOcWithSettingAndBio
};
