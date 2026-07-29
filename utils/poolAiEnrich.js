/**
 * 漏填或候选池无合适项时：AI 生成单条选项并写入本地自定义卡池
 * 已锁定/用户自填且不在池中的项：保留原文并写入选项库，不替换
 */
const poolsLoader = require('./poolsLoader.js');
const { buildCompactDrawContext } = require('./ocContext.js');
const { normalizeResult } = require('./ocResult.js');

const POOL_LABELS = {
  worldviews: '世界观',
  origins: '身世设定',
  lifeEvents: '人生大事件',
  catchphrases: '常用语',
  presetEvents: '情境事件',
  attitudes: '态度反应'
};

const LAYER1_POOL_MAP = {
  name: 'names',
  race: 'races',
  gender: 'genders',
  age: 'ages',
  hairColor: 'hairColors',
  eyeColor: 'eyeColors',
  personality0: 'personalities',
  personality1: 'personalities',
  likes: 'likes',
  quirk0: 'quirks',
  quirk1: 'quirks'
};

function hasCloud() {
  return typeof wx !== 'undefined' && !!wx.cloud;
}

function poolHasValue(pool, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return (pool || []).map((x) => String(x).trim()).includes(v);
}

function needsAiSlot(value, pool) {
  const v = String(value || '').trim();
  if (!v) return true;
  return !poolHasValue(pool, v);
}

function appendValueToPool(poolKey, value, pools) {
  const v = String(value || '').trim();
  if (!v) return;
  if (poolHasValue(pools[poolKey], v)) return;
  poolsLoader.appendToPool(poolKey, [v]);
  const next = poolsLoader.getDrawPools();
  pools[poolKey] = next[poolKey] || pools[poolKey];
}

function callGenerateItem(poolKey, label, slotHint, work, existing, reason) {
  return new Promise((resolve) => {
    if (!hasCloud()) {
      resolve('');
      return;
    }
    wx.cloud.callFunction({
      name: 'generatePoolItem',
      data: {
        poolKey,
        label: label || POOL_LABELS[poolKey] || poolKey,
        slotHint,
        contextText: buildCompactDrawContext(work || {}, poolKey === 'catchphrases' ? 3 : 2),
        existing: (existing || []).slice(0, 40),
        reason
      },
      timeout: 50000,
      success(res) {
        const r = (res && res.result) || {};
        resolve(r.ok && r.item ? String(r.item).trim() : '');
      },
      fail() {
        resolve('');
      }
    });
  });
}

/**
 * @param {boolean} isLocked 用户已锁定该槽位
 */
async function applySlot(poolKey, slotHint, value, pools, work, reason, isLocked) {
  const v = String(value || '').trim();
  const pool = pools[poolKey] || [];

  if (isLocked) {
    if (v) appendValueToPool(poolKey, v, pools);
    return v;
  }

  if (!needsAiSlot(v, pool)) return v;

  const item = await callGenerateItem(
    poolKey,
    POOL_LABELS[poolKey],
    slotHint,
    work,
    pool,
    reason
  );
  if (!item) return v;
  appendValueToPool(poolKey, item, pools);
  return item;
}

async function enrichLayer2(data, pools, work, locked) {
  if (!data) return data;
  const L = locked || {};
  const bg = { ...data };
  const origins = (bg.origins || []).slice();
  const lifeEvents = (bg.lifeEvents || []).slice();
  while (origins.length < 3) origins.push('');
  while (lifeEvents.length < 3) lifeEvents.push('');

  bg.worldview = await applySlot(
    'worldviews',
    '世界观',
    bg.worldview,
    pools,
    work,
    '世界观漏填或与角色不符',
    !!L.worldview
  );

  for (let i = 0; i < 3; i++) {
    origins[i] = await applySlot(
      'origins',
      `身世设定第${i + 1}条`,
      origins[i],
      pools,
      work,
      '身世漏填或与角色不符',
      !!L['origin' + i]
    );
  }

  for (let i = 0; i < 3; i++) {
    lifeEvents[i] = await applySlot(
      'lifeEvents',
      `人生大事件第${i + 1}条`,
      lifeEvents[i],
      pools,
      work,
      '人生事件漏填或与角色不符',
      !!L['lifeEvent' + i]
    );
  }

  bg.origins = origins;
  bg.lifeEvents = lifeEvents;
  return bg;
}

async function enrichLayer3(data, pools, work, locked) {
  if (!data) return data;
  const L = locked || {};
  const cp = (data.catchphrases || []).slice();
  const ad = (data.attitudes || []).map((a) => ({
    event: (a && a.event) || '',
    attitude: (a && a.attitude) || ''
  }));
  while (cp.length < 3) cp.push('');
  while (ad.length < 3) ad.push({ event: '', attitude: '' });

  for (let i = 0; i < 3; i++) {
    cp[i] = await applySlot(
      'catchphrases',
      `常用语第${i + 1}条`,
      cp[i],
      pools,
      work,
      '常用语漏填或与口吻不符',
      !!L['catchphrase' + i]
    );
  }

  for (let i = 0; i < 3; i++) {
    ad[i].event = await applySlot(
      'presetEvents',
      `情境事件第${i + 1}条`,
      ad[i].event,
      pools,
      work,
      '情境漏填或与背景不符',
      !!L['attitude' + i]
    );
    ad[i].attitude = await applySlot(
      'attitudes',
      `对「${ad[i].event}」的态度`,
      ad[i].attitude,
      pools,
      work,
      '态度漏填或与性格不符',
      !!L['attitude' + i]
    );
  }

  return { catchphrases: cp, attitudes: ad };
}

function enrichLayer(layer, data, pools, work, locked) {
  if (layer === 2) return enrichLayer2(data, pools, work, locked);
  if (layer === 3) return enrichLayer3(data, pools, work, locked);
  return Promise.resolve(data);
}

/** Layer1 重抽后：将已锁定且自填的项写入选项库 */
function ensureLayer1LockedInPools(result, locked, pools) {
  if (!result || !locked) return;
  const r = normalizeResult(result);
  Object.keys(LAYER1_POOL_MAP).forEach((lockKey) => {
    if (!locked[lockKey]) return;
    const poolKey = LAYER1_POOL_MAP[lockKey];
    let val = '';
    if (lockKey === 'personality0') val = (r.personalities || [])[0] || '';
    else if (lockKey === 'personality1') val = (r.personalities || [])[1] || '';
    else if (lockKey === 'quirk0') val = (r.quirks || [])[0] || '';
    else if (lockKey === 'quirk1') val = (r.quirks || [])[1] || '';
    else val = r[lockKey] || '';
    appendValueToPool(poolKey, val, pools);
  });
}

module.exports = {
  needsAiSlot,
  poolHasValue,
  appendValueToPool,
  enrichLayer,
  enrichLayer2,
  enrichLayer3,
  ensureLayer1LockedInPools
};
