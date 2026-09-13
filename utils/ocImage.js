const OC_IMAGE_BASENAME = 'oc_notebook_image';
const MAX_OC_IMAGES = 36;

function getUserDataDir() {
  if (typeof wx === 'undefined') return '';
  const env = wx.env || {};
  return env.USER_DATA_PATH || env.USERDATA_PATH || '';
}

function joinUserPath(fileName) {
  const base = getUserDataDir().replace(/\/+$/, '');
  if (!base) return '';
  const name = String(fileName || '').replace(/^\/+/, '');
  if (!name) return '';
  return `${base}/${name}`;
}

function normalizeImageExt(ext) {
  const e = String(ext || 'jpg').toLowerCase();
  if (e === 'jpeg') return 'jpg';
  if (e === 'jpg' || e === 'png' || e === 'webp' || e === 'gif') return e;
  return 'jpg';
}

function safePathToken(value, fallback) {
  const token = String(value || fallback || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
  return token || String(fallback || 'x');
}

function extractImageExt(filePath) {
  const match = String(filePath || '').match(/\.([a-zA-Z0-9]+)(\?.*)?$/);
  return normalizeImageExt(match ? match[1] : 'jpg');
}

function newOcImageId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getImageDestPath(ext) {
  return joinUserPath(`${OC_IMAGE_BASENAME}.${normalizeImageExt(ext)}`);
}

function buildOcImageFileName(favoriteId, imageId, ext) {
  const suffix = normalizeImageExt(ext);
  const safeId = safePathToken(imageId, newOcImageId()).slice(0, 32);
  if (favoriteId) {
    const safeFav = safePathToken(favoriteId, 'fav').slice(0, 24);
    return `ocimg_${safeFav}_${safeId}.${suffix}`;
  }
  return `ocimg_d_${safeId}.${suffix}`;
}

function getOcImageListPath(favoriteId, imageId, ext) {
  return joinUserPath(buildOcImageFileName(favoriteId, imageId, ext));
}

function normalizeOcImageEntry(entry) {
  if (!entry || !entry.path) return null;
  return {
    id: entry.id || newOcImageId(),
    path: String(entry.path),
    time: entry.time || Date.now()
  };
}

function normalizeOcImageList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeOcImageEntry).filter(Boolean);
}

function primaryImagePath(images, legacyPath) {
  const list = normalizeOcImageList(images);
  if (list.length) return list[0].path;
  return legacyPath || '';
}

/** 列表展示用：同步取路径，不扫文件系统（避免白屏/卡顿） */
function getDisplayImagePathQuick(workOrItem) {
  if (!workOrItem) return '';
  try {
    if (Array.isArray(workOrItem.ocAlbums) && workOrItem.ocAlbums.length) {
      const ocAlbum = require('./ocAlbum.js');
      const flat = ocAlbum.flattenAlbumImages(workOrItem.ocAlbums);
      const fromAlbums = primaryImagePath(flat, '');
      if (fromAlbums) return fromAlbums;
    }
  } catch (_) {}
  return primaryImagePath(workOrItem.ocImages, workOrItem.ocImagePath || '');
}

function unlinkQuiet(fs, filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve();
      return;
    }
    fs.unlink({
      filePath,
      success: () => resolve(),
      fail: () => resolve()
    });
  });
}

function isEphemeralTempPath(filePath) {
  const s = String(filePath || '');
  if (!s) return false;
  const base = getUserDataDir();
  if (base && s.indexOf(base) === 0) return false;
  return /^https?:\/\//i.test(s) || /^wxfile:\/\//i.test(s);
}

function makePickStagingPath(tempFilePath) {
  return joinUserPath(
    `oc_pick_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${extractImageExt(tempFilePath)}`
  );
}

function isHttpTmpPath(filePath) {
  return /^https?:\/\/tmp\//i.test(String(filePath || ''));
}

