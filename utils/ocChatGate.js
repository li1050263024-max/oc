/**
 * 与 OC 对话前必须已有人物小传（生成或自行粘贴/上传）。
 * 设定本中的 OC 会出现在聊天列表；无小传时弹窗引导填写。
 * 小传补全经历与关系，并可改写口吻；常用语为说话方式基础。
 */

const { getFavoriteById, workFromFavoriteItem } = require('./favorite.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

function workHasBio(work) {
  return !!(work && String(work.generatedBio || '').trim());
}

function resolveWorkForChat(ocId) {
  if (ocId && ocId !== '__work__') {
    const item = getFavoriteById(ocId);
    if (item) return workFromFavoriteItem(item);
  }
  return wx.getStorageSync(STORAGE_OC_WORK) || {};
}

function bioPageUrl(ocId) {
  if (ocId && ocId !== '__work__') {
    return '/pages/ocBio/ocBio?ocId=' + encodeURIComponent(ocId);
  }
  return '/pages/ocBio/ocBio';
}

/**
 * 无小传时弹窗引导去填写；有小传返回 true。
 * @returns {boolean}
 */
function ensureOcBioForChat(work, ocId) {
  if (workHasBio(work)) return true;
  const id = ocId || (work && work.notebookFavoriteId) || '';
  wx.showModal({
    title: '需要人物小传',
    content: '与 OC 对话前须先有人物小传',
    confirmText: '去填写',
    cancelText: '取消',
    success(res) {
      if (!res.confirm) return;
      wx.navigateTo({ url: bioPageUrl(id) });
    }
  });
  return false;
}

/** 按 ocId 检查；无小传则引导 */
function ensureOcIdBioForChat(ocId) {
  const work = resolveWorkForChat(ocId);
  return ensureOcBioForChat(work, ocId);
}

module.exports = {
  workHasBio,
  resolveWorkForChat,
  bioPageUrl,
  ensureOcBioForChat,
  ensureOcIdBioForChat
};
