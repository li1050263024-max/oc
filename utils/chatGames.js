/** 聊天内小游戏（摇骰子、红包、转账等） */

const KIND_DICE = 'game_dice';
const KIND_MONEY = 'game_money';
const DEFAULT_DICE_FACES = 6;
const MONEY_TYPE_RED = 'red_packet';
const MONEY_TYPE_TRANSFER = 'transfer';
const RED_PACKET_MAX = 200;
/** 转账名义不限，仅防异常超大数 */
const TRANSFER_AMOUNT_MAX = 99999999.99;
const MONEY_PRESETS_RED = [0.01, 1, 6.66, 8.88, 66, 88.88, 100, 200];
const MONEY_PRESETS_TRANSFER = [1, 50, 100, 520, 1314, 5200, 10000, 52000];
const MONEY_PRESETS = MONEY_PRESETS_RED;

function rollDie(faces) {
  const n = Math.max(2, Math.min(100, Number(faces) || DEFAULT_DICE_FACES));
  const value = 1 + Math.floor(Math.random() * n);
  return { faces: n, value: value };
}

function formatDiceContent(payload, who) {
  const p = payload || {};
  const faces = Number(p.faces) || DEFAULT_DICE_FACES;
  const value = Number(p.value) || 0;
  const label = who === 'oc' ? '对方' : who === 'user' ? '你' : '';
  const head = label ? '[摇骰子] ' + label + '掷出了 ' : '[摇骰子] 掷出了 ';
  return head + value + '（D' + faces + '）';
}

function compareLabel(userValue, ocValue) {
  const u = Number(userValue) || 0;
  const o = Number(ocValue) || 0;
  if (!u || !o) return '';
  if (o === u) return '平手';
  if (o > u) return '角色点数更大';
  return '玩家点数更大';
}

/** 仅支持单颗六面骰 */
function createDiceRoll() {
  const faces = DEFAULT_DICE_FACES;
  const value = rollDie(faces).value;
  const payload = {
    faces: faces,
    count: 1,
    values: [value],
    value: value,
    total: value
  };
  return {
    kind: KIND_DICE,
    game: payload,
    content: formatDiceContent(payload, 'user')
  };
}

function isDiceMessage(msg) {
  return !!(msg && (msg.kind === KIND_DICE || (msg.game && msg.game.faces && !msg.game.type)));
}

function normalizeMoneyAmount(raw, type) {
  let n = Number(raw);
  if (!isFinite(n) || n <= 0) n = 1;
  n = Math.round(n * 100) / 100;
  if (n < 0.01) n = 0.01;
  if (type === MONEY_TYPE_RED) {
    if (n > RED_PACKET_MAX) n = RED_PACKET_MAX;
  } else if (n > TRANSFER_AMOUNT_MAX) {
    n = TRANSFER_AMOUNT_MAX;
  }
  return n;
}

function formatMoneyAmount(amount, type) {
  const n = normalizeMoneyAmount(amount, type);
  return n.toFixed(2);
}

function moneyTypeLabel(type) {
  return type === MONEY_TYPE_TRANSFER ? '转账' : '红包';
}

function formatMoneyContent(payload, who) {
  const p = payload || {};
  const type = p.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const label = moneyTypeLabel(type);
  const amount = formatMoneyAmount(p.amount, type);
  const actor = who === 'oc' ? '对方' : who === 'user' ? '你' : '';
  const verb = type === MONEY_TYPE_TRANSFER ? '转账' : '发红包';
  const status = String(p.status || '');
  let tail = '';
  if (status === 'accepted') tail = '（已接收）';
  else if (status === 'rejected') tail = '（已退回）';
  else if (status === 'claimed') tail = '（已领取）';
  if (actor) return '[' + label + '] ' + actor + verb + ' ' + amount + ' 元' + tail;
  return '[' + label + '] ' + amount + ' 元' + tail;
}

/**
 * 给模型看的金钱历史：必须明确「谁→谁」，禁止用「你/对方」
 * （界面文案里的「你/对方」是用户视角，直接喂给模型会把转账方向搞反）
 */
