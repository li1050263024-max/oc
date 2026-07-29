const {
  pickPackFile,
  sharePackFile,
  shareTextFile,
  isPickBusy
} = require('./ocShare.js');
const { importPack } = require('./ocPack.js');
const { showShareSheet } = require('./inAppSharePage.js');

let _importBusy = false;

function toastImportResult(result) {
  if (result.ok) {
    wx.showToast({ title: result.message || '导入成功', icon: 'success' });
  } else {
    wx.showToast({ title: result.errMsg || '导入失败', icon: 'none' });
  }
}

function runImportPack(options, onSuccess) {
  const opts = options || {};
  if (_importBusy || isPickBusy()) {
    wx.showToast({ title: '请稍候…', icon: 'none' });
    return;
  }
  _importBusy = true;
  const done = () => {
    _importBusy = false;
    if (typeof opts.onFinish === 'function') opts.onFinish();
  };
  pickPackFile((err, pack) => {
    if (err) {
      done();
      if (err.message !== '未选择文件' && err.message !== '请稍候') {
        wx.showToast({ title: err.message || '导入失败', icon: 'none' });
      }
      return;
    }
    const result = importPack(pack, opts);
    toastImportResult(result);
    if (result.ok && typeof onSuccess === 'function') {
      onSuccess(result);
    }
    done();
  });
}

function runSharePack(pack, baseName) {
  if (!pack) {
    wx.showToast({ title: '无数据可分享', icon: 'none' });
    return;
  }
  sharePackFile(pack, baseName || 'oc_backup');
}

function runShareText(title, body, meta) {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  const text = String(body || '').trim();
  if (!text) {
    wx.showToast({ title: '无内容可分享', icon: 'none' });
    return;
  }
  showShareSheet(page, {
    title: title || '分享',
    content: text,
    shareTitle: (meta && meta.shareTitle) || title || 'OC 设定',
    path: (meta && meta.path) || '/pages/index/index'
  });
}

function runShareTextFile(content, baseName) {
  shareTextFile(content, baseName || 'oc');
}

function runExportMenu(options) {
  const opts = options || {};
  wx.showActionSheet({
    itemList: ['导出 txt 文本', '导出 JSON 备份'],
    success: (res) => {
      if (res.tapIndex === 0) {
        const text = typeof opts.getText === 'function' ? opts.getText() : '';
        if (!text) {
          wx.showToast({ title: '无内容可导出', icon: 'none' });
          return;
        }
        shareTextFile(text, opts.baseName || 'oc');
      } else if (res.tapIndex === 1) {
        const pack = typeof opts.getPack === 'function' ? opts.getPack() : null;
        if (!pack) {
          wx.showToast({ title: '导出失败', icon: 'none' });
          return;
        }
        sharePackFile(pack, opts.baseName || 'oc_backup');
      }
    }
  });
}

module.exports = {
  runImportPack,
  runSharePack,
  runShareText,
  runShareTextFile,
  runExportMenu,
  toastImportResult,
  isPickBusy
};