/** 在 chooseImage/chooseMedia 的 success 回调里同步调用，抢在 http://tmp 失效前复制 */
function stabilizeTempImagePathSync(tempFilePath) {
  if (!tempFilePath) return '';
  const base = getUserDataDir();
  if (!base) return '';
  if (String(tempFilePath).indexOf(base) === 0) return tempFilePath;

  const staging = makePickStagingPath(tempFilePath);
  if (!staging) return '';

  const fs = wx.getFileSystemManager();
  try {
    if (typeof fs.readFileSync === 'function' && typeof fs.writeFileSync === 'function') {
      const data = fs.readFileSync(tempFilePath);
      fs.writeFileSync(staging, data);
      return staging;
    }
  } catch (e) {
    console.warn('[ocImage] readFileSync failed', tempFilePath, e);
  }

  try {
    if (typeof fs.copyFileSync === 'function') {
      fs.copyFileSync(tempFilePath, staging);
      return staging;
    }
  } catch (e) {
    console.warn('[ocImage] copyFileSync failed', tempFilePath, e);
  }

  return '';
}

function formatFsError(err, fallback) {
  if (!err) return fallback || '未知错误';
  if (typeof err === 'string') return err;
  return String(err.errMsg || err.message || fallback || '未知错误');
}

function isStorageQuotaError(err) {
  const msg = formatFsError(err, '').toLowerCase();
  return (
    msg.indexOf('exceeded the maximum size') >= 0 ||
    msg.indexOf('storage limit') >= 0 ||
    msg.indexOf('quota') >= 0 ||
    msg.indexOf('空间') >= 0 ||
    msg.indexOf('存储') >= 0
  );
}

function pathFileName(filePath) {
  const s = stripDisplayCache(String(filePath || '').trim()).replace(/\\/g, '/');
  if (!s) return '';
  const parts = s.split('/');
  return parts[parts.length - 1] || '';
}

function collectReferencedImagePaths() {
  const paths = new Set();
  const names = new Set();
  const add = (p) => {
    const s = stripDisplayCache(String(p || '').trim());
    if (!s) return;
    // 开发者工具可能存成 http://127.0.0.1/.../__usr__/xxx.jpg，仍按文件名保护
    const name = pathFileName(s);
    if (name) names.add(name);
    if (!/^https?:\/\//i.test(s)) paths.add(s);
  };
  const scanWork = (w) => {
    if (!w || typeof w !== 'object') return;
    add(w.ocImagePath);
    add(w.chatAvatarPath);
    add(w.chatBackgroundPath);
    (w.ocImages || []).forEach((img) => add(img && img.path));
    (w.ocAlbums || []).forEach((alb) => {
      ((alb && alb.images) || []).forEach((img) => add(img && img.path));
    });
    if (w.profileScene) {
      add(w.profileScene.worldTimelineBg);
      add(w.profileScene.relationGraphBg);
    }
    (w.relationships || []).forEach((r) => add(r && r.avatarPath));
  };
  let favs = [];
  let work = {};
  try {
    favs = wx.getStorageSync('oc_favorites') || [];
  } catch (e) {
    favs = [];
  }
  try {
    work = wx.getStorageSync('oc_work_in_progress') || {};
  } catch (e) {
    work = {};
  }
  favs.forEach((fav) => scanWork(fav));
  scanWork(work);
  // 抖音缓存里的图也要保护，避免清缓存式 cleanup 删掉正在播的图
  try {
    const feed = wx.getStorageSync('oc_douyin_feed') || [];
    (Array.isArray(feed) ? feed : []).forEach((clip) => {
      if (!clip) return;
      add(clip.imagePath);
      (clip.images || []).forEach((img) => add(img && img.path));
    });
  } catch (_) {}
  return { paths, names };
}

let _userDataNamesCache = null;
let _userDataNamesCacheAt = 0;
const USER_DATA_NAMES_TTL_MS = 8000;

function listUserDataFileNames() {
  const base = getUserDataDir();
  if (!base) return Promise.resolve([]);
  const now = Date.now();
  if (_userDataNamesCache && now - _userDataNamesCacheAt < USER_DATA_NAMES_TTL_MS) {
    return Promise.resolve(_userDataNamesCache);
  }
  const fs = wx.getFileSystemManager();
  if (typeof fs.readdir !== 'function') return Promise.resolve([]);
  return new Promise((resolve) => {
    fs.readdir({
      dirPath: base,
      success(res) {
        const files = (res && res.files) || [];
        _userDataNamesCache = files;
        _userDataNamesCacheAt = Date.now();
        resolve(files);
      },
      fail: () => resolve(_userDataNamesCache || [])
    });
  });
}

function invalidateUserDataNamesCache() {
  _userDataNamesCache = null;
  _userDataNamesCacheAt = 0;
}

/** 按 imageId / favoriteId 在 USER_DATA_PATH 里找回立绘文件 */
async function findUserImageByIdToken(favoriteId, imageId) {
  const idTok = safePathToken(imageId, '').slice(0, 32);
  if (!idTok) return '';
  const favTok = favoriteId ? safePathToken(favoriteId, 'fav').slice(0, 24) : '';
  const names = await listUserDataFileNames();
  let fallback = '';
  // 先按文件名匹配，再最多验证少量候选，避免对整目录逐个 getFileInfo
  const candidates = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || '');
    if (!/^ocimg_/i.test(name)) continue;
    if (name.indexOf(idTok) < 0) continue;
    candidates.push(name);
  }
  candidates.sort((a, b) => {
    const af = favTok && a.indexOf(favTok) >= 0 ? 0 : 1;
    const bf = favTok && b.indexOf(favTok) >= 0 ? 0 : 1;
    return af - bf;
  });
  const limit = Math.min(candidates.length, 4);
  for (let i = 0; i < limit; i++) {
    const full = joinUserPath(candidates[i]);
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(full)) {
      if (favTok && candidates[i].indexOf(favTok) >= 0) return full;
      if (!fallback) fallback = full;
    }
  }
  return fallback;
}

