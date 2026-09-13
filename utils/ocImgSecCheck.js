/**
 * 用户图片内容安全（客户端）
 * 流程：压缩 → 临时上传云存储 → 云函数 imgSecCheck → 清理临时文件
 */
const { callCloudFunction, ensureCloudReady } = require('./cloudInit.js');

const MAX_CHECK_BYTES = 900 * 1024;
const TEMP_PREFIX = 'oc_img_sec_tmp/';

function contentTypeOf(path) {
  const s = String(path || '').toLowerCase();
  if (/\.png(\?|$)/.test(s)) return 'image/png';
  if (/\.gif(\?|$)/.test(s)) return 'image/gif';
  return 'image/jpeg';
}

function getFileSize(filePath) {
  return new Promise((resolve) => {
    if (!filePath || typeof wx.getFileSystemManager !== 'function') {
      resolve(0);
      return;
    }
    const fs = wx.getFileSystemManager();
    if (typeof fs.getFileInfo !== 'function') {
      resolve(0);
      return;
    }
    fs.getFileInfo({
      filePath: filePath,
      success: (res) => resolve(Number(res && res.size) || 0),
      fail: () => resolve(0)
    });
  });
}

function compressOnce(src, quality) {
  return new Promise((resolve) => {
    if (!src || typeof wx.compressImage !== 'function') {
      resolve(src || '');
      return;
    }
    wx.compressImage({
      src: src,
      quality: quality,
      success: (res) => resolve((res && res.tempFilePath) || src),
      fail: () => resolve(src)
    });
  });
}

/** 尽量压到审核接口 1MB 限制内 */
async function prepareCheckPath(localPath) {
  let path = String(localPath || '').trim();
  if (!path) throw new Error('未获取到图片');
  let size = await getFileSize(path);
  if (size && size <= MAX_CHECK_BYTES) return path;

  const qualities = [72, 55, 40, 28];
  for (let i = 0; i < qualities.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    path = await compressOnce(path, qualities[i]);
    // eslint-disable-next-line no-await-in-loop
    size = await getFileSize(path);
    if (!size || size <= MAX_CHECK_BYTES) return path;
  }
  if (size > 1024 * 1024) {
    throw new Error('图片过大，请换一张较小的图');
  }
  return path;
}

function uploadTemp(filePath) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('云开发不可用'));
      return;
    }
    const cloudPath =
      TEMP_PREFIX +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '.jpg';
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: (up) => {
        const fileID = (up && up.fileID) || '';
        if (!fileID) {
          reject(new Error('临时上传失败'));
          return;
        }
        resolve(fileID);
      },
      fail: (err) =>
        reject(new Error((err && err.errMsg) || '临时上传失败'))
    });
  });
}

function cleanupTemp(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.deleteFile !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    wx.cloud.deleteFile({
      fileList: [fileID],
      complete: () => resolve()
    });
  });
}

/**
 * 审核用户本地图片；违规或不通过则 throw
 * @param {string} localPath
 * @returns {Promise<{pass:boolean}>}
 */
async function assertUserImageSafe(localPath) {
  try {
    if (!require('./ocAppFeatures.js').isImgSecCheckEnabled()) {
      return { pass: true, skipped: true };
    }
  } catch (_) {
    // 功能开关模块异常时不拦截上传
    return { pass: true, skipped: true };
  }
  if (!ensureCloudReady()) {
    throw new Error('云开发未就绪，无法审核图片');
  }
  const checkPath = await prepareCheckPath(localPath);
  let fileID = '';
  try {
    fileID = await uploadTemp(checkPath);
    const res = await callCloudFunction({
      name: 'imgSecCheck',
      data: {
        action: 'check',
        fileID: fileID,
        contentType: contentTypeOf(checkPath),
        keepFile: false
      },
      timeout: 25000
    });
    fileID = ''; // 云函数侧通常已删
    const r = (res && res.result) || {};
    if (r.pass === true) {
      return { pass: true };
    }
    if (r.risky || r.errCode === 87014) {
      const err = new Error(r.errMsg || '图片含违规内容，无法使用');
      err.code = 'IMG_RISKY';
      err.risky = true;
      throw err;
    }
    const err = new Error(
      (r.errMsg && String(r.errMsg).slice(0, 80)) || '图片审核未通过，请换图重试'
    );
    err.code = 'IMG_CHECK_FAIL';
    throw err;
  } catch (e) {
    if (fileID) cleanupTemp(fileID);
    if (e && (e.risky || e.code === 'IMG_RISKY' || e.code === 'IMG_CHECK_FAIL')) {
      throw e;
    }
    const msg = String((e && (e.message || e.errMsg)) || e || '');
    if (/FUNCTION_NOT_FOUND|FunctionName|找不到函数/i.test(msg)) {
      const err = new Error(
        '请先部署云函数 imgSecCheck（右键 → 上传并部署：云端安装依赖）'
      );
      err.code = 'IMG_CHECK_UNDEPLOYED';
      throw err;
    }
    if (/87014|违规|risky/i.test(msg)) {
      const err = new Error('图片含违规内容，无法使用');
      err.code = 'IMG_RISKY';
      err.risky = true;
      throw err;
    }
    throw new Error(msg.slice(0, 80) || '图片审核失败');
  }
}

/** 批量审核；任一张违规则中断并抛错 */
async function assertUserImagesSafe(paths) {
  const list = (paths || []).map((p) => String(p || '').trim()).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await assertUserImageSafe(list[i]);
  }
  return { pass: true, count: list.length };
}

module.exports = {
  assertUserImageSafe,
  assertUserImagesSafe
};
