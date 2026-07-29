/**
 * 单聊主动消息：问候/问安/想念类模板，按人设与时间匹配
 */
const { normalizeForDedupe } = require('./ocSocialDedupe.js');
const { listSessions, getMessages } = require('./chatSession.js');
const { resolveOcChatStorageIds } = require('./ocChatHistory.js');

function ocHash(oc) {
  const id = String((oc && oc.id) || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function isForbiddenSceneText(text, forbiddenList) {
  const t = normalizeForDedupe(text);
  if (!t || t.length < 4) return true;
  for (let i = 0; i < (forbiddenList || []).length; i++) {
    const nf = normalizeForDedupe(forbiddenList[i]);
    if (!nf || nf.length < 4) continue;
    if (t === nf) return true;
    if (t.slice(0, 10) === nf.slice(0, 10) && t.slice(0, 10).length >= 8) return true;
    if (t.slice(0, 8) === nf.slice(0, 8) && t.slice(0, 8).length >= 6) return true;
  }
  return false;
}

const SCENE_ANCHOR_WORDS = [
  '早安', '晚安', '早啊', '早上好', '午安', '晚上好', '在吗', '嗨', '哈喽', '喂',
  '吃饭', '休息', '保重', '辛苦', '降温', '多穿', '别熬', '早点睡', '记得', '注意',
  '问候', '打招呼', '冒泡', '顺利', '近况', '有空', '聊聊', '想你', '别装'
];

const MESSAGE_KIND_LABELS = {
  morning: '早安问候',
  evening: '晚安或睡前关怀',
  greeting: '日常打招呼',
  care: '关心体贴',
  checkin: '轻问近况',
  miss: '想念或盼对方找来（须贴合性格）'
};

/** 根据人设判断是否适合写想念/嘴硬催促类 */
function inferProactivePersonalityStyle(ctx) {
  const p =
    String((ctx && ctx.personality) || '') +
    String((ctx && ctx.quirk) || '') +
    String((ctx && ctx.bioHook) || '');
  return {
    allowsMissYou: /温柔|暖|粘|念|重情|恋爱|撒娇|痴情|依赖|热情|直球/.test(p),
    allowsTease: /傲|嘴硬|毒|活泼|开朗|皮|损|别扭|炸毛|任性/.test(p),
    prefersRestrained: /冷|淡|酷|疏离|克制|沉默|寡言/.test(p)
  };
}

function buildMissKindPool(ctx) {
  const you = '你';
  const name = (ctx && ctx.name) || '我';
  const style = inferProactivePersonalityStyle(ctx);
  const out = [];

  if (style.allowsMissYou) {
    out.push('有点想你了，在吗？');
    out.push('今天还没跟你说话，有点想你。');
    out.push('突然有点想你，来打个招呼。');
  }
  if (style.allowsTease) {
    out.push('别装看不见，回我一句。');
    out.push('……你怎么还不来？我才不是专门等你。');
    out.push('哼，再不来我就继续发消息了。');
  }
  if (style.allowsMissYou && style.allowsTease) {
    out.push('想你了，别装看不见好不好。');
  }
  if (!out.length) {
    out.push('在吗？' + name + '找你说句话。');
    out.push('有空回我一句吗？');
  }
  return out;
}

function extractProactiveSceneSignature(text, messageKind) {
  const t = String(text || '')
    .replace(/\s+/g, '')
    .trim();
  if (!t) return '';
  const hits = [];
  for (let i = 0; i < SCENE_ANCHOR_WORDS.length; i++) {
    const w = SCENE_ANCHOR_WORDS[i].trim();
    if (w && t.indexOf(w) >= 0 && hits.indexOf(w) < 0) hits.push(w);
  }
  const opener = t.slice(0, 8);
  const kind = String(messageKind || 'greeting');
  return kind + '@' + (hits.length ? hits.slice(0, 2).join('+') : 'plain') + ':' + opener;
}

function isSceneSignatureConflict(sig, forbiddenSigs) {
  if (!sig || !forbiddenSigs || !forbiddenSigs.length) return false;
  const parts = String(sig).split(':');
  const head = parts[0] || '';
  const open = parts[1] || '';
  for (let i = 0; i < forbiddenSigs.length; i++) {
    const other = String(forbiddenSigs[i] || '');
    if (!other) continue;
    if (other === sig) return true;
    const oParts = other.split(':');
    const oHead = oParts[0] || '';
    const oOpen = oParts[1] || '';
    if (head && oHead && head === oHead) return true;
    const headKeys = head.split('@');
    const oHeadKeys = oHead.split('@');
    const anchors = (headKeys[1] || '').split('+').filter(Boolean);
    const oAnchors = (oHeadKeys[1] || '').split('+').filter(Boolean);
    const overlap = anchors.some((k) => oAnchors.indexOf(k) >= 0);
    if (overlap && open && oOpen && open.slice(0, 4) === oOpen.slice(0, 4)) return true;
  }
  return false;
}

const THEME_KEYWORDS = [
  [/修仙|仙侠|灵力|宗门|剑|丹|妖|灵根|渡劫/, 'fantasy'],
  [/魔法|西幻|龙|精灵|魔女|骑士|王国/, 'western'],
  [/现代|都市|上班|通勤|地铁|外卖|加班|公司/, 'modern'],
  [/校园|学校|同学|考试|课堂|宿舍|社团/, 'school'],
  [/科幻|星际|机甲|太空|赛博|仿生人|AI(?!助手)/, 'scifi'],
  [/古代|江湖|武侠|客栈|镖局|宫|朝/, 'historical'],
  [/末世|废土|丧尸|避难/, 'apocalypse'],
  [/海岛|港口|渔|船|洋/, 'coastal'],
  [/雪|冰|寒|冬|北/, 'cold'],
  [/沙漠|沙|干旱|绿洲/, 'desert']
];

function pickFromSeed(pool, seed) {
  const list = pool && pool.length ? pool : [];
  if (!list.length) return '';
  return list[Math.abs(Number(seed) || 0) % list.length];
}

function sliceSafe(text, max) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 12);
}