function formatMoneyForAiHistory(msg) {
  if (!msg || !isMoneyMessage(msg)) return '';
  const g = msg.game || {};
  const typeLabel = g.type === MONEY_TYPE_TRANSFER ? '转账' : '红包';
  const amount = formatMoneyAmount(g.amount, g.type);
  const status = String(g.status || '');
  let statusHint = '';
  if (status === 'accepted' || status === 'claimed') statusHint = '，对方已接收';
  else if (status === 'rejected') statusHint = '，已被退回';
  else if (status === 'waiting') statusHint = '，等待你（角色）决定接收或退回';
  else if (status === 'sent') statusHint = '，等待用户领取或退回';

  const fromOc = g.side === 'oc' || (msg.role === 'assistant' && g.side !== 'user');
  if (fromOc) {
    return (
      '[系统·金钱] 你（角色）向用户发出了' +
      typeLabel +
      ' ' +
      amount +
      ' 元' +
      statusHint +
      '。这是你发给用户的，不是用户发给你的；台词里不要当成用户转给你。'
    );
  }
  return (
    '[系统·金钱] 用户向你（角色）发出了' +
    typeLabel +
    ' ' +
    amount +
    ' 元' +
    statusHint +
    '。这是用户发给你的。'
  );
}

function createMoneySend(type, amount, side) {
  const t = type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const who = side === 'oc' ? 'oc' : 'user';
  const amt = normalizeMoneyAmount(amount, t);
  const payload = {
    type: t,
    amount: amt,
    amountText: formatMoneyAmount(amt, t),
    // 对方发出的红包/转账都待用户领取或退回；用户发出的待角色处理
    status: who === 'oc' ? 'sent' : 'waiting',
    side: who,
    blessing: t === MONEY_TYPE_RED ? '恭喜发财，大吉大利' : ''
  };
  return {
    kind: KIND_MONEY,
    game: payload,
    content: formatMoneyContent(payload, who)
  };
}

function isMoneyMessage(msg) {
  return !!(
    msg &&
    (msg.kind === KIND_MONEY ||
      (msg.game &&
        (msg.game.type === MONEY_TYPE_RED || msg.game.type === MONEY_TYPE_TRANSFER)))
  );
}

function toAiHistoryMessage(msg) {
  if (!msg || msg.recalled) return null;
  if (isMoneyMessage(msg)) {
    const moneyLine = formatMoneyForAiHistory(msg);
    if (!moneyLine) return null;
    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: moneyLine
    };
  }
  const content = String(msg.content || '').trim();
  if (!content) return null;
  return {
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: content
  };
}

/**
 * 短用户句；详细规则由云函数 diceMode 附加，避免超长 userMessage 拖慢/超时。
 */
function buildDiceDecideUserMessage(userPayload, ocValue) {
  const userValue = Number(userPayload && userPayload.value) || 0;
  const oc = Math.max(1, Math.min(DEFAULT_DICE_FACES, Number(ocValue) || rollDie().value));
  const cmp = compareLabel(userValue, oc);
  return (
    '[摇骰子] 玩家D6=' +
    userValue +
    '；若你愿意一起玩则你的D6=' +
    oc +
    '（' +
    cmp +
    '）。请结合人设与上文判断愿不愿意玩，并按格式回复。'
  );
}

function parseDiceAiReply(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { join: false, speech: '' };
  }

  if (text.charAt(0) === '{') {
    try {
      const obj = JSON.parse(text);
      const speech = String(obj.speech || obj.text || obj.reply || '').trim();
      const join = !!(obj.join === true || obj.join === 1 || obj.join === '1');
      if (speech) return { join: join, speech: speech };
    } catch (_) {}
  }

  const joinMatch = text.match(/JOIN\s*:\s*([01])/i);
  const join = !!(joinMatch && joinMatch[1] === '1');
  let speech = text;
  const parts = text.split(/\n---\s*\n/);
  if (parts.length >= 2) {
    speech = parts.slice(1).join('\n---\n').trim();
  } else if (joinMatch) {
    speech = text.replace(/JOIN\s*:\s*[01]\s*/i, '').replace(/^---\s*/m, '').trim();
  }
  speech = speech
    .replace(/^\s*JOIN\s*:\s*[01]\s*/i, '')
    .replace(/^---\s*/m, '')
    .trim();
  if (!speech) speech = text;
  return { join: join, speech: speech };
}

