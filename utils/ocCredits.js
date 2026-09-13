/**
 * 通用额度点（与兑换池 extraRounds 同一账户）
 * 定价参考：¥3=150 点，¥5=350 点，¥10=1000 点；聊天溢出仍按 1 点=1 轮
 */
const COSTS = {
  /** 视频抽音：免费 3 次后每次扣点 */
  VIDEO_EXTRACT: 10,
  /** 朋友圈/抖音观看 OC 超上限后永久 +1 人 */
  WATCH_SLOT: 10,
  /** 朋友圈 AI 批量生成（一次刷新） */
  MOMENTS_GENERATE: 5,
  /** 新生成 OC 故事（每周免费次数用尽后） */
  STORY_NEW: 8,
  /** 续写故事 */
  STORY_CONTINUE: 5,
  /** 润色/修改故事 */
  STORY_REVISE: 12,
  /** 聊天溢出（免费周额度用尽后） */
  CHAT_OVERFLOW: 1
};

/** 生成 OC 故事：每周免费次数（周一为周起点，与聊天周额度一致） */
const STORY_NEW_FREE_WEEKLY = 5;
const STORY_NEW_FREE_STORAGE = 'oc_story_new_free_weekly_v1';

/** 故事续写：账号累计免费 5 次，用尽后每次扣额度点 */
const STORY_CONTINUE_FREE_TOTAL = 5;
const STORY_CONTINUE_FREE_STORAGE = 'oc_story_continue_free_v1';

const COST_LABELS = {
  VIDEO_EXTRACT: '视频提取',
  WATCH_SLOT: '观看 OC 扩容',
  MOMENTS_GENERATE: '朋友圈生成',
  STORY_NEW: '故事生成',
  STORY_CONTINUE: '故事续写',
  STORY_REVISE: '故事润色',
  CHAT_OVERFLOW: '聊天溢出'
};

function getBalance() {
  try {
    return require('./aiChatQuota.js').readExtraRounds();
  } catch (_) {
    return 0;
  }
}

function getCost(key) {
  const n = COSTS[key];
  return n != null ? n : 0;
}

function canAfford(cost) {
  return getBalance() >= Math.max(0, Math.floor(Number(cost) || 0));
}

/**
 * 预扣额度；失败返回 ok:false，成功可 refund
 * @returns {{ ok: boolean, left: number, spent?: number, need?: number, errMsg?: string }}
 */
function consume(cost, reason) {
  const n = Math.max(0, Math.floor(Number(cost) || 0));
  const quota = require('./aiChatQuota.js');
  if (n <= 0) return { ok: true, left: quota.readExtraRounds(), spent: 0 };
  if (typeof quota.consumeExtraRounds === 'function') {
    const r = quota.consumeExtraRounds(n);
    if (!r) {
      return {
        ok: false,
        left: quota.readExtraRounds(),
        need: n,
        errMsg:
          (COST_LABELS[reason] || '该功能') +
          '需要 ' +
          n +
          ' 点额度（当前 ' +
          quota.readExtraRounds() +
          '）'
      };
    }
    return { ok: true, left: quota.readExtraRounds(), spent: n };
  }
  // 兼容：逐次扣 1
  for (let i = 0; i < n; i++) {
    if (!quota.consumeExtraRound()) {
      // 尽力退回已扣
      if (i > 0 && typeof quota.addExtraRounds === 'function') {
        quota.addExtraRounds(i);
      }
      return {
        ok: false,
        left: quota.readExtraRounds(),
        need: n,
        errMsg: '额度不足，需要 ' + n + ' 点'
      };
    }
  }
  return { ok: true, left: quota.readExtraRounds(), spent: n };
}

function refund(cost) {
  const n = Math.max(0, Math.floor(Number(cost) || 0));
  if (n <= 0) return getBalance();
  const quota = require('./aiChatQuota.js');
  if (typeof quota.addExtraRounds === 'function') {
    return quota.addExtraRounds(n);
  }
  return getBalance();
}

function getStoryNewFreeState() {
  let weekKey = '';
  try {
    weekKey = require('./aiChatQuota.js').localWeekKey(Date.now());
  } catch (_) {
    weekKey = String(new Date().toISOString()).slice(0, 10);
  }
  let raw = {};
  try {
    raw = wx.getStorageSync(STORY_NEW_FREE_STORAGE) || {};
  } catch (_) {
    raw = {};
  }
  let used = 0;
  if (String(raw.weekKey || '') === weekKey) {
    used = Math.max(0, Math.floor(Number(raw.used) || 0));
  }
  const limit = STORY_NEW_FREE_WEEKLY;
  const left = Math.max(0, limit - used);
  return { weekKey: weekKey, used: used, left: left, limit: limit };
}

function writeStoryNewFreeState(state) {
  try {
    wx.setStorageSync(STORY_NEW_FREE_STORAGE, {
      weekKey: state.weekKey,
      used: Math.max(0, Math.floor(Number(state.used) || 0))
    });
  } catch (_) {}
}

