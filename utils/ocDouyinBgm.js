const STORAGE_BGM_MAP = 'oc_douyin_bgm_by_oc';
const STORAGE_BGM_BY_CLIP = 'oc_douyin_bgm_by_clip';
const STORAGE_BGM_LEGACY = 'oc_douyin_bgm';
/** 每条抖音可记一条 BGM 绑定；超出按更新时间淘汰，避免撑爆本地存储 */
const MAX_CLIP_BGM = 80;
const MAX_BYTES = 15 * 1024 * 1024;
// 参考常见抖音下载体积：15–30s 约 5–20MB（压缩档），1080p 高码率约 20–35MB
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_DURATION_SEC = 60;
const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'ogg'];

function normalizeOcId(ocId) {
  return String(ocId || '').trim();
}

function getUserDataDir() {
  try {
    const env = wx.env || {};
    return env.USER_DATA_PATH || env.USERDATA_PATH || '';
  } catch (_) {
    return '';
  }
}

function safeToken(value, fallback) {
  const t = String(value || fallback || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
  return (t || String(fallback || 'x')).slice(0, 40);
}

function bgmDestPath(ocId, ext) {
  const base = getUserDataDir().replace(/\/+$/, '');
  if (!base) return '';
  const e = AUDIO_EXTS.indexOf(String(ext || '').toLowerCase()) >= 0 ? String(ext).toLowerCase() : 'mp3';
  return base + '/oc_dy_bgm_' + safeToken(ocId, 'oc') + '.' + e;
}

function readMap() {
  try {
    const raw = wx.getStorageSync(STORAGE_BGM_MAP);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.assign({}, raw);
  } catch (_) {}
  return {};
}

function writeMap(map) {
  try {
    wx.setStorageSync(STORAGE_BGM_MAP, map || {});
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeMeta(raw) {
  if (!raw || typeof raw !== 'object' || !raw.path) return null;
  return {
    path: String(raw.path || ''),
    name: String(raw.name || '自定义 BGM').slice(0, 80),
    updatedAt: Number(raw.updatedAt) || 0,
    isRemote: !!raw.isRemote,
    fileID: String(raw.fileID || ''),
    ocId: String(raw.ocId || '')
  };
}

function getBgm(ocId) {
  const id = normalizeOcId(ocId);
  if (!id) return null;
  const map = readMap();
  return normalizeMeta(map[id]);
}

function setBgm(ocId, meta) {
  const id = normalizeOcId(ocId);
  if (!id) return null;
  const map = readMap();
  if (!meta || !meta.path) {
    delete map[id];
    writeMap(map);
    return null;
  }
  const next = normalizeMeta(
    Object.assign({}, meta, {
      ocId: id,
      updatedAt: Number(meta.updatedAt) || Date.now()
    })
  );
  if (!next) return null;
  map[id] = next;
  writeMap(map);
  return next;
}

function clearBgm(ocId) {
  const id = normalizeOcId(ocId);
  const prev = getBgm(id);
  if (id) {
    const map = readMap();
    delete map[id];
    writeMap(map);
  }
  if (
    prev &&
    prev.path &&
    !prev.isRemote &&
    !/^https?:\/\//i.test(prev.path) &&
    !/^cloud:\/\//i.test(prev.path)
  ) {
    try {
      wx.getFileSystemManager().unlink({ filePath: prev.path, fail() {} });
    } catch (_) {}
  }
  return null;
}

function clearLegacyGlobalBgm() {
  try {
    const legacy = wx.getStorageSync(STORAGE_BGM_LEGACY);
    if (legacy) wx.removeStorageSync(STORAGE_BGM_LEGACY);
  } catch (_) {}
}

/** 本地自定义 BGM 清单（供存储清理页） */
function listLocalBgmEntries() {
  const map = readMap();
  const out = [];
  Object.keys(map).forEach((ocId) => {
    const m = normalizeMeta(map[ocId]);
    if (!m || !m.path || m.isRemote) return;
    if (/^https?:\/\//i.test(m.path) || /^cloud:\/\//i.test(m.path)) return;
    out.push({
      ocId: ocId,
      name: m.name || '自定义 BGM',
      path: m.path,
      updatedAt: m.updatedAt || 0
    });
  });
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

function readClipMap() {
  try {
    const raw = wx.getStorageSync(STORAGE_BGM_BY_CLIP);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.assign({}, raw);
  } catch (_) {}
  return {};
}

function writeClipMap(map) {
  try {
    wx.setStorageSync(STORAGE_BGM_BY_CLIP, map || {});
    return true;
  } catch (_) {
    return false;
  }
}

function pruneClipMap(map) {
  const keys = Object.keys(map || {});
  if (keys.length <= MAX_CLIP_BGM) return map || {};
  keys.sort((a, b) => {
    const ta = Number((map[a] && map[a].updatedAt) || 0);
    const tb = Number((map[b] && map[b].updatedAt) || 0);
    return ta - tb;
  });
  const drop = keys.length - MAX_CLIP_BGM;
  for (let i = 0; i < drop; i++) delete map[keys[i]];
  return map;
}

function normalizeClipId(clipId) {
  return String(clipId || '').trim();
}

function getClipBgm(clipId) {
  const id = normalizeClipId(clipId);
  if (!id) return null;
  return normalizeMeta(readClipMap()[id]);
}

function setClipBgm(clipId, meta) {
  const id = normalizeClipId(clipId);
  if (!id) return null;
  const map = readClipMap();
  if (!meta || !meta.path) {
    delete map[id];
    writeClipMap(map);
    return null;
  }
  const next = normalizeMeta(
    Object.assign({}, meta, {
      updatedAt: Number(meta.updatedAt) || Date.now()
    })
  );
  if (!next) return null;
  map[id] = next;
  writeClipMap(pruneClipMap(map));
  return next;
}

function clearClipBgm(clipId) {
  const id = normalizeClipId(clipId);
  if (!id) return null;
  const map = readClipMap();
  delete map[id];
  writeClipMap(map);
  return null;
}

function fileExists(path) {
  if (!path) return Promise.resolve(false);
  if (/^https?:\/\//i.test(path) || /^cloud:\/\//i.test(path)) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().access({
        path: path,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function extFromName(name, path) {
  const src = String(name || path || '');
  const m = src.match(/\.([a-zA-Z0-9]{1,8})(?:\?|$)/);
  return m ? String(m[1]).toLowerCase() : '';
}

function normalizeAudioUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  // 去掉包裹引号 / 中文括号尾巴
  s = s.replace(/^['"「『【\[]+|['"」』】\]]+$/g, '').trim();
  // 从一段文字里抽出首个 http(s) 链接
  const m = s.match(/https?:\/\/[^\s<>"']+/i);
  if (m) s = m[0];
  // 常见粘贴尾巴
  s = s.replace(/[),.，。；;]+$/g, '');
  return s.trim();
}

function isAudioUrl(url) {
  const u = normalizeAudioUrl(url);
  if (!/^https?:\/\//i.test(u)) return false;
  const ext = extFromName('', u.split('?')[0]);
  if (!ext) return true;
  return AUDIO_EXTS.indexOf(ext) >= 0 || ext === 'mp4';
}

function displayNameFromAudioUrl(url) {
  try {
    const path = String(url || '').split('?')[0];
    const base = path.split('/').pop() || '';
    let name = base;
    try {
      name = decodeURIComponent(base);
    } catch (_) {}
    name = String(name || '')
      .replace(/\.(mp3|m4a|aac|wav|ogg|mp4)$/i, '')
      .trim();
    if (name) return name.slice(0, 80);
  } catch (_) {}
  return '网络 BGM';
}

function mapCloudCallError(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '');
  // ffmpeg 未装依赖：勿误报成「未部署」
  // 本地调试 ping 通过 ≠ 云端真机可用（真机调用的是云端 Linux）
  if (
    /未找到 ffmpeg|ffmpeg-static|云端安装依赖|依赖未就绪|无法执行|不可执行|runnable:\s*false/i.test(
      msg
    )
  ) {
    return '视频提取云端依赖未就绪：右键 extractVideoAudio →「上传并部署：云端安装依赖」（勿上传本机 node_modules；模拟器通过≠云端可用）';
  }
  if (/extractVideoAudio/i.test(msg) && /FUNCTION_NOT_FOUND|FunctionName|找不到|不存在/i.test(msg)) {
    return '云函数未部署：请上传并部署 extractVideoAudio（勾选云端安装依赖）';
  }
  if (/manageOcDouyinBgm/i.test(msg) && /FUNCTION_NOT_FOUND|FunctionName|找不到|不存在/i.test(msg)) {
    return '云函数未部署：请上传 manageOcDouyinBgm';
  }
  if (/oc_douyin_bgm_lib|请先在云开发控制台创建集合/i.test(msg)) {
    return '请先创建云数据库集合 oc_douyin_bgm_lib';
  }
  if (/FUNCTION_NOT_FOUND|FunctionName|找不到函数/i.test(msg)) {
    if (/extractVideoAudio/i.test(msg)) {
      return '云函数未部署：请上传并部署 extractVideoAudio（勾选云端安装依赖）';
    }
    if (/fetchRemoteAudio/i.test(msg)) return '云函数未部署：请上传 fetchRemoteAudio';
    if (/redeemCode/i.test(msg)) return '云函数未部署：请上传 redeemCode';
    if (/manageOcDouyinBgm/i.test(msg)) return '云函数未部署：请上传 manageOcDouyinBgm';
    return '云函数未部署或名称不匹配，请检查控制台云函数列表';
  }
  if (/timeout|TIMED_OUT|超时/i.test(msg)) {
    return '拉取超时，请换更小的音频或稍后重试';
  }
  if (/ENOTFOUND|getaddrinfo|解析错误|无法解析域名/i.test(msg)) {
    return '云端无法访问此外链，请改用「上传新音频」';
  }
  if (/URI malformed|uri error|解码/i.test(msg)) {
    return '链接格式有误，请换一条直链';
  }
  if (/url not in domain|不在.*域名|合法域名/i.test(msg)) {
    return '域名未配置，将尝试本机下载';
  }
  if (/cloud init|未开通|env/i.test(msg)) {
    return '云开发未就绪，请检查环境';
  }
  if (
    /maximum size of the file storage|file storage limit|storage limit|本地.*配额|用户文件.*上限/i.test(
      msg
    )
  ) {
    return '本地存储已满，无法缓存上传；已显示包内曲目，请清理本地缓存后重试入库';
  }
  return msg.slice(0, 80) || '拉取音频失败';
}

function downloadUrlToTemp(url) {
  return new Promise((resolve, reject) => {
    if (typeof wx.downloadFile !== 'function') {
      reject(new Error('no_download'));
      return;
    }
    wx.downloadFile({
      url: url,
      timeout: 60000,
      success(res) {
        const code = Number(res && res.statusCode) || 0;
        const path = (res && res.tempFilePath) || '';
        if (code >= 200 && code < 300 && path) {
          resolve({ path: path, size: 0 });
          return;
        }
        reject(new Error('下载失败 HTTP ' + code));
      },
      fail(err) {
        reject(err || new Error('download_fail'));
      }
    });
  });
}

function saveRemoteUrlAsMeta(ocId, url, name) {
  const meta = setBgm(ocId, {
    path: url,
    name: name || '网络 BGM',
    updatedAt: Date.now(),
    isRemote: true,
    fileID: ''
  });
  clearLegacyGlobalBgm();
  return meta;
}

function saveBgmViaCloud(ocId, url, displayName) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云开发不可用'));
  }
  return wx.cloud
    .callFunction({
      name: 'fetchRemoteAudio',
      data: { url: url, ocId: ocId },
      timeout: 60000
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) {
        throw new Error(r.errMsg || mapCloudCallError(res) || '拉取音频失败');
      }
      const playPath = r.fileID || r.tempFileURL || '';
      if (!playPath) throw new Error('云存储未返回可播放地址');
      const prev = getBgm(ocId);
      const meta = setBgm(ocId, {
        path: playPath,
        name: r.name || displayName || '网络 BGM',
        updatedAt: Date.now(),
        isRemote: true,
        fileID: r.fileID || ''
      });
      if (prev && prev.path && !prev.isRemote && prev.path !== playPath) {
        setTimeout(() => {
          try {
            wx.getFileSystemManager().unlink({ filePath: prev.path, fail() {} });
          } catch (_) {}
        }, 1500);
      }
      clearLegacyGlobalBgm();
      return meta;
    });
}

/**
 * 粘贴音频链接：
 * 1) 优先本机 downloadFile（本机网络常比腾讯云更能访问 catbox 等外链）
 * 2) 失败再走云函数
 * 3) 再失败则直接存 https 地址尝试播放（开发者工具不校验域名时可播）
 */
function saveBgmFromUrl(ocId, url) {
  const id = normalizeOcId(ocId);
  if (!id) return Promise.reject(new Error('缺少 OC'));
  const u = normalizeAudioUrl(url);
  if (!isAudioUrl(u)) {
    return Promise.reject(new Error('请粘贴有效的 http(s) 音频直链'));
  }
  const displayName = displayNameFromAudioUrl(u);
  const ext = extFromName('', u.split('?')[0]) || 'mp3';
  const fileName = displayName + '.' + (AUDIO_EXTS.indexOf(ext) >= 0 ? ext : 'mp3');

  return downloadUrlToTemp(u)
    .then((file) => saveUploadedAudio(id, file.path, fileName, file.size || 0))
    .catch((localErr) => {
      return saveBgmViaCloud(id, u, displayName).catch((cloudErr) => {
        // 最后兜底：直接用 https 播（真机需配置 downloadFile 合法域名）
        const meta = saveRemoteUrlAsMeta(id, u, displayName);
        if (meta) return meta;
        const localMsg = mapCloudCallError(localErr);
        const cloudMsg = mapCloudCallError(cloudErr);
        return Promise.reject(
          new Error(
            cloudMsg.indexOf('无法访问') >= 0 || cloudMsg.indexOf('解析') >= 0
              ? '该外链云端拉不到，请改用「上传新音频」'
              : cloudMsg || localMsg || '拉取音频失败'
          )
        );
      });
    });
}

function isStorageQuotaError(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '');
  return /limit|exceed|最大|storage|空间|quota|fail exceed/i.test(msg);
}

function unlinkQuiet(fs, filePath) {
  return new Promise((resolve) => {
    if (!fs || !filePath) {
      resolve(false);
      return;
    }
    try {
      fs.unlink({
        filePath: filePath,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/** 收集仍在用的本地 BGM 路径 */
function collectReferencedBgmPaths() {
  const keep = new Set();
  const map = readMap();
  Object.keys(map).forEach((k) => {
    const m = normalizeMeta(map[k]);
    if (!m || !m.path) return;
    if (m.isRemote) return;
    if (/^https?:\/\//i.test(m.path) || /^cloud:\/\//i.test(m.path)) return;
    keep.add(m.path);
  });
  return keep;
}

/**
 * 清理未引用的 oc_dy_bgm_*，以及 saveFile 残留的 savedFile（易占满约 10MB）
 */
function purgeLocalBgmStorage(extraKeepPaths) {
  let fs;
  try {
    fs = wx.getFileSystemManager();
  } catch (_) {
    return Promise.resolve({ deleted: 0 });
  }
  const keep = collectReferencedBgmPaths();
  (Array.isArray(extraKeepPaths) ? extraKeepPaths : []).forEach((p) => {
    if (p) keep.add(String(p));
  });
  const base = getUserDataDir().replace(/\/+$/, '');

  const purgeUserDataBgms = () =>
    new Promise((resolve) => {
      if (!base || typeof fs.readdir !== 'function') {
        resolve(0);
        return;
      }
      fs.readdir({
        dirPath: base,
        success(res) {
          const names = (res && res.files) || res || [];
          const list = (Array.isArray(names) ? names : []).filter((n) =>
            /^oc_dy_bgm_/i.test(String(n))
          );
          let left = list.length;
          let deleted = 0;
          if (!left) {
            resolve(0);
            return;
          }
          list.forEach((name) => {
            const full = base + '/' + name;
            if (keep.has(full)) {
              left -= 1;
              if (!left) resolve(deleted);
              return;
            }
            unlinkQuiet(fs, full).then((ok) => {
              if (ok) deleted += 1;
              left -= 1;
              if (!left) resolve(deleted);
            });
          });
        },
        fail: () => resolve(0)
      });
    });

  const purgeSavedFiles = () =>
    new Promise((resolve) => {
      if (typeof fs.getSavedFileList !== 'function') {
        resolve(0);
        return;
      }
      fs.getSavedFileList({
        success(res) {
          const files = (res && res.fileList) || [];
          let left = files.length;
          let deleted = 0;
          if (!left) {
            resolve(0);
            return;
          }
          files.forEach((f) => {
            const p = (f && f.filePath) || '';
            if (!p || keep.has(p)) {
              left -= 1;
              if (!left) resolve(deleted);
              return;
            }
            // 只清明显是缓存/临时的；带 oc_dy_bgm 或非引用路径
            const name = String(p).split(/[/\\]/).pop() || '';
            const removable =
              /^oc_dy_bgm_/i.test(name) ||
              /\.(mp3|m4a|aac|wav|ogg|mp4)$/i.test(name) ||
              /tmp|temp|store_/i.test(p);
            if (!removable || keep.has(p)) {
              left -= 1;
              if (!left) resolve(deleted);
              return;
            }
            const remove = () => {
              if (typeof fs.removeSavedFile === 'function') {
                fs.removeSavedFile({
                  filePath: p,
                  success: () => {
                    deleted += 1;
                    left -= 1;
                    if (!left) resolve(deleted);
                  },
                  fail: () => {
                    unlinkQuiet(fs, p).then((ok) => {
                      if (ok) deleted += 1;
                      left -= 1;
                      if (!left) resolve(deleted);
                    });
                  }
                });
              } else {
                unlinkQuiet(fs, p).then((ok) => {
                  if (ok) deleted += 1;
                  left -= 1;
                  if (!left) resolve(deleted);
                });
              }
            };
            remove();
          });
        },
        fail: () => resolve(0)
      });
    });

  return purgeUserDataBgms()
    .then((a) =>
      purgeSavedFiles().then((b) => {
        let imageClean = Promise.resolve({ deleted: 0 });
        try {
          const ocImage = require('./ocImage.js');
          if (typeof ocImage.cleanupUserImageStorage === 'function') {
            imageClean = ocImage.cleanupUserImageStorage(Array.from(keep));
          }
        } catch (_) {}
        return imageClean.then((img) => ({
          deleted: a + b + (Number(img && img.deleted) || 0)
        }));
      })
    )
    .catch(() => ({ deleted: 0 }));
}

function copyToDest(fs, src, dest) {
  return new Promise((resolve, reject) => {
    const tryCopy = () => {
      fs.copyFile({
        srcPath: src,
        destPath: dest,
        success: () => resolve(dest),
        fail: (err) => reject(err || new Error('复制音频失败'))
      });
    };
    fs.unlink({
      filePath: dest,
      complete: () => tryCopy(),
      fail: () => tryCopy()
    });
  });
}

/** 优先 read+write 到 USER_DATA，避免 saveFile 占满「本地用户文件」配额 */
function writeTempToDest(fs, src, dest) {
  return new Promise((resolve, reject) => {
    if (typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function') {
      reject(new Error('不支持 writeFile'));
      return;
    }
    fs.readFile({
      filePath: src,
      success(res) {
        const data = res && res.data;
        if (data == null) {
          reject(new Error('读取临时音频失败'));
          return;
        }
        const doWrite = () => {
          fs.writeFile({
            filePath: dest,
            data: data,
            success: () => resolve(dest),
            fail: (err) => reject(err || new Error('写入音频失败'))
          });
        };
        fs.unlink({
          filePath: dest,
          complete: () => doWrite(),
          fail: () => doWrite()
        });
      },
      fail: (err) => reject(err || new Error('读取临时音频失败'))
    });
  });
}

function saveUploadedAudio(ocId, tempFilePath, displayName, size) {
  const id = normalizeOcId(ocId);
  if (!id) return Promise.reject(new Error('缺少 OC'));
  if (!tempFilePath) return Promise.reject(new Error('未选择音频'));
  if (size > 0 && size > MAX_BYTES) {
    return Promise.reject(new Error('音频过大，请控制在 15MB 内'));
  }
  const name =
    String(displayName || '自定义 BGM')
      .replace(/\.[^.]+$/, '')
      .slice(0, 80) || '自定义 BGM';
  const ext = extFromName(displayName, tempFilePath) || 'mp3';
  const dest = bgmDestPath(id, ext);
  if (!dest) return Promise.reject(new Error('当前环境不支持保存音频'));

  let fs;
  try {
    fs = wx.getFileSystemManager();
  } catch (e) {
    return Promise.reject(new Error('当前环境不支持保存音频'));
  }

  const prev = getBgm(id);
  const keepPrev =
    prev && prev.path && !prev.isRemote && prev.path !== dest ? [prev.path] : [];

  const persistOnce = () =>
    writeTempToDest(fs, tempFilePath, dest)
      .catch(() => copyToDest(fs, tempFilePath, dest))
      .catch(() =>
        new Promise((resolve, reject) => {
          if (typeof fs.saveFile !== 'function') {
            reject(new Error('保存音频失败'));
            return;
          }
          fs.saveFile({
            tempFilePath: tempFilePath,
            success(res) {
              const saved = (res && res.savedFilePath) || '';
              if (!saved) {
                reject(new Error('保存音频失败'));
                return;
              }
              copyToDest(fs, saved, dest)
                .then(resolve)
                .catch(() => resolve(saved));
            },
            fail(err) {
              reject(err || new Error('保存音频失败'));
            }
          });
        })
      );

  const makeFullErr = () => {
    try {
      const clean = require('./ocLocalStorageClean.js');
      return clean.makeStorageFullError(
        '本地存储空间不足（约10MB上限）。请删除部分自定义 BGM 或立绘后重试'
      );
    } catch (_) {
      const e = new Error(
        '本地存储空间不足（约10MB上限）。请删除部分自定义 BGM 或立绘后重试'
      );
      e.storageFull = true;
      e.code = 'STORAGE_FULL';
      return e;
    }
  };

  return purgeLocalBgmStorage(keepPrev)
    .then(() => persistOnce())
    .catch((err) => {
      if (!isStorageQuotaError(err)) return Promise.reject(err);
      return purgeLocalBgmStorage(keepPrev).then((r) => {
        if (!(r && r.deleted)) {
          return Promise.reject(makeFullErr());
        }
        return persistOnce();
      });
    })
    .then((savedPath) => {
      const meta = setBgm(id, {
        path: savedPath,
        name: name,
        updatedAt: Date.now(),
        isRemote: false,
        fileID: ''
      });
      if (prev && prev.path && !prev.isRemote && prev.path !== savedPath) {
        setTimeout(() => {
          unlinkQuiet(fs, prev.path);
        }, 800);
      }
      clearLegacyGlobalBgm();
      return meta;
    })
    .catch((err) => {
      if (isStorageQuotaError(err) || (err && err.storageFull)) {
        return Promise.reject(makeFullErr());
      }
      return Promise.reject(
        err instanceof Error ? err : new Error(String((err && err.errMsg) || err || '保存音频失败'))
      );
    });
}

function normalizePickedAudioFiles(tempFiles) {
  const out = [];
  (tempFiles || []).forEach((file) => {
    if (!file || !file.path) return;
    const ext = extFromName(file.name, file.path);
    if (AUDIO_EXTS.indexOf(ext) < 0) return;
    out.push({
      path: file.path,
      name: file.name || '自定义 BGM',
      size: Number(file.size) || 0
    });
  });
  return out;
}

/** 选音频（本地/聊天文件）；count>1 时返回数组，否则返回单文件对象（兼容旧调用） */
function pickAudioFile(count) {
  const maxCount = Math.min(Math.max(Number(count) || 1, 1), 20);
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMessageFile !== 'function') {
      reject(new Error('当前基础库不支持本地上传音频，请升级微信'));
      return;
    }
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    const finish = (files) => {
      const list = normalizePickedAudioFiles(files);
      if (!list.length) {
        reject(new Error('请选择 mp3/m4a/aac/wav 音频'));
        return;
      }
      resolve(maxCount === 1 ? list[0] : list);
    };
    const cancelReject = (err) => {
      const msg = (err && err.errMsg) || '';
      if (/cancel/i.test(msg)) {
        const e = new Error('cancel');
        e.cancelled = true;
        reject(e);
        return true;
      }
      return false;
    };
    // 优先按音频扩展名筛选；失败再放宽为全部文件
    wx.chooseMessageFile({
      count: maxCount,
      type: 'file',
      extension: AUDIO_EXTS,
      success(res) {
        finish(res.tempFiles);
      },
      fail(err) {
        if (cancelReject(err)) return;
        wx.chooseMessageFile({
          count: maxCount,
          type: 'file',
          success(res2) {
            finish(res2.tempFiles);
          },
          fail(err2) {
            if (cancelReject(err2)) return;
            wx.chooseMessageFile({
              count: maxCount,
              type: 'all',
              success(res3) {
                finish(res3.tempFiles);
              },
              fail: () => reject(new Error('选择本地音频失败'))
            });
          }
        });
      }
    });
  });
}

function isCloudTempHttps(url) {
  const u = String(url || '');
  return (
    /^https?:\/\//i.test(u) &&
    (/tcb\.qcloud\.la/i.test(u) || /\.myqcloud\.com/i.test(u) || /file\.myqcloud/i.test(u))
  );
}

/** cloud:// → 本机临时文件（避免临时 https 403）；失败再回落 getTempFileURL */
function resolveCloudTempUrl(fileID) {
  const id = String(fileID || '').trim();
  if (!id || !/^cloud:\/\//i.test(id)) return Promise.resolve(id);
  if (!wx.cloud) return Promise.resolve(id);

  const viaDownload = () =>
    new Promise((resolve, reject) => {
      if (typeof wx.cloud.downloadFile !== 'function') {
        reject(new Error('no downloadFile'));
        return;
      }
      wx.cloud.downloadFile({
        fileID: id,
        success(res) {
          const p = res && res.tempFilePath;
          const code = Number(res && res.statusCode) || 0;
          if (p && (code === 200 || code === 0)) resolve(p);
          else reject(new Error('download status ' + code));
        },
        fail: reject
      });
    });

  const viaTempUrl = () =>
    new Promise((resolve) => {
      if (typeof wx.cloud.getTempFileURL !== 'function') {
        resolve(id);
        return;
      }
      wx.cloud.getTempFileURL({
        fileList: [id],
        success(res) {
          const row = (res && res.fileList && res.fileList[0]) || {};
          resolve(row.tempFileURL || id);
        },
        fail: () => resolve(id)
      });
    });

  return viaDownload().catch(() => viaTempUrl());
}

function resolvePlayableFromMeta(meta) {
  if (!meta) return Promise.resolve(null);
  const path = String(meta.path || '');
  const fileID = String(meta.fileID || '').trim();
  const cloudId = /^cloud:\/\//i.test(fileID)
    ? fileID
    : /^cloud:\/\//i.test(path)
      ? path
      : '';

  // 有 cloud:// 时始终重新下载/换链，禁止复用会 403 的旧 https
  if (cloudId) {
    return resolveCloudTempUrl(cloudId).then((url) => {
      if (!url) return null;
      return Object.assign({}, meta, {
        path: url,
        fileID: cloudId,
        isRemote: true
      });
    });
  }

  if (meta.isRemote || /^https?:\/\//i.test(path) || /^\/pages\//i.test(path)) {
    return Promise.resolve(meta);
  }
  return fileExists(path).then((ok) => (ok ? meta : null));
}

function resolvePlayableBgm(ocId) {
  return resolvePlayableFromMeta(getBgm(ocId)).then((meta) => {
    if (meta) return meta;
    // 本地文件失效时清掉 OC 绑定
    const raw = getBgm(ocId);
    if (raw && raw.path && !raw.isRemote && !/^https?:\/\//i.test(raw.path) && !/^cloud:\/\//i.test(raw.path)) {
      clearBgm(ocId);
    }
    return null;
  });
}

function resolvePlayableClipBgm(clipId) {
  return resolvePlayableFromMeta(getClipBgm(clipId)).then((meta) => {
    if (meta) return meta;
    const raw = getClipBgm(clipId);
    if (
      raw &&
      raw.path &&
      !raw.isRemote &&
      !/^https?:\/\//i.test(raw.path) &&
      !/^cloud:\/\//i.test(raw.path) &&
      !/^\/pages\//i.test(raw.path)
    ) {
      clearClipBgm(clipId);
    }
    return null;
  });
}

let _libCache = { at: 0, tracks: [] };
const LIB_CACHE_MS = 60 * 1000;

function getLibraryTracksCached() {
  if (Date.now() - _libCache.at < LIB_CACHE_MS && _libCache.tracks.length) {
    return Promise.resolve(_libCache.tracks);
  }
  return listCloudBgmLibraryWithSeed().then((res) => {
    const tracks = (res && res.tracks) || [];
    _libCache = { at: Date.now(), tracks: tracks };
    return tracks;
  });
}

/**
 * 每条抖音首次加载时随机绑一首曲库 BGM；已绑定则复用。点唱片可再换。
 */
function ensureRandomBgmForClip(clipId, ocId) {
  const cid = normalizeClipId(clipId);
  if (!cid) return resolvePlayableBgm(ocId);
  return resolvePlayableClipBgm(cid).then((existing) => {
    if (existing) return existing;
    return getLibraryTracksCached()
      .then((tracks) => {
        const list = Array.isArray(tracks) ? tracks : [];
        if (!list.length) return resolvePlayableBgm(ocId);
        const pick = list[Math.floor(Math.random() * list.length)];
        return assignCloudTrackToClip(cid, pick);
      })
      .then((meta) => {
        if (!meta) return resolvePlayableBgm(ocId);
        return resolvePlayableFromMeta(meta);
      })
      .catch(() => resolvePlayableBgm(ocId));
  });
}

/** 包内 BGM 放在独立分包，避免 ocApp 预加载超过 2MB */
const BGM_PACK_ROOT = '/pages/ocDouyinBgmPack/bgm/';
const BUILTIN_BGM_PACK_PATH = BGM_PACK_ROOT + 'oc-clip.mp3';
const BUILTIN_BGM_NAME = 'oc-clip';
const STORAGE_SEED_BUILTIN = 'oc_douyin_bgm_seed_oc_clip_v1';
/** 包内 BGM：打开曲库时自动上传并登记到 oc_douyin_bgm_lib */
const PACKAGED_BGM_SEEDS = [
  {
    packPath: BUILTIN_BGM_PACK_PATH,
    name: BUILTIN_BGM_NAME,
    cloudPath: 'oc_douyin_bgm/oc-clip.mp3',
    storageKey: STORAGE_SEED_BUILTIN
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-01.mp3',
    name: 'bgm-202608-01',
    cloudPath: 'oc_douyin_bgm/bgm-202608-01.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_01'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-02.mp3',
    name: 'bgm-202608-02',
    cloudPath: 'oc_douyin_bgm/bgm-202608-02.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_02'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-03.mp3',
    name: 'bgm-202608-03',
    cloudPath: 'oc_douyin_bgm/bgm-202608-03.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_03'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-04.mp3',
    name: 'bgm-202608-04',
    cloudPath: 'oc_douyin_bgm/bgm-202608-04.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_04'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-05.mp3',
    name: 'bgm-202608-05',
    cloudPath: 'oc_douyin_bgm/bgm-202608-05.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_05'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-06.mp3',
    name: 'bgm-202608-06',
    cloudPath: 'oc_douyin_bgm/bgm-202608-06.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_06'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-07.mp3',
    name: 'bgm-202608-07',
    cloudPath: 'oc_douyin_bgm/bgm-202608-07.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_07'
  },
  {
    packPath: BGM_PACK_ROOT + 'bgm-202608-08.mp3',
    name: 'bgm-202608-08',
    cloudPath: 'oc_douyin_bgm/bgm-202608-08.mp3',
    storageKey: 'oc_douyin_bgm_seed_202608_08'
  }
];

function ensureBgmPackLoaded() {
  return new Promise((resolve) => {
    if (typeof wx.loadSubpackage !== 'function') {
      resolve(true);
      return;
    }
    try {
      const task = wx.loadSubpackage({
        name: 'ocDouyinBgmPack',
        success: () => resolve(true),
        fail: () => resolve(false)
      });
      if (task && typeof task.onProgressUpdate === 'function') {
        /* noop */
      }
    } catch (_) {
      resolve(false);
    }
  });
}

function resolvePackPath(packPath) {
  const p = String(packPath || '').trim();
  if (!p) return '';
  return p.charAt(0) === '/' ? p : '/' + p;
}

function trackMatchesSeed(t, seed) {
  if (!t || !seed) return false;
  const cloudBase = String(seed.cloudPath || '').split('/').pop() || '';
  return (
    String(t.name || '') === seed.name ||
    (cloudBase && String(t.fileID || '').indexOf(cloudBase) >= 0) ||
    String(t.fileID || '').indexOf(String(seed.cloudPath || '')) >= 0
  );
}

function listPackagedFallbackTracks() {
  return PACKAGED_BGM_SEEDS.map((s) => ({
    id: 'pack:' + s.name,
    name: s.name,
    fileID: '',
    url: resolvePackPath(s.packPath),
    size: 0,
    createdAt: 0,
    isPackaged: true
  }));
}

function listCloudBgmLibrary() {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('请使用支持云开发的基础库'));
  }
  return wx.cloud
    .callFunction({
      name: 'manageOcDouyinBgm',
      data: { action: 'list' },
      timeout: 20000
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok && !(r.tracks && r.tracks.length)) {
        throw new Error(r.errMsg || '读取曲库失败');
      }
      return Array.isArray(r.tracks) ? r.tracks : [];
    });
}

function unlinkQuietPath(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(false);
      return;
    }
    try {
      wx.getFileSystemManager().unlink({
        filePath: filePath,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/** 清掉历史 seed 缓存，避免占满本地 10MB 用户文件配额 */
function clearSeedTempFiles() {
  return new Promise((resolve) => {
    const base = getUserDataDir();
    if (!base) {
      resolve(0);
      return;
    }
    const root = base.replace(/\/+$/, '');
    let fsm;
    try {
      fsm = wx.getFileSystemManager();
    } catch (_) {
      resolve(0);
      return;
    }
    fsm.readdir({
      dirPath: root,
      success(res) {
        const names = (res.files || []).filter(
          (n) => /^oc_dy_seed_/i.test(String(n || '')) || /^oc_dy_bgm_/i.test(String(n || ''))
        );
        if (!names.length) {
          resolve(0);
          return;
        }
        let left = names.length;
        let deleted = 0;
        names.forEach((n) => {
          fsm.unlink({
            filePath: root + '/' + n,
            success: () => {
              deleted += 1;
            },
            complete: () => {
              left -= 1;
              if (left <= 0) resolve(deleted);
            }
          });
        });
      },
      fail: () => resolve(0)
    });
  });
}

function tryFreeLocalQuotaForSeed() {
  return clearSeedTempFiles().then((n) => {
    try {
      const ocImage = require('./ocImage.js');
      if (ocImage && typeof ocImage.cleanupUserImageStorage === 'function') {
        return ocImage
          .cleanupUserImageStorage([])
          .then((r) => ({ seedDeleted: n, imageDeleted: (r && r.deleted) || 0 }))
          .catch(() => ({ seedDeleted: n, imageDeleted: 0 }));
      }
    } catch (_) {}
    return { seedDeleted: n, imageDeleted: 0 };
  });
}

/** 包内路径优先直接 upload；失败再短时复制到用户目录（传完即删） */
function copyPackagedAudioToUserPath(packPath, name) {
  return new Promise((resolve, reject) => {
    const base = getUserDataDir();
    if (!base) {
      reject(new Error('无本地用户目录'));
      return;
    }
    const src = resolvePackPath(packPath);
    const dest = base.replace(/\/+$/, '') + '/oc_dy_seed_' + safeToken(name, 'bgm') + '.mp3';
    let fsm;
    try {
      fsm = wx.getFileSystemManager();
    } catch (e) {
      reject(e || new Error('文件系统不可用'));
      return;
    }
    const writeOnce = () => {
      fsm.readFile({
        filePath: src,
        success(res) {
          fsm.writeFile({
            filePath: dest,
            data: res.data,
            success() {
              resolve(dest);
            },
            fail(err) {
              reject(err || new Error('写入本地失败'));
            }
          });
        },
        fail(err) {
          const msg = String((err && (err.errMsg || err.message)) || err || '');
          reject(new Error('读取包内音频失败 ' + src + (msg ? '：' + msg : '')));
        }
      });
    };
    // 同名残留先删
    fsm.unlink({
      filePath: dest,
      complete: () => writeOnce(),
      fail: () => writeOnce()
    });
  });
}

function uploadLocalFileToCloud(localPath, cloudPath) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('云开发不可用'));
      return;
    }
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: localPath,
      success: (up) => resolve(up),
      fail: (err) => reject(err || new Error('上传云存储失败'))
    });
  });
}

function uploadPackagedAudioToCloud(packPath, cloudPath, name) {
  const pack = resolvePackPath(packPath);
  // 1) 直接传包内路径（不占用户文件配额）
  return uploadLocalFileToCloud(pack, cloudPath).catch((directErr) => {
    const directMsg = String((directErr && (directErr.errMsg || directErr.message)) || directErr || '');
    console.warn('[ocDouyinBgm] direct pack upload fail', name, directMsg);
    // 2) 腾挪本地配额后，复制一首 → 上传 → 立刻删除本地副本
    return tryFreeLocalQuotaForSeed()
      .then(() => copyPackagedAudioToUserPath(pack, name))
      .catch((copyErr) => {
        // 再清一次后重试复制
        return tryFreeLocalQuotaForSeed().then(() => copyPackagedAudioToUserPath(pack, name)).catch(() => {
          throw copyErr;
        });
      })
      .then((localPath) =>
        uploadLocalFileToCloud(localPath, cloudPath).then(
          (up) => {
            unlinkQuietPath(localPath);
            return up;
          },
          (upErr) => {
            unlinkQuietPath(localPath);
            throw upErr;
          }
        )
      );
  });
}

function seedOnePackagedBgm(seed, options) {
  const item = seed || {};
  const opts = options || {};
  const force = !!opts.force;
  const storageKey = String(item.storageKey || '');
  const name = String(item.name || 'BGM').slice(0, 80) || 'BGM';
  if (!force && storageKey) {
    try {
      if (wx.getStorageSync(storageKey)) {
        return Promise.resolve({ skipped: true, reason: 'done', name: name });
      }
    } catch (_) {}
  }
  const packPath = String(item.packPath || '');
  const cloudPath = String(item.cloudPath || '');
  if (!packPath || !cloudPath) {
    return Promise.resolve({ ok: false, name: name, errMsg: 'seed 配置不完整' });
  }
  return uploadPackagedAudioToCloud(packPath, cloudPath, name)
    .then((up) => {
      const fileID = (up && up.fileID) || '';
      if (!fileID) throw new Error('未返回 fileID');
      return registerCloudBgm(fileID, name, 0).then((r) => {
        try {
          if (storageKey) {
            wx.setStorageSync(storageKey, { fileID: fileID, at: Date.now() });
          }
        } catch (_) {}
        return { ok: true, fileID: fileID, name: name, register: r };
      });
    })
    .catch((err) => {
      const msg = mapCloudCallError(err);
      console.warn('[ocDouyinBgm] seed packaged', name, msg);
      try {
        if (storageKey) wx.removeStorageSync(storageKey);
      } catch (_) {}
      return { ok: false, name: name, errMsg: msg };
    });
}

/**
 * 把打包进小程序的 BGM 上传到云存储并登记曲库。
 * 若本地标记已入库但云列表没有，会强制重传。
 */
function seedPackagedBgms(tracksHint) {
  const list = Array.isArray(tracksHint) ? tracksHint : [];
  const jobs = [];
  PACKAGED_BGM_SEEDS.forEach((seed) => {
    const inCloud = list.some((t) => trackMatchesSeed(t, seed));
    if (inCloud) return;
    let localDone = false;
    try {
      localDone = !!(seed.storageKey && wx.getStorageSync(seed.storageKey));
    } catch (_) {}
    if (localDone) {
      try {
        wx.removeStorageSync(seed.storageKey);
      } catch (_) {}
    }
    jobs.push({ seed: seed, force: true });
  });
  if (!jobs.length) {
    return Promise.resolve({ ok: true, seeded: 0, skipped: PACKAGED_BGM_SEEDS.length, errors: [] });
  }
  return tryFreeLocalQuotaForSeed().then(() => {
    let chain = Promise.resolve({ ok: 0, fail: 0, errors: [] });
    jobs.forEach((job) => {
      chain = chain.then((acc) =>
        seedOnePackagedBgm(job.seed, { force: job.force }).then((r) => {
          if (r && r.ok) acc.ok += 1;
          else if (!(r && r.skipped)) {
            acc.fail += 1;
            if (r && r.errMsg) acc.errors.push(String(r.name || '') + ': ' + r.errMsg);
          }
          return acc;
        })
      );
    });
    return chain.then((acc) => ({
      ok: acc.fail === 0,
      seeded: acc.ok,
      failed: acc.fail,
      errors: acc.errors.slice(0, 3)
    }));
  });
}

/** 兼容旧调用：只种子 oc-clip */
function seedBuiltinOcClipBgm() {
  const seed = PACKAGED_BGM_SEEDS.find((s) => s.name === BUILTIN_BGM_NAME) || PACKAGED_BGM_SEEDS[0];
  return seedOnePackagedBgm(seed, { force: true });
}

/**
 * 拉曲库并补齐包内 BGM。
 * 返回 { tracks, hint }；云失败时至少给出包内曲目，避免空库。
 */
function listCloudBgmLibraryWithSeed() {
  let hint = '';
  return ensureBgmPackLoaded().then(() =>
    listCloudBgmLibrary()
      .catch((e) => {
        hint = mapCloudCallError(e) || '曲库读取失败';
        return [];
      })
      .then((tracks) => {
        const list = Array.isArray(tracks) ? tracks : [];
        return seedPackagedBgms(list).then((r) => {
        if (r && r.errors && r.errors.length) {
          hint = hint || r.errors[0];
        }
        const reload =
          r && r.seeded > 0
            ? listCloudBgmLibrary().catch((e) => {
                hint = hint || mapCloudCallError(e);
                return list;
              })
            : Promise.resolve(list);
        return reload.then((finalList) => {
          let out = Array.isArray(finalList) ? finalList : [];
          if (!out.length) {
            out = listPackagedFallbackTracks();
            if (!hint) {
              hint = '云曲库暂空，已显示包内曲目；请部署云函数 manageOcDouyinBgm 并创建集合 oc_douyin_bgm_lib';
            } else if (hint.indexOf('包内') < 0) {
              hint = hint + '（已显示包内曲目）';
            }
          }
          return { tracks: out, hint: hint };
        });
      });
    })
  );
}

function registerCloudBgm(fileID, name, size) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云开发不可用'));
  }
  return wx.cloud
    .callFunction({
      name: 'manageOcDouyinBgm',
      data: {
        action: 'register',
        fileID: fileID,
        name: name || 'BGM',
        size: Number(size) || 0
      },
      timeout: 15000
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.errMsg || '登记曲库失败');
      return r;
    });
}