function buildOcDiceMessage(ocValue, userValue) {
  const faces = DEFAULT_DICE_FACES;
  const value = Math.max(1, Math.min(faces, Number(ocValue) || rollDie(faces).value));
  const game = {
    faces: faces,
    count: 1,
    values: [value],
    value: value,
    total: value,
    rivalValue: Number(userValue) || 0,
    side: 'oc'
  };
  const cmp =
    game.rivalValue > 0
      ? game.value === game.rivalValue
        ? '，平手'
        : game.value > game.rivalValue
          ? '，比你大'
          : '，比你小'
      : '';
  const content =
    formatDiceContent(game, 'oc') +
    (game.rivalValue ? '（你是 ' + game.rivalValue + cmp + '）' : '');
  return {
    kind: KIND_DICE,
    game: game,
    content: content
  };
}

/**
 * @param {number} ocValue 预先掷好的角色点数；JOIN:1 时必须使用该点数，禁止再随机
 */
function buildDiceAssistantMessages(ocId, userValue, rawReply, ocValue) {
  let join = false;
  let speech = String(rawReply || '').trim();
  if (speech) {
    if (speech.charAt(0) === '{') {
      try {
        const obj = JSON.parse(speech);
        const j = obj.join === true || obj.join === 1 || obj.join === '1';
        const s = String(obj.speech || obj.text || obj.reply || '').trim();
        if (s) {
          join = !!j;
          speech = s;
        }
      } catch (_) {}
    } else {
      const joinMatch = speech.match(/JOIN\s*:\s*([01])/i);
      join = !!(joinMatch && joinMatch[1] === '1');
      const parts = speech.split(/\n---\s*\n/);
      if (parts.length >= 2) {
        speech = parts.slice(1).join('\n---\n').trim();
      } else if (joinMatch) {
        speech = speech.replace(/JOIN\s*:\s*[01]\s*/i, '').replace(/^---\s*/m, '').trim();
      }
      speech = speech
        .replace(/^\s*JOIN\s*:\s*[01]\s*/i, '')
        .replace(/^---\s*/m, '')
        .trim();
    }
  }
  if (!speech) speech = String(rawReply || '').trim() || '……';

  const out = [];
  if (join) {
    const fixedOc = Math.max(
      1,
      Math.min(DEFAULT_DICE_FACES, Number(ocValue) || rollDie(DEFAULT_DICE_FACES).value)
    );
    const dice = buildOcDiceMessage(fixedOc, userValue);
    out.push(Object.assign({ role: 'assistant', ocId: ocId }, dice));
  }
  out.push({
    role: 'assistant',
    ocId: ocId,
    content: speech
  });
  return out;
}

function buildMoneyDecideUserMessage(payload) {
  const p = payload || {};
  const type = p.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const label = moneyTypeLabel(type);
  const amount = formatMoneyAmount(p.amount, type);
  return (
    '[' +
    label +
    '] 玩家向你' +
    (type === MONEY_TYPE_TRANSFER ? '转账' : '发红包') +
    ' ' +
    amount +
    ' 元（虚拟玩法，非真实支付）。请严格按人设与当前关系决定接收或退回，并按格式回复。'
  );
}

/** 客户端/云端共用：收红包格式规则 */
const MONEY_REPLY_RULES =
  '\n\n【红包/转账回应规则】用户向你发了虚拟红包或转账（非真实支付）。你必须严格按下述格式回复：\n' +
  '第1行只能是 ACCEPT:1（接收）或 ACCEPT:0（退回/拒收）。\n' +
  '第2行必须是 ---\n' +
  '然后写一两句角色台词（可含动作）。\n' +
  '判断必须贴合人设与上文，可收可退，不要每次都退，也不要每次都收。\n' +
  '爱财、贪心、占有欲、缺钱、傲娇嘴硬心软、亲密依赖等更易 ACCEPT:1；\n' +
  '清高、厌施舍、自尊强、嫌金额侮辱、生气冷战、明确拒绝被养等更易 ACCEPT:0。\n' +
  '台词要与 ACCEPT 一致：ACCEPT:1 不要说退回；ACCEPT:0 不要说收下。\n' +
  '台词中不要出现「系统」「指令」「ACCEPT」。禁止提真实支付。';

