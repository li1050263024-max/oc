/**
 * 抽卡：Layer1 本地；Layer2/3 云 API + 本地补全 + AI 生成入卡池
 */
const coherentGacha = require('./coherentGacha.js');
const poolAiEnrich = require('./poolAiEnrich.js');
const { buildCompactDrawContext } = require('./ocContext.js');
const { normalizeResult } = require('./ocResult.js');
const {
  namesPoolWithoutUsed,
  ensureUniqueOcName,
  getUsedOcNames
} = require('./favorite.js');

function preparePoolsForDraw(pools, work) {
  const poolCopy = { ...(pools || {}) };
  const excludeFavoriteId =
    (work && work.notebookFavoriteId) || (work && work._favoriteId) || '';
  poolCopy.names = namesPoolWithoutUsed(poolCopy.names || [], {
    excludeFavoriteId: excludeFavoriteId
  });
  return { poolCopy, excludeFavoriteId, usedNames: getUsedOcNames({ excludeFavoriteId }) };
}

function finalizeUniqueName(data, pools, locked) {
  if (!data || (locked && locked.name === true)) return data;
  data.name = ensureUniqueOcName(data.name, (pools && pools.names) || []);
  return data;
}

function hasCloud() {
  return typeof wx !== 'undefined' && !!wx.cloud;
}

const POOL_KEYS_BY_LAYER = {
  1: ['names', 'races', 'hairColors', 'eyeColors', 'personalities', 'quirks', 'genders', 'ages', 'likes'],
  2: ['worldviews', 'origins', 'lifeEvents'],
  3: ['catchphrases', 'presetEvents', 'attitudes']
};

function trimPoolsForLayer(pools, layer) {
  const keys = POOL_KEYS_BY_LAYER[layer] || [];
  const cap = layer === 1 ? 64 : layer === 2 ? 48 : 56;
  const out = {};
  keys.forEach((k) => {
    if (Array.isArray(pools[k])) out[k] = pools[k].slice(0, cap);
  });
  return out;
}

function fillGaps(layer, data, pools, locked, current, work) {
  if (layer === 2) {
    return coherentGacha.fillLayer2Gaps(data, pools, locked, current, work);
  }
  if (layer === 3) {
    return coherentGacha.fillLayer3Gaps(data, pools, locked, current, work);
  }
  return data;
}

async function finalizeLayer(layer, data, pools, locked, current, work) {
  const poolCopy = { ...pools };
  let filled = fillGaps(layer, data, poolCopy, locked, current, work);
  filled = await poolAiEnrich.enrichLayer(layer, filled, poolCopy, work, locked || {});
  return filled;
}

function callCloudLayer(layer, pools, locked, current, work, localDraw) {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'drawOcCoherent',
      data: {
        layer,
        pools: trimPoolsForLayer(pools || {}, layer),
        locked: locked || {},
        current: current || null,
        contextText: buildCompactDrawContext(work || {}, layer)
      },
      timeout: 90000,
      success(res) {
        const r = (res && res.result) || {};
        const raw = r.ok && r.data ? r.data : localDraw();
        finalizeLayer(layer, raw, pools, locked, current, work).then(resolve);
        if (!r.ok) console.warn(`[drawLayer${layer}] cloud fallback:`, r.errMsg);
      },
      fail(err) {
        console.warn(`[drawLayer${layer}] cloud fail:`, err);
        finalizeLayer(layer, localDraw(), pools, locked, current, work).then(resolve);
      }
    });
  });
}

function isFieldLocked(locked, key) {
  return locked && locked[key] === true;
}

