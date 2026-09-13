/**
 * 本地用户文件 / KV 存储清理：空间不足时引导用户删除内容
 */
const STORAGE_ERR_CODE = 'STORAGE_FULL';

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / (1024 * 1024)).toFixed(2) + ' MB';
}

function isStorageQuotaError(err) {
  const msg = String((err && (err.errMsg || err.message)) || err || '');
  return /limit|exceed|最大|storage|空间|quota|fail exceed|STORAGE_FULL/i.test(msg);
}

function makeStorageFullError(detail) {
  const e = new Error(
    detail ||
      '本地存储空间不足（约 10MB 上限）。请删除部分立绘、自定义 BGM 或无效缓存后重试'
  );
  e.code = STORAGE_ERR_CODE;
  e.storageFull = true;
  return e;
}

function getKvStorageSnapshot() {
  try {
    const info = wx.getStorageInfoSync() || {};
    return {
      currentSize: Number(info.currentSize) || 0,
      limitSize: Number(info.limitSize) || 0,
      keys: Array.isArray(info.keys) ? info.keys.slice() : []
    };
  } catch (_) {
    return { currentSize: 0, limitSize: 0, keys: [] };
  }
}

function getUserDataDir() {
  try {
    const env = wx.env || {};
    return String(env.USER_DATA_PATH || env.USERDATA_PATH || '').replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function statFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(0);
      return;
    }
    try {
      const fs = wx.getFileSystemManager();
      fs.stat({
        path: filePath,
        success: (res) => {
          const st = (res && res.stats) || res;
          resolve(Number((st && st.size) || 0) || 0);
        },
        fail: () => resolve(0)
      });
    } catch (_) {
      resolve(0);
    }
  });
}

