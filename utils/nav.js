const STORAGE_OC_WORK = 'oc_work_in_progress';
const { isLayer3Ready } = require('./ocWork.js');
const { hasAnyOcForSocial } = require('./ocSocialEligible.js');
const {
  hasLocalOcSetting,
  getFavorites,
  loadFavoriteToWork,
  workFromFavoriteItem,
  ensureCurrentWorkInFavorites
} = require('./favorite.js');

const ROUTES = {
  index: '/pages/index/index',
  favorites: '/pages/favorites/favorites',
  pools: '/pages/pools/pools',
  notebook: '/pages/ocNotebook/ocNotebook',
  chat: '/pages/ocChat/ocChat',
  groupChat: '/pages/ocGroupChat/ocGroupChat',
  bio: '/pages/ocBioHub/ocBioHub',
  story: '/pages/ocStory/ocStory',
  moments: '/pages/ocMoments/ocMoments',
  feedback: '/pages/feedback/feedback'
};

const MAIN_TABS = {
  notebook: ROUTES.notebook,
  pools: ROUTES.pools,
  story: ROUTES.bio,
  chat: ROUTES.chat,
  moments: ROUTES.moments
};

function getCurrentRoute() {
  const pages = getCurrentPages();
  if (!pages.length) return '';
  return pages[pages.length - 1].route || '';
}

function routeKeyFromPath(route) {
  if (!route) return '';
  const rules = [
    ['index/index', 'index'],
    ['ocStory/ocStory', 'story'],
    ['ocBioHub/ocBioHub', 'bio'],
    ['ocBio/ocBio', 'bio'],
    ['ocChat/ocChat', 'chat'],
    ['ocGroupChat/ocGroupChat', 'groupChat'],
    ['ocMoments/ocMoments', 'moments'],
    ['ocNotebookEdit', 'notebookEdit'],
    ['ocNotebook/ocNotebook', 'notebook'],
    ['favorites/favorites', 'favorites'],
    ['pools/pools', 'pools'],
    ['background/background', 'background'],
    ['attitude/attitude', 'attitude'],
    ['mindmap/mindmap', 'mindmap'],
    ['feedback/feedback', 'feedback']
  ];
  for (let i = 0; i < rules.length; i++) {
    if (route.indexOf(rules[i][0]) !== -1) return rules[i][1];
  }
  return '';
}

function checkLayer3Ready() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (isLayer3Ready(work)) return true;
  const favs = getFavorites();
  for (let i = 0; i < favs.length; i++) {
    const w = workFromFavoriteItem(favs[i]);
    if (isLayer3Ready(w)) return true;
  }
  return false;
}

function checkAnyOcHasBio() {
  return hasAnyOcForSocial();
}

function ensureLayer3WorkLoaded() {
  const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
  if (isLayer3Ready(work)) {
    ensureCurrentWorkInFavorites();
    return true;
  }
  const favs = getFavorites();
  for (let i = 0; i < favs.length; i++) {
    const w = workFromFavoriteItem(favs[i]);
    if (isLayer3Ready(w)) {
      loadFavoriteToWork(favs[i].id);
      return true;
    }
  }
  return false;
}

function goHome() {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.indexHomeReset = true;
  }
  const cur = routeKeyFromPath(getCurrentRoute());
  if (cur === 'index') {
    const pages = getCurrentPages();
    const curPage = pages.length ? pages[pages.length - 1] : null;
    if (curPage && typeof curPage.resetToHomeScreen === 'function') {
      curPage.resetToHomeScreen();
    }
    return 'same';
  }
  // 首页在主包：优先 reLaunch，保证从分包一定能回去
  wx.reLaunch({
    url: ROUTES.index,
    fail(err) {
      console.error('[nav] goHome reLaunch fail', err);
      wx.redirectTo({
        url: ROUTES.index,
        fail() {
          wx.showToast({ title: '返回首页失败', icon: 'none' });
        }
      });
    }
  });
  return 'navigated';
}

function openTabUrl(url, key) {
  if (!url) return false;
  // Tab 互切用 redirectTo（快）；失败再 reLaunch
  wx.redirectTo({
    url,
    fail(err) {
      console.error('[nav] redirectTo fail', key, url, err);
      wx.reLaunch({
        url,
        fail(err2) {
          console.error('[nav] reLaunch fail', key, url, err2);
          wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
        }
      });
    }
  });
  return 'navigated';
}