function getDayPhase(ts) {
  const h = new Date(Number(ts) || Date.now()).getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

function assignMessageKindsForBatch(count, seed) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return [];
  const phase = getDayPhase(seed);
  let pool;
  if (phase === 'morning') {
    pool = ['morning', 'care', 'greeting'];
  } else if (phase === 'night') {
    pool = ['evening', 'care', 'greeting'];
  } else if (phase === 'evening') {
    pool = ['evening', 'greeting', 'care'];
  } else if (phase === 'noon') {
    pool = ['care', 'greeting', 'miss'];
  } else {
    pool = ['greeting', 'care', 'miss'];
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pool[i % pool.length]);
  }
  return out;
}

function buildKindTextPools(ctx, phase) {
  const you = '你';
  const name = ctx.name || '我';
  const p = String(ctx.personality || '');
  const pools = {
    morning: [
      '早安，' + you + '今天起得早吗？',
      '早上好，' + name + '刚醒，先来问个好。',
      '早啊，记得吃早饭，别空着肚子。',
      '新的一天了，' + you + '那边天亮了吗？'
    ],
    evening: [
      '晚安，' + you + '今天也辛苦了。',
      '夜深了，早点休息，别熬太晚。',
      '晚上好，睡前记得放松一下。',
      '该睡了，' + you + '别硬撑着了。'
    ],
    greeting: [
      '嗨，' + you + '在吗？',
      '哈喽，' + name + '来打个招呼。',
      '喂，有空聊两句吗？',
      '在不在？' + name + '找你说句话。'
    ],
    care: [
      '记得按时吃饭，别忙忘了。',
      '别太累了，歇一歇再忙。',
      '天凉了，多穿点别着凉。',
      '多喝水，别老坐着不动。',
      '忙完早点休息，别硬扛。'
    ],
    checkin: [
      '今天还顺利吗？有空回我一句。',
      '好久没聊了，来两句？',
      '最近怎么样，想听你说说。',
      '闲下来了吗？' + name + '在这。'
    ]
  };

  if (p.indexOf('冷') >= 0 || p.indexOf('傲') >= 0) {
    pools.greeting.push('……在吗，' + name + '就问一句。');
    pools.checkin.push('别误会，不是催你，就是来确认一下。');
    pools.greeting.push('别装看不见，回我一句。');
    pools.checkin.push('……你怎么还不来？我才不是专门等你。');
  }
  if (p.indexOf('温柔') >= 0 || p.indexOf('暖') >= 0) {
    pools.care.push('别把自己逼太紧，' + name + '会担心。');
    pools.evening.push('今晚也要好好睡觉，' + you + '。');
    pools.checkin.push('有点想你了，在吗？');
    pools.care.push('今天还没见到你，心里有点空落落的。');
  }
  if (p.indexOf('粘') >= 0 || p.indexOf('撒娇') >= 0) {
    pools.checkin.push('想你了，别让我等太久。');
    pools.greeting.push('你怎么还不来找我呀？');
  }
  if (p.indexOf('活泼') >= 0 || p.indexOf('开朗') >= 0) {
    pools.greeting.push('嗨嗨！' + you + '在不在？来敲门啦！');
    pools.morning.push('早——' + you + '今天也要元气满满！');
  }
  if ((ctx.themeTags || {}).fantasy || (ctx.themeTags || {}).historical) {
    pools.morning.push('晨安，' + name + '特来问安。');
    pools.evening.push('夜已深，' + name + '愿你安眠。');
    pools.greeting.push('是' + name + '，来向' + you + '请安。');
  }
  if (phase === 'morning' && pools.morning.length) {
    return pools;
  }
  if ((phase === 'night' || phase === 'evening') && pools.evening.length) {
    return pools;
  }
  return pools;
}