/** 文案：入口/生成页灰色提示 */
function getStoryNewCostHint() {
  const free = getStoryNewFreeState();
  const cost = COSTS.STORY_NEW;
  if (free.left > 0) {
    return (
      '本周免费剩余 ' + free.left + '/' + free.limit + ' 次，用尽后每次 ' + cost + ' 点'
    );
  }
  return '本周免费已用完，每次消耗 ' + cost + ' 点额度';
}

/**
 * 生成故事扣费：先消耗每周免费，再扣额度点
 * @returns {{ ok: boolean, free?: boolean, cost: number, spent?: number, freeLeft?: number, errMsg?: string, left?: number }}
 */
function consumeStoryNew() {
  const free = getStoryNewFreeState();
  if (free.left > 0) {
    writeStoryNewFreeState({ weekKey: free.weekKey, used: free.used + 1 });
    return {
      ok: true,
      free: true,
      cost: 0,
      spent: 0,
      freeLeft: free.left - 1,
      left: getBalance()
    };
  }
  const pay = consume(COSTS.STORY_NEW, 'STORY_NEW');
  return Object.assign({}, pay, {
    free: false,
    cost: COSTS.STORY_NEW,
    freeLeft: 0
  });
}

/** 生成失败时退回：免费次数或额度点 */
function refundStoryNew(pay) {
  if (!pay || !pay.ok) return getStoryNewFreeState();
  if (pay.free) {
    const free = getStoryNewFreeState();
    writeStoryNewFreeState({
      weekKey: free.weekKey,
      used: Math.max(0, free.used - 1)
    });
    return getStoryNewFreeState();
  }
  refund(pay.spent != null ? pay.spent : pay.cost || COSTS.STORY_NEW);
  return getStoryNewFreeState();
}

function getStoryContinueFreeState() {
  let used = 0;
  try {
    used = Math.max(0, Math.floor(Number(wx.getStorageSync(STORY_CONTINUE_FREE_STORAGE)) || 0));
  } catch (_) {
    used = 0;
  }
  const limit = STORY_CONTINUE_FREE_TOTAL;
  const left = Math.max(0, limit - used);
  return { used: used, left: left, limit: limit };
}

function writeStoryContinueFreeUsed(used) {
  try {
    wx.setStorageSync(
      STORY_CONTINUE_FREE_STORAGE,
      Math.max(0, Math.floor(Number(used) || 0))
    );
  } catch (_) {}
}

function getStoryContinueCostHint() {
  const free = getStoryContinueFreeState();
  const cost = COSTS.STORY_CONTINUE;
  if (free.left > 0) {
    return '免费续写剩余 ' + free.left + '/' + free.limit + ' 次，用尽后每次 ' + cost + ' 点';
  }
  return '免费次数已用完，每次续写消耗 ' + cost + ' 点额度';
}

/**
 * 续写扣费：先消耗累计免费次数，再扣额度点
 */
function consumeStoryContinue() {
  const free = getStoryContinueFreeState();
  if (free.left > 0) {
    writeStoryContinueFreeUsed(free.used + 1);
    return {
      ok: true,
      free: true,
      cost: 0,
      spent: 0,
      freeLeft: free.left - 1,
      left: getBalance()
    };
  }
  const pay = consume(COSTS.STORY_CONTINUE, 'STORY_CONTINUE');
  return Object.assign({}, pay, {
    free: false,
    cost: COSTS.STORY_CONTINUE,
    freeLeft: 0
  });
}

function refundStoryContinue(pay) {
  if (!pay || !pay.ok) return getStoryContinueFreeState();
  if (pay.free) {
    const free = getStoryContinueFreeState();
    writeStoryContinueFreeUsed(Math.max(0, free.used - 1));
    return getStoryContinueFreeState();
  }
  refund(pay.spent != null ? pay.spent : pay.cost || COSTS.STORY_CONTINUE);
  return getStoryContinueFreeState();
}

/** 不足时弹窗引导兑换；足够则 resolve true */
function ensure(cost, featureKey) {
  const n = Math.max(0, Math.floor(Number(cost) || 0));
  const label = COST_LABELS[featureKey] || '该功能';
  if (canAfford(n)) return Promise.resolve(true);
  const left = getBalance();
  return new Promise((resolve) => {
    wx.showModal({
      title: '额度不足',
      content:
        label + '需要 ' + n + ' 点（当前 ' + left + ' 点）。可前往额度商店购买。',
      confirmText: '去购买',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/redeemCode/redeemCode',
            fail: () => {}
          });
        }
        resolve(false);
      },
      fail: () => resolve(false)
    });
  });
}

module.exports = {
  COSTS,
  COST_LABELS,
  STORY_NEW_FREE_WEEKLY,
  STORY_CONTINUE_FREE_TOTAL,
  getBalance,
  getCost,
  canAfford,
  consume,
  refund,
  ensure,
  getStoryNewFreeState,
  getStoryNewCostHint,
  consumeStoryNew,
  refundStoryNew,
  getStoryContinueFreeState,
  getStoryContinueCostHint,
  consumeStoryContinue,
  refundStoryContinue
};
