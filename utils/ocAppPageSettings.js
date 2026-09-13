/**
 * OC APP 入口卡片上方「设置」：选择 OC / 回复节奏（朋友圈、抖音同款面板）
 */
const replySettings = require('./ocMomentsReplySettings.js');
const { hasAnyOcForSocial } = require('./ocSocialEligible.js');

function openWatchOc(appKey) {
  if (!hasAnyOcForSocial()) {
    wx.showToast({ title: '请先在设定本中保存 OC', icon: 'none' });
    return;
  }
  wx.navigateTo({
    url: '/pages/ocApp/ocWatchOc/ocWatchOc?app=' + encodeURIComponent(appKey),
    fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' })
  });
}

function openReplyModeSheet(appKey, onDone) {
  const key = appKey === 'douyin' ? 'douyin' : 'moments';
  const opts = replySettings.getReplyModeOptions();
  const current = replySettings.getReplyMode(key);
  wx.showActionSheet({
    itemList: opts.map((x) => (x.key === current ? '✓ ' : '') + x.label + ' · ' + x.hint),
    success: (res) => {
      const picked = opts[res.tapIndex];
      if (!picked) return;
      replySettings.setReplyMode(picked.key, key);
      wx.showToast({ title: '已设为' + picked.label, icon: 'none' });
      if (typeof onDone === 'function') onDone(picked);
    }
  });
}

/**
 * @param {'moments'|'douyin'} pageKey
 * @param {object} [page] 页面内底部设置面板
 */
function openSettings(pageKey, page) {
  const key = pageKey === 'douyin' ? 'douyin' : 'moments';

  if (page && typeof page.setData === 'function') {
    const mode = replySettings.getReplyMode(key);
    const opts = replySettings.getReplyModeOptions().map((x) =>
      Object.assign({}, x, { selected: x.key === mode })
    );
    const isDy = key === 'douyin';
    page.setData({
      settingsVisible: true,
      settingsAppKey: key,
      settingsTitle: isDy ? '抖音设置' : '朋友圈设置',
      settingsDesc: isDy
        ? '指定参与抖音的角色，并设置其回复评论的节奏'
        : '指定参与朋友圈的角色，并设置其回复评论的节奏',
      settingsWatchSub: isDy
        ? '决定哪些角色会出现在抖音信息流'
        : '决定哪些角色会出现在朋友圈',
      settingsReplyModes: opts,
      settingsReplyMode: mode
    });
    return;
  }

  // 无 page 时回退 ActionSheet
  const items = ['选择 OC', '回复模式'];
  const actions = ['watch', 'reply'];
  wx.showActionSheet({
    itemList: items,
    success: (res) => {
      const act = actions[res.tapIndex];
      if (act === 'watch') {
        openWatchOc(key);
        return;
      }
      if (act === 'reply') {
        openReplyModeSheet(key);
      }
    }
  });
}

function closeSettings(page) {
  if (!page || typeof page.setData !== 'function') return;
  page.setData({ settingsVisible: false });
}

function pickReplyMode(page, modeKey) {
  if (!page) return;
  const appKey = page.data && page.data.settingsAppKey === 'douyin' ? 'douyin' : 'moments';
  const next = replySettings.setReplyMode(modeKey, appKey);
  const opts = replySettings.getReplyModeOptions().map((x) =>
    Object.assign({}, x, { selected: x.key === next })
  );
  page.setData({
    settingsReplyModes: opts,
    settingsReplyMode: next
  });
  wx.showToast({ title: '已设为' + (replySettings.MODE_LABELS[next] || next), icon: 'none' });
}

module.exports = {
  openSettings,
  closeSettings,
  pickReplyMode,
  openWatchOc,
  openReplyModeSheet
};
