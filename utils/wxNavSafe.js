/** 微信小程序顶栏 / 胶囊按钮安全区 */
function getWxNavSafeInsets() {
  try {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    const statusBar = Number(win.statusBarHeight) || 20;
    const windowWidth = Number(win.windowWidth) || 375;
    let topHeight = statusBar + 8;
    let capsulePaddingRight = 12;
    let menuTop = statusBar + 4;
    let menuHeight = 32;

    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.bottom) {
        topHeight = Math.ceil(menu.bottom + 8);
      }
      if (menu && menu.top != null && menu.height) {
        menuTop = menu.top;
        menuHeight = menu.height;
      }
      if (menu && menu.left) {
        capsulePaddingRight = Math.max(12, Math.ceil(windowWidth - menu.left + 8));
      }
    }

    return { topHeight, capsulePaddingRight, menuTop, menuHeight };
  } catch (_) {
    return { topHeight: 64, capsulePaddingRight: 96, menuTop: 24, menuHeight: 32 };
  }
}

/** 切换条近似宽度（rpx），用于判断是否与胶囊重叠 */
const SEGMENT_BAR_WIDTH_RPX = 360;

function buildSegmentNavStyle(insets) {
  const i = insets || getWxNavSafeInsets();
  let windowWidth = 375;
  let menuLeft = windowWidth - i.capsulePaddingRight + 8;
  try {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    windowWidth = Number(win.windowWidth) || windowWidth;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.left) menuLeft = menu.left;
    }
  } catch (_) {}

  const barWidthPx = (SEGMENT_BAR_WIDTH_RPX / 750) * windowWidth;
  const pageCenter = windowWidth / 2;
  const barRightIfCentered = pageCenter + barWidthPx / 2;
  const safeRight = menuLeft - 8;
  let shiftLeft = 0;
  if (barRightIfCentered > safeRight) {
    shiftLeft = Math.ceil(barRightIfCentered - safeRight);
  }

  let style =
    'top:' + i.menuTop + 'px;height:' + i.menuHeight + 'px;';
  if (shiftLeft > 0) {
    style += 'transform:translateX(-' + shiftLeft + 'px);';
  }
  return style;
}

function buildChatListRailStyle(insets) {
  const i = insets || getWxNavSafeInsets();
  let windowWidth = 375;
  try {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    windowWidth = Number(win.windowWidth) || windowWidth;
  } catch (_) {}
  const leftPx = Math.round((48 / 750) * windowWidth);
  return (
    'top:' +
    i.menuTop +
    'px;height:' +
    i.menuHeight +
    'px;left:' +
    leftPx +
    'px;'
  );
}

/** 人设详情页：收起按钮与胶囊同一行、紧靠胶囊左侧 */
function buildProfileCollapseBarStyle(insets) {
  const i = insets || getWxNavSafeInsets();
  return (
    'top:' +
    i.menuTop +
    'px;height:' +
    i.menuHeight +
    'px;padding-right:' +
    i.capsulePaddingRight +
    'px;'
  );
}

/** 人设详情页侧栏宽度（rpx） */
const PROFILE_TAB_RAIL_WIDTH_RPX = 88;

/** 人设详情页：右侧固定侧栏 */
function buildProfileTabRailStyle(insets) {
  const i = insets || getWxNavSafeInsets();
  return 'top:' + i.topHeight + 'px;width:' + PROFILE_TAB_RAIL_WIDTH_RPX + 'rpx;';
}

/** 人设详情页：scroll 区顶部留白（胶囊行下方） */
function buildProfileScrollPadStyle(insets, tabRailCollapsed) {
  const i = insets || getWxNavSafeInsets();
  const rightPad = tabRailCollapsed ? '10px' : '0px';
  return (
    'padding-top:' +
    i.topHeight +
    'px;padding-left:10px;padding-right:' +
    rightPad +
    ';padding-bottom:48rpx;'
  );
}

/** 人设详情页：面板标题区右侧留白，避免与收起按钮重叠 */
function buildProfilePanelHeadStyle(insets) {
  const i = insets || getWxNavSafeInsets();
  return 'padding-right:' + (i.capsulePaddingRight + 72) + 'px;';
}

module.exports = {
  getWxNavSafeInsets,
  buildSegmentNavStyle,
  buildChatListRailStyle,
  buildProfileCollapseBarStyle,
  buildProfileTabRailStyle,
  buildProfileScrollPadStyle,
  buildProfilePanelHeadStyle,
  PROFILE_TAB_RAIL_WIDTH_RPX
};
