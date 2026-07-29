const PACK_EXT = '.json';
const TXT_EXT = '.txt';
const { markSkipAppRelaunch } = require('./appRelaunch.js');

let _pickBusy = false;

function safeFileName(name) {
  return String(name || 'oc')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 24);
}

function writePackFile(pack, baseName) {
  const fs = wx.getFileSystemManager();
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = safeFileName(baseName) + '_' + stamp + PACK_EXT;
  const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
  fs.writeFileSync(filePath, JSON.stringify(pack), 'utf8');
  return { filePath, fileName };
}

function writeTextFile(content, baseName) {
  const fs = wx.getFileSystemManager();
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = safeFileName(baseName) + '_' + stamp + TXT_EXT;
  const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
  fs.writeFileSync(filePath, String(content || ''), 'utf8');
  return { filePath, fileName };
}

function sharePackFile(pack, baseName) {
  try {
    const { filePath, fileName } = writePackFile(pack, baseName);
    if (wx.shareFileMessage) {
      markSkipAppRelaunch();
      wx.shareFileMessage({ filePath, fileName });
      return true;
    }
    wx.setClipboardData({
      data: JSON.stringify(pack),
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' })
    });
    return true;
  } catch (err) {
    console.error('[ocShare] sharePackFile', err);
    wx.showToast({ title: '分享失败', icon: 'none' });
    return false;
  }
}

function shareTextFile(content, baseName) {
  try {
    const text = String(content || '').trim();
    if (!text) {
      wx.showToast({ title: '无内容可分享', icon: 'none' });
      return false;
    }
    const { filePath, fileName } = writeTextFile(text, baseName);
    if (wx.shareFileMessage) {
      markSkipAppRelaunch();
      wx.shareFileMessage({ filePath, fileName });
      return true;
    }
    wx.setClipboardData({
      data: text.slice(0, 50000),
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' })
    });
    return true;
  } catch (err) {
    console.error('[ocShare] shareTextFile', err);
    wx.showToast({ title: '分享失败', icon: 'none' });
    return false;
  }
}

function exportPackToClipboard(pack) {
  const text = JSON.stringify(pack);
  if (text.length > 900000) {
    wx.showToast({ title: '数据过大，请用文件分享', icon: 'none' });
    return false;
  }
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: '已复制导出数据', icon: 'none' })
  });
  return true;
}

function pickPackFile(onDone) {
  if (_pickBusy) {
    if (onDone) onDone(new Error('请稍候'));
    return;
  }
  _pickBusy = true;
  const finish = (err, pack) => {
    _pickBusy = false;
    if (onDone) onDone(err, pack);
  };

  markSkipAppRelaunch();
  wx.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['json', 'txt'],
    success: (res) => {
      const file = res.tempFiles && res.tempFiles[0];
      if (!file || !file.path) {
        finish(new Error('未选择文件'));
        return;
      }
      wx.getFileSystemManager().readFile({
        filePath: file.path,
        encoding: 'utf8',
        success: (r) => {
          const raw = String(r.data || '').trim();
          if (!raw) {
            finish(new Error('文件为空'));
            return;
          }
          try {
            finish(null, JSON.parse(raw));
          } catch (e) {
            finish(new Error('请导入 JSON 备份文件'));
          }
        },
        fail: () => finish(new Error('读取文件失败'))
      });
    },
    fail: (err) => {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
        finish(new Error('未选择文件'));
        return;
      }
      finish(new Error('未选择文件'));
    }
  });
}

function sharePlainText(title, body) {
  const text =
    String(title || '').trim() +
    (body ? '\n\n' + String(body).trim() : '');
  shareTextFile(text, title || 'oc');
}

function isPickBusy() {
  return _pickBusy;
}

module.exports = {
  writePackFile,
  writeTextFile,
  sharePackFile,
  shareTextFile,
  exportPackToClipboard,
  pickPackFile,
  sharePlainText,
  isPickBusy
};