function listUserDataNames() {
  return new Promise((resolve) => {
    const base = getUserDataDir();
    if (!base) {
      resolve([]);
      return;
    }
    try {
      const fs = wx.getFileSystemManager();
      fs.readdir({
        dirPath: base,
        success: (res) => {
          const names = (res && res.files) || res || [];
          resolve(Array.isArray(names) ? names.map(String) : []);
        },
        fail: () => resolve([])
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function estimateStorageValueBytes(val) {
  try {
    if (val == null) return 0;
    if (typeof val === 'string') return val.length * 2;
    return JSON.stringify(val).length * 2;
  } catch (_) {
    return 0;
  }
}

function classifyKvKey(key) {
  const k = String(key || '');
  if (/^oc_chat_|^oc_group_chat|^oc_chat_sessions_|^oc_chat_memory_/.test(k)) return 'chat';
  if (/^oc_favorites|^oc_work|^oc_notebook|^oc_family|^oc_deleted/.test(k)) return 'notebook';
  if (/^oc_douyin_|^oc_dy_/.test(k)) return 'douyin';
  if (/image|avatar|album|立绘|bgm|audio/i.test(k)) return 'media';
  return 'other';
}

/**
 * @returns {Promise<{
 *   kv: object,
 *   items: Array,
 *   categories: Array,
 *   orphanAudioCount: number,
 *   orphanImageHint: string
 * }>}
 */
async function buildCleanupInventory() {
  const kv = getKvStorageSnapshot();
  const items = [];
  let douyinBgm = null;
  try {
    douyinBgm = require('./ocDouyinBgm.js');
  } catch (_) {}

  if (douyinBgm && typeof douyinBgm.listLocalBgmEntries === 'function') {
    const entries = douyinBgm.listLocalBgmEntries() || [];
    for (let i = 0; i < entries.length; i++) {
      const row = entries[i];
      // eslint-disable-next-line no-await-in-loop
      const size = await statFile(row.path);
      items.push({
        id: 'bgm_' + row.ocId,
        kind: 'bgm',
        title: row.name || '自定义 BGM',
        sub: '本地 BGM · OC',
        size: size,
        sizeText: formatBytes(size),
        path: row.path,
        ocId: row.ocId,
        selected: false
      });
    }
  }

  const names = await listUserDataNames();
  const base = getUserDataDir();
  let orphanAudio = 0;
  let orphanAudioBytes = 0;
  let fileImageBytes = 0;
  let fileOtherBytes = 0;
  const keepPaths = {};
  items.forEach((it) => {
    if (it.path) keepPaths[it.path] = true;
  });
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const full = base + '/' + name;
    // eslint-disable-next-line no-await-in-loop
    const size = await statFile(full);
    if (/^oc_dy_bgm_/i.test(name)) {
      if (!keepPaths[full]) {
        orphanAudio += 1;
        orphanAudioBytes += size;
      }
      continue;
    }
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name) || /image|avatar|album/i.test(name)) {
      fileImageBytes += size;
    } else {
      fileOtherBytes += size;
    }
  }

  const catBytes = {
    chat: 0,
    notebook: 0,
    douyin: 0,
    media: 0,
    other: 0
  };
  (kv.keys || []).forEach((key) => {
    let bytes = 0;
    try {
      bytes = estimateStorageValueBytes(wx.getStorageSync(key));
    } catch (_) {
      bytes = 0;
    }
    const cat = classifyKvKey(key);
    catBytes[cat] = (catBytes[cat] || 0) + bytes;
  });

  const bgmBytes = items.reduce((s, it) => s + (Number(it.size) || 0), 0);
  const categories = [
    {
      id: 'chat',
      title: '聊天记录（键值）',
      size: catBytes.chat,
      sizeText: formatBytes(catBytes.chat),
      hint: '私聊/群聊消息与会话'
    },
    {
      id: 'notebook',
      title: '设定本 / 收藏',
      size: catBytes.notebook,
      sizeText: formatBytes(catBytes.notebook),
      hint: 'OC 设定与收藏数据'
    },
    {
      id: 'douyin',
      title: '抖音动态（键值）',
      size: catBytes.douyin,
      sizeText: formatBytes(catBytes.douyin),
      hint: '信息流、评论、点赞等'
    },
    {
      id: 'bgm',
      title: '自定义本地 BGM',
      size: bgmBytes + orphanAudioBytes,
      sizeText: formatBytes(bgmBytes + orphanAudioBytes),
      hint: orphanAudio
        ? '含 ' + orphanAudio + ' 个未引用音频'
        : '已绑定的自定义音乐'
    },
    {
      id: 'images',
      title: '本地图片文件',
      size: fileImageBytes,
      sizeText: formatBytes(fileImageBytes),
      hint: '立绘/缓存图（可到设定本删除）'
    },
    {
      id: 'other',
      title: '其它缓存',
      size: catBytes.media + catBytes.other + fileOtherBytes,
      sizeText: formatBytes(catBytes.media + catBytes.other + fileOtherBytes),
      hint: '其它键值与临时文件'
    }
  ].filter((c) => c.size > 0 || c.id === 'chat' || c.id === 'douyin' || c.id === 'bgm');

  const totalCat = categories.reduce((s, c) => s + (Number(c.size) || 0), 0) || 1;
  categories.forEach((c) => {
    c.pct = Math.max(2, Math.round(((Number(c.size) || 0) / totalCat) * 100));
  });

  return {
    kv: kv,
    kvText:
      formatBytes((kv.currentSize || 0) * 1024) +
      (kv.limitSize ? ' / ' + formatBytes(kv.limitSize * 1024) : ''),
    categories: categories,
    items: items,
    orphanAudioCount: orphanAudio,
    orphanAudioBytes: orphanAudioBytes,
    orphanAudioText: orphanAudio
      ? orphanAudio + ' 个未引用音频（约 ' + formatBytes(orphanAudioBytes) + '）'
      : '暂无未引用音频',
    orphanImageHint: '未引用立绘/缓存可一键清理'
  };
}

async function deleteSelectedItems(selectedIds) {
  const ids = selectedIds || [];
  let deleted = 0;
  let douyinBgm = null;
  try {
    douyinBgm = require('./ocDouyinBgm.js');
  } catch (_) {}
  ids.forEach((id) => {
    const s = String(id || '');
    if (s.indexOf('bgm_') === 0 && douyinBgm && typeof douyinBgm.clearBgm === 'function') {
      const ocId = s.slice(4);
      douyinBgm.clearBgm(ocId);
      deleted += 1;
    }
  });
  return { deleted };
}

async function runAutoPurge() {
  let deleted = 0;
  try {
    const douyinBgm = require('./ocDouyinBgm.js');
    if (typeof douyinBgm.purgeLocalBgmStorage === 'function') {
      const r = await douyinBgm.purgeLocalBgmStorage([]);
      deleted += Number(r && r.deleted) || 0;
    }
  } catch (_) {}
  try {
    const ocImage = require('./ocImage.js');
    if (typeof ocImage.cleanupUserImageStorage === 'function') {
      const r = await ocImage.cleanupUserImageStorage([]);
      deleted += Number(r && r.deleted) || 0;
    }
  } catch (_) {}
  return { deleted };
}

/**
 * 弹窗引导清理；确认后跳转清理页
 * @param {object} [opts]
 * @param {string} [opts.message]
 * @param {boolean} [opts.autoNavigate]
 */
function promptStorageCleanup(opts) {
  const options = opts || {};
  const message =
    options.message ||
    '小程序本地文件空间约有 10MB 上限。请删除部分自定义 BGM、未引用缓存，或到设定本删除不用的立绘后重试。';
  return new Promise((resolve) => {
    wx.showModal({
      title: '本地存储空间不足',
      content: message,
      confirmText: '去清理',
      cancelText: '取消',
      success: (res) => {
        if (res && res.confirm) {
          wx.navigateTo({
            url: '/pages/ocApp/ocStorageClean/ocStorageClean',
            fail: () => {
              wx.showToast({ title: '打开清理页失败', icon: 'none' });
              resolve(false);
            },
            success: () => resolve(true)
          });
          return;
        }
        resolve(false);
      },
      fail: () => resolve(false)
    });
  });
}

function openStorageCleanPage() {
  return new Promise((resolve) => {
    wx.navigateTo({
      url: '/pages/ocApp/ocStorageClean/ocStorageClean',
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

module.exports = {
  STORAGE_ERR_CODE,
  formatBytes,
  isStorageQuotaError,
  makeStorageFullError,
  getKvStorageSnapshot,
  buildCleanupInventory,
  deleteSelectedItems,
  runAutoPurge,
  promptStorageCleanup,
  openStorageCleanPage
};