function uploadOneToCloud(tempFilePath, displayName, size, ocIdHint) {
  if (!tempFilePath) return Promise.reject(new Error('未选择音频'));
  if (size > 0 && size > MAX_BYTES) {
    return Promise.reject(new Error('音频过大，请控制在 15MB 内'));
  }
  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return Promise.reject(new Error('请使用支持云开发的基础库'));
  }
  const name =
    String(displayName || '自定义 BGM')
      .replace(/\.[^.]+$/, '')
      .slice(0, 80) || '自定义 BGM';
  const ext = extFromName(displayName, tempFilePath) || 'mp3';
  const cloudPath =
    'oc_douyin_bgm/' +
    Date.now() +
    '_' +
    safeToken(ocIdHint || 'lib', 'lib') +
    '_' +
    Math.random().toString(36).slice(2, 7) +
    '.' +
    (AUDIO_EXTS.indexOf(ext) >= 0 ? ext : 'mp3');

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (up) => resolve(up),
      fail: (err) => reject(err || new Error('上传云存储失败'))
    });
  }).then((up) => {
    const fileID = (up && up.fileID) || '';
    if (!fileID) throw new Error('云存储未返回 fileID');
    return registerCloudBgm(fileID, name, size).then(() => {
      if (!wx.cloud.getTempFileURL) {
        return { fileID: fileID, url: fileID, name: name };
      }
      return new Promise((resolve) => {
        wx.cloud.getTempFileURL({
          fileList: [fileID],
          success(res) {
            const row = (res.fileList && res.fileList[0]) || {};
            resolve({
              fileID: fileID,
              url: row.tempFileURL || fileID,
              name: name
            });
          },
          fail: () => resolve({ fileID: fileID, url: fileID, name: name })
        });
      });
    });
  });
}

