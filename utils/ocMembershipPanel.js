/**
 * 选择 OC 页「会员权益」面板：云端 oc_app_config/membership_panel，后台可开关
 */
const STORAGE_KEY = 'oc_membership_panel_cache_v1';

const DEFAULT_PANEL = {
  visible: false,
  title: '额度说明',
  lines: [
    '额度可在「额度商店」直接购买道具',
    '免费用户每周 30 轮对话；额度永久可用',
    '视频提取：免费 3 次，之后 10 点/次',
    '选择 OC 超 10 人：10 点永久 +1 人',
    '会员：仅免广告（额度与次数规则与普通用户相同）'
  ],
  footer: '请到「额度商店」购买额度道具；会员码仅开通免广告'
};

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const lines = Array.isArray(src.lines)
    ? src.lines.map((x) => String(x || '').trim()).filter(Boolean)
    : DEFAULT_PANEL.lines.slice();
  return {
    visible: src.visible === true || src.visible === 1 || src.visible === '1',
    title: String(src.title || DEFAULT_PANEL.title).trim() || DEFAULT_PANEL.title,
    lines: lines.length ? lines : DEFAULT_PANEL.lines.slice(),
    footer: String(src.footer != null ? src.footer : DEFAULT_PANEL.footer).trim()
  };
}

function readCache() {
  try {
    return normalize(wx.getStorageSync(STORAGE_KEY));
  } catch (_) {
    return normalize(DEFAULT_PANEL);
  }
}

function writeCache(row) {
  const next = normalize(row);
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (_) {}
  return next;
}

function getPanel() {
  return readCache();
}

/** 拉取云端配置（失败用缓存/默认） */
function syncPanel() {
  const { callCloudFunction } = require('./cloudInit.js');
  return callCloudFunction({
    name: 'redeemCode',
    data: { action: 'getAppConfig' }
  })
    .then((res) => {
      const data = (res && res.result) || {};
      try {
        if (data && data.features) {
          require('./ocAppFeatures.js').writeCache(data.features);
        }
      } catch (_) {}
      if (!data.ok || !data.membershipPanel) return getPanel();
      return writeCache(data.membershipPanel);
    })
    .catch(() => getPanel());
}

module.exports = {
  DEFAULT_PANEL,
  getPanel,
  syncPanel,
  writeCache,
  normalize
};