/** 客户端/云端共用：仅白名单场景可主动发包，平常聊天禁止 */
const MONEY_PROACTIVE_RULES =
  '\n\n【虚拟红包/转账·主动·白名单】默认 TYPE:none。平常闲聊、调情、寒暄、讲日常一律禁止发钱。\n' +
  '请先写角色台词，末尾追加且只追加一次：\n' +
  '<<<MONEY\nTYPE:none|red_packet|transfer\nAMOUNT:数字\n>>>\n' +
  '或：SEND:none / SEND:red_packet:金额 / SEND:transfer:金额\n' +
  '仅当本轮用户消息属于下列之一时，才可 red_packet/transfer，否则必须 none：\n' +
  'A) 用户主动提到钱/红包/转账/打钱/借钱/给我钱/生活费等；\n' +
  'B) 用户正在哭穷、卖惨、诉苦缺钱、交不起房租学费、救急、求补偿；\n' +
  'C) 用户刚给你发了红包/转账，你礼尚往来回一份（可回也可只口头谢，不强制）。\n' +
  '禁止：用户没提钱、也没卖惨哭穷时，因关系好/人设有钱/想讨好而主动塞钱。\n' +
  '金额：认真给钱 ≥ 1 元；红包 ≤ 200；转账见【财力参考】。近几轮刚发过则本轮 none。\n' +
  '方向：【角色→用户】发钱；严禁写成用户转给你。\n' +
  '台词禁止「[红包]」「[转账]」「X元已发送」；红包台词勿报金额；拿不准就 none。\n';

/**
 * 是否允许本轮主动发红包/转账（客户端硬闸，防止平常聊天乱发卡）
 * @param {string} userMessage
 * @param {Array} [recentMessages]
 */