function buildGreetingTexts(ctx, seed, options) {
  const opts = options || {};
  const kind = opts.kind || opts.messageKind || 'greeting';
  const phase = getDayPhase(seed);
  const s = Number(seed) || 0;
  const pools = buildKindTextPools(ctx, phase);
  let base;
  if (kind === 'miss') {
    base = buildMissKindPool(ctx).slice();
  } else {
    base = (pools[kind] || pools.greeting || []).slice();
    const style = inferProactivePersonalityStyle(ctx);
    if (style.prefersRestrained) {
      base = base.filter(
        (t) =>
          !/想你了|好想你|别装看不见|你怎么还不|才不是专门等你/.test(String(t || ''))
      );
    }
  }
  const phrase = String(ctx.phrase || '');
  const likes = String(ctx.likes || '');

  if (phrase && kind === 'greeting') {
    base.push(phrase.slice(0, 10) + '——' + nameFromCtx(ctx) + '来问好了。');
  }
  if (likes && kind === 'care') {
    base.push('别总忙着' + likes + '，也记得照顾好自己。');
  }

  const uniq = [];
  const seen = {};
  for (let i = 0; i < base.length; i++) {
    const t = base[(s + i) % base.length];
    if (!seen[t]) {
      seen[t] = true;
      uniq.push(t);
    }
  }
  return uniq.length ? uniq : base.slice(0, 6);
}

function nameFromCtx(ctx) {
  return (ctx && ctx.name) || '我';
}

function buildDoingNowTexts(ctx, seed) {
  return buildGreetingTexts(ctx, seed, { kind: 'greeting' });
}

function collectMessagesForStorage(storageId) {
  const ids = resolveOcChatStorageIds(storageId);
  let msgs = [];
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const sessions = listSessions(id);
    for (let i = 0; i < sessions.length; i++) {
      msgs = msgs.concat(getMessages(id, sessions[i].id) || []);
    }
    if (!msgs.length) {
      try {
        const legacy = wx.getStorageSync('oc_chat_' + id);
        if (Array.isArray(legacy)) msgs = legacy;
      } catch (e) {}
    }
  }
  return msgs;
}

function getRecentUserChatLines(storageId, limit) {
  const msgs = collectMessagesForStorage(storageId);
  const out = [];
  for (let i = msgs.length - 1; i >= 0 && out.length < (limit || 5); i--) {
    const m = msgs[i];
    if (m && m.role === 'user') {
      const t = String(m.content || '').trim();
      if (t) out.unshift(t);
    }
  }
  return out;
}

function inferThemeTags(work, oc) {
  const bg = (work && work.background) || {};
  const r = (work && work.result) || {};
  const bio = String((work && work.generatedBio) || (oc && oc.bioText) || '');
  const worldview = String(bg.worldview || '');
  const events = (bg.lifeEvents || []).filter(Boolean).join(' ');
  const origins = (bg.origins || []).filter(Boolean).join(' ');
  const personality = String(
    (oc && oc.personalityText) || r.personality || ''
  );
  const blob = worldview + bio + events + origins + personality;

  const tags = { daily: 1 };
  THEME_KEYWORDS.forEach(([re, tag]) => {
    if (re.test(blob)) tags[tag] = (tags[tag] || 0) + 4;
  });
  if (events.trim()) tags.lifeEvent = (tags.lifeEvent || 0) + 6;
  if (bio.trim()) tags.bio = (tags.bio || 0) + 5;
  if (worldview.trim()) tags.worldview = (tags.worldview || 0) + 5;
  if (origins.trim()) tags.origin = (tags.origin || 0) + 4;
  if (personality.trim()) tags.personality = (tags.personality || 0) + 3;
  if (String(oc.quirkText || r.quirk || '').trim()) tags.quirk = (tags.quirk || 0) + 3;
  if ((work.catchphrases || []).filter(Boolean).length) tags.catchphrase = 3;
  if (String(r.likes || '').trim()) tags.likes = 3;
  if (String(r.race || oc.race || '').trim()) tags.race = 2;
  return tags;
}