function isRemovableUserImageName(name) {
  const n = String(name || '');
  if (!n || n.indexOf('.') < 0) return false;
  return (
    /^oc_pick_/i.test(n) ||
    /^ocimg_/i.test(n) ||
    /^ocimg_d_/i.test(n) ||
    /^oc_fav_/i.test(n) ||
    /^oc_notebook_image\./i.test(n) ||
    /^oc_chat_/i.test(n) ||
    /^oc_group_chat_bg_/i.test(n) ||
    /^oc_image_/i.test(n) ||
    /^oc_gallery_/i.test(n)
  );
}

/** 清理 USER_DATA_PATH 下未引用的图片与选图临时文件，释放本地 10MB 配额 */
async function cleanupUserImageStorage(extraKeepPaths) {
  const base = getUserDataDir();
  if (!base) return { deleted: 0 };
  const ref = collectReferencedImagePaths();
  const referenced = ref.paths;
  const referencedNames = ref.names;
  (Array.isArray(extraKeepPaths) ? extraKeepPaths : []).forEach((p) => {
    const s = stripDisplayCache(String(p || '').trim());
    if (!s) return;
    const name = pathFileName(s);
    if (name) referencedNames.add(name);
    if (!/^https?:\/\//i.test(s)) referenced.add(s);
  });
  const names = await listUserDataFileNames();
  let deleted = 0;
  for (let i = 0; i < names.length; i += 1) {
    const name = String(names[i] || '');
    if (!isRemovableUserImageName(name)) continue;
    const full = joinUserPath(name);
    if (!full) continue;
    const isPick = /^oc_pick_/i.test(name);
    // 关键：按完整路径或文件名任一命中即保留（修路径格式不一致导致的误删）
    if (!isPick && (referenced.has(full) || referencedNames.has(name))) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await removeImageFile(full);
    if (ok) deleted += 1;
  }
  return { deleted };
}

/** 选图 success 回调内尽快调用，将临时图转为 USER_DATA_PATH 下的稳定路径 */
function ensurePersistedPickPath(tempFilePath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('未获取到图片'));
      return;
    }
    const base = getUserDataDir();
    if (!base) {
      reject(new Error('当前环境不支持保存图片（无 USER_DATA_PATH）'));
      return;
    }
    if (String(tempFilePath).indexOf(base) === 0) {
      resolve(tempFilePath);
      return;
    }

    const syncPath = stabilizeTempImagePathSync(tempFilePath);
    if (syncPath) {
      resolve(syncPath);
      return;
    }

    const fs = wx.getFileSystemManager();
    const fail = (err, fb) => {
      if (isStorageQuotaError(err)) {
        try {
          const clean = require('./ocLocalStorageClean.js');
          reject(
            clean.makeStorageFullError(
              '本地存储已满（约10MB上限）。请删除部分立绘、自定义 BGM 或未引用缓存后重试'
            )
          );
        } catch (_) {
          const e = new Error(
            '本地存储已满（约10MB上限）。请删除部分立绘或缓存后重试'
          );
          e.storageFull = true;
          reject(e);
        }
        return;
      }
      reject(new Error(formatFsError(err, fb || '临时图片读取失败')));
    };

    const saveTemp = (src, onFail, retried) => {
      if (typeof fs.saveFile !== 'function') {
        onFail(new Error('不支持 saveFile'));
        return;
      }
      fs.saveFile({
        tempFilePath: src,
        success(res) {
          const saved = (res && res.savedFilePath) || '';
          if (!saved) {
            onFail(new Error('saveFile 未返回路径'));
            return;
          }
          resolve(saved);
        },
        fail(err) {
          if (!retried && isStorageQuotaError(err)) {
            cleanupUserImageStorage()
              .then(({ deleted }) => {
                if (deleted > 0) saveTemp(src, onFail, true);
                else onFail(err);
              })
              .catch(() => onFail(err));
            return;
          }
          onFail(err);
        }
      });
    };

    const runCompressThenSave = (src, prevErr) => {
      if (typeof wx.compressImage !== 'function') {
        saveTemp(src, (err) => fail(err || prevErr, '临时图片保存失败'));
        return;
      }
      wx.compressImage({
        src,
        quality: 75,
        success(cmp) {
          const next = cmp && cmp.tempFilePath;
          if (!next) {
            fail(prevErr, 'compressImage 未返回路径');
            return;
          }
          saveTemp(next, (err) => fail(err || prevErr, '压缩后保存失败'));
        },
        fail(err) {
          saveTemp(src, (e) => fail(e || err || prevErr, '压缩与保存均失败'));
        }
    });
  };

    if (isHttpTmpPath(tempFilePath) || isEphemeralTempPath(tempFilePath)) {
      runCompressThenSave(tempFilePath);
      return;
    }

    saveTemp(tempFilePath, (err) => fail(err, '临时图片保存失败'));
  });
}