function shouldAllowProactiveMoney(userMessage, recentMessages) {
  const t = String(userMessage || '');
  if (
    /红包|转账|转你|转给|打钱|打给|给我钱|借我|借点|差钱|没钱|穷|哭穷|卖惨|救急|生活费|零花|伙食费|房租|学费|交不起|帮我付|替我付|充值|养我|包养|心意钱|给我点钱|发个红包|转点钱|转些|打些钱/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /(卖惨|哭穷|诉苦).{0,12}(钱|穷|费|交不)|交不起.{0,8}(房租|学费|网费|医药)|真的没钱|钱包空|吃土|揭不开锅|断粮/.test(
      t
    )
  ) {
    return true;
  }
  if (Array.isArray(recentMessages)) {
    const recent = recentMessages.slice(-10);
    // 用户刚发过红包/转账 → 允许礼尚往来
    if (
      recent.some(
        (m) =>
          m &&
          m.role === 'user' &&
          m.kind === KIND_MONEY &&
          m.game &&
          (m.game.type === MONEY_TYPE_RED || m.game.type === MONEY_TYPE_TRANSFER)
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectPersonaTextFromWork(work) {
  if (!work) return '';
  const parts = [];
  try {
    const r = work.result || {};
    parts.push(r.name, r.gender, r.age, r.race, r.personality, r.quirk, r.occupation, r.identity);
    if (Array.isArray(r.personalities)) parts.push(r.personalities.join(' '));
    if (Array.isArray(r.quirks)) parts.push(r.quirks.join(' '));
  } catch (_) {}
  try {
    const bg = work.background || {};
    parts.push(bg.worldview);
    if (Array.isArray(bg.origins)) parts.push(bg.origins.join('\n'));
    if (Array.isArray(bg.lifeEvents)) parts.push(bg.lifeEvents.join('\n'));
  } catch (_) {}
  try {
    if (work.bio) parts.push(typeof work.bio === 'string' ? work.bio : JSON.stringify(work.bio));
    if (work.ocBio) parts.push(String(work.ocBio));
    if (work.bioText) parts.push(String(work.bioText));
  } catch (_) {}
  try {
    if (Array.isArray(work.catchphrases)) parts.push(work.catchphrases.join('\n'));
    if (Array.isArray(work.attitudes)) {
      parts.push(
        work.attitudes
          .map((x) => (x && (x.event || '') + ' ' + (x.attitude || '')) || '')
          .join('\n')
      );
    }
  } catch (_) {}
  return parts.filter(Boolean).join('\n');
}

/** 从人设文本估计财力档：ultra_rich / rich / mid / poor / broke */
function estimateWealthTier(personaText) {
  const t = String(personaText || '');
  if (!t) return 'mid';
  if (/破产|赤贫|身无分文|穷得叮当|吃土|负债累累|流浪|乞讨/.test(t)) return 'broke';

  // 超级富豪 / 知名有钱角色（含漫威等既有 IP）
  if (
    /钢铁侠|tony\s*stark|托尼.?斯塔克|蝙蝠侠|bruce\s*wayne|布鲁斯.?韦恩|乐高拉斯|lex\s*luthor|贝佐斯|马斯克|王思聪|霸总|财阀会长|帝国总裁|银河首富|世界首富|万亿|千亿|超级富豪|军火大王|斯塔克工业|韦恩企业/.test(
      t
    ) ||
    /亿万|豪门继承人|顶级富|巨富|身家过亿|继承亿|财团掌门|跨国财阀/.test(t)
  ) {
    return 'ultra_rich';
  }

  if (
    /财阀|豪门|总裁|董事长|富二代|千金|少爷|贵族|皇室|金主|有钱人|富商|企业家|奢|名媛|太子党|财团|阔少|阔小姐|钻石王老五/.test(
      t
    )
  ) {
    return 'rich';
  }
  if (/穷|拮据|清贫|打工|学生党|月光族|低薪|借钱|贫困|省吃俭用|没钱|囊中羞涩/.test(t)) {
    return 'poor';
  }
  if (/小康|中产|白领|稳定收入|公司职员|公务员|教师|医生/.test(t)) return 'mid';
  return 'mid';
}

function isAffectionatePersona(personaText) {
  const t = String(personaText || '');
  return /深情|痴情|专一|奉献|偏爱|占有欲|依赖|守护|爱惨|离不开|付出型|恋爱脑|病娇|忠贞|溺爱|宠/.test(
    t
  );
}

function buildMoneyAmountGuide(workOrText) {
  const text =
    typeof workOrText === 'string' ? workOrText : collectPersonaTextFromWork(workOrText);
  const tier = estimateWealthTier(text);
  const affectionate = isAffectionatePersona(text);
  let guide =
    '\n\n【财力参考】仅在你决定发钱时参考金额；默认仍应 TYPE:none，不要因有钱就发。\n' +
    '红包不得超过 ' +
    RED_PACKET_MAX +
    '；常规认真给钱 ≥ 1 元。\n';

  if (tier === 'ultra_rich') {
    guide +=
      '判定：超级富豪/知名有钱人物（如钢铁侠级）。关系一般也别寒酸；关系不错时转账默认 ≥ 1000。\n' +
      '随手给钱：常用 3000～50000；宠溺/炫耀/包养/救急：5万～20万+ 都合理。\n' +
      '红包仍 ≤ 200（可直接顶格 200）；真正大手笔请用 transfer，严禁只转几十几百（除非明确在玩笑）。\n';
  } else if (tier === 'rich') {
    guide +=
      '判定：富裕/有钱。关系不错时转账尽量 ≥ 1000；日常示好常见 2000～20000。\n' +
      '红包常用 88～200（可达上限）；炫耀或包养语境转账可更大。严禁关系好还只给几十块。\n';
  } else if (tier === 'poor') {
    guide +=
      '判定：清贫/拮据。日常红包/转账常用 1～30（不要只转一分钱）；普通示好转账可到几十～一两百。\n';
    if (affectionate) {
      guide +=
        '人设偏深情：动感情时可用 transfer「倾尽所有」——贴合穷身份、带两位小数的不规则金额（如 86.43、327.18），像把余额清空，禁止 10/50/100 等整齐整数。\n';
    } else {
      guide +=
        '若对话非常动感情（告白、承诺、补偿、和好），也可用 transfer「倾尽所有」：不规则小数金额，像清空余额。\n';
    }
  } else if (tier === 'broke') {
    guide +=
      '判定：几乎没钱。多数 TYPE:none；若要给，认真时至少 1 元；玩笑才可用 0.01～0.99。\n' +
      '深情/动感情时可用「倾尽所有」transfer：小额但有零有整（如 12.87、37.56、68.19），忌整数。\n';
  } else {
    guide +=
      '判定：普通财力。红包常用 6.66～88；转账常用 50～2000。动感情「倾尽所有」可用不规则大额小数。\n';
  }
  return guide;
}

function inferAcceptFromSpeech(speech) {
  const s = String(speech || '');
  if (!s) return null;
  if (
    /退回|退给|拒收|不收|不要钱|用不着|拿回去|收不了|请收回|还是你留|别给我钱|不想收|拒绝/.test(
      s
    )
  ) {
    return false;
  }
  if (
    /收下|接收|收了|拿到|拿着|笑纳|不客气|谢谢你.{0,6}(红包|钱|转)|到手|我就收|那我收下|收下了|收着/.test(
      s
    )
  ) {
    return true;
  }
  return null;
}

function parseMoneyAcceptReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return { accept: true, speech: '' };

  if (text.charAt(0) === '{') {
    try {
      const obj = JSON.parse(text);
      const speech = String(obj.speech || obj.text || obj.reply || '').trim();
      if (obj.accept === true || obj.accept === 1 || obj.accept === '1') {
        return { accept: true, speech: speech || text };
      }
      if (obj.accept === false || obj.accept === 0 || obj.accept === '0') {
        return { accept: false, speech: speech || text };
      }
      if (obj.join === true || obj.join === 1 || obj.join === '1') {
        return { accept: true, speech: speech || text };
      }
      if (obj.join === false || obj.join === 0 || obj.join === '0') {
        return { accept: false, speech: speech || text };
      }
      if (speech) {
        const inferred = inferAcceptFromSpeech(speech);
        return {
          accept: inferred == null ? true : inferred,
          speech: speech
        };
      }
    } catch (_) {}
  }

  let accept = null;
  const acceptMatch = text.match(/ACCEPT\s*[:：]\s*([01])/i);
  if (acceptMatch) {
    accept = acceptMatch[1] === '1';
  } else {
    const firstLine = (text.split(/\n/)[0] || '').trim();
    if (/^(接收|收下|收|接受)$/.test(firstLine)) accept = true;
    if (/^(退回|拒收|拒绝|不收|退)$/.test(firstLine)) accept = false;
  }

  let speech = text;
  const parts = text.split(/\n---\s*\n/);
  if (parts.length >= 2) {
    speech = parts.slice(1).join('\n---\n').trim();
  } else if (acceptMatch) {
    speech = text.replace(/ACCEPT\s*[:：]\s*[01]\s*/i, '').replace(/^---\s*/m, '').trim();
  } else if (/^(接收|收下|收|接受|退回|拒收|拒绝|不收|退)\s*$/m.test(text.split(/\n/)[0] || '')) {
    speech = text
      .split(/\n/)
      .slice(1)
      .join('\n')
      .replace(/^---\s*/m, '')
      .trim();
  }
  speech = speech
    .replace(/^\s*ACCEPT\s*[:：]\s*[01]\s*/i, '')
    .replace(/^---\s*/m, '')
    .trim();
  if (!speech) speech = text.replace(/ACCEPT\s*[:：]\s*[01]/gi, '').trim();

  if (accept == null) {
    const inferred = inferAcceptFromSpeech(speech);
    // 无明确格式时：台词像退回则退，否则默认接收（避免一律显示退回）
    accept = inferred == null ? true : inferred;
  }
  return { accept: !!accept, speech: speech };
}

/**
 * 用户发红包/转账后：更新用户卡片状态，并追加角色台词
 */
function buildMoneyReactResult(ocId, userPayload, rawReply) {
  const parsed = parseMoneyAcceptReply(rawReply);
  const accept = !!parsed.accept;
  let speech = String(parsed.speech || '').trim();
  // 去掉残留标记，避免露馅
  speech = speech
    .replace(/ACCEPT\s*[:：]\s*[01]/gi, '')
    .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
    .replace(/SEND\s*:\s*[^\n]+/gi, '')
    .trim();
  if (!speech) speech = accept ? '……收下了。' : '……还是退给你吧。';
  const base = Object.assign({}, userPayload || {});
  const type = base.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const updatedUserGame = Object.assign({}, base, {
    type: type,
    amount: normalizeMoneyAmount(base.amount, type),
    amountText: formatMoneyAmount(base.amount, type),
    status: accept ? 'accepted' : 'rejected',
    side: 'user'
  });
  return {
    updatedUserGame: updatedUserGame,
    updatedUserContent: formatMoneyContent(updatedUserGame, 'user'),
    messages: [
      {
        role: 'assistant',
        ocId: ocId,
        content: speech
      }
    ]
  };
}

function parseMoneyTypeToken(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!t || t === 'none' || t === '0' || t === 'no' || t === '无') return null;
  if (t === 'transfer' || t === 'zz' || t === '转账') return MONEY_TYPE_TRANSFER;
  if (
    t === 'red_packet' ||
    t === 'redpacket' ||
    t === 'hongbao' ||
    t === 'hb' ||
    t === '红包' ||
    t === 'packet'
  ) {
    return MONEY_TYPE_RED;
  }
  return null;
}

function inferMoneyFromSpeech(speech) {
  // 已关闭「从台词猜红包/转账」：模型聊到钱就误发卡，导致一聊就转账。
  // 仅认 <<<MONEY>>> / SEND: 显式标记。
  return null;
}

/** 平常对话：解析角色是否主动发红包/转账 */
function parseMoneyAwareReply(raw) {
  let text = String(raw || '').trim();
  if (!text) return { speech: '', money: null };

  let money = null;

  const sendLine = text.match(/SEND\s*:\s*([^\n\r]+)/i);
  if (sendLine) {
    const payload = String(sendLine[1] || '').trim();
    text = (text.slice(0, sendLine.index) + text.slice(sendLine.index + sendLine[0].length)).trim();
    if (!/^none$/i.test(payload)) {
      const parts = payload.split(':');
      const type = parseMoneyTypeToken(parts[0]);
      if (type) {
        money = {
          type: type,
          amount: normalizeMoneyAmount(parts[1] != null ? parts[1] : 8.88, type)
        };
      }
    }
  }

  const block = text.match(/<<<MONEY\s*([\s\S]*?)>>>/i);
  if (block) {
    const body = block[1] || '';
    text = (text.slice(0, block.index) + text.slice(block.index + block[0].length)).trim();
    if (!money) {
      const typeMatch = body.match(/TYPE\s*[:：]\s*([^\s\n]+)/i);
      const amountMatch = body.match(/AMOUNT\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);
      const type = parseMoneyTypeToken(typeMatch && typeMatch[1]);
      if (type) {
        money = {
          type: type,
          amount: normalizeMoneyAmount(amountMatch && amountMatch[1], type)
        };
      }
    }
  } else if (!money && text.charAt(0) === '{') {
    try {
      const obj = JSON.parse(text);
      const speech = String(obj.speech || obj.text || obj.reply || '').trim();
      const type = parseMoneyTypeToken(obj.moneyType || obj.type || obj.action);
      if (speech) text = speech;
      if (type) {
        money = {
          type: type,
          amount: normalizeMoneyAmount(obj.amount || obj.money || 1, type)
        };
      }
    } catch (_) {}
  }

  text = text
    .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
    .replace(/SEND\s*:\s*[^\n\r]+/gi, '')
    .replace(/^---\s*/m, '')
    .trim();

  if (!money) {
    money = inferMoneyFromSpeech(text);
  }

  return { speech: text, money: money };
}

function sanitizeMoneySpeech(speech, money) {
  let s = String(speech || '');
  if (!s) return '';
  s = s
    .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
    .replace(/SEND\s*:\s*[^\n\r]+/gi, '')
    .replace(/ACCEPT\s*[:：]\s*[01]/gi, '')
    // 去掉系统通知式整句
    .replace(/\[[^\]]*红包[^\]]*\][^\n]*/g, '')
    .replace(/\[[^\]]*转账[^\]]*\][^\n]*/g, '')
    .replace(/[¥￥]?\s*\d+(?:\.\d+)?\s*元\s*已发送/g, '')
    .replace(/\d+(?:\.\d+)?\s*元已发送/g, '')
    .replace(/已发送/g, '');

  // 角色主动发包时：去掉「当成用户转给我」的颠倒说法
  if (money) {
    s = s
      .replace(/谢谢你(给我)?(转的|转账|发的红包|的红包|打的钱)/g, '')
      .replace(/收到了你的(转账|红包)/g, '')
      .replace(/你怎么转(了)?这么多/g, '')
      .replace(/你(居然|竟然)?给我转/g, '我给你转')
      .replace(/你给我(转账|发红包|转了)/g, '我给你$1');
  }

  // 有红包卡片时，台词里不要漏金额
  if (money && money.type === MONEY_TYPE_RED) {
    s = s
      .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, '')
      .replace(/\d+(?:\.\d+)?\s*元/g, '')
      .replace(/\d+(?:\.\d+)?\s*块/g, '')
      .replace(/6\.66|8\.88|66\.66|88\.88/g, '');
  }

  s = s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[，,。！!？?\s]+$/g, '')
    .trim();
  // 清理后若只剩祝福套话且已有红包卡，可保留短祝福；若几乎为空则不返回
  if (!s || /^[…\.\-—~～]+$/.test(s)) return '';
  return s;
}

