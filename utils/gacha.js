/**
 * 抽卡逻辑：从各选项池等概率随机抽取，组成 OC 设定卡
 */
const defaultPools = require('../data/pools.js');
const { normalizeResult, personalityBlend, quirkBlend, pad3 } = require('./ocResult.js');
const { pickAge } = require('./coherentGacha.js');
const { namesPoolWithoutUsed, ensureUniqueOcName } = require('./favorite.js');

function pickOne(arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function withUniqueNames(pools) {
  const p = pools && pools.names ? { ...pools } : { ...defaultPools };
  p.names = namesPoolWithoutUsed(p.names || defaultPools.names || []);
  return p;
}

function draw(pools) {
  const p = withUniqueNames(pools);
  const personalities = pad3([
    pickOne(p.personalities),
    pickOne(p.personalities),
    ''
  ]);
  let q0 = pickOne(p.quirks);
  let q1 = pickOne(p.quirks);
  if (q1 === q0 && (p.quirks || []).length > 1) {
    q1 = pickOne((p.quirks || []).filter((q) => q !== q0));
  }
  const quirks = pad3([q0, q1, '']);
  return {
    name: ensureUniqueOcName(pickOne(p.names), p.names),
    race: pickOne(p.races),
    gender: pickOne(p.genders || ['男', '女', '无性别']),
    age: pickAge(p, new Set()),
    hairColor: pickOne(p.hairColors),
    eyeColor: pickOne(p.eyeColors),
    personalities,
    quirks,
    likes: pickOne(p.likes || [])
  };
}

function drawPartial(currentResult, locked, pools) {
  if (!currentResult || !locked) return normalizeResult(currentResult || draw(pools));
  const p = withUniqueNames(pools);
  const next = normalizeResult(currentResult);
  const scalarKeys = {
    name: 'names',
    race: 'races',
    gender: 'genders',
    hairColor: 'hairColors',
    eyeColor: 'eyeColors'
  };
  Object.keys(scalarKeys).forEach((key) => {
    if (locked[key] !== true) {
      if (key === 'gender') {
        next[key] = pickOne(p.genders || ['男', '女', '无性别']);
      } else {
        next[key] = pickOne(p[scalarKeys[key]]);
      }
    }
  });
  if (locked.name !== true) {
    next.name = ensureUniqueOcName(next.name, p.names);
  }
  if (locked.age !== true) next.age = pickAge(p, new Set());
  for (let i = 0; i < 3; i++) {
    if (locked['personality' + i] !== true) {
      next.personalities[i] = pickOne(p.personalities);
    }
    if (locked['quirk' + i] !== true) {
      next.quirks[i] = pickOne(p.quirks);
    }
  }
  return next;
}

function toCopyText(result) {
  const r = normalizeResult(result);
  if (!r.name && !r.race) return '';
  const lines = [
    '【OC 设定】',
    `姓名：${r.name}`,
    `种族：${r.race}`,
    `性别：${r.gender}`,
    `年龄：${r.age}`,
    `发色：${r.hairColor}`,
    `瞳色：${r.eyeColor}`,
    `性格：${personalityBlend(r)}`,
    r.likes ? `喜欢：${r.likes}` : '',
    `怪癖：${quirkBlend(r)}`
  ].filter(Boolean);
  return lines.join('\n');
}

module.exports = {
  draw,
  drawPartial,
  toCopyText
};