function saveTempToStaging(tempFilePath) {
  return ensurePersistedPickPath(tempFilePath);
}

/** 在选图 success 回调内调用；开发者工具 http://tmp 需先 compressImage 再 saveFile */
function captureTempImagePath(tempFilePath) {
  return ensurePersistedPickPath(tempFilePath);
}

/** 选图后立即把 http://tmp 等临时路径复制到 USER_DATA_PATH，避免稍后 saveFile 时文件已失效 */
function stabilizeTempImagePath(tempFilePath) {
  const syncPath = stabilizeTempImagePathSync(tempFilePath);
  if (syncPath) return Promise.resolve(syncPath);
  return captureTempImagePath(tempFilePath);
}

function persistTempImage(tempFilePath, destPath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('未获取到图片'));
      return;
    }
    const base = getUserDataDir();
    if (!base) {
      reject(new Error('当前环境不支持保存图片'));
      return;
    }

    const fs = wx.getFileSystemManager();
    const dest =
      destPath && String(destPath).indexOf(base) === 0
        ? destPath
        : joinUserPath(
            destPath
              ? String(destPath).replace(/^\/+/, '').split('/').pop()
              : `ocimg_${Date.now()}.${extractImageExt(tempFilePath)}`
          );

    if (!dest) {
      reject(new Error('当前环境不支持保存图片'));
      return;
    }

    if (tempFilePath === dest) {
      resolve(dest);
      return;
    }

    const done = (path, prevErr) => {
      if (path) {
        resolve(path);
        return;
      }
      reject(prevErr || new Error('保存图片失败'));
    };

    const tryAutoSave = (prevErr) => {
      if (typeof fs.saveFile !== 'function') {
        done('', prevErr || new Error('保存图片失败'));
        return;
      }
      fs.saveFile({
        tempFilePath,
        success(res) {
          const saved = (res && res.savedFilePath) || '';
          if (!saved) {
            done('', prevErr || new Error('saveFile 未返回路径'));
            return;
          }
          if (saved === dest) {
            done(dest);
            return;
          }
          fs.copyFile({
            srcPath: saved,
            destPath: dest,
            success: () => done(dest),
            fail: (err) => done(saved, err)
          });
        },
        fail(err) {
          done('', err || prevErr);
        }
      });
    };

    const tryReadWrite = (prevErr) => {
      fs.readFile({
        filePath: tempFilePath,
        success(readRes) {
          unlinkQuiet(fs, dest).then(() => {
            fs.writeFile({
              filePath: dest,
              data: readRes.data,
              success: () => done(dest),
              fail: (err) => tryAutoSave(err || prevErr)
            });
          });
        },
        fail: (err) => tryAutoSave(err || prevErr)
      });
    };

    const tryCopy = (prevErr) => {
      fs.copyFile({
        srcPath: tempFilePath,
        destPath: dest,
        success: () => done(dest),
        fail: (err) => tryReadWrite(err || prevErr)
      });
    };

    unlinkQuiet(fs, dest).then(() => {
      if (isEphemeralTempPath(tempFilePath)) {
        tryReadWrite();
        return;
      }
      if (typeof fs.saveFile !== 'function') {
        tryCopy();
        return;
      }
      fs.copyFile({
        srcPath: tempFilePath,
        destPath: dest,
        success: () => done(dest),
        fail: () => tryCopy()
      });
    });
  });
}