function buildMoneyAwareAssistantMessages(ocId, rawReply, options) {
  const opts = options || {};
  const parsed = parseMoneyAwareReply(rawReply);
  const out = [];
  let speech = sanitizeMoneySpeech(parsed.speech, parsed.money);
  if (speech) {
    out.push({
      role: 'assistant',
      ocId: ocId,
      content: speech
    });
  }
  let money = parsed.money;
  const allow = shouldAllowProactiveMoney(opts.userMessage, opts.recentMessages);
  if (money && !allow) money = null;
  // 近几条助手已发过红包/转账则本轮强制不发卡
  if (money && Array.isArray(opts.recentMessages)) {
    const recent = opts.recentMessages.slice(-12);
    const hasRecentMoney = recent.some(
      (m) =>
        m &&
        m.role === 'assistant' &&
        m.kind === KIND_MONEY &&
        m.game &&
        (m.game.type === MONEY_TYPE_RED || m.game.type === MONEY_TYPE_TRANSFER)
    );
    if (hasRecentMoney) money = null;
  }
  if (money) {
    const built = createMoneySend(money.type, money.amount, 'oc');
    out.push(Object.assign({ role: 'assistant', ocId: ocId }, built));
  }
  if (!out.length) {
    const fallback = sanitizeMoneySpeech(String(rawReply || '').trim(), null);
    out.push({
      role: 'assistant',
      ocId: ocId,
      content: fallback || '……'
    });
  }
  return out;
}

