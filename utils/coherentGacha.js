/**
 * 逻辑抽卡：主题标签加权 + 冲突惩罚，减少跨模块不搭组合
 */
const {
  pad3,
  normalizeResult,
  personalityBlend,
  quirkBlend,
  defaultBackground,
  normalizeBackground
} = require('./ocResult.js');
const { namesPoolWithoutUsed, ensureUniqueOcName } = require('./favorite.js');

function poolsWithFreeNames(pools) {
  const p = pools || {};
  return Object.assign({}, p, {
    names: namesPoolWithoutUsed(p.names || [])
  });
}

const TAG_RULES = [
  { tag: 'fantasy', words: ['精灵', '龙', '仙', '魔', '兽', '妖', '吸血鬼', '天使', '恶魔', '妖精', '人鱼', '狼人', '矮人', '神裔', '玄幻', '仙侠', '魔法', '西幻', '不死', '树人', '猫族', '鸟族', '麒麟', '凤凰', '德鲁伊', '术士', '骑士', '魔王', '勇者', '永生'] },
  { tag: 'modern', words: ['现代', '都市', '校园', '民国', '当代', '日常', '偶像', '娱乐圈', '医院', '警局', '律所', '直播', '网红', '小镇', '公路', '人类', '城邦', '自由民', '少年'] },
  { tag: 'scifi', words: ['赛博', '科幻', '星际', '机械', '蒸汽', '废土', '机甲', '火星', '月球', '太空', '虚拟', '智械', '殖民', '轨道', '星舰', '仿生人', '改造人', '硅基', '蜂巢'] },
  { tag: 'romance', words: ['恋', '爱', '情', '青梅', '告白', '婚礼', '暗恋', '情人', '所爱', '心动', '联姻', '分手', '梦女', '乙女', '甜宠', '宠溺', '男友', '女友'] },
  { tag: 'dark', words: ['背叛', '战争', '灾难', '死亡', '末世', '丧尸', '黑暗', '复仇', '罪', '失去', '决裂', '宿敌', '威胁', '栽赃', '羞辱', '诅咒', '通缉', '孤儿', '被弃', '流放'] },
  { tag: 'warm', words: ['温柔', '友情', '家人', '守护', '挚友', '亲情', '原谅', '相信', '陪伴', '谢谢', '保护', '帮忙', '出头', '妥协', '心软', '幼年'] },
  { tag: 'cold', words: ['冷', '淡漠', '疏离', '腹黑', '毒舌', '沉默', '走开', '无视', '翻脸', '记仇', '拒绝', '质问', '冷战', '独自'] },
  { tag: 'energetic', words: ['活泼', '话痨', '热情', '中二', '戏精', '自来熟', '激动', '哈哈', '乐观', '快热', '领袖', '少年'] },
  { tag: 'shy', words: ['社恐', '内向', '腼腆', '害羞', '不敢', '逃避', '别看我', '慢热', '怯懦', '回避', '幼年'] },
  { tag: 'rational', words: ['理性', '谨慎', '分析', '权衡', '计划', '数据', '冷静', '守序', '完美'] },
  { tag: 'chaotic', words: ['冲动', '暴躁', '混沌', '叛逆', '随性', '戏精', '中二'] },
  { tag: 'youth', words: ['幼年', '少年'] },
  { tag: 'mature', words: ['青年'] },
  { tag: 'immortal', words: ['永生'] }
];

const TAG_CONFLICTS = {
  fantasy: ['scifi', 'modern'],
  scifi: ['fantasy'],
  modern: ['fantasy'],
  warm: ['cold'],
  cold: ['warm'],
  shy: ['energetic'],
  energetic: ['shy'],
  rational: ['chaotic'],
  chaotic: ['rational'],
  youth: ['elder'],
  elder: ['youth']
};

const RACE_THEME = {
  人类: ['modern', 'warm'],
  精灵: ['fantasy'],
  兽人: ['fantasy'],
  龙族: ['fantasy'],
  机械体: ['scifi'],
  魔族: ['fantasy', 'dark'],
  仙族: ['fantasy'],
  吸血鬼: ['fantasy', 'dark'],
  天使: ['fantasy', 'warm'],
  恶魔: ['fantasy', 'dark'],
  仿生人: ['scifi'],
  改造人: ['scifi'],
  星舰移民: ['scifi'],
  殖民二代: ['scifi']
};