async function saveImageFromTempToDest(tempFilePath, destPath, options) {
  const opts = options || {};
  if (!opts.skipSecCheck) {
    await require('./ocImgSecCheck.js').assertUserImageSafe(tempFilePath);
  }
  return persistTempImage(tempFilePath, destPath);
}

function saveOcImageFromTemp(tempFilePath, favoriteId) {
  return saveOcImageListFromTemp(tempFilePath, favoriteId);
}

async function saveOcImageListFromTemp(tempFilePath, favoriteId, extraKeepPaths) {
  if (!tempFilePath) throw new Error('未获取到图片');
  await require('./ocImgSecCheck.js').assertUserImageSafe(tempFilePath);
  const id = newOcImageId();
  const ext = extractImageExt(tempFilePath);
  const dest = getOcImageListPath(favoriteId || '', id, ext);
  const persistOnce = () => persistTempImage(tempFilePath, dest);
  try {
    const saved = await persistOnce();
    return { id, path: saved, time: Date.now() };
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err;
    const { deleted } = await cleanupUserImageStorage(extraKeepPaths);
    if (!deleted) {
      throw new Error(
        '本地存储已满（约10MB上限），请删除部分立绘或在开发者工具「清缓存」后重试'
      );
    }
    const saved = await persistOnce();
    return { id, path: saved, time: Date.now() };
  }
}

function removeImageFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(false);
      return;
    }
    const fs = wx.getFileSystemManager();
    fs.unlink({
      filePath,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

async function removeOcImageFiles(list) {
  const items = normalizeOcImageList(list);
  for (let i = 0; i < items.length; i += 1) {
    await removeImageFile(items[i].path);
  }
}

function removeFavoriteImageFile(favoriteId) {
  return removeAllFavoriteOcImages(favoriteId);
}

async function removeAllFavoriteOcImages(favoriteId) {
  if (!favoriteId) return false;
  await removeImageFile(getFavoriteImagePath(favoriteId));
  return true;
}

function removeOcImageFile() {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager();
    const targets = ['jpg', 'jpeg', 'png', 'webp'].map((e) => getImageDestPath(e)).filter(Boolean);
    if (!targets.length) {
      resolve(false);
      return;
    }
    let pending = targets.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) resolve(true);
    };
    targets.forEach((p) => {
      fs.unlink({ filePath: p, success: done, fail: done });
    });
  });
}

