const momentsStore = require('./ocMomentsStore.js');
const ocImage = require('./ocImage.js');

const COVER_NAME = 'moments_cover.jpg';

function coverDestPath() {
  if (!wx.env || !wx.env.USER_DATA_PATH) return '';
  return wx.env.USER_DATA_PATH + '/' + COVER_NAME;
}

async function saveMomentsCoverFromTemp(tempPath) {
  const src = String(tempPath || '').trim();
  if (!src) return '';
  await require('./ocImgSecCheck.js').assertUserImageSafe(src);
  const dest = coverDestPath();
  if (!dest) {
    momentsStore.setCoverPath(src);
    return src;
  }
  try {
    const fs = wx.getFileSystemManager();
    await new Promise((resolve, reject) => {
      fs.copyFile({
        srcPath: src,
        destPath: dest,
        success: resolve,
        fail: reject
      });
    });
    momentsStore.setCoverPath(dest);
    return dest;
  } catch (e) {
    momentsStore.setCoverPath(src);
    return src;
  }
}

async function resolveMomentsCoverUrl() {
  const stored = momentsStore.getCoverPath();
  if (!stored) return '';
  if (await ocImage.fileExists(stored)) return stored;
  momentsStore.setCoverPath('');
  return '';
}

async function saveMomentPostImagesFromTemp(tempPaths) {
  const list = Array.isArray(tempPaths) ? tempPaths : [];
  const out = [];
  const root = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '';
  for (let i = 0; i < list.length && out.length < 9; i++) {
    const src = String(list[i] || '').trim();
    if (!src) continue;
    const ext = ocImage.extractImageExt(src) || 'jpg';
    const id = 'umi_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
    if (!root) {
      out.push({ id: id, path: src, time: Date.now() });
      continue;
    }
    const dest = root + '/moments_post_' + id + '.' + ext;
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await ocImage.saveImageFromTempToDest(src, dest);
      out.push({ id: id, path: saved || src, time: Date.now() });
    } catch (_) {
      out.push({ id: id, path: src, time: Date.now() });
    }
  }
  return out;
}

module.exports = {
  saveMomentsCoverFromTemp,
  resolveMomentsCoverUrl,
  saveMomentPostImagesFromTemp
};