function mergeCloudLayer1(cloudData, pools, locked, current) {
  const poolCopy = { ...pools };
  const base = normalizeResult(current || {});
  const c = cloudData || {};
  if (!isFieldLocked(locked, 'name') && c.name) base.name = c.name;
  if (!isFieldLocked(locked, 'race') && c.race) base.race = c.race;
  if (!isFieldLocked(locked, 'hairColor') && c.hairColor) base.hairColor = c.hairColor;
  if (!isFieldLocked(locked, 'eyeColor') && c.eyeColor) base.eyeColor = c.eyeColor;
  if (!isFieldLocked(locked, 'personality0') && c.personality) base.personalities[0] = c.personality;
  if (!isFieldLocked(locked, 'quirk0') && c.quirk) base.quirks[0] = c.quirk;

  const hasSeed =
    !!(c.name || c.race || c.hairColor || c.eyeColor || c.personality || c.quirk) ||
    !!(current && Object.keys(current).length);
  const lockedAny = locked && Object.keys(locked).some((k) => locked[k] === true);
  if (hasSeed || lockedAny) {
    return coherentGacha.drawLayer1Partial(poolCopy, locked || {}, base);
  }
  return coherentGacha.drawLayer1(poolCopy);
}

function drawLayer1(pools, locked, current, work) {
  const prepared = preparePoolsForDraw(pools, work);
  const poolCopy = prepared.poolCopy;
  const lk = locked || {};
  const localDraw = () =>
    lk && Object.keys(lk).some((k) => lk[k] === true) && current
      ? coherentGacha.drawLayer1Partial(poolCopy, lk, current)
      : coherentGacha.drawLayer1(poolCopy);

  const finalizeL1 = (data) => {
    if (lk && current) poolAiEnrich.ensureLayer1LockedInPools(data, lk, poolCopy);
    return finalizeUniqueName(data, poolCopy, lk);
  };

  const applied = !!(work && work.gachaScopeApplied);
  const hint = applied ? String((work && work.gachaScopeHint) || '').trim() : '';
  if (!hint || !hasCloud()) {
    return Promise.resolve(finalizeL1(localDraw()));
  }

  const cloudPools = trimPoolsForLayer(poolCopy, 1);
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'drawOcCoherent',
      data: {
        layer: 1,
        pools: cloudPools,
        locked: lk,
        current: current || null,
        contextText: buildCompactDrawContext(work || {}, 1),
        excludeNames: prepared.usedNames
      },
      timeout: 90000,
      success(res) {
        const r = (res && res.result) || {};
        const raw = r.ok && r.data ? r.data : null;
        resolve(finalizeL1(raw ? mergeCloudLayer1(raw, poolCopy, lk, current) : localDraw()));
        if (!r.ok) console.warn('[drawLayer1] cloud fallback:', r.errMsg);
      },
      fail(err) {
        console.warn('[drawLayer1] cloud fail:', err);
        resolve(finalizeL1(localDraw()));
      }
    });
  });
}

function drawLayer2(pools, locked, current, work) {
  const localDraw = () => coherentGacha.drawLayer2(pools, locked || {}, current, work);
  if (!hasCloud()) {
    return finalizeLayer(2, localDraw(), pools, locked, current, work);
  }
  return callCloudLayer(2, pools, locked, current, work, localDraw);
}

function drawLayer3(pools, locked, current, work) {
  const localDraw = () => coherentGacha.drawLayer3(pools, locked || {}, current, work);
  if (!hasCloud()) {
    return finalizeLayer(3, localDraw(), pools, locked, current, work);
  }
  return callCloudLayer(3, pools, locked, current, work, localDraw);
}

function expandPool(poolKey, label, existing, theme, count) {
  return new Promise((resolve, reject) => {
    if (!hasCloud()) {
      reject(new Error('请使用支持云开发的基础库'));
      return;
    }
    wx.cloud.callFunction({
      name: 'expandOcPool',
      data: {
        poolKey,
        label,
        existing: existing || [],
        theme: theme || '',
        count: count || 8
      },
      timeout: 60000,
      success(res) {
        const r = res.result || {};
        if (r.ok && Array.isArray(r.items)) resolve(r.items);
        else reject(new Error(r.errMsg || '丰富选项失败'));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '调用失败'));
      }
    });
  });
}

module.exports = {
  drawLayer1,
  drawLayer2,
  drawLayer3,
  expandPool
};