function fileExists(filePath) {
  return new Promise((resolve) => {
    const path = stripDisplayCache(filePath);
    if (!path) {
      resolve(false);
      return;
    }
    const fs = wx.getFileSystemManager();
    if (typeof fs.getFileInfo === 'function') {
      fs.getFileInfo({
        filePath: path,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
      return;
    }
    fs.access({
      path,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function getFavoriteImagePath(favoriteId) {
  return joinUserPath(`oc_fav_${safePathToken(favoriteId, 'fav')}.jpg`);
}

async function filterExistingImages(list) {
  const normalized = normalizeOcImageList(list);
  const out = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const item = normalized[i];
    if (await fileExists(item.path)) out.push(item);
  }
  return out;
}

async function copyImageItem(srcPath, favoriteId, imageId, ext) {
  const dest = getOcImageListPath(favoriteId, imageId, ext);
  if (!dest) throw new Error('当前环境不支持保存图片');
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fs.copyFile({
      srcPath,
      destPath: dest,
      success: () => resolve(dest),
      fail: () => {
      fs.readFile({
        filePath: srcPath,
        success(readRes) {
            fs.writeFile({
              filePath: dest,
              data: readRes.data,
              success: () => resolve(dest),
              fail: (err) => reject(err)
          });
        },
        fail: (err) => reject(err)
      });
      }
    });
  });
}

async function migrateImagesToFavorite(images, favoriteId) {
  if (!favoriteId) return normalizeOcImageList(images);
  const list = normalizeOcImageList(images);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!(await fileExists(item.path))) continue;
    const favPrefix = `ocimg_${safePathToken(favoriteId, 'fav')}_`;
    const legacyFav = getFavoriteImagePath(favoriteId);
    if (
      item.path.indexOf(favPrefix) >= 0 ||
      item.path.indexOf(`oc_image_${favoriteId}_`) >= 0 ||
      item.path === legacyFav
    ) {
      out.push(item);
      continue;
    }
    const newId = newOcImageId();
    const ext = extractImageExt(item.path);
    try {
      const dest = await copyImageItem(item.path, favoriteId, newId, ext);
      if (
        item.path.indexOf('ocimg_d_') >= 0 ||
        item.path.indexOf('oc_image_draft_') >= 0 ||
        item.path.indexOf('oc_gallery_draft_') >= 0 ||
        item.path.indexOf(OC_IMAGE_BASENAME) >= 0
      ) {
        await removeImageFile(item.path);
      }
      out.push({ id: newId, path: dest, time: item.time || Date.now() });
    } catch (e) {
      out.push(item);
    }
  }
  return out;
}

function copyImageForFavorite(srcPath, favoriteId) {
  return copyImageItem(srcPath, favoriteId, newOcImageId(), 'jpg');
}

function mergeImageLists(primary, secondary) {
  const map = {};
  normalizeOcImageList(secondary).forEach((img) => {
    map[img.path] = img;
  });
  normalizeOcImageList(primary).forEach((img) => {
    map[img.path] = img;
  });
  return Object.values(map).sort((a, b) => (a.time || 0) - (b.time || 0));
}

async function normalizeWorkImages(work) {
  if (!work || typeof work !== 'object') return [];
  let images = normalizeOcImageList(work.ocImages);
  const seen = new Set(images.map((x) => x.path));

  if (work.ocImagePath && !seen.has(work.ocImagePath)) {
    images.unshift({
      id: newOcImageId(),
      path: work.ocImagePath,
      time: Date.now()
    });
    seen.add(work.ocImagePath);
  }

  if (Array.isArray(work.ocGallery)) {
    for (let i = 0; i < work.ocGallery.length; i += 1) {
      const g = work.ocGallery[i];
      if (g && g.path && !seen.has(g.path)) {
        images.push({
          id: g.id || newOcImageId(),
          path: g.path,
          time: g.time || Date.now()
        });
        seen.add(g.path);
      }
    }
  }

  images = await filterExistingImages(images);
  work.ocImages = images;
  work.ocImagePath = primaryImagePath(images, '');
  delete work.ocGallery;
  return images;
}

function syncPrimaryImagePath(work) {
  if (!work || typeof work !== 'object') return;
  work.ocImagePath = primaryImagePath(work.ocImages, work.ocImagePath || '');
}

function getChatOcAvatarPath(id) {
  return joinUserPath(`oc_chat_avatar_${safePathToken(id, 'oc')}.jpg`);
}

function getUserChatAvatarPath() {
  return joinUserPath('oc_chat_user_avatar.jpg');
}

function getChatBackgroundPath(id) {
  return joinUserPath(`oc_chat_bg_${safePathToken(id, 'oc')}.jpg`);
}

function getGroupChatBackgroundPath(roomId) {
  return joinUserPath(`oc_group_chat_bg_${safePathToken(roomId, 'room')}.jpg`);
}

function getProfileSceneBgPath(favoriteId, field, ext) {
  const safeFav = safePathToken(favoriteId, 'fav').slice(0, 24);
  const tag = field === 'relationGraphBg' ? 'relbg' : 'tlbg';
  return joinUserPath(`oc_scene_${safeFav}_${tag}.${normalizeImageExt(ext)}`);
}

async function saveProfileSceneBgFromTemp(favoriteId, field, tempFilePath, oldPath) {
  if (!tempFilePath) throw new Error('未获取到图片');
  const favId = safePathToken(favoriteId, 'fav').slice(0, 24);
  const tag = field === 'relationGraphBg' ? 'relbg' : 'tlbg';
  const ext = extractImageExt(tempFilePath);
  const dest = getVersionedChatAssetPath(`oc_scene_${favId}_${tag}`, ext);

  // 已在 saveImageFromTempToDest 内审核
  const persistOnce = () => saveImageFromTempToDest(tempFilePath, dest);

  let saved = '';
  try {
    saved = await persistOnce();
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err;
    const { deleted } = await cleanupUserImageStorage();
    if (!deleted) {
      throw new Error('本地存储已满，请删除部分立绘后重试');
    }
    saved = await persistOnce();
  }

  const prev = String(oldPath || '').trim();
  if (prev && prev !== saved) {
    await removeImageFile(prev);
  }
  const legacy = getProfileSceneBgPath(favoriteId, field, ext);
  if (legacy && legacy !== saved && legacy !== prev) {
    await removeImageFile(legacy);
  }
  return saved;
}

async function resolveLocalImagePath(filePath) {
  const path = stripDisplayCache(filePath);
  if (!path) return '';
  if (await fileExists(path)) return path;
  return '';
}

/** 每次保存用新文件名，避免同路径覆盖后 image 组件仍显示旧图 */
function getVersionedChatAssetPath(namePrefix, ext) {
  const prefix = String(namePrefix || 'oc_asset').replace(/[^a-zA-Z0-9_-]/g, '') || 'oc_asset';
  return joinUserPath(`${prefix}_${Date.now()}.${normalizeImageExt(ext)}`);
}

function stripDisplayCache(url) {
  if (!url) return '';
  const s = String(url);
  const q = s.indexOf('?');
  if (q < 0) return s;
  const base = s.slice(0, q);
  const rest = s
    .slice(q + 1)
    .split('&')
    .filter((p) => p && !/^t=\d+$/.test(p));
  return rest.length ? base + '?' + rest.join('&') : base;
}

function setPageImageField(page, field, url) {
  const next = url ? String(url) : '';
  const prev = page.data[field] || '';
  return new Promise((resolve) => {
    if (!next) {
      page.setData({ [field]: '' }, resolve);
      return;
    }
    if (prev && stripDisplayCache(prev) === stripDisplayCache(next)) {
      page.setData({ [field]: '' }, () => {
        setTimeout(() => page.setData({ [field]: next }, resolve), 32);
      });
      return;
    }
    page.setData({ [field]: next }, resolve);
  });
}

async function resolveDisplayImagePath(workOrItem) {
  if (!workOrItem) return '';
  const target = workOrItem;
  await normalizeWorkImages(target);
  const img = primaryImagePath(target.ocImages, target.ocImagePath || '');
  if (!img) return '';
  return (await fileExists(img)) ? img : '';
}

/** 修复收藏图册里失效的本地路径（误删/路径格式变化后尽量找回文件） */
async function repairFavoriteAlbumImagePaths() {
  let list = [];
  try {
    list = wx.getStorageSync('oc_favorites') || [];
  } catch (_) {
    return { fixed: 0 };
  }
  if (!Array.isArray(list) || !list.length) return { fixed: 0 };
  let fixed = 0;
  const next = [];
  for (let i = 0; i < list.length; i++) {
    const fav = list[i];
    if (!fav || typeof fav !== 'object') {
      next.push(fav);
      continue;
    }
    const albums = Array.isArray(fav.ocAlbums) ? fav.ocAlbums : [];
    let favChanged = false;
    const newAlbums = [];
    for (let a = 0; a < albums.length; a++) {
      const alb = albums[a];
      if (!alb) {
        newAlbums.push(alb);
        continue;
      }
      const images = Array.isArray(alb.images) ? alb.images : [];
      const newImages = [];
      for (let j = 0; j < images.length; j++) {
        const img = images[j];
        if (!img || !img.path) {
          newImages.push(img);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        if (await fileExists(img.path)) {
          newImages.push(img);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const found = await findUserImageByIdToken(fav.id, img.id);
        if (found) {
          newImages.push(Object.assign({}, img, { path: found }));
          favChanged = true;
          fixed += 1;
        } else {
          newImages.push(img);
        }
      }
      newAlbums.push(Object.assign({}, alb, { images: newImages }));
    }
    if (favChanged) {
      const patched = Object.assign({}, fav, { ocAlbums: newAlbums });
      try {
        const ocAlbum = require('./ocAlbum.js');
        ocAlbum.syncWorkImagesFromAlbums(patched);
      } catch (_) {}
      next.push(patched);
    } else {
      next.push(fav);
    }
  }
  if (fixed > 0) {
    try {
      wx.setStorageSync('oc_favorites', next);
    } catch (_) {}
  }
  return { fixed };
}

module.exports = {
  MAX_OC_IMAGES,
  getImageDestPath,
  getFavoriteImagePath,
  getOcImageListPath,
  getChatOcAvatarPath,
  getUserChatAvatarPath,
  getChatBackgroundPath,
  getGroupChatBackgroundPath,
  getProfileSceneBgPath,
  saveProfileSceneBgFromTemp,
  resolveLocalImagePath,
  findUserImageByIdToken,
  normalizeOcImageList,
  normalizeOcImageEntry,
  primaryImagePath,
  mergeImageLists,
  saveOcImageFromTemp,
  saveOcImageListFromTemp,
  saveImageFromTempToDest,
  stabilizeTempImagePath,
  stabilizeTempImagePathSync,
  ensurePersistedPickPath,
  captureTempImagePath,
  cleanupUserImageStorage,
  repairFavoriteAlbumImagePaths,
  invalidateUserDataNamesCache,
  isStorageQuotaError,
  copyImageForFavorite,
  migrateImagesToFavorite,
  normalizeWorkImages,
  syncPrimaryImagePath,
  filterExistingImages,
  removeOcImageFile,
  removeFavoriteImageFile,
  removeImageFile,
  removeOcImageFiles,
  removeAllFavoriteOcImages,
  fileExists,
  extractImageExt,
  getVersionedChatAssetPath,
  stripDisplayCache,
  setPageImageField,
  resolveDisplayImagePath,
  getDisplayImagePathQuick
};
