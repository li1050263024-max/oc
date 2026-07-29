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

module.exports = {
  saveMomentsCoverFromTemp,
  resolveMomentsCoverUrl
};