const AGE_OPTIONS = ['幼年', '少年', '青年', '永生'];
const GENDER_OPTIONS = ['男', '女', '无性别'];

const SEED_TAGS = ['fantasy', 'modern', 'scifi', 'romance', 'warm', 'dark'];

const UNUSUAL_COLOR_HINTS = ['蓝', '紫', '粉', '银', '红', '绿', '金', '异瞳', '渐变', '荧光'];

function inferTags(text) {
  const tags = new Set();
  const s = String(text || '');
  TAG_RULES.forEach(({ tag, words }) => {
    if (words.some((w) => s.includes(w))) tags.add(tag);
  });
  return tags;
}

function mergeTags(...sources) {
  const out = new Set();
  sources.forEach((src) => {
    if (src instanceof Set) src.forEach((t) => out.add(t));
    else if (Array.isArray(src)) src.forEach((t) => out.add(t));
  });
  return out;
}

function applyRaceTheme(race, tags) {
  const extra = RACE_THEME[race];
  if (extra) extra.forEach((t) => tags.add(t));
  inferTags(race).forEach((t) => tags.add(t));
  return tags;
}

function applyAgeTheme(age, tags) {
  inferTags(age).forEach((t) => tags.add(t));
  if (age === '幼年' || age === '少年') tags.add('youth');
  if (age === '青年') tags.add('mature');
  if (age === '永生') tags.add('immortal');
  return tags;
}

function scoreByTags(text, activeTags) {
  let score = 1 + Math.random() * 0.3;
  const itemTags = inferTags(text);
  activeTags.forEach((t) => {
    if (itemTags.has(t)) score += 3.5;
  });
  activeTags.forEach((t) => {
    const conflicts = TAG_CONFLICTS[t];
    if (!conflicts) return;
    conflicts.forEach((c) => {
      if (itemTags.has(c)) score -= 5;
    });
  });
  return Math.max(0.08, score);
}

function weightedPick(list, activeTags) {
  const arr = (list || []).filter(Boolean);
  if (!arr.length) return '';
  if (!activeTags || activeTags.size === 0) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  const weights = arr.map((t) => scoreByTags(t, activeTags));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return arr[Math.floor(Math.random() * arr.length)];
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function pickNWeighted(list, n, activeTags) {
  const pool = (list || []).slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const pick = weightedPick(pool, activeTags);
    out.push(pick);
    const idx = pool.indexOf(pick);
    if (idx >= 0) pool.splice(idx, 1);
  }
  return out;
}

function pickSeedTags() {
  const primary = SEED_TAGS[Math.floor(Math.random() * SEED_TAGS.length)];
  const tags = new Set([primary]);
  if (Math.random() < 0.4) {
    tags.add(SEED_TAGS[Math.floor(Math.random() * SEED_TAGS.length)]);
  }
  return tags;
}

function pickAge(pools, tags) {
  const pool = (pools.ages || AGE_OPTIONS).filter((a) => AGE_OPTIONS.includes(a));
  const list = pool.length ? pool : AGE_OPTIONS.slice();
  return weightedPick(list, tags);
}

function pickGender(pools, tags) {
  const list = (pools.genders || GENDER_OPTIONS).filter(Boolean);
  return weightedPick(list.length ? list : GENDER_OPTIONS, tags);
}