function buildProactiveSceneContext(oc, storageId, seed) {
  const work = (oc && oc.work) || {};
  const r = (work.result || {}) || {};
  const bg = work.background || {};
  const events = (bg.lifeEvents || []).filter(Boolean);
  const origins = (bg.origins || []).filter(Boolean);
  const cp = (work.catchphrases || []).filter(Boolean);
  const bio = String((work.generatedBio || oc.bioText) || '').trim();
  const bioHook = bio
    ? bio.split(/[。！？\n]/).filter(Boolean)[0]
    : '';
  const themeTags = inferThemeTags(work, oc);

  const s = Number(seed) || Date.now();
  const event = sliceSafe(pickFromSeed(events, s), 10);
  const event2 = sliceSafe(pickFromSeed(events, s + 7), 8);
  const origin = sliceSafe(pickFromSeed(origins, s + 11), 10);
  const phrase = sliceSafe(pickFromSeed(cp, s + 13), 14);

  return {
    name: sliceSafe(oc.name || r.name || '我', 6),
    race: sliceSafe(r.race || oc.race, 6),
    gender: sliceSafe(r.gender || oc.gender, 4),
    likes: sliceSafe(r.likes, 10),
    personality: sliceSafe(oc.personalityText || r.personality, 10),
    quirk: sliceSafe(oc.quirkText || r.quirk, 10),
    worldview: sliceSafe(bg.worldview, 12),
    worldviewShort: sliceSafe(bg.worldview, 6),
    bioHook: sliceSafe(bioHook, 18),
    event,
    event2,
    origin,
    phrase,
    themeTags,
    hasEvent: !!event,
    hasBio: !!bioHook,
    hasWorldview: !!bg.worldview
  };
}

function scene(tags, need, fill) {
  return { tags: tags || ['daily'], need: need || [], fill };
}

