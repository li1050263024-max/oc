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

/** 客户端/云端共用：平常对话主动发包 */
const MONEY_PROACTIVE_RULES =
  '\n\n【虚拟红包/转账·主动】这是角色扮演，可主动给对方发虚拟红包或转账（非真实支付）。\n' +
  '请先写角色台词，再在末尾追加且只追加一次：\n' +
  '<<<MONEY\nTYPE:none|red_packet|transfer\nAMOUNT:数字\n>>>\n' +
  '或等价一行：SEND:none / SEND:red_packet:金额 / SEND:transfer:金额\n' +
  '选择依据（必须结合人设、对话气氛与本条内容）：\n' +
  '- 想讨好、哄人、道歉补偿、过节祝福、炫耀财力、照顾对方、撒娇塞钱、关系升温 → 用 red_packet 或 transfer\n' +
  '- 人设抠门、清高、疏远、正在吵架且不愿示好 → TYPE:none\n' +
  '金额规则（强制）：\n' +
  '- 常规下限：认真转账/红包默认 ≥ 1 元；即使人设很穷，也不要只转 0.01（太敷衍）\n' +
  '- 玩笑例外：仅在逗对方、调侃、赌气玩笑时，才可用 1 元以下甚至 0.01\n' +
  '- 硬性上限：红包 AMOUNT ≤ 200；转账不设上限\n' +
  '- 按人设财力：有钱就大方，清贫就小额但仍真诚（见【财力参考】）\n' +
  '- 富豪/知名有钱角色（如钢铁侠、霸总、财阀等）：关系不错时转账尽量 ≥ 1000，随手给钱常见几千～十几万，严禁寒酸到几十几百（除非故意玩笑）\n' +
  '- 「倾尽所有」例外：人设虽穷但深情，或与用户聊到很动感情/告白/承诺/补偿时，可用 transfer 转一笔贴合身份、却像清空余额的金额\n' +
  '  · 这种金额必须「有零有整」、忌整数整十整百（禁止 10/50/100/200/520 等好看整数）\n' +
  '  · 示例风格：86.43、327.18、1586.72、2037.55（像账户里剩多少转多少）\n' +
  '  · 穷学生倾尽所有可在几十～几百带小数；打工族可到一千多带小数；勿写成富翁级\n' +
  '不要每条都发；但当语境明显适合给钱时，应当主动发，不要总是 none。\n' +
  '方向规则（最高优先级，严禁搞反）：\n' +
  '- TYPE:red_packet/transfer 表示【你（角色）→用户】给你发钱；台词必须是「我转给你 / 给你红包 / 收下」口吻\n' +
  '- 严禁把本条说成用户转给你：禁止「谢谢你转给我」「你怎么转这么多」「收到了你的转账」等\n' +
  '- 只有上文明确是「用户向你发了红包/转账」时，才可以谢用户给钱\n' +
  '台词规则（重要）：\n' +
  '- 禁止写系统通知式文案，例如「[红包]」「[转账]」「X元已发送」「已发送」\n' +
  '- 发红包时台词里禁止出现具体金额（金额只写在标记里，领取前对方看不到）\n' +
  '- 转账台词可以说「转给你一点」「把我剩下的都给你」，尽量少报具体数字；数字只放在标记里\n' +
  '- 不要解释标记。';

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
    '\n\n【财力参考·强制】根据人设财力选金额；红包不得超过 ' +
    RED_PACKET_MAX +
    '；转账不设上限。\n' +
    '常规认真转账/红包 ≥ 1 元；仅玩笑/逗对方才可用 1 元以下。\n';

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
  const s = String(speech || '');
  if (!s) return null;
  // 明确不发
  if (/不[会能]?(发红包|转账)|没钱|下次|算了/.test(s) && !/(给你|给你转|发个红包|红包拿|转你)/.test(s)) {
    return null;
  }
  let type = null;
  if (/转账|转你|转给|打给你|打了|转了/.test(s)) type = MONEY_TYPE_TRANSFER;
  if (/红包|塞你|塞给|压岁|心意/.test(s)) type = type || MONEY_TYPE_RED;
  if (!type) return null;
  let amount = null;
  const m1 = s.match(
    /(?:红包|转账|转了|转你|给你|打了|打给你)?\s*[¥￥]?\s*([0-9]+(?:\.[0-9]+)?)\s*元?/
  );
  const m2 = s.match(/([0-9]+(?:\.[0-9]+)?)\s*块/);
  if (m1) amount = m1[1];
  else if (m2) amount = m2[1];
  else if (/6\.66|666/.test(s)) amount = 6.66;
  else if (/8\.88|888/.test(s)) amount = 8.88;
  else if (/520/.test(s)) amount = 520;
  else amount = type === MONEY_TYPE_TRANSFER ? 50 : 8.88;
  return { type: type, amount: normalizeMoneyAmount(amount, type) };
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

function buildMoneyAwareAssistantMessages(ocId, rawReply) {
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
  if (parsed.money) {
    const built = createMoneySend(parsed.money.type, parsed.money.amount, 'oc');
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

function withMoneyProactiveRules(systemPrompt, workOrText) {
  // 完整主动发红包规则由云函数 moneyAware 附加；客户端只传财力参考
  return String(systemPrompt || '') + buildMoneyAmountGuide(workOrText);
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
  withMoneyReplyRules,
  withMoneyProactiveRules,
  buildMoneyAmountGuide,
  estimateWealthTier,
  isAffectionatePersona,
  collectPersonaTextFromWork
};