/** 选本地音频 → 上传云存储 → 登记曲库 → 绑定当前 OC */
function uploadAudioToCloudLibrary(ocId, tempFilePath, displayName, size) {
  const id = normalizeOcId(ocId);
  return uploadOneToCloud(tempFilePath, displayName, size, id).then((track) => {
    if (!id) return track;
    const meta = setBgm(id, {
      path: track.url || track.fileID,
      name: track.name || 'BGM',
      updatedAt: Date.now(),
      isRemote: true,
      fileID: track.fileID
    });
    clearLegacyGlobalBgm();
    return Object.assign({}, track, { meta: meta });
  });
}

/**
 * 批量上传到曲库。
 * files: [{ path, name, size }]
 * 默认只把第一首绑定到当前 OC，其余仅入库。
 */
function uploadAudiosToCloudLibrary(ocId, files, options) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return Promise.reject(new Error('未选择音频'));
  const opts = options || {};
  const assignFirst = opts.assignFirst !== false;
  const id = normalizeOcId(ocId);
  let chain = Promise.resolve({ ok: 0, fail: 0, first: null });
  list.forEach((file, index) => {
    chain = chain.then((acc) =>
      uploadOneToCloud(file.path, file.name, file.size, id || 'lib')
        .then((track) => {
          acc.ok += 1;
          if (!acc.first) acc.first = track;
          if (assignFirst && index === 0 && id) {
            const meta = setBgm(id, {
              path: track.url || track.fileID,
              name: track.name || 'BGM',
              updatedAt: Date.now(),
              isRemote: true,
              fileID: track.fileID
            });
            clearLegacyGlobalBgm();
            acc.first = Object.assign({}, track, { meta: meta });
          }
          return acc;
        })
        .catch(() => {
          acc.fail += 1;
          return acc;
        })
    );
  });
  return chain;
}

