/**
 * 第二层：背景故事（世界观 + 人生大事件）
 * 第三层：常用语 + 态度
 * 使用 data/pools.js 中的 worldviews / lifeEvents / catchphrases / presetEvents / attitudes
 */
const defaultPools = require('../data/pools.js');

function pickOne(arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  if (!arr || arr.length === 0) return [];
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

function getPools(pools) {
  const p = pools && pools.worldviews ? pools : defaultPools;
  return p;
}

/**
 * 生成背景故事：1 个世界观 + 3 件人生大事件
 * @param {Object} [pools]
 * @returns {{ worldview: string, lifeEvents: string[] }}
 */
function drawBackgroundStory(pools) {
  const p = getPools(pools);
  return {
    worldview: pickOne(p.worldviews || []),
    lifeEvents: pickN(p.lifeEvents || [], 3)
  };
}

/**
 * 对未锁定的背景项重抽
 * @param {{ worldview, lifeEvents }} current
 * @param {{ worldview?: boolean, lifeEvent0?: boolean, ... }} locked
 * @param {Object} [pools]
 */
function drawPartialBackground(current, locked, pools) {
  if (!current) return drawBackgroundStory(pools);
  const p = getPools(pools);
  const next = {
    worldview: locked.worldview === true ? current.worldview : pickOne(p.worldviews || []),
    lifeEvents: (current.lifeEvents || []).slice()
  };
  for (let i = 0; i < 3; i++) {
    const key = 'lifeEvent' + i;
    if (locked[key] !== true && next.lifeEvents[i] !== undefined) {
      next.lifeEvents[i] = pickOne(p.lifeEvents || []);
    }
  }
  return next;
}

/**
 * 生成 3 句常用语（与性格弱关联：仅从池中随机抽 3 条）
 * @param {Object} [pools]
 * @param {number} [count=3]
 * @returns {string[]}
 */
function drawCatchphrases(pools, count = 3) {
  const p = getPools(pools);
  return pickN(p.catchphrases || [], count);
}

/**
 * 生成 3 条态度（从预设事件池随机抽 3 题，态度随机）
 * @param {Object} [pools]
 * @returns {{ event: string, attitude: string }[]}
 */
function drawAttitudes(pools) {
  const p = getPools(pools);
  const events = p.presetEvents || defaultPools.presetEvents || [];
  const chosen = pickN(events, 3);
  const attitudePool = p.attitudes || defaultPools.attitudes || [];
  return chosen.map(event => ({
    event,
    attitude: pickOne(attitudePool)
  }));
}

/**
 * 对未锁定的常用语重抽
 * @param {string[]} current
 * @param {{ catchphrase0?: boolean, catchphrase1?: boolean, catchphrase2?: boolean }} locked
 * @param {Object} [pools]
 * @returns {string[]}
 */
function drawPartialCatchphrases(current, locked, pools) {
  if (!current || current.length === 0) return drawCatchphrases(pools, 3);
  const p = getPools(pools);
  const pool = p.catchphrases || [];
  const next = current.slice();
  for (let i = 0; i < 3; i++) {
    const key = 'catchphrase' + i;
    if (locked[key] !== true && next[i] !== undefined) {
      next[i] = pickOne(pool);
    }
  }
  return next;
}

/**
 * 对未锁定的态度重抽（事件+态度一起换）
 * @param {{ event: string, attitude: string }[]} current
 * @param {{ attitude0?: boolean, attitude1?: boolean, attitude2?: boolean }} locked
 * @param {Object} [pools]
 * @returns {{ event: string, attitude: string }[]}
 */
function drawPartialAttitudes(current, locked, pools) {
  if (!current || current.length === 0) return drawAttitudes(pools);
  const p = getPools(pools);
  const events = p.presetEvents || defaultPools.presetEvents || [];
  const attitudePool = p.attitudes || defaultPools.attitudes || [];
  const next = current.map(item => ({ ...item }));
  for (let i = 0; i < 3; i++) {
    const key = 'attitude' + i;
    if (locked[key] !== true && next[i]) {
      next[i] = {
        event: pickOne(events),
        attitude: pickOne(attitudePool)
      };
    }
  }
  return next;
}

module.exports = {
  drawBackgroundStory,
  drawPartialBackground,
  drawCatchphrases,
  drawAttitudes,
  drawPartialCatchphrases,
  drawPartialAttitudes,
  getPools
};