function tagsFromWork(work) {
  if (!work || !work.result) return pickSeedTags();
  const r = normalizeResult(work.result);
  let tags = mergeTags(
    inferTags(r.race),
    inferTags(r.gender),
    inferTags(r.age),
    inferTags(personalityBlend(r)),
    inferTags(quirkBlend(r)),
    inferTags(r.hairColor),
    work.background ? inferTags(work.background.worldview) : new Set()
  );
  (r.personalities || []).forEach((p) => inferTags(p).forEach((t) => tags.add(t)));
  inferTags(r.likes).forEach((t) => tags.add(t));
  (r.quirks || []).forEach((q) => inferTags(q).forEach((t) => tags.add(t)));
  if (work.background && work.background.origins) {
    work.background.origins.forEach((o) => inferTags(o).forEach((t) => tags.add(t)));
  }
  if (work.gachaScopeApplied && work.gachaScopeHint) {
    inferTags(work.gachaScopeHint).forEach((t) => tags.add(t));
    if (/梦女|乙女|恋爱|男友|女友|老公|老婆|宠溺|甜宠|霸道|傲娇/.test(work.gachaScopeHint)) {
      tags.add('romance');
      tags.add('warm');
    }
  }
  tags = applyRaceTheme(r.race || '', tags);
  tags = applyAgeTheme(r.age || '', tags);
  return tags;
}

function pickHairColor(race, personalityText, pools, tags) {
  const t = mergeTags(tags, inferTags(race), inferTags(personalityText));
  const list = pools.hairColors || [];
  if (t.has('fantasy') || t.has('scifi')) {
    const unusual = list.filter((c) => UNUSUAL_COLOR_HINTS.some((h) => c.includes(h)));
    if (unusual.length && Math.random() < 0.7) return weightedPick(unusual, t);
  }
  if (t.has('modern')) {
    const normal = list.filter((c) => !UNUSUAL_COLOR_HINTS.some((h) => c.includes(h)));
    if (normal.length && Math.random() < 0.75) return weightedPick(normal, t);
  }
  if (t.has('elder') && list.some((c) => c.includes('银') || c.includes('白'))) {
    const gray = list.filter((c) => /银|白|灰/.test(c));
    if (gray.length && Math.random() < 0.45) return weightedPick(gray, t);
  }
  return weightedPick(list, t);
}

function pickEyeColor(race, personalityText, hairColor, pools, tags) {
  const t = mergeTags(tags, inferTags(race), inferTags(personalityText), inferTags(hairColor));
  const list = pools.eyeColors || [];
  if (t.has('fantasy') && list.some((c) => c.includes('异瞳')) && Math.random() < 0.25) {
    const hetero = list.filter((c) => c.includes('异瞳') || c.includes('蓝一金'));
    if (hetero.length) return weightedPick(hetero, t);
  }
  return weightedPick(list, t);
}

function pickPersonalityList(pools, tags, n) {
  return pickNWeighted(pools.personalities || [], n, tags);
}

function pickQuirkList(pools, tags, n) {
  return pickNWeighted(pools.quirks || [], n, tags);
}

function pickOneQuirkExcluding(pools, tags, exclude) {
  const ex = exclude || new Set();
  const pool = (pools.quirks || []).filter((q) => q && !ex.has(q));
  return pickNWeighted(pool.length ? pool : pools.quirks || [], 1, tags)[0] || '';
}

function fillLayer1Quirks(pools, tags, locked, base) {
  const q0locked = isLocked(locked, 'quirk0');
  const q1locked = isLocked(locked, 'quirk1');
  if (!q0locked && !q1locked) {
    const picked = pickQuirkList(pools, tags, 2);
    base.quirks[0] = picked[0] || '';
    base.quirks[1] = picked[1] || '';
  } else {
    if (!q0locked) {
      const ex = new Set();
      if (base.quirks[1]) ex.add(base.quirks[1]);
      base.quirks[0] = pickOneQuirkExcluding(pools, tags, ex);
    }
    if (!q1locked) {
      const ex = new Set();
      if (base.quirks[0]) ex.add(base.quirks[0]);
      base.quirks[1] = pickOneQuirkExcluding(pools, tags, ex);
    }
  }
  (base.quirks || []).forEach((q) => {
    if (q) inferTags(q).forEach((t) => tags.add(t));
  });
}

function inferEventMood(event) {
  const s = String(event || '');
  if (/背叛|失去|拒绝|误解|栽赃|威胁|羞辱|分手|病危|失败|诅咒|通缉|死亡|战争|孤儿|被弃|流放/.test(s)) return 'dark';
  if (/告白|财富|相遇|和解|重逢|联姻|喜欢/.test(s)) return 'romance';
  if (/欺负|弱者|牺牲|二选一|绝境|决斗|战争|求救/.test(s)) return 'conflict';
  return 'neutral';
}