/** 从相册/拍摄选一段视频（用于提取音轨，仅落本地） */
function pickVideoFile() {
  return new Promise((resolve, reject) => {
    if (typeof wx.chooseMedia !== 'function') {
      reject(new Error('当前基础库不支持选视频，请升级微信'));
      return;
    }
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    } catch (_) {}
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: MAX_VIDEO_DURATION_SEC,
      camera: 'back',
      success(res) {
        const f = (res && res.tempFiles && res.tempFiles[0]) || null;
        if (!f || !f.tempFilePath) {
          reject(new Error('未选择视频'));
          return;
        }
        const size = Number(f.size) || 0;
        if (size > MAX_VIDEO_BYTES) {
          reject(new Error('视频过大，请控制在 30MB 内'));
          return;
        }
        const duration = Number(f.duration) || 0;
        if (duration > MAX_VIDEO_DURATION_SEC + 0.5) {
          reject(new Error('视频过长，请控制在 60 秒内'));
          return;
        }
        resolve({
          path: f.tempFilePath,
          name: '视频BGM',
          size: size,
          duration: duration
        });
      },
      fail(err) {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) {
          const e = new Error('cancel');
          e.cancelled = true;
          reject(e);
          return;
        }
        reject(new Error('选择视频失败'));
      }
    });
  });
}