function buildProactiveScenes() {
  const S = [];
  const push = (tags, need, fill) => S.push(scene(tags, need, fill));

  // —— 人生事件 × 设定主题（25）——
  const evDaily = [
    (c) =>
      '等公交时风把站牌吹得哐哐响，我下意识想起' +
      c.event +
      '，那时也是这种没预兆的乱。',
    (c) =>
      '拆快递划到手，血珠冒出来，忽然觉得跟' +
      c.event +
      '里那种「来不及躲」是一类事。',
    (c) =>
      '热饮烫到舌头，疼得吸气，脑子里却飘过' +
      c.event2 +
      '，两处都没给我准备时间。',
    (c) =>
      '鞋带开了两次，第二次懒得系，走慢些，反而想起' +
      c.event +
      '里那种硬撑到底的劲儿。',
    (c) =>
      '洗衣机的节奏声停了又转，我靠着墙等，想起' +
      c.event2 +
      '，也是中途差点以为要结束。',
    (c) =>
      '扫码进站闸机卡了一下，后面有人轻咳，我想到' +
      c.event +
      '，跟眼前这破机器一样不讲理。',
    (c) =>
      '充电线绕第三遍还是打结，我想大概是' +
      c.event2 +
      '那阵子的晦气没散，索性拔了重插。',
    (c) =>
      '窗外太阳雨，路人伞花开又合，我记起' +
      c.event +
      '，跟这天气一样没道理。',
    (c) =>
      '快递太大塞不进柜，蹲门口拆，泡沫粘裤腿，想起' +
      c.event2 +
      '也是这般狼狈，但好歹拿到了。',
    (c) =>
      '电台插播半句没头没尾的话，我听了两遍，只跟' +
      c.event +
      '沾点边，其余全忘了。',
    (c) =>
      '用牙咬线头，舌头尝到金属味，想到' +
      c.event2 +
      '，随即觉得自己戏太多，把线头剪了。',
    (c) =>
      '电梯里小孩背诗错字，我差点接上下一句，才发现是' +
      c.event +
      '里用过的词，赶紧闭嘴。',
    (c) =>
      '微波炉叮一声，我忘了热的是什么，打开看见汤面起泡，像' +
      c.event2 +
      '里描述过的那种闷着的局面。',
    (c) =>
      '指甲剪找不着，用牙咬开零食袋，划了一下，倒清醒了，想起' +
      c.event +
      '也是从小事开始的。',
    (c) =>
      '路灯闪了一下，整条巷子暗了半拍，我脚步没停，但心跳漏了一拍，像' +
      c.event2 +
      '那次。'
  ];
  evDaily.forEach((fn, i) => {
    push(['lifeEvent', 'daily', 'modern'], ['event'], fn);
  });

  const evFantasy = [
    (c) =>
      '在' +
      (c.worldviewShort || '这方天地') +
      '里惯见的规矩，今天却失灵——' +
      c.event +
      '那类意外，原来日常也会重演。',
    (c) =>
      '灵气/风声一断（就当是风吧），我愣了愣，想起' +
      c.event +
      '，那时也是征兆先于人。',
    (c) =>
      '符纸/贴纸从包侧滑落（反正就是张纸），我捡起来折好，想到' +
      c.event2 +
      '，折痕都类似。'
  ];
  evFantasy.forEach((fn) => push(['lifeEvent', 'fantasy', 'worldview'], ['event'], fn));

  const evHistorical = [
    (c) =>
      '茶凉到一半，我换热水，看茶叶沉底，像' +
      c.event +
      '里那种等不到回音的时辰。',
    (c) =>
      '街角卖糖人换了花样，我仍买旧的，甜得发腻，却像' +
      c.event2 +
      '那阵子的味道。'
  ];
  evHistorical.forEach((fn) => push(['lifeEvent', 'historical'], ['event'], fn));

  const evSchool = [
    (c) =>
      '走廊广播测试音刺耳朵，我捂了一下，想起' +
      c.event +
      '，也是突然被点名似的。',
    (c) =>
      '作业本夹了根头发，我抽出来，想到' +
      c.event2 +
      '，小得几乎看不见，却忘不掉。'
  ];
  evSchool.forEach((fn) => push(['lifeEvent', 'school'], ['event'], fn));

  const evScifi = [
    (c) =>
      '手环/手表震了两下没显示内容，我拍了拍，想起' +
      c.event +
      '，系统也会偶尔抽风。',
    (c) =>
      '自动门感应慢了半拍，我差点撞上，想到' +
      c.event2 +
      '，人机都在延迟。'
  ];
  evScifi.forEach((fn) => push(['lifeEvent', 'scifi', 'modern'], ['event'], fn));

  // —— 小传 / 身世（15）——
  const bioScenes = [
    (c) =>
      c.bioHook
        ? '小传里写过' + c.bioHook + '，刚才洗碗水滴下来的节奏，居然跟那场景有点像。'
        : '抽屉深处有张没寄出的明信片，邮票翘边，我把它压平了。',
    (c) =>
      c.bioHook
        ? '路过一家关门的店，招牌字体像小传里描过的' +
          c.bioHook.slice(0, 6) +
          '，我没进去。'
        : '把旧手机充上电，相册第一张是糊的，看了三秒又锁屏。',
    (c) =>
      c.origin
        ? '身世里提过' + c.origin + '，今天被人问路问反了方向，我竟先想到那段。'
        : '风把门带上又弹开，我回去锁，像补一个迟到的动作。',
    (c) =>
      c.bioHook
        ? '读小传里「' + c.bioHook.slice(0, 10) + '」那句，窗外正好有鸟叫，对上了。'
        : '书页间夹着根干枯的草，不知道哪年放的，我没扔。',
    (c) =>
      c.origin
        ? '身世里提过「' + c.origin + '」，今天老习惯又犯了，把钥匙摸了三遍才出门。'
        : '把闹钟按掉第三次，终于起床，第一件事是去摸猫碗空了没有。'
  ];
  bioScenes.forEach((fn) => push(['bio', 'origin'], ['bioHook'], fn));
  push(['bio'], ['bioHook'], (c) =>
    c.bioHook
      ? '小传里' + c.bioHook.slice(0, 8) + '那段，我刚才走路走快了，喘口气才想起别赶。'
      : '窗玻璃上凝了一层水汽，我用指尖画了个圆又擦掉，没什么原因。'
  );
  for (let i = 0; i < 9; i++) {
    push(['bio', 'daily'], ['bioHook'], (c) => {
      const hooks = [
        '把' + c.bioHook.slice(0, 6) + '写进备忘录又删了，最后只留下一句「算了」。',
        '做梦后半段像小传里的场景，醒来只记得' + c.bioHook.slice(0, 8) + '，水还温着。',
        '擦桌子时想起小传里「' + c.bioHook.slice(0, 10) + '」，抹布拧过了，水还是脏。',
        '排队时脑子里循环小传那句，前面的人回头看了我一眼。',
        '热汤表面那层膜，像小传里写的' + c.bioHook.slice(0, 6) + '，我撇开了。'
      ];
      return hooks[i % hooks.length];
    });
  }

  // —— 世界观氛围（15）——
  const wvScenes = [
    (c) =>
      '今天风很' +
      c.worldviewShort +
      '，我把窗只开一条缝，听外面的声音像隔了一层纱。',
    (c) =>
      c.worldviewShort +
      '这种地方居然也有卖热可可的，我买了一杯，烫到上颚。',
    (c) =>
      '公告栏贴了新通知，字排得歪歪的，在' +
      c.worldviewShort +
      '的规矩里算异类，我读完第一句就走了。',
    (c) =>
      '路口红绿灯闪黄灯闪很久，我数了七下，它才变绿，像' +
      c.worldview +
      '里的某种拖延。',
    (c) =>
      '雨停后地面冒热气，这景象在' +
      c.worldviewShort +
      '不算稀奇，我还是站了会儿才走。'
  ];
  wvScenes.forEach((fn) => push(['worldview'], ['worldview'], fn));
  for (let i = 0; i < 10; i++) {
    push(['worldview', 'daily'], ['worldview'], (c) => {
      const lines = [
        '风把广告牌吹得哐哐响，这种' + c.worldview + '的天气，我在路口等红灯，把帽檐压低。',
        '手机没信号那几分钟，我反而看清了路边旧招牌，在' + c.worldviewShort + '里它早该换了。',
        '楼下有人练笛子，跑调两次，第三遍顺了，像' + c.worldviewShort + '里说的「第三次才对」。',
        '快递柜屏幕反光，我瞥见自己头发翘着，懒得理，在' + c.worldviewShort + '里这不算失礼。',
        '微波炉空转，我听见嗡鸣，像' + c.worldviewShort + '里常提到的背景噪音。'
      ];
      return lines[i % lines.length];
    });
  }

  // —— 性格 / 怪癖 / 口癖 / 喜好（15）——
  push(['personality'], ['personality'], (c) =>
    '又是' + c.personality + '的一天，连外卖都点晚了，骑手打电话来时我还在找耳机。'
  );
  push(['personality'], ['personality'], (c) =>
    '同事说我今天看起来特别' + c.personality + '，我说是吗，其实只是因为袜子穿反了。'
  );
  push(['quirk'], ['quirk'], (c) =>
    '明知道会' + c.quirk + '，我还是把票根折成小方块，揣兜里现在硌得慌。'
  );
  push(['quirk'], ['quirk'], (c) =>
    '老毛病犯了：' + c.quirk + '，结果把钥匙锁屋里了，在楼道里坐了十分钟。'
  );
  push(['catchphrase'], ['phrase'], (c) =>
    '洗碗洗到一半突然默念「' + c.phrase + '」，水溅到袖口了，懒得擦。'
  );
  push(['catchphrase'], ['phrase'], (c) =>
    '「' + c.phrase + '」——这话我对自己说了第三遍，还是没想好接下来干嘛。'
  );
  push(['likes'], ['likes'], (c) =>
    '本来想买' + c.likes + '，排队太长，我换了别的，咬第一口就后悔没等。'
  );
  push(['likes'], ['likes'], (c) =>
    '看到' + c.likes + '的周边，我站柜台前算了算余额，最后买了最便宜的款。'
  );
  push(['race'], ['race'], (c) =>
    c.name +
    '，刚被人叫错称呼，我懒得纠正，反正今天' +
    c.race +
    '的身份也不怎么显眼。'
  );
  for (let i = 0; i < 6; i++) {
    push(['personality', 'daily'], ['personality'], (c) => {
      const ps = [
        '把头发剪短了，镜子里的自己愣了两秒，' + c.personality + '还是写在脸上。',
        '快递到了，盒子比想象中小，拆完一地泡沫，我坐泡沫堆里喝了口水。',
        '刚把笔盖咬出牙印，才发现这笔不是我的，搁在失物处了，走得挺轻快。',
        '洗衣机的节奏声突然停了，我抱着胳膊等了三分钟，它自己又转起来了。',
        '钥匙串上多了颗不知哪来的扣子，晃起来叮当响，听着还挺顺耳。',
        '便利店的饭团换包装了，我愣在门口对比了半分钟，最后两种各拿一个。'
      ];
      return ps[i % ps.length];
    });
  }

  // —— 独立生活小片段（15，不接用户聊天）——
  const soloLife = [
    (c) =>
      c.name +
      '把闹钟铃声换成鸟叫，结果窗外真鸟应和，我愣是把铃声又换回去了。',
    (c) =>
      '楼道声控灯坏了，我跺脚跺到邻居出门看，灯才亮，挺社死的。',
    (c) =>
      '新买的盆太大塞不进水槽，我端去阳台洗，水溅到隔壁晾的被单上，道了个歉。',
    (c) =>
      '把旧日历撕了叠成三角，一摞摞码在桌角，像小型堡垒，没别的原因。',
    (c) =>
      '自动贩卖机吞硬币，我拍了两下才吐出来，硬币热得烫手。',
    (c) =>
      '猫从窗台跳下来踩了键盘，屏幕乱码，我按了三次撤销才恢复。',
    (c) =>
      '把耳机孔清灰，用牙签挑出一团绒絮，音质居然好了一点。',
    (c) =>
      '公交坐过站，多走了一站路，发现那家关门的店今天居然亮灯了。',
    (c) =>
      c.worldviewShort
        ? '在' + c.worldviewShort + '这种地方，连风都带着旧味道，我把窗关严了。'
        : '把窗关严了，外面风还是钻进来，像故意捣乱。',
    (c) =>
      c.personality
        ? '今天状态有点' + c.personality + '，连热水的温度都嫌烫，换凉水又太凉。'
        : '热水太烫凉水太凉，我端着杯子站了半分钟。',
    (c) =>
      c.likes
        ? '本来想买' + c.likes + '，排队太长，换了别的，第一口就后悔。'
        : '排队太长换了别的，第一口就后悔，但还是吃完了。',
    (c) =>
      '包装绳系成死结，剪不开，用牙咬开，舌头尝到一点纤维味。',
    (c) =>
      '电梯里有人吃韭菜盒子，我屏住呼吸，楼层数跳到我的那层才大口喘气。',
    (c) =>
      '把照片从相框里取出来，发现背面写了行小字，不是写给我的，又塞回去了。',
    (c) =>
      c.event
        ? '路过旧地，没停，但想起' + c.event + '，脚步还是慢半拍。'
        : '路过旧地，没停，脚步还是慢半拍，然后继续走。'
  ];
  soloLife.forEach((fn) => push(['daily', 'lifeEvent'], [], fn));

  // —— 盼续聊：用户离开小程序后，OC 惦记对话却不说「在吗/想我吗」（18）——
  const missUserScenes = [
    () =>
      '（把聊天页滑到最底又停住）对话框还停在上一条下面，我这边攒了几件小事，不知先开口哪件。',
    () =>
      '（输入框里字打了又删）光标闪得心乱，我把手机扣在桌上，转而去听水壶渐响的声音。',
    () =>
      '（拇指悬在发送键上方很久）最后还是删干净了，只剩空白一行，我换坐姿喝这口温掉的水。',
    () =>
      '（把会话取消置顶又置回去）列表里那条静静待着，像没写完的半句，我先把窗缝关严。',
    () =>
      '（解锁瞄一眼角标又锁屏）数字干净得很，我嘿了一声，转而去叠散在沙发上的毯子。',
    () =>
      '（把手机收进抽屉又取出来）本想眼不见为净，最后还是搁在抬眼就能瞧见的位置。',
    () =>
      '（对着没有红点的通知栏发了会儿呆）栏里空空的，我叹口气，先去擦洗手池边的水渍。',
    () =>
      '（往上滑聊天记录两屏又滑回来）上面几段话看过几遍，后面的话堵在喉头，先把手边活干完。',
    () =>
      '（把未发送的草稿清空）删到最后只剩标点，我揉了揉眉心，决定出门买杯热饮。',
    () =>
      '（反复点亮屏幕又熄灭）光亮灭掉又亮起，像等什么，我最后还是把音量调成了震动。',
    () =>
      '（编辑栏输入又全选删除）删完手心有点汗，我起身去开窗，让冷风把热度吹散一点。',
    () =>
      '（把对话框标记未读又取消）标记完觉得滑稽，还是原样放着，先去把晾着的衣服收了。',
    () =>
      '（夜里把手机亮度调到最低）屏幕昏着，我侧过身去听冰箱压缩机那口气。',
    () =>
      '（剪了个简短的开头又存进草稿箱）草稿箱里多了条，我锁屏去热牛奶，等会儿也许能接着写。',
    () =>
      '（把铃声从静音调回来又调回去）怕漏掉什么，又怕太显眼，我最后选了震动两短一长。',
    () =>
      '（对话列表划过去又划回来）别的会话都热闹，这一条静着，我先去把地扫了再说。',
    (c) =>
      '（' +
      pickDoingAction(41) +
      '）对话框还挂着，我先去把' +
      (c.likes ? c.likes.slice(0, 4) : '碗筷') +
      '收拾完，回来说不定就有新动静。',
    (c) =>
      '（' +
      pickDoingAction(42) +
      '）' +
      c.name +
      '把聊天背景换回了默认图，原先那张看了太久，心里还留着半句没说完的话。'
  ];
  missUserScenes.forEach((fn) => push(['miss_user', 'daily'], [], fn));

  // —— 纯日常兜底（补足 100）——
  const dailyPool = [
    (c) =>
      '（' +
      pickDoingAction(3) +
      '）' +
      c.name +
      '刚把耳机线缠成了团，解了五分钟，还没解开。',
    () => '（用袖口擦了擦杯沿）正在晾鞋带，泥点还没刷干净。',
    () => '（把手机扣在桌上）刚划到相册推送，又锁屏了，饭还热着。',
    () => '（把书签夹进书里）正在找过期优惠券，最后当书签用了。',
    () => '（屏住呼吸等电梯）刚出地铁，香水味还黏在衣领上。',
    () => '（把湿袜子扔进盆里）正在换歌单，最吵那首还没播完。',
    () => '（闻了一下酸奶盖）刚把过期酸奶放回去，等会儿再扔。',
    () => '（盯着同款背包背影）正在下车，包里苹果还没吃。'
  ];
  while (S.length < 100) {
    const idx = S.length;
    push(['daily'], [], dailyPool[idx % dailyPool.length]);
  }

  return S.slice(0, 100);
}

