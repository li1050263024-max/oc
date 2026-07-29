function shareSheetDefaults() {
  return {
    shareSheetVisible: false,
    shareSheetTitle: '',
    shareSheetContent: ''
  };
}

function showShareSheet(page, options) {
  if (!page || typeof page.setData !== 'function') return;
  const opts = options || {};
  page._shareAppMeta = {
    shareTitle: opts.shareTitle || opts.title || 'OC 设定',
    path: opts.path || '/pages/index/index'
  };
  page.setData({
    shareSheetVisible: true,
    shareSheetTitle: opts.title || '分享',
    shareSheetContent: String(opts.content || '').trim()
  });
}

function closeShareSheet(page) {
  if (!page || typeof page.setData !== 'function') return;
  page.setData({
    shareSheetVisible: false,
    shareSheetTitle: '',
    shareSheetContent: ''
  });
}

function buildOcSharePath(favoriteId) {
  if (!favoriteId) return '/pages/ocNotebook/ocNotebook';
  return (
    '/pages/ocNotebookEdit/ocNotebookEdit?id=' +
    encodeURIComponent(String(favoriteId))
  );
}

function buildShareMessage(page) {
  const meta = (page && page._shareAppMeta) || {};
  return {
    title: meta.shareTitle || 'OC 设定',
    path: meta.path || '/pages/index/index'
  };
}

function bindSharePage(page) {
  if (!page) return;
  page.onCloseShareSheet = function () {
    closeShareSheet(page);
  };
  if (!page.onShareAppMessage) {
    page.onShareAppMessage = function () {
      return buildShareMessage(page);
    };
  }
}

module.exports = {
  shareSheetDefaults,
  showShareSheet,
  closeShareSheet,
  buildShareMessage,
  buildOcSharePath,
  bindSharePage
};