function cleanupCloudTempFiles(fileIDs) {
  const list = (fileIDs || []).filter((id) => id && /^cloud:\/\//i.test(String(id)));
  if (!list.length || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve();
  }
  return wx.cloud
    .callFunction({
      name: 'extractVideoAudio',
      data: { action: 'cleanup', fileList: list },
      timeout: 15000
    })
    .catch(() => null);
}

function uploadVideoTemp(tempFilePath, ocIdHint) {
  if (!tempFilePath) return Promise.reject(new Error('未选择视频'));
  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return Promise.reject(new Error('请使用支持云开发的基础库'));
  }
  const cloudPath =
    'oc_douyin_bgm_tmp/' +
    Date.now() +
    '_' +
    safeToken(ocIdHint || 'lib', 'lib') +
    '_' +
    Math.random().toString(36).slice(2, 7) +
    '.mp4';
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (up) => {
        const fileID = (up && up.fileID) || '';
        if (!fileID) {
          reject(new Error('云存储未返回 fileID'));
          return;
        }
        resolve(fileID);
      },
      fail: (err) => reject(err || new Error('上传视频失败'))
    });
  });
}

/** 免费 3 次，之后每次 10 额度（见 ocEntitlements.js） */
function fetchVideoExtractQuota() {
  const ent = require('./ocEntitlements.js');
  const credits = require('./ocCredits.js');
  const freeLeft = ent.getVideoExtractFreeLeft();
  const balance = credits.getBalance();
  return Promise.resolve({
    left: freeLeft > 0 ? freeLeft : balance >= ent.VIDEO_EXTRACT_COST ? 1 : 0,
    limit: ent.VIDEO_EXTRACT_FREE,
    used: ent.VIDEO_EXTRACT_FREE - freeLeft,
    isVip: false,
    freeLeft: freeLeft,
    creditCost: ent.VIDEO_EXTRACT_COST,
    creditBalance: balance
  });
}