function switchMainTab(key) {
  if (key === 'home' || key === 'index') {
    return goHome();
  }

  const url = MAIN_TABS[key];
  if (!url) return false;

  if (key === 'story' && !hasLocalOcSetting()) {
    wx.showToast({
      title: '请先在设定本中保存 OC',
      icon: 'none',
      duration: 2800
    });
    return false;
  }
  if (key === 'chat') {
    if (!checkAnyOcHasBio()) {
      wx.showToast({
        title: '请先在设定本中保存 OC',
        icon: 'none',
        duration: 2800
      });
      return false;
    }
    ensureLayer3WorkLoaded();
  }
  if (key === 'moments' && !checkAnyOcHasBio()) {
    wx.showToast({
      title: '请先在设定本中保存 OC',
      icon: 'none',
      duration: 2800
    });
    return false;
  }

  const tabRouteKey = key === 'story' ? 'bio' : key === 'chat' ? 'chat' : key;
  const cur = routeKeyFromPath(getCurrentRoute());
  if (
    cur === tabRouteKey ||
    (key === 'story' && cur === 'story') ||
    (key === 'chat' && cur === 'groupChat')
  ) {
    return 'same';
  }

  return openTabUrl(url, key);
}

function goTo(key) {
  if (key === 'index') {
    return goHome();
  }
  if (key === 'favorites') {
    return goTo('notebook');
  }
  if (key === 'bio') {
    return switchMainTab('story');
  }
  if (key === 'notebook' || key === 'pools' || key === 'moments') {
    return switchMainTab(key);
  }
  if (key === 'story') {
    if (!hasLocalOcSetting()) {
      wx.showToast({
        title: '请先生成一套 OC 设定',
        icon: 'none',
        duration: 2800
      });
      return false;
    }
    ensureLayer3WorkLoaded();
    const cur = routeKeyFromPath(getCurrentRoute());
    if (cur === 'story') return 'same';
    wx.redirectTo({
      url: ROUTES.story,
      fail() {
        wx.reLaunch({ url: ROUTES.story });
      }
    });
    return 'navigated';
  }
  if (key === 'chat') {
    if (!checkAnyOcHasBio()) {
      wx.showToast({
        title: '请先在设定本中保存 OC',
        icon: 'none',
        duration: 2800
      });
      return false;
    }
    ensureLayer3WorkLoaded();
    const cur = routeKeyFromPath(getCurrentRoute());
    if (cur === 'chat') return 'same';
    wx.redirectTo({
      url: ROUTES.chat,
      fail() {
        wx.reLaunch({ url: ROUTES.chat });
      }
    });
    return 'navigated';
  }
  if (key === 'groupChat') {
    if (!checkAnyOcHasBio()) {
      wx.showToast({
        title: '请先在设定本中保存 OC',
        icon: 'none',
        duration: 2800
      });
      return false;
    }
    ensureLayer3WorkLoaded();
    const cur = routeKeyFromPath(getCurrentRoute());
    if (cur === 'groupChat') return 'same';
    wx.redirectTo({
      url: ROUTES.groupChat,
      fail() {
        wx.reLaunch({ url: ROUTES.groupChat });
      }
    });
    return 'navigated';
  }

  const url = ROUTES[key];
  if (!url) {
    wx.showToast({ title: '页面未配置', icon: 'none' });
    return false;
  }
  const cur = routeKeyFromPath(getCurrentRoute());
  if (cur === key) return 'same';

  const pages = getCurrentPages();
  const open = function () {
    wx.navigateTo({
      url: url,
      fail: function (err) {
        wx.redirectTo({
          url: url,
          fail: function () {
            wx.showToast({ title: '无法打开页面', icon: 'none' });
            console.error('[nav] open fail:', key, err);
          }
        });
      }
    });
  };
  if (pages.length >= 9) {
    wx.redirectTo({ url: url, fail: open });
  } else {
    open();
  }
  return 'navigated';
}

module.exports = {
  ROUTES,
  MAIN_TABS,
  getCurrentRoute,
  routeKeyFromPath,
  checkLayer3Ready,
  checkAnyOcHasBio,
  hasLocalOcSetting,
  ensureLayer3WorkLoaded,
  goHome,
  goTo,
  switchMainTab
};
