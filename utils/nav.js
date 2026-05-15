const STORAGE_OC_WORK = 'oc_work_in_progress';
const { isLayer3Ready } = require('./ocWork.js');

const ROUTES = {
  index: '/pages/index/index',
  favorites: '/pages/favorites/favorites',
  pools: '/pages/pools/pools',
  notebook: '/pages/ocNotebook/ocNotebook',
  chat: '/pages/ocChat/ocChat',
  bio: '/pages/ocBio/ocBio'
};

function getCurrentRoute() {
  const pages = getCurrentPages();
  if (!pages.length) return '';
  return pages[pages.length - 1].route || '';
}

function routeKeyFromPath(route) {
  if (!route) return '';
  if (route.indexOf('index/index') !== -1) return 'index';
  if (route.indexOf('favorites') !== -1) return 'favorites';
  if (route.indexOf('pools') !== -1) return 'pools';
  if (route.indexOf('ocNotebook') !== -1) return 'notebook';
  if (route.indexOf('ocChat') !== -1) return 'chat';
  if (route.indexOf('ocBio') !== -1) return 'bio';
  return '';
}

function checkLayer3Ready() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  return isLayer3Ready(work);
}

function goTo(key) {
  if (key === 'chat' || key === 'bio') {
    if (!checkLayer3Ready()) {
      wx.showToast({
        title: '请先在「语言与态度」生成常用语与态度',
        icon: 'none',
        duration: 2800
      });
      return false;
    }
  }
  const url = ROUTES[key];
  if (!url) return false;
  const cur = routeKeyFromPath(getCurrentRoute());
  if (cur === key) return 'same';
  if (key === 'index') {
    wx.reLaunch({ url });
  } else {
    wx.navigateTo({ url });
  }
  return true;
}

module.exports = {
  ROUTES,
  getCurrentRoute,
  routeKeyFromPath,
  checkLayer3Ready,
  goTo
};
