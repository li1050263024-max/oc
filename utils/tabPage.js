/** 所有 Tab 主页面共用的 window 配置（写入各页 .json） */
const { applyUiThemeBackground, getUiThemeClass, syncCurrentPageTheme } = require('./uiTheme.js');

const TAB_PAGE_JSON = {
  navigationStyle: 'custom',
  backgroundColor: '#c8bee4',
  backgroundColorTop: '#c8bee4',
  backgroundColorBottom: '#c4d0e8',
  backgroundColorContent: '#c8bee400'
};

function applyPageGradientBg() {
  applyUiThemeBackground();
  syncCurrentPageTheme();
}

function bindTabPage(pageDef) {
  const userOnLoad = pageDef.onLoad;
  const userOnShow = pageDef.onShow;
  pageDef.onLoad = function (options) {
    applyPageGradientBg();
    if (userOnLoad) userOnLoad.call(this, options);
  };
  pageDef.onShow = function () {
    applyPageGradientBg();
    if (userOnShow) userOnShow.call(this);
  };
  return pageDef;
}

module.exports = {
  TAB_PAGE_JSON,
  applyPageGradientBg,
  bindTabPage
};