function beginVideoExtractQuota() {
  const ent = require('./ocEntitlements.js');
  const r = ent.reserveVideoExtract();
  if (!r.ok) {
    return Promise.reject(new Error(r.errMsg || '额度不足'));
  }
  return Promise.resolve({
    left: ent.getVideoExtractFreeLeft(),
    limit: ent.VIDEO_EXTRACT_FREE,
    used: ent.VIDEO_EXTRACT_FREE - ent.getVideoExtractFreeLeft(),
    reservation: r
  });
}

function refundVideoExtractQuota(quotaSnap) {
  try {
    const ent = require('./ocEntitlements.js');
    const res =
      quotaSnap && quotaSnap.reservation
        ? quotaSnap.reservation
        : quotaSnap;
    ent.refundVideoExtract(res);
  } catch (_) {}
  return Promise.resolve(null);
}

/** @deprecated 已改为周次配额；保留兼容旧调用 */
function hasVideoExtractFreeTrial() {
  return true;
}

/**
 * 选视频 → 预扣周次 → 临时上传 → 云提取 → 落本地（或 cloud://）→ 清理临时云文件
 */
function extractAudioFromVideoToLocal(ocId, videoFile) {
  const id = normalizeOcId(ocId);
  const file = videoFile || {};
  const tempPath = file.path || '';
  const displayName = String(file.name || '视频BGM').slice(0, 80);
  const size = Number(file.size) || 0;
  if (!id) return Promise.reject(new Error('缺少 OC'));
  if (!tempPath) return Promise.reject(new Error('未选择视频'));
  if (size > MAX_VIDEO_BYTES) {
    return Promise.reject(new Error('视频过大，请控制在 30MB 内'));
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云开发不可用'));
  }

  let quotaReserved = false;
  let quotaSnap = null;
  let videoFileID = '';
  let audioFileID = '';

  return beginVideoExtractQuota()
    .then((q) => {
      quotaReserved = true;
      quotaSnap = q;
      // 可选探测：仅当云端明确回报无 ffmpeg 时拦截；探测失败不挡提取（避免误报「未安装」）
      return wx.cloud
        .callFunction({
          name: 'extractVideoAudio',
          data: { action: 'pingFfmpeg' },
          timeout: 20000
        })
        .then((pingRes) => {
          const p = (pingRes && pingRes.result) || {};
          const clearlyMissing =
            p &&
            p.ok === false &&
            (p.hasFfmpeg === false ||
              p.runnable === false ||
              /未找到 ffmpeg|无法执行|不可执行/i.test(String(p.msg || p.runErr || '')));
          if (clearlyMissing) {
            const tip = String(p.tip || p.msg || p.runErr || '').slice(0, 100);
            throw new Error(
              '云端 ffmpeg 未就绪' +
                (p.platform ? '（' + p.platform + '/' + p.arch + '）' : '') +
                (tip ? '：' + tip : '') +
                '。请右键 extractVideoAudio →「上传并部署：云端安装依赖」后重试'
            );
          }
        })
        .catch((err) => {
          const msg = String((err && err.message) || err || '');
          if (/云端 ffmpeg 未就绪|上传并部署：云端安装依赖/i.test(msg)) throw err;
          console.warn('[extractVideoAudio] ping skip', msg.slice(0, 120));
        })
        .then(() => uploadVideoTemp(tempPath, id));
    })
    .then((vid) => {
      videoFileID = vid;
      return wx.cloud.callFunction({
        name: 'extractVideoAudio',
        data: {
          action: 'extract',
          fileID: videoFileID,
          name: displayName
        },
        timeout: 90000
      });
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok || !r.fileID) {
        throw new Error(
          mapCloudCallError({ message: r.errMsg || r.err }) ||
            r.errMsg ||
            '提取音轨失败'
        );
      }
      audioFileID = r.fileID;
      videoFileID = '';
      return r;
    })
    .then((r) => {
      const keepCloudMeta = () => {
        const meta = setBgm(id, {
          path: audioFileID,
          name: String(r.name || displayName || '视频BGM').slice(0, 80),
          updatedAt: Date.now(),
          isRemote: true,
          fileID: audioFileID
        });
        clearLegacyGlobalBgm();
        if (!meta) throw new Error('保存失败');
        return resolveCloudTempUrl(audioFileID).then((playPath) => ({
          meta: Object.assign({}, meta, { path: playPath || audioFileID }),
          quota: quotaSnap,
          keptOnCloud: true
        }));
      };

      const tryLocal = () =>
        resolveCloudTempUrl(audioFileID)
          .then((localOrUrl) => {
            if (
              localOrUrl &&
              !/^https?:\/\//i.test(localOrUrl) &&
              !/^cloud:\/\//i.test(localOrUrl)
            ) {
              return { path: localOrUrl, size: Number(r.size) || 0 };
            }
            if (r.url) return downloadUrlToTemp(r.url);
            if (localOrUrl && /^https?:\/\//i.test(localOrUrl)) {
              return downloadUrlToTemp(localOrUrl);
            }
            throw new Error('无法下载提取结果');
          })
          .then((dl) =>
            saveUploadedAudio(
              id,
              dl.path,
              (r.name || displayName) + '.m4a',
              Number(r.size) || dl.size || 0
            )
          )
          .then((meta) => ({
            meta: meta,
            quota: quotaSnap,
            keptOnCloud: false
          }));

      return tryLocal().catch((err) => {
        const msg = String((err && err.message) || err || '');
        if (/空间不足|10MB|storage|quota|limit|exceed/i.test(msg)) {
          return keepCloudMeta();
        }
        return Promise.reject(err);
      });
    })
    .then((result) => {
      const toClean =
        result && result.keptOnCloud
          ? [videoFileID]
          : [audioFileID, videoFileID];
      return cleanupCloudTempFiles(toClean).then(() => result);
    })
    .catch((err) => {
      const refundP = quotaReserved ? refundVideoExtractQuota(quotaSnap) : Promise.resolve(null);
      const friendly = new Error(mapCloudCallError(err) || (err && err.message) || '提取失败');
      return refundP
        .then(() => cleanupCloudTempFiles([audioFileID, videoFileID]))
        .then(() => Promise.reject(friendly));
    });
}