const PROACTIVE_SCENES = buildProactiveScenes();

function sceneMeetsNeed(sc, ctx) {
  const need = sc.need || [];
  for (let i = 0; i < need.length; i++) {
    const key = need[i];
    if (key === 'event' && !ctx.hasEvent) return false;
    if (key === 'bioHook' && !ctx.hasBio) return false;
    if (key === 'worldview' && !ctx.hasWorldview) return false;
    if (key === 'personality' && !ctx.personality) return false;
    if (key === 'quirk' && !ctx.quirk) return false;
    if (key === 'phrase' && !ctx.phrase) return false;
    if (key === 'likes' && !ctx.likes) return false;
    if (key === 'race' && !ctx.race) return false;
  }
  return true;
}

function scoreScene(sc, ctx) {
  if (!sceneMeetsNeed(sc, ctx)) return -1;
  let score = 0;
  (sc.tags || []).forEach((tag) => {
    score += ctx.themeTags[tag] || 0;
  });
  if ((sc.tags || []).indexOf('lifeEvent') >= 0 && ctx.hasEvent) score += 8;
  if ((sc.tags || []).indexOf('bio') >= 0 && ctx.hasBio) score += 6;
  if ((sc.tags || []).indexOf('worldview') >= 0 && ctx.hasWorldview) score += 6;
  if (ctx.preferMissUser && (sc.tags || []).indexOf('miss_user') >= 0) score += 24;
  return score;
}

