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
    hasBio: !!bioText
  };
}

function _hasValidResult(item) {
  return !!(item && item.result && String(item.result.name || '').trim());
}

/**
 * 设定本中可用于社交入口的 OC（有姓名即可出现在对话列表；
 * 无小传时聊天会再弹窗引导填写）
 */
function getOcsForSocial() {
  const mapped = [];
  const seenId = {};
  const seenName = {};

  const favs = safeGetFavorites();
  if (Array.isArray(favs)) {
    favs.forEach((item) => {
      if (!_hasValidResult(item)) return;
      const work = workFromFavoriteItem(item);
      if (!work || !work.result) return;
      const rawName = String(item.result.name || '').trim();
      if (seenId[item.id] || (rawName && seenName[rawName])) return;
      seenId[item.id] = true;
      if (rawName) seenName[rawName] = true;
      mapped.push(
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
    const rawName = String(work.result.name || '').trim();
    if (!seenId[favId] && !(rawName && seenName[rawName])) {
      mapped.unshift(
        mapEligibleItem(
          favId,
          work.result.name || '进行中 OC',
          work,
          '',
          {
            chatAvatarPath: work.chatAvatarPath,
            ocImagePath: work.ocImagePath,
            ocImages: work.ocImages
          }
        )
      );
    }
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
