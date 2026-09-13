/**
 * 抖音文案选题：30% 生活向 / 70% 人设+当日朋友圈心情 → 匹配热门口吻句
 * 性格 / 心情 / 朋友圈只用于「选哪类口吻」，禁止把性格描述词拼进正文展示。
 * 选图仍走 ocAlbumMatch；热门风参考口吻，禁止照抄示例。
 */
const { getOcTodayPostContents } = require('./ocMomentsStore.js');
const { pickTopicForOc, formatTopicForPrompt, localDateKey } = require('./ocDouyinTopics.js');

/** 生活向概率 */
const LIFE_CAPTION_PROB = 0.3;

const LIFE_STYLE_HINTS = [
  '通勤路上随手拍、窗外光、一杯喝到一半的东西',
  '睡醒乱发、被子、手机没电的碎碎念',
  '晚饭后散步、便利店、路灯、晚风',
  '打扫/收拾桌面、懒人日常、拖延小吐槽',
  '下雨天窗景、伞、鞋袜湿了的无奈',
  '健身/拉伸/久坐腰酸的真实片刻',
  '点外卖犹豫、到了又懒得下楼',
  '周末赖床、刷到好笑视频没忍住笑出声'
];

/**
 * 热门文案风格池：只学口吻/句式，禁止复述示例原文。
 * 覆盖：诗意治愈 / 冷感嘴硬 / 荒诞整活 / 暧昧拉扯
 */
const HOT_STYLE_BUCKETS = [
  {
    id: 'poetic_soft',
    moods: ['柔软/暧昧', '淡淡低落', '夜感/失眠气', '平静偏日常', '情绪平稳'],
    label: '诗意治愈短句',
    styleHint:
      '像抖音热门诗意文案：意象轻、留白多、一句画面感；温柔但不鸡汤，字少好截图。',
    examples: [
      '等我们心脏共鸣 等我的隐喻被你读懂',
      '你漂亮的眼睛应该流幸福的眼泪',
      '你和幸福的事很搭',
      '你是细腻水雾钩织成的春天',
      '花会自然开 老天爱笨小孩',
      '要把眼泪留给幸福',
      '有你的冬 或许会更好',
      '好的总是压箱底 我猜幸福也是',
      '阳光开袋即食',
      '允许停滞和放空'
    ]
  },
  {
    id: 'cold_tsundere',
    moods: ['吐槽火力', '疲惫/烦躁', '淡淡低落', '情绪平稳'],
    label: '冷感嘴硬拉扯',
    styleHint:
      '像垫底辣孩/冷感热门文案：嘴硬、疏离、一句扎心或反问；有距离感，别写成怨妇长文。',
    examples: [
      '为什么你的心怎么都捂不热',
      '怎么两清 怎么做回甲乙丙丁',
      '奇怪 我的恶劣你第一次体验吗',
      '我的坏你也照单全收吗',
      '肯定没事啊 以后都没你的事了',
      '只对你坏 何尝不是一种偏爱',
      '谎言和我们都到此为止吧',
      '坏一点又怎么样呢',
      '怎么 你的一厢情愿也要我负责吗',
      '怎么 才发现舍不得我离开吗',
      '不活在你给的人设里',
      '苍白的话刺痛着耳朵'
    ]
  },
  {
    id: 'whimsy_meme',
    moods: ['开心上扬', '吐槽火力', '情绪平稳', '平静偏日常'],
    label: '荒诞整活/谐音梗',
    styleHint:
      '像会火的整活短句：有反差、有谐音或小动物比喻，轻松好笑，仍要贴合角色口癖。',
    examples: [
      '苹果不要去想梨子的问题',
      '问题小猫来自异世界',
      '村长 我承认我是一只没有毅力的小羊',
      '想开一家早餐店名字就叫早点见面',
      '沉默的 胆小的 普通的',
      '活泼的 沉默的 感性的 理性的 都是我对未来真正的',
      '小猫咪说不再要加拿大哥哥了',
      '觉今非而昨非'
    ]
  },
  {
    id: 'soft_tension',
    moods: ['柔软/暧昧', '开心上扬', '夜感/失眠气', '疲惫/烦躁'],
    label: '暧昧试探短句',
    styleHint:
      '像热门暧昧文案：问句/半句告白/占有欲轻描，点到为止；未确认关系勿黏腻长告白。',
    examples: [
      '该怎么开口 是最近天冷了 还是想你了',
      '我在你的世界有占到一席之地吗',
      '你的世界少了我真没关系吗',
      '我们之间到底是不是可以吃醋的关系',
      '我最想选的肩膀是否想和我同心',
      '仅仅是这样就满足了吗',
      '因为你 我已经毫无底线了知道吗',
      '嘴上说怪我 其实心里是想我吧',
      '我爱这络绎不绝的无意义的瞬间',
      '说着幸福吧 就会幸福的',
      '如果你能爱我的一切',
      '我只守着我的枯木 再难爱上下一个春'
    ]
  }
];