const STRONG_OTOME_CATCHPHRASE_RE =
  /唯一例外|我在吃醋|留下来好不好|把手给我|叫我名字|好想抱住|眼里只能|只准对我撒娇|味道我记住了|再靠近一点也没关系|心跳声你听到了吗|我的温柔只给你|想把你藏起来|你是我在等的人|我会一直选你|让我牵着你走|你的笑容是我的|想把你写进未来|你一笑我就输了|只许想我一个人|过来，让我抱抱你|今天也只想见你|你的消息我会秒回|不许对我忽冷忽热|我的世界很小|你哭的话我会心疼|别松手|心跳好快|不许对别人这样|想要一直看着你|想听你说喜欢我|梦里也是你|不许说别人更好|别对别人那么好|你在看哪里|离我太远了|你是我的。|别让我等太久|你想逃到哪里|别用那种眼神|把整个城市翻过来|仅属于你的特权|顺路来接你|你温度有点低|再叫一次我的名字|这是命令——陪在我身边|你惹麻烦的话|你笑起来的样子|不许半路离开|你手好凉|乖，过来|等你回来|依赖我吗/;

const MILD_ROMANCE_CATCHPHRASE_RE =
  /你对我很重要|真是拿你没办法|才不是帮你|请留下来|请相信我一次|等我，马上到|……笨蛋|你是特别的|一起走吧|说什么傻话呢|只对你一个人温柔|可以再靠近一点吗|可以依赖我吗|想和你分享一切|只有你懂我|我会一直在|我答应过你的|别走，陪陪我|我会哄你的|你认真的吗|我是认真的|别开玩笑了|只有你不可以受伤|这次换我护着你|别什么都自己扛|我信你这一次|别再说再见|别后悔今天|别回头看我/;

const OVERUSED_CATCHPHRASE_RE = /哈哈哈你认真的|笑死我了|不会吧又来|绝了这也能行/;

function isStrongOtomeCatchphrase(text) {
  return STRONG_OTOME_CATCHPHRASE_RE.test(String(text || ''));
}

function isMildRomanceCatchphrase(text) {
  return MILD_ROMANCE_CATCHPHRASE_RE.test(String(text || ''));
}

function isRomanceCatchphrase(text) {
  return isStrongOtomeCatchphrase(text);
}

function isStrongShyCatchphrase(text) {
  return /……|对不起|别看我|可以别盯着我看|我、我没有那个意思/.test(String(text || ''));
}

function isStrongColdCatchphrase(text) {
  return /关我什么事|关你什么事|随便你。|哦，随便|无所谓|冷静点说|你懂个什么|闭嘴，听我说|少管闲事|数据不会骗人|这不合理吧/.test(
    String(text || '')
  );
}

function isStrongWarmCatchphrase(text) {
  return /谢谢|别怕，交给我|有你在就好|家人是最重要的|朋友嘛|护着你|交给我|保护|信你/.test(
    String(text || '')
  );
}

/** 偏中性：含轻度恋爱感但各类型 OC 均可使用 */
function isNeutralCatchphrase(text) {
  const s = String(text || '');
  if (!s) return false;
  if (isStrongOtomeCatchphrase(s)) return false;
  if (isMildRomanceCatchphrase(s)) return true;
  if (isStrongShyCatchphrase(s)) return false;
  if (isStrongColdCatchphrase(s)) return false;
  if (isStrongWarmCatchphrase(s)) return false;
  if (OVERUSED_CATCHPHRASE_RE.test(s)) return false;
  return true;
}

function blendCatchphrasePool(preferred, fullPool) {
  const full = (fullPool || []).filter(Boolean);
  if (!preferred || !preferred.length) return full;
  const seen = new Set(preferred);
  const merged = preferred.slice();
  full.filter(isNeutralCatchphrase).forEach((c) => {
    if (!seen.has(c)) {
      merged.push(c);
      seen.add(c);
    }
  });
  return merged.length ? merged : full;
}

