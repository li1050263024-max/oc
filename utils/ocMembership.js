/**
 * 会员状态：云端 user_quota.isVip / vipExpireAt；本地缓存加速
 */
const STORAGE_MEMBERSHIP = 'oc_membership_cache_v1';

function readCache() {
  try {
    const raw = wx.getStorageSync(STORAGE_MEMBERSHIP);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeCache(row) {
  try {
    wx.setStorageSync(STORAGE_MEMBERSHIP, row || {});
  } catch (_) {}
}

function isVipFromRow(row) {
  if (!row) return false;
  // 后台「暂停权益」后本地同步为 isVip=false；若仍带 vipPaused 也视为无效
  if (row.vipPaused === true || row.vipPaused === 1 || row.vipPaused === '1') {
    return false;
  }
  if (row.isVip === true || row.isVip === 1 || row.isVip === '1') {
    const exp = Number(row.vipExpireAt) || 0;
    if (exp > 0 && Date.now() > exp) return false;
    return true;
  }
  return false;
}

/** 同步判断（读缓存；未同步过时默认非会员） */
function isMember() {
  return isVipFromRow(readCache());
}

function formatVipExpire(vipExpireAt) {
  const exp = Number(vipExpireAt) || 0;
  if (!exp) return '永久';
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function getMembership() {
  const c = readCache();
  const vip = isVipFromRow(c);
  const exp = Number(c.vipExpireAt) || 0;
  const paused =
    c.vipPaused === true || c.vipPaused === 1 || c.vipPaused === '1';
  return {
    isVip: vip,
    isMember: vip,
    vipPaused: !!paused,
    vipExpireAt: exp,
    vipExpireText: vip ? formatVipExpire(exp) : paused ? '已暂停' : ''
  };
}

/** 拉取云端会员标记并写缓存 */
function syncMembership() {
  const { callCloudFunction } = require('./cloudInit.js');
  return callCloudFunction({
    name: 'redeemCode',
    data: { action: 'balance' }
  })
    .then((res) => {
      const data = (res && res.result) || {};
      if (!data.ok) return getMembership();
      writeCache({
        isVip: !!data.isVip,
        vipPaused: !!data.vipPaused,
        vipExpireAt: Number(data.vipExpireAt) || 0,
        syncedAt: Date.now()
      });
      // 同步会员标记（仅免广告，不改变周额度）
      try {
        const aiChatQuota = require('./aiChatQuota.js');
        if (typeof aiChatQuota.getDailyRoundCount === 'function') {
          aiChatQuota.getDailyRoundCount('dm', Date.now());
        }
      } catch (_) {}
      return getMembership();
    })
    .catch(() => getMembership());
}

module.exports = {
  isMember,
  getMembership,
  syncMembership,
  formatVipExpire,
  isVipFromRow,
  writeCache,
  readCache
};