const FALLBACK_HOT_LINES = HOT_STYLE_BUCKETS.reduce((acc, b) => {
  (b.examples || []).forEach((e) => acc.push(e));
  return acc;
}, []);

function hashSalt(str) {
  const s = String(str || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function summarizeMoodFromMoments(contents) {
  const list = (contents || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (!list.length) {
    return {
      hasMoments: false,
      moodLabel: '平静偏日常',
      moodHint: '今日暂无朋友圈可参考，按人设默认情绪写，不要编造具体行程。',
      samples: []
    };
  }
  const joined = list.join('；');
  let moodLabel = '情绪平稳';
  if (/累|困|熬|忙|崩|炸|烦|无语|崩溃/.test(joined)) moodLabel = '疲惫/烦躁';
  else if (/开心|高兴|笑|可爱|期待|兴奋|爽/.test(joined)) moodLabel = '开心上扬';
  else if (/想你|喜欢|心动|甜|温柔|暧昧/.test(joined)) moodLabel = '柔软/暧昧';
  else if (/丧|emo|孤独|空|无聊|算了/.test(joined)) moodLabel = '淡淡低落';
  else if (/怒|滚|烦死|讨厌|吐槽/.test(joined)) moodLabel = '吐槽火力';
  else if (/夜|晚|失眠|睡不着/.test(joined)) moodLabel = '夜感/失眠气';

  const samples = list.slice(0, 4).map((s) => s.slice(0, 60));
  return {
    hasMoments: true,
    moodLabel: moodLabel,
    moodHint:
      '根据以上朋友圈推断「最近心情≈' +
      moodLabel +
      '」，抖音文案情绪要贴这个心情，但不要逐句复述朋友圈原文。',
    samples: samples
  };
}

/** 性格只参与选桶，不写入文案正文 */
function personalityBucketBias(oc) {
  const pers = String((oc && oc.personalityText) || '');
  if (/冷|傲|高冷|孤|疏离|嘴硬/.test(pers)) return 'cold_tsundere';
  if (/温柔|软|治愈|黏|细腻|暖/.test(pers)) return 'poetic_soft';
  if (/活泼|整活|搞笑|谐音|跳脱/.test(pers)) return 'whimsy_meme';
  if (/暧昧|撩|占有|醋|心动/.test(pers)) return 'soft_tension';
  if (/吐槽|毒舌|损|怼/.test(pers)) return 'cold_tsundere';
  return '';
}

function pickHotBucket(oc, moodLabel, salt) {
  const mood = String(moodLabel || '');
  const matched = HOT_STYLE_BUCKETS.filter(
    (b) => (b.moods || []).indexOf(mood) >= 0
  );
  let pool = matched.length ? matched : HOT_STYLE_BUCKETS.slice();
  const biasId = personalityBucketBias(oc);
  if (biasId) {
    const biased = pool.filter((b) => b.id === biasId);
    // 心情匹配池里若有性格对应桶，优先；否则在全库里拉该桶进来参与抽选
    if (biased.length) {
      pool = biased;
    } else {
      const hit = HOT_STYLE_BUCKETS.find((b) => b.id === biasId);
      if (hit && Math.random() < 0.55) pool = [hit].concat(pool);
    }
  }
  const idx =
    hashSalt((oc && oc.id) + '|' + salt + '|' + mood + '|' + biasId) % pool.length;
  return pool[idx] || HOT_STYLE_BUCKETS[0];
}

/** 按 OC 错开示例切片，降低多 OC 撞同款钩子 */
function pickStyleExamples(bucket, oc, salt, count) {
  const list = (bucket && bucket.examples) || [];
  if (!list.length) return [];
  const n = Math.max(2, Math.min(count || 3, list.length));
  const start = hashSalt((oc && oc.id) + '|ex|' + salt) % list.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(list[(start + i * 3) % list.length]);
  }
  return out;
}

function normalizeCaptionKey(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】…—~·,.!?;:'"()\[\]♥♡·]/g, '')
    .toLowerCase()
    .slice(0, 48);
}

/**
 * 收集信息流里已用文案，供跨 OC 避重
 * @param {object} [opts]
 * @param {string} [opts.excludeOcId]
 * @param {number} [opts.limit]
 */
function collectAvoidCaptions(opts) {
  const options = opts || {};
  const limit = options.limit || 36;
  const excludeOcId = options.excludeOcId != null ? String(options.excludeOcId) : '';
  const out = [];
  const seen = {};
  try {
    const { getStoredFeed } = require('./ocDouyinStore.js');
    (getStoredFeed() || []).forEach((c) => {
      if (!c || !c.content) return;
      if (excludeOcId && String(c.ocId) === excludeOcId) return;
      const key = normalizeCaptionKey(c.content);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(String(c.content).trim().slice(0, 60));
    });
  } catch (_) {}
  return out.slice(0, limit);
}

/**
 * 本地兜底：按性格+心情(+朋友圈推断)匹配风格桶，再取热门口吻句。
 * 正文只输出口吻句，绝不拼接性格描述词。
 */
function pickLocalHotCaption(oc, topic, avoidList) {
  const mood = summarizeMoodFromMoments(
    getOcTodayPostContents(oc && oc.id, Date.now())
  );
  const salt = localDateKey() + '_' + ((oc && oc.id) || '');
  const bucket = pickHotBucket(oc, mood.moodLabel, salt);
  const avoid = {};
  (avoidList || []).forEach((t) => {
    const k = normalizeCaptionKey(t);
    if (k) avoid[k] = true;
  });
  // 优先从匹配到的风格桶取句，再回退全库
  const primary = (bucket && bucket.examples) || [];
  const pools = [primary, FALLBACK_HOT_LINES];
  let content = '';
  for (let p = 0; p < pools.length && !content; p++) {
    const lines = pools[p];
    if (!lines || !lines.length) continue;
    const start = hashSalt(salt + '|fb|' + p) % lines.length;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[(start + i) % lines.length];
      const key = normalizeCaptionKey(line);
      if (key && !avoid[key]) {
        content = line;
        break;
      }
    }
  }
  if (!content) {
    content =
      (primary[0] || FALLBACK_HOT_LINES[0] || '今天的光还可以。');
  }
  const tags = (topic && topic.tags) || (bucket && [bucket.label]) || ['心情'];
  return {
    content: String(content).trim().slice(0, 120),
    tags: tags.slice(0, 3),
    bucketId: bucket && bucket.id
  };
}

/**
 * @returns {{
 *   captionMode: 'life'|'persona_hot',
 *   topicHint: string,
 *   moodHint: string,
 *   styleHint: string,
 *   styleExamples: string[],
 *   avoidCaptions: string[],
 *   tags: string[]
 * }}
 */
function pickCaptionBrief(oc, salt) {
  const life = Math.random() < LIFE_CAPTION_PROB;
  const dateKey = localDateKey();
  const moments = getOcTodayPostContents(oc && oc.id, Date.now());
  const mood = summarizeMoodFromMoments(moments);
  const avoidCaptions = collectAvoidCaptions({
    excludeOcId: oc && oc.id,
    limit: 28
  });

  if (life) {
    const lifeHint =
      LIFE_STYLE_HINTS[Math.floor(Math.random() * LIFE_STYLE_HINTS.length)] ||
      LIFE_STYLE_HINTS[0];
    let lifeMood = mood.hasMoments
      ? '可轻微带一点今日心情（' + mood.moodLabel + '），不要喧宾夺主。'
      : '';
    try {
      const { buildPostInfluenceHint } = require('./ocSocialContext.js');
      const influence = buildPostInfluenceHint(oc, 'douyin');
      if (influence) lifeMood = (lifeMood ? lifeMood + '\n\n' : '') + influence;
    } catch (_) {}
    return {
      captionMode: 'life',
      topicHint:
        '模式=生活碎片。写普通人刷到会心一笑的生活向出镜文案，题材参考：' +
        lifeHint +
        '。仍须符合角色口癖，但重点是「生活感」而非人设演讲。',
      moodHint: lifeMood,
      styleHint: '生活向：具体小场景、口语、短、少鸡汤。',
      styleExamples: [],
      avoidCaptions: avoidCaptions,
      tags: ['日常', '生活碎片'],
      mood: mood
    };
  }

  const topic = pickTopicForOc(oc, salt || dateKey + '_' + ((oc && oc.id) || ''));
  const bucket = pickHotBucket(
    oc,
    mood.moodLabel,
    salt || dateKey + '_' + ((oc && oc.id) || '')
  );
  const examples = pickStyleExamples(
    bucket,
    oc,
    salt || dateKey,
    3
  );
  const pers = String((oc && oc.personalityText) || '').slice(0, 80);

  let topicHint =
    '模式=人设热门风（约七成权重：人设口癖 + 最近心情 + 抖音热门口吻）。' +
    formatTopicForPrompt(topic) +
    '；风格桶=' +
    (bucket.label || bucket.id) +
    '。' +
    (bucket.styleHint || '');
  if (pers) {
    topicHint +=
      '；性格仅用于匹配口吻与措辞（参考：' +
      pers +
      '），禁止把性格词、性格标签写进正文。';
  }
  topicHint +=
    '。必须原创，禁止照抄【口吻参考】任何一句；禁止与【其他OC已发文案】撞车或高度同构；正文不要出现「性格」「人设」说明书式罗列。';

  let moodHint = mood.moodHint;
  if (mood.samples.length) {
    moodHint +=
      '\n今日朋友圈摘录（只作心情依据）：\n- ' + mood.samples.join('\n- ');
  }
  try {
    const { buildPostInfluenceHint } = require('./ocSocialContext.js');
    const influence = buildPostInfluenceHint(oc, 'douyin');
    if (influence) {
      moodHint += '\n\n' + influence;
    }
  } catch (_) {}

  return {
    captionMode: 'persona_hot',
    topicHint: topicHint,
    moodHint: moodHint,
    styleHint: bucket.styleHint || '',
    styleExamples: examples,
    avoidCaptions: avoidCaptions,
    tags: (topic && topic.tags) || ['心情'],
    mood: mood,
    topic: topic,
    bucketId: bucket.id
  };
}

module.exports = {
  LIFE_CAPTION_PROB,
  HOT_STYLE_BUCKETS,
  pickCaptionBrief,
  summarizeMoodFromMoments,
  collectAvoidCaptions,
  pickLocalHotCaption,
  normalizeCaptionKey
};