function detectRomanceCatchphraseHint(personality, tags, scopeHint) {
  const pTags = inferTags(personality);
  const scope = String(scopeHint || '');
  return (
    pTags.has('warm') ||
    pTags.has('romance') ||
    (tags && tags.has && tags.has('romance')) ||
    /恋|爱|甜|温柔|浪漫|心动|吃醋|守护|依赖|黏人|梦女|乙女|恋爱|男友|女友|宠溺|甜宠|霸道|傲娇/.test(
      personality || ''
    ) ||
    /恋|爱|甜|温柔|浪漫|心动|吃醋|梦女|乙女|恋爱|男友|女友|宠溺|甜宠/.test(scope)
  );
}

function buildCatchphrasePool(pool, personality, tags, scopeHint) {
  const pTags = inferTags(personality);
  const full = (pool || []).filter(Boolean);
  let list = full;
  const romanceHint = detectRomanceCatchphraseHint(personality, tags, scopeHint);
  if (romanceHint) {
    const romance = full.filter(
      (c) => isStrongOtomeCatchphrase(c) || isMildRomanceCatchphrase(c)
    );
    if (romance.length >= 6) list = blendCatchphrasePool(romance, full);
  } else if (pTags.has('shy')) {
    const shy = full.filter((c) => isStrongShyCatchphrase(c) || /那个|没有/.test(c));
    if (shy.length >= 3) list = blendCatchphrasePool(shy, full);
  } else if (pTags.has('energetic') || pTags.has('chaotic')) {
    const withoutOverused = full.filter((c) => !OVERUSED_CATCHPHRASE_RE.test(c));
    if (withoutOverused.length >= 10) list = withoutOverused;
  } else if (pTags.has('cold') || pTags.has('rational')) {
    const cool = full.filter((c) =>
      /哦|随便|无所谓|冷静|理性|关我|闭嘴|然后呢|结论|就这|走着瞧|后会有期/.test(c)
    );
    if (cool.length >= 3) list = blendCatchphrasePool(cool, full);
  } else if (pTags.has('warm')) {
    const warm = full.filter((c) => isStrongWarmCatchphrase(c) || /一起|陪|留下|加油|辛苦了/.test(c));
    if (warm.length >= 3) list = blendCatchphrasePool(warm, full);
  }
  return list.length ? list : full;
}

function scoreCatchphrase(text, activeTags, options) {
  const opts = options || {};
  const pTags = opts.personalityTags || new Set();
  let score = scoreByTags(text, activeTags);
  if (isNeutralCatchphrase(text)) score += 2.5;
  if (isMildRomanceCatchphrase(text)) score += 3;
  if (isStrongOtomeCatchphrase(text)) {
    if (opts.romanceBoost) score += 7;
    else score += 4.5;
  }
  if (pTags.has('shy') && isStrongShyCatchphrase(text)) score += 3;
  if ((pTags.has('cold') || pTags.has('rational')) && isStrongColdCatchphrase(text)) score += 3;
  if (pTags.has('warm') && isStrongWarmCatchphrase(text)) score += 2.5;
  if (OVERUSED_CATCHPHRASE_RE.test(text)) score *= 0.2;
  return Math.max(0.08, score);
}

