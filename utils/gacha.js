/**
 * 抽卡逻辑：从各选项池等概率随机抽取 1 项，组成一张 OC 设定卡
 * 支持传入自定义选项池 pools，不传则使用默认
 */
const defaultPools = require('../data/pools.js');

function pickOne(arr) {
  if (!arr || arr.length === 0) return '';
  const index = Math.floor(Math.random() * arr.length);
  return arr[index];
}

/**
 * 执行一次抽卡
 * @param {Object} [pools] - 可选，自定义选项池，结构同 data/pools.js
 * @returns {{ name, race, hairColor, eyeColor, personality, quirk }}
 */
function draw(pools) {
  const p = pools && pools.names ? pools : defaultPools;
  return {
    name: pickOne(p.names),
    race: pickOne(p.races),
    hairColor: pickOne(p.hairColors),
    eyeColor: pickOne(p.eyeColors),
    personality: pickOne(p.personalities),
    quirk: pickOne(p.quirks)
  };
}

/**
 * 对未锁定的维度重新抽卡，锁定的维度保留原值
 * @param {Object} currentResult - 当前结果
 * @param {Object} locked - 各维度是否锁定
 * @param {Object} [pools] - 可选，自定义选项池
 * @returns {{ name, race, hairColor, eyeColor, personality, quirk }}
 */
function drawPartial(currentResult, locked, pools) {
  if (!currentResult || !locked) return currentResult || draw(pools);
  const p = pools && pools.names ? pools : defaultPools;
  const poolKeys = {
    name: 'names',
    race: 'races',
    hairColor: 'hairColors',
    eyeColor: 'eyeColors',
    personality: 'personalities',
    quirk: 'quirks'
  };
  const next = { ...currentResult };
  Object.keys(poolKeys).forEach(key => {
    if (!locked[key]) {
      next[key] = pickOne(p[poolKeys[key]]);
    }
  });
  return next;
}

/**
 * 将抽卡结果拼接成一段可复制的文案
 * @param {Object} result - draw() 的返回值
 * @returns {string}
 */
function toCopyText(result) {
  if (!result) return '';
  return [
    `【OC 设定】`,
    `姓名：${result.name}`,
    `种族：${result.race}`,
    `发色：${result.hairColor}`,
    `瞳色：${result.eyeColor}`,
    `性格：${result.personality}`,
    `怪癖：${result.quirk}`
  ].join('\n');
}

module.exports = {
  draw,
  drawPartial,
  toCopyText
};
