const STORAGE_UI_THEME = 'oc_ui_theme';
const THEME_PURPLE = 'purple';
const THEME_MONO = 'mono';
const THEME_PINK = 'pink';

const THEME_BG = {
  purple: {
    backgroundColor: '#c8bee4',
    backgroundColorTop: '#c8bee4',
    backgroundColorBottom: '#c4d0e8'
  },
  mono: {
    backgroundColor: '#e4e4e7',
    backgroundColorTop: '#ececee',
    backgroundColorBottom: '#d4d4d8'
  },
  pink: {
    backgroundColor: '#fdf8fa',
    backgroundColorTop: '#f8fbfe',
    backgroundColorBottom: '#f5eef3'
  }
};

function normalizeTheme(raw) {
  if (raw === THEME_MONO) return THEME_MONO;
  if (raw === THEME_PINK) return THEME_PINK;
  return THEME_PURPLE;
}

function getUiTheme() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.uiTheme) {
      return normalizeTheme(app.globalData.uiTheme);
    }
    return normalizeTheme(wx.getStorageSync(STORAGE_UI_THEME));
  } catch (_) {
    return THEME_PURPLE;
  }
}

function getUiThemeClass(theme) {
  const t = normalizeTheme(theme || getUiTheme());
  if (t === THEME_MONO) return 'theme-mono';
  if (t === THEME_PINK) return 'theme-pink';
  return '';
}

function initUiTheme() {
  const theme = getUiTheme();
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.uiTheme = theme;
  } catch (_) {}
  return theme;
}

function setUiTheme(theme) {
  const next = normalizeTheme(theme);
  try {
    wx.setStorageSync(STORAGE_UI_THEME, next);
  } catch (_) {}
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.uiTheme = next;
  } catch (_) {}
  applyUiThemeBackground(next);
  syncCurrentPageTheme();
  return next;
}

function applyUiThemeBackground(theme) {
  const t = normalizeTheme(theme || getUiTheme());
  const bg = THEME_BG[t] || THEME_BG.purple;
  if (typeof wx.setBackgroundColor === 'function') {
    wx.setBackgroundColor(bg);
  }
}

function syncCurrentPageTheme() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    if (cur && cur.setData) {
      cur.setData({ uiThemeClass: getUiThemeClass() });
    }
  } catch (_) {}
}

function syncPageTheme(page) {
  const target = page;
  if (target && target.setData) {
    target.setData({ uiThemeClass: getUiThemeClass() });
  } else {
    syncCurrentPageTheme();
  }
  applyUiThemeBackground();
}

function getSnapshotColors(theme) {
  const t = normalizeTheme(theme || getUiTheme());
  if (t === THEME_MONO) {
    return {
      bgTop: '#f4f4f5',
      bgBottom: '#e4e4e7',
      title: '#27272a',
      userBg: '#52525b'
    };
  }
  if (t === THEME_PINK) {
    return {
      bgTop: '#fdf8fa',
      bgBottom: '#eef4fb',
      title: '#e8a6b3',
      userBg: '#f7c9d3'
    };
  }
  return {
    bgTop: '#f5f0fc',
    bgBottom: '#dce8f4',
    title: '#6d28d9',
    userBg: '#a78bfa'
  };
}

function getModalConfirmColor(theme) {
  const t = normalizeTheme(theme || getUiTheme());
  if (t === THEME_MONO) return '#27272a';
  if (t === THEME_PINK) return '#e8a6b3';
  return '#6d28d9';
}

function getSwiperIndicatorColors(theme) {
  const t = normalizeTheme(theme || getUiTheme());
  if (t === THEME_MONO) {
    return { indicatorColor: 'rgba(39, 39, 42, 0.25)', indicatorActiveColor: '#27272a' };
  }
  if (t === THEME_PINK) {
    return { indicatorColor: 'rgba(232, 166, 179, 0.24)', indicatorActiveColor: '#e8a6b3' };
  }
  return { indicatorColor: 'rgba(109, 40, 217, 0.25)', indicatorActiveColor: '#6d28d9' };
}

module.exports = {
  THEME_PURPLE,
  THEME_MONO,
  THEME_PINK,
  STORAGE_UI_THEME,
  getUiTheme,
  getUiThemeClass,
  getModalConfirmColor,
  getSwiperIndicatorColors,
  getSnapshotColors,
  initUiTheme,
  setUiTheme,
  applyUiThemeBackground,
  syncPageTheme,
  syncCurrentPageTheme
};