function weightedPickCatchphrase(list, activeTags, usedSet, options) {
  const arr = (list || []).filter((c) => c && !(usedSet && usedSet.has(c)));
  if (!arr.length) return '';
  const weights = arr.map((t) => scoreCatchphrase(t, activeTags, options));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return arr[Math.floor(Math.random() * arr.length)];
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function pickCatchphrases(pool, personality, tags, scopeHint, count, usedSet) {
  const list = buildCatchphrasePool(pool, personality, tags, scopeHint);
  const romanceBoost = detectRomanceCatchphraseHint(personality, tags, scopeHint);
  const pickTags = mergeTags(tags, inferTags(personality));
  if (romanceBoost) {
    pickTags.add('romance');
    pickTags.add('warm');
  }
  const options = { romanceBoost, personalityTags: inferTags(personality) };
  const out = [];
  const used = usedSet || new Set();
  for (let i = 0; i < count; i++) {
    let pick = weightedPickCatchphrase(list, pickTags, used, options);
    if (!pick) {
      pick = weightedPickCatchphrase(
        (pool || []).filter(Boolean),
        pickTags,
        used,
        options
      );
    }
    if (!pick) break;
    out.push(pick);
    used.add(pick);
  }
  return out;
}

function filterCatchphrases(pool, personality, tags, scopeHint) {
  const used = new Set();
  return pickCatchphrases(pool, personality, tags, scopeHint, 1, used)[0] || '';
}

function pickAttitudeForEvent(event, personality, pool, baseTags) {
  const mood = inferEventMood(event);
  const pTags = inferTags(personality);
  const tags = mergeTags(baseTags, pTags);
  if (mood === 'dark') {
    tags.add('cold');
    tags.delete('warm');
  }
  if (mood === 'romance') tags.add('romance');
  if (mood === 'conflict') {
    if (!pTags.has('cold') && !pTags.has('shy')) tags.add('warm');
  }
  let candidates = pool || [];
  if (mood === 'dark') {
    const coldish = candidates.filter((a) => /冷静|怀疑|记仇|走开|翻脸|独自|拒绝|质问|日后算账|视而不见/.test(a));
    if (coldish.length >= 3) candidates = coldish;
  } else if (mood === 'romance') {
    const warmish = candidates.filter((a) => /守护|原谅|相信|护在身后|坦白|心软|在意|握手|选择对方/.test(a));
    if (warmish.length >= 3) candidates = warmish;
  } else if (mood === 'conflict') {
    const active = candidates.filter((a) => /帮忙|站出来|反击|计划|护|出头|制定|冲|护在身后/.test(a));
    if (active.length >= 3) candidates = active;
  }
  if (pTags.has('shy')) {
    const shyAtt = candidates.filter((a) => /沉默|假装|离开|写纸条|逃避|装没听见/.test(a));
    if (shyAtt.length >= 2) candidates = shyAtt;
  }
  if (pTags.has('rational')) {
    const rat = candidates.filter((a) => /分析|权衡|计划|观望|理性|制定/.test(a));
    if (rat.length >= 2) candidates = rat;
  }
  return weightedPick(candidates, tags);
}

function drawLayer1(pools) {
  pools = poolsWithFreeNames(pools);
  let tags = pickSeedTags();
  const gender = pickGender(pools, tags);
  inferTags(gender).forEach((t) => tags.add(t));
  const age = pickAge(pools, tags);
  tags = applyAgeTheme(age, tags);
  const race = weightedPick(pools.races || [], tags);
  tags = applyRaceTheme(race, mergeTags(tags, inferTags(race)));
  const personalities = pickPersonalityList(pools, tags, 2);
  personalities.forEach((p) => inferTags(p).forEach((t) => tags.add(t)));
  const pText = personalities.join('、');
  const quirks = pickQuirkList(pools, tags, 2);
  quirks.forEach((q) => inferTags(q).forEach((t) => tags.add(t)));
  const likes = weightedPick(pools.likes || [], tags) || '';
  if (likes) inferTags(likes).forEach((t) => tags.add(t));
  return {
    name: ensureUniqueOcName(weightedPick(pools.names || [], tags), pools.names || []),
    race,
    gender,
    age,
    hairColor: pickHairColor(race, pText, pools, tags),
    eyeColor: pickEyeColor(race, pText, null, pools, tags),
    personalities,
    quirks,
    likes
  };
}

function isLocked(locked, key) {
  return locked && locked[key] === true;
}

function drawLayer1Partial(pools, locked, current) {
  pools = poolsWithFreeNames(pools);
  const base = normalizeResult(current || {});
  let tags = mergeTags(
    inferTags(base.race),
    inferTags(base.gender),
    inferTags(base.age),
    inferTags(personalityBlend(base)),
    inferTags(quirkBlend(base))
  );
  if (tags.size === 0) tags = pickSeedTags();
  tags = applyRaceTheme(base.race || '', tags);
  tags = applyAgeTheme(base.age || '', tags);

  if (!isLocked(locked, 'gender')) {
    base.gender = pickGender(pools, tags);
    inferTags(base.gender).forEach((t) => tags.add(t));
  }
  if (!isLocked(locked, 'age')) {
    base.age = pickAge(pools, tags);
    tags = applyAgeTheme(base.age, tags);
  }
  if (!isLocked(locked, 'race')) {
    base.race = weightedPick(pools.races || [], tags);
    tags = applyRaceTheme(base.race, tags);
  }

  if (!isLocked(locked, 'personality0')) {
    base.personalities[0] = pickPersonalityList(pools, tags, 1)[0] || '';
    inferTags(base.personalities[0]).forEach((t) => tags.add(t));
  }
  if (!isLocked(locked, 'personality1')) {
    base.personalities[1] = pickPersonalityList(pools, tags, 1)[0] || '';
    inferTags(base.personalities[1]).forEach((t) => tags.add(t));
  }
  if (!isLocked(locked, 'likes')) {
    base.likes = weightedPick(pools.likes || [], tags) || '';
    if (base.likes) inferTags(base.likes).forEach((t) => tags.add(t));
  }
  fillLayer1Quirks(pools, tags, locked, base);

  const pText = personalityBlend(base);
  if (!isLocked(locked, 'name')) {
    base.name = ensureUniqueOcName(
      weightedPick(pools.names || [], tags),
      pools.names || []
    );
  }
  if (!isLocked(locked, 'hairColor')) {
    base.hairColor = pickHairColor(base.race, pText, pools, tags);
  }
  if (!isLocked(locked, 'eyeColor')) {
    base.eyeColor = pickEyeColor(base.race, pText, base.hairColor, pools, tags);
  }
  return base;
}

function drawLayer2(pools, locked, current, work) {
  let tags = tagsFromWork(work);
  if (tags.size === 0) pickSeedTags().forEach((t) => tags.add(t));

  const bg = current
    ? {
        worldview: current.worldview || '',
        lifeEvents: (current.lifeEvents || []).slice(),
        origins: (current.origins || []).slice()
      }
    : { worldview: '', lifeEvents: ['', '', ''], origins: ['', '', ''] };
  while (bg.lifeEvents.length < 3) bg.lifeEvents.push('');
  while (bg.origins.length < 3) bg.origins.push('');

  if (!(locked && locked.worldview === true)) {
    bg.worldview = weightedPick(pools.worldviews || [], tags);
    inferTags(bg.worldview).forEach((t) => tags.add(t));
  }

  for (let i = 0; i < 3; i++) {
    const key = 'lifeEvent' + i;
    if (!(locked && locked[key] === true)) {
      bg.lifeEvents[i] = pickNWeighted(pools.lifeEvents || [], 1, tags)[0] || '';
      inferTags(bg.lifeEvents[i]).forEach((t) => tags.add(t));
    }
  }

  for (let i = 0; i < 3; i++) {
    const key = 'origin' + i;
    if (!(locked && locked[key] === true)) {
      bg.origins[i] = pickNWeighted(pools.origins || [], 1, tags)[0] || '';
      inferTags(bg.origins[i]).forEach((t) => tags.add(t));
    }
  }
  return bg;
}

function drawLayer3(pools, locked, current, work) {
  const tags = tagsFromWork(work);
  const personality = work && work.result ? personalityBlend(work.result) : '';
  const scopeHint =
    work && work.gachaScopeApplied ? String(work.gachaScopeHint || '').trim() : '';
  const cp = current && current.catchphrases ? current.catchphrases.slice() : ['', '', ''];
  const ad =
    current && current.attitudes
      ? current.attitudes.map((a) => ({ event: a.event || '', attitude: a.attitude || '' }))
      : [];

  const nextCp = [];
  const usedCp = new Set();
  for (let i = 0; i < 3; i++) {
    const key = 'catchphrase' + i;
    if (locked && locked[key] === true) {
      const val = cp[i] != null ? String(cp[i]).trim() : '';
      nextCp[i] = val;
      if (val) usedCp.add(val);
    }
  }
  for (let i = 0; i < 3; i++) {
    const key = 'catchphrase' + i;
    if (locked && locked[key] === true) continue;
    const picked = pickCatchphrases(
      pools.catchphrases || [],
      personality,
      tags,
      scopeHint,
      1,
      usedCp
    );
    nextCp[i] = picked[0] || '';
    if (nextCp[i]) usedCp.add(nextCp[i]);
  }

  const eventPool = pools.presetEvents || [];
  const attitudePool = pools.attitudes || [];
  const usedEvents = new Set();
  const nextAd = [];
  for (let i = 0; i < 3; i++) {
    const key = 'attitude' + i;
    if (locked && locked[key] === true && ad[i]) {
      nextAd[i] = { ...ad[i] };
      continue;
    }
    const avail = eventPool.filter((e) => !usedEvents.has(e));
    const event = weightedPick(avail.length ? avail : eventPool, tags);
    usedEvents.add(event);
    nextAd[i] = {
      event,
      attitude: pickAttitudeForEvent(event, personality, attitudePool, tags)
    };
  }

  return { catchphrases: nextCp, attitudes: nextAd };
}

/**
 * AI/云返回后补全空白项：保留已有内容，仅对空缺槽位做逻辑抽卡
 */
function applyLockedLayer2(merged, locked, current) {
  const L = locked || {};
  const cur = current || {};
  if (L.worldview) {
    merged.worldview = String(cur.worldview != null ? cur.worldview : merged.worldview || '').trim();
  }
  for (let i = 0; i < 3; i++) {
    if (L['origin' + i] && cur.origins) {
      merged.origins[i] = cur.origins[i] != null ? cur.origins[i] : merged.origins[i];
    }
    if (L['lifeEvent' + i] && cur.lifeEvents) {
      merged.lifeEvents[i] =
        cur.lifeEvents[i] != null ? cur.lifeEvents[i] : merged.lifeEvents[i];
    }
  }
  return merged;
}

function fillLayer2Gaps(partial, pools, locked, current, work) {
  const merged = applyLockedLayer2(
    normalizeBackground({
      ...defaultBackground(),
      ...(current || {}),
      ...(partial || {})
    }),
    locked,
    current
  );
  return drawLayer2(pools, locked || {}, merged, work);
}

function applyLockedLayer3(cp, ad, locked, current) {
  const L = locked || {};
  const cur = current || {};
  const catchphrases = pad3(cp);
  const attitudes = [];
  for (let i = 0; i < 3; i++) {
    const fromPartial = ad[i] || {};
    const fromCurrent =
      cur.attitudes && cur.attitudes[i] ? cur.attitudes[i] : { event: '', attitude: '' };
    attitudes.push({
      event: String(fromPartial.event || fromCurrent.event || '').trim(),
      attitude: String(fromPartial.attitude || fromCurrent.attitude || '').trim()
    });
    if (L['catchphrase' + i] && cur.catchphrases) {
      catchphrases[i] =
        cur.catchphrases[i] != null ? cur.catchphrases[i] : catchphrases[i];
    }
    if (L['attitude' + i] && cur.attitudes && cur.attitudes[i]) {
      attitudes[i] = {
        event: String(cur.attitudes[i].event || '').trim(),
        attitude: String(cur.attitudes[i].attitude || '').trim()
      };
    }
  }
  return { catchphrases, attitudes };
}

function fillLayer3Gaps(partial, pools, locked, current, work) {
  const cp = pad3((partial && partial.catchphrases) || (current && current.catchphrases));
  const ad = [];
  for (let i = 0; i < 3; i++) {
    const fromPartial =
      partial && Array.isArray(partial.attitudes) && partial.attitudes[i]
        ? partial.attitudes[i]
        : null;
    const fromCurrent =
      current && Array.isArray(current.attitudes) && current.attitudes[i]
        ? current.attitudes[i]
        : null;
    const row = fromPartial || fromCurrent || {};
    ad.push({
      event: String(row.event || '').trim(),
      attitude: String(row.attitude || '').trim()
    });
  }
  const merged = applyLockedLayer3(cp, ad, locked, current);
  return drawLayer3(pools, locked || {}, merged, work);
}

module.exports = {
  drawLayer1,
  drawLayer1Partial,
  drawLayer2,
  drawLayer3,
  fillLayer2Gaps,
  fillLayer3Gaps,
  draw: drawLayer1,
  drawPartial: drawLayer1Partial,
  pickAge,
  AGE_OPTIONS,
  GENDER_OPTIONS
};