/** @deprecated 使用 extractAudioFromVideoToLocal */
function extractAudioFromVideoToLibrary(ocId, videoFile) {
  return extractAudioFromVideoToLocal(ocId, videoFile);
}

/** 选用曲库某首：绑定到 OC 并返回可播 meta */
function trackToMeta(track) {
  if (!track || !(track.fileID || track.url)) return null;
  const fileID = String(track.fileID || '');
  const playPath = String(track.url || fileID);
  const name = String(track.name || 'BGM').slice(0, 80);
  const isPackaged = !!track.isPackaged || /^\/pages\//i.test(playPath);
  const storePath = fileID && /^cloud:\/\//i.test(fileID) ? fileID : playPath;
  return {
    path: storePath,
    name: name,
    updatedAt: Date.now(),
    isRemote: !isPackaged && !!(fileID || /^https?:\/\//i.test(playPath)),
    fileID: fileID
  };
}

function assignCloudTrackToOc(ocId, track) {
  const id = normalizeOcId(ocId);
  if (!id) return Promise.reject(new Error('缺少 OC'));
  const draft = trackToMeta(track);
  if (!draft) return Promise.reject(new Error('无效曲目'));
  const meta = setBgm(id, draft);
  clearLegacyGlobalBgm();
  if (!meta) return Promise.reject(new Error('保存失败'));
  if (meta.fileID && /^cloud:\/\//i.test(meta.fileID)) {
    return resolveCloudTempUrl(meta.fileID).then((url) =>
      Object.assign({}, meta, { path: url || meta.path })
    );
  }
  return Promise.resolve(meta);
}

function assignCloudTrackToClip(clipId, track) {
  const id = normalizeClipId(clipId);
  if (!id) return Promise.reject(new Error('缺少抖音条目'));
  const draft = trackToMeta(track);
  if (!draft) return Promise.reject(new Error('无效曲目'));
  const meta = setClipBgm(id, draft);
  if (!meta) return Promise.reject(new Error('保存失败'));
  if (meta.fileID && /^cloud:\/\//i.test(meta.fileID)) {
    return resolveCloudTempUrl(meta.fileID).then((url) =>
      Object.assign({}, meta, { path: url || meta.path })
    );
  }
  return Promise.resolve(meta);
}

module.exports = {
  getBgm,
  setBgm,
  clearBgm,
  listLocalBgmEntries,
  getClipBgm,
  setClipBgm,
  clearClipBgm,
  saveUploadedAudio,
  saveBgmFromUrl,
  pickAudioFile,
  pickVideoFile,
  hasVideoExtractFreeTrial,
  fetchVideoExtractQuota,
  beginVideoExtractQuota,
  refundVideoExtractQuota,
  extractAudioFromVideoToLocal,
  extractAudioFromVideoToLibrary,
  resolvePlayableBgm,
  resolvePlayableClipBgm,
  ensureRandomBgmForClip,
  resolveCloudTempUrl,
  isCloudTempHttps,
  isAudioUrl,
  normalizeAudioUrl,
  listCloudBgmLibrary,
  listCloudBgmLibraryWithSeed,
  ensureBgmPackLoaded,
  seedBuiltinOcClipBgm,
  registerCloudBgm,
  uploadAudioToCloudLibrary,
  uploadAudiosToCloudLibrary,
  assignCloudTrackToOc,
  assignCloudTrackToClip,
  purgeLocalBgmStorage,
  MAX_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  MAX_CLIP_BGM,
  AUDIO_EXTS
};