function withMoneyReplyRules(systemPrompt) {
  // 完整收红包规则由云函数 moneyMode 附加，避免 callFunction 体积超限
  return String(systemPrompt || '');
}

function withMoneyProactiveRules(systemPrompt, workOrText, options) {
  const opts = options || {};
  const base = String(systemPrompt || '');
  // 未命中白名单时明确禁止，避免只靠云函数规则仍被模型乱发
  if (opts.allowProactiveMoney === false) {
    return (
      base +
      '\n\n【本轮禁止发红包/转账】用户未提钱、也未哭穷卖惨。必须普通聊天；禁止 <<<MONEY>>> / SEND: 发钱标记。\n'
    );
  }
  return base + buildMoneyAmountGuide(workOrText);
}

function resolveOcMoneyMessage(msg, action) {
  if (!isMoneyMessage(msg) || msg.role !== 'assistant') return null;
  const game = Object.assign({}, msg.game || {});
  if (game.status !== 'sent' && game.status !== 'waiting') return null;
  if (action === 'reject') {
    game.status = 'rejected';
  } else if (action === 'claim' || action === 'accept') {
    game.status =
      game.type === MONEY_TYPE_TRANSFER ? 'accepted' : 'claimed';
  } else {
    return null;
  }
  game.side = 'oc';
  game.amountText = formatMoneyAmount(game.amount, game.type);
  return {
    kind: KIND_MONEY,
    game: game,
    content: formatMoneyContent(game, 'oc')
  };
}