function rankScenes(ctx) {
  return PROACTIVE_SCENES.map((sc, index) => ({
    sc,
    index,
    score: scoreScene(sc, ctx)
  }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
}

function pickThemedProactiveScenes(
  oc,
  storageId,
  seed,
  count,
  forbiddenList,
  batchIndex,
  forbiddenSceneSignatures,
  preferMissUser,
  messageKind
) {
  const ctx = buildProactiveSceneContext(oc, storageId, seed);
  ctx.preferMissUser = !!preferMissUser;
  const kind = messageKind || 'greeting';
  const n = Math.min(count || 24, 48);
  const out = [];
  const usedText = {};
  const sceneSigs = forbiddenSceneSignatures || [];

  const baseOffset =
    ocHash(oc) +
    (Math.abs(Number(seed) || 0) % 97) +
    (Number(batchIndex) || 0) * 991;
  const greetingTexts = buildGreetingTexts(ctx, baseOffset, { kind: kind });
  for (let i = 0; i < greetingTexts.length && out.length < n; i++) {
    const text = greetingTexts[(baseOffset + i) % greetingTexts.length];
    if (!text || isForbiddenSceneText(text, forbiddenList) || usedText[text]) continue;
    const sig = extractProactiveSceneSignature(text, kind);
    if (isSceneSignatureConflict(sig, sceneSigs)) continue;
    usedText[text] = true;
    out.push({ text, ctx, sceneTags: [kind, 'greeting'], sceneSignature: sig });
  }
  return out;
}

function buildUserChatBlockForPrompt() {
  return '';
}

module.exports = {
  PROACTIVE_SCENES,
  MESSAGE_KIND_LABELS,
  assignMessageKindsForBatch,
  inferProactivePersonalityStyle,
  buildMissKindPool,
  buildProactiveSceneContext,
  buildGreetingTexts,
  buildDoingNowTexts,
  getRecentUserChatLines,
  buildUserChatBlockForPrompt,
  pickThemedProactiveScenes,
  inferThemeTags,
  rankScenes,
  extractProactiveSceneSignature,
  isSceneSignatureConflict,
  getDayPhase
};