function claimOcMoneyMessage(msg) {
  return resolveOcMoneyMessage(msg, 'claim');
}

function rejectOcMoneyMessage(msg) {
  return resolveOcMoneyMessage(msg, 'reject');
}

module.exports = {
  KIND_DICE,
  KIND_MONEY,
  MONEY_TYPE_RED,
  MONEY_TYPE_TRANSFER,
  MONEY_PRESETS,
  MONEY_PRESETS_RED,
  MONEY_PRESETS_TRANSFER,
  RED_PACKET_MAX,
  DEFAULT_DICE_FACES,
  rollDie,
  createDiceRoll,
  formatDiceContent,
  compareLabel,
  isDiceMessage,
  toAiHistoryMessage,
  buildDiceDecideUserMessage,
  buildDiceReactUserMessage: buildDiceDecideUserMessage,
  parseDiceAiReply,
  buildOcDiceMessage,
  buildDiceAssistantMessages,
  normalizeMoneyAmount,
  formatMoneyAmount,
  moneyTypeLabel,
  formatMoneyContent,
  formatMoneyForAiHistory,
  createMoneySend,
  isMoneyMessage,
  buildMoneyDecideUserMessage,
  parseMoneyAcceptReply,
  buildMoneyReactResult,
  parseMoneyAwareReply,
  buildMoneyAwareAssistantMessages,
  claimOcMoneyMessage,
  rejectOcMoneyMessage,
  resolveOcMoneyMessage,
  sanitizeMoneySpeech,
  MONEY_REPLY_RULES,
  MONEY_PROACTIVE_RULES,
  shouldAllowProactiveMoney,
  withMoneyReplyRules,
  withMoneyProactiveRules,
  buildMoneyAmountGuide,
  estimateWealthTier,
  isAffectionatePersona,
  collectPersonaTextFromWork
};
