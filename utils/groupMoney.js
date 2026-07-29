/**
 * 群聊红包 / 转账
 * 模式：normal=普通（人均相同）、lucky=拼手气、targeted=指定对象
 */
const {
  KIND_MONEY,
  MONEY_TYPE_RED,
  MONEY_TYPE_TRANSFER,
  normalizeMoneyAmount,
  formatMoneyAmount,
  createMoneySend,
  parseMoneyAcceptReply,
  sanitizeMoneySpeech,
  withMoneyReplyRules,
  buildMoneyAmountGuide
} = require('./chatGames.js');

const MONEY_MODE_NORMAL = 'normal';
const MONEY_MODE_LUCKY = 'lucky';
const MONEY_MODE_TARGETED = 'targeted';

function modeLabel(mode) {
  if (mode === MONEY_MODE_LUCKY) return '拼手气';
  if (mode === MONEY_MODE_TARGETED) return '指定';
  return '普通';
}

function allocateEqualShares(total, n) {
  const count = Math.max(1, Math.floor(Number(n) || 1));
  const totalCents = Math.max(count, Math.round(normalizeMoneyAmount(total, MONEY_TYPE_RED) * 100));
  const base = Math.floor(totalCents / count);
  let rem = totalCents - base * count;
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    out.push(Math.max(1, c) / 100);
  }
  return out;
}

function allocateLuckyShares(total, n) {
  const count = Math.max(1, Math.floor(Number(n) || 1));
  let remain = Math.max(count, Math.round(normalizeMoneyAmount(total, MONEY_TYPE_RED) * 100));
  const shares = [];
  for (let i = 0; i < count - 1; i++) {
    const left = count - i;
    const avg = remain / left;
    const maxTake = Math.max(1, remain - (left - 1));
    let take = Math.floor(Math.random() * (avg * 2)) + 1;
    if (take < 1) take = 1;
    if (take > maxTake) take = maxTake;
    shares.push(take);
    remain -= take;
  }
  shares.push(Math.max(1, remain));
  for (let i = shares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shares[i];
    shares[i] = shares[j];
    shares[j] = tmp;
  }
  return shares.map((c) => c / 100);
}

function resolveTargetIds(members, targetIds, mode) {
  const all = (members || []).filter((m) => m && m.id).map((m) => m.id);
  // 普通 / 拼手气：始终全员，不允许指定子集
  if (mode === MONEY_MODE_NORMAL || mode === MONEY_MODE_LUCKY) {
    return all.slice();
  }
  const picked = (targetIds || []).filter((id) => all.indexOf(id) >= 0);
  return picked.length ? picked : all.slice(0, 1);
}

function formatGroupMoneyContent(game) {
  const g = game || {};
  const type = g.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const from = g.fromName || (g.side === 'user' ? '你' : '对方');
  if (type === MONEY_TYPE_TRANSFER) {
    const to = g.targetNames && g.targetNames[0] ? g.targetNames[0] : '某人';
    return (
      '[转账] ' +
      from +
      ' → ' +
      to +
      ' ' +
      formatMoneyAmount(g.amount, type) +
      ' 元'
    );
  }
  const ml = modeLabel(g.mode);
  const n = (g.targetIds || []).length || 1;
  return (
    '[红包·' +
    ml +
    '] ' +
    from +
    '发了 ' +
    formatMoneyAmount(g.amount, type) +
    ' 元（' +
    n +
    '人）'
  );
}

/**
 * @param {object} opts
 * @param {'red_packet'|'transfer'} opts.type
 * @param {'normal'|'lucky'|'targeted'} [opts.mode]
 * @param {number} opts.amount 总额（红包）或转账金额
 * @param {'user'|'oc'} opts.side
 * @param {string} [opts.fromId]
 * @param {string} [opts.fromName]
 * @param {string[]} [opts.targetIds] OC id 列表；转账仅取第一个
 * @param {object[]} opts.members
 */
function createGroupMoneySend(opts) {
  const o = opts || {};
  const type = o.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const side = o.side === 'oc' ? 'oc' : 'user';
  let mode = o.mode || MONEY_MODE_NORMAL;
  if (type === MONEY_TYPE_TRANSFER) mode = MONEY_MODE_TARGETED;

  const members = o.members || [];
  let targetIds =
    type === MONEY_TYPE_TRANSFER
      ? resolveTargetIds(members, (o.targetIds || []).slice(0, 1), MONEY_MODE_TARGETED)
      : resolveTargetIds(members, o.targetIds, mode);

  if (!targetIds.length && members.length) {
    targetIds = [members[0].id];
  }

  const total =
    type === MONEY_TYPE_TRANSFER
      ? normalizeMoneyAmount(o.amount, type)
      : normalizeMoneyAmount(o.amount, MONEY_TYPE_RED);

  const nameMap = {};
  members.forEach((m) => {
    if (m && m.id) nameMap[m.id] = m.name || m.id;
  });
  const targetNames = targetIds.map((id) => nameMap[id] || id);

  let shares;
  if (type === MONEY_TYPE_TRANSFER) {
    shares = [total];
  } else if (mode === MONEY_MODE_LUCKY) {
    shares = allocateLuckyShares(total, targetIds.length);
  } else {
    shares = allocateEqualShares(total, targetIds.length);
  }

  const claims = {};
  targetIds.forEach((id, i) => {
    const amt = normalizeMoneyAmount(shares[i] != null ? shares[i] : total / targetIds.length, type);
    claims[id] = {
      status: 'pending',
      amount: amt,
      amountText: formatMoneyAmount(amt, type),
      name: nameMap[id] || id
    };
  });

  const game = {
    type: type,
    mode: mode,
    amount: total,
    amountText: formatMoneyAmount(total, type),
    status: 'waiting',
    side: side,
    fromId: o.fromId || (side === 'user' ? 'user' : ''),
    fromName: o.fromName || (side === 'user' ? '我' : ''),
    targetIds: targetIds,
    targetNames: targetNames,
    claims: claims,
    blessing: type === MONEY_TYPE_RED ? '恭喜发财，大吉大利' : '',
    channel: 'group'
  };

  return {
    kind: KIND_MONEY,
    game: game,
    content: formatGroupMoneyContent(game)
  };
}

function buildGroupMoneyDecideUserMessage(game, member) {
  const g = game || {};
  const mem = member || {};
  const claim = (g.claims && g.claims[mem.id]) || {};
  const type = g.type === MONEY_TYPE_TRANSFER ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  const label = type === MONEY_TYPE_TRANSFER ? '转账' : '红包';
  const mode = modeLabel(g.mode);
  const share = formatMoneyAmount(claim.amount != null ? claim.amount : g.amount, type);
  const from = g.fromName || '用户';
  return (
    '[群聊' +
    label +
    (type === MONEY_TYPE_RED ? '·' + mode : '') +
    '] ' +
    from +
    '在群里向你' +
    (type === MONEY_TYPE_TRANSFER ? '转账' : '发了红包，若你领取则可得') +
    ' ' +
    share +
    ' 元（虚拟玩法）。请严格按你的人设与当前群聊语境决定接收或退回，不要跟风其它成员。按格式回复。'
  );
}

/**
 * 某成员对用户群红包/转账的反应：更新 claims，追加台词
 */
function applyGroupMoneyMemberReact(userMoneyMsg, member, rawReply) {
  const parsed = parseMoneyAcceptReply(rawReply);
  const accept = !!parsed.accept;
  let speech = String(parsed.speech || '').trim();
  speech = speech
    .replace(/ACCEPT\s*[:：]\s*[01]/gi, '')
    .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
    .replace(/SEND\s*:\s*[^\n]+/gi, '')
    .trim();
  if (!speech) speech = accept ? '……收下了。' : '……就不收了。';

  const game = Object.assign({}, (userMoneyMsg && userMoneyMsg.game) || {});
  const claims = Object.assign({}, game.claims || {});
  const ocId = member && member.id;
  const prev = Object.assign({}, claims[ocId] || {});
  prev.status = accept ? (game.type === MONEY_TYPE_TRANSFER ? 'accepted' : 'claimed') : 'rejected';
  claims[ocId] = prev;

  const pending = Object.keys(claims).filter((id) => claims[id] && claims[id].status === 'pending');
  let status = game.status || 'waiting';
  if (!pending.length) {
    const anyOk = Object.keys(claims).some((id) => {
      const s = claims[id] && claims[id].status;
      return s === 'accepted' || s === 'claimed';
    });
    status = anyOk ? 'accepted' : 'rejected';
  }

  const updatedGame = Object.assign({}, game, { claims: claims, status: status });
  return {
    updatedGame: updatedGame,
    updatedContent: formatGroupMoneyContent(updatedGame),
    speech: speech,
    accept: accept
  };
}

const GROUP_MONEY_PROACTIVE_RULES =
  '\n\n【群聊·虚拟红包/转账】可按人设与语境独立决定是否发红包/转账（非真实支付）。\n' +
  '禁止跟风：其它成员发了，你不必发；可不愿意发、装没看见、或只口头回应。\n' +
  '若要发，台词后追加且只追加一次：\n' +
  '<<<MONEY\nTYPE:none|red_packet|transfer\nMODE:normal|lucky|targeted\nTO:user|成员名或id|all\nAMOUNT:数字\n>>>\n' +
  '说明：\n' +
  '- TYPE:none 表示不发\n' +
  '- red_packet：MODE=normal 普通人均相同；lucky 拼手气；targeted 指定 TO 中的对象\n' +
  '- transfer：转账，TO 必须是单个（user 或某一成员），AMOUNT 为转账额\n' +
  '- TO 可以是 user、其它群成员（不一定是用户）、或 all（仅红包群发）\n' +
  '- 红包总额 ≤ 200；转账不限；金额贴合人设财力\n' +
  '- 方向：TYPE 非 none 时是【你→TO】给你发钱；台词用「我转给你/给你红包」；严禁说成对方转给你\n' +
  '- 台词禁止「X元已发送」「[红包]」系统式通知；红包台词勿报金额\n';

function withGroupMoneyProactiveRules(systemPrompt, work) {
  // 群聊红包格式与单聊不同，须客户端带上；财力参考保留，体积由 cloudChatPayload 再压
  return (
    String(systemPrompt || '') +
    GROUP_MONEY_PROACTIVE_RULES +
    buildMoneyAmountGuide(work)
  );
}

function withGroupMoneyReplyRules(systemPrompt) {
  return withMoneyReplyRules(systemPrompt);
}

function parseGroupMoneyToToken(raw, members) {
  const t = String(raw || '').trim();
  if (!t || /^none$/i.test(t)) return [];
  if (/^user$/i.test(t) || t === '用户' || t === '我') return ['user'];
  if (/^all$/i.test(t) || t === '全员' || t === '大家') {
    return (members || []).map((m) => m.id);
  }
  const hit = (members || []).find(
    (m) => m.id === t || m.name === t || (m.name && t.indexOf(m.name) >= 0)
  );
  if (hit) return [hit.id];
  return [];
}

function parseGroupMoneyAwareReply(raw, members, selfMember) {
  let text = String(raw || '').trim();
  if (!text) return { speech: '', money: null };

  let blockBody = '';
  const block = text.match(/<<<MONEY\s*([\s\S]*?)>>>/i);
  if (block) {
    blockBody = block[1] || '';
    text = (text.slice(0, block.index) + text.slice(block.index + block[0].length)).trim();
  }

  const typeMatch = blockBody.match(/TYPE\s*[:：]\s*([^\s\n]+)/i);
  const modeMatch = blockBody.match(/MODE\s*[:：]\s*([^\s\n]+)/i);
  const toMatch = blockBody.match(/TO\s*[:：]\s*([^\n]+)/i);
  const amountMatch = blockBody.match(/AMOUNT\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/i);

  let typeTok = typeMatch && typeMatch[1];
  if (!typeTok || /^none$/i.test(typeTok) || typeTok === '无') {
    text = text
      .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
      .replace(/SEND\s*:\s*[^\n\r]+/gi, '')
      .trim();
    text = sanitizeMoneySpeech(text, null);
    return { speech: text, money: null };
  }

  const isTransfer = /transfer|转账/i.test(typeTok);
  const type = isTransfer ? MONEY_TYPE_TRANSFER : MONEY_TYPE_RED;
  let mode = MONEY_MODE_NORMAL;
  const modeTok = (modeMatch && modeMatch[1]) || '';
  if (/lucky|拼手气/i.test(modeTok)) mode = MONEY_MODE_LUCKY;
  else if (/targeted|指定/i.test(modeTok)) mode = MONEY_MODE_TARGETED;
  if (isTransfer) mode = MONEY_MODE_TARGETED;

  let targets = parseGroupMoneyToToken(toMatch && toMatch[1], members);
  if (!targets.length) {
    targets = isTransfer ? ['user'] : (members || []).map((m) => m.id).filter((id) => id !== (selfMember && selfMember.id));
    if (!isTransfer && !targets.length) targets = ['user'];
  }
  // 红包 TO:all 含其他人；排除自己
  if (!isTransfer) {
    targets = targets.filter((id) => id !== (selfMember && selfMember.id));
  }
  // 目前领取回路以 OC 为主；发给 user 的卡单独处理
  const ocTargets = targets.filter((id) => id !== 'user');
  const includeUser = targets.indexOf('user') >= 0;

  const amount = normalizeMoneyAmount(amountMatch && amountMatch[1], type);

  text = text
    .replace(/<<<MONEY[\s\S]*?>>>/gi, '')
    .replace(/SEND\s*:\s*[^\n\r]+/gi, '')
    .trim();
  text = sanitizeMoneySpeech(text, { type: type });

  return {
    speech: text,
    money: {
      type: type,
      mode: mode,
      amount: amount,
      ocTargets: ocTargets,
      includeUser: includeUser
    }
  };
}

/**
 * 将 OC 主动发包解析为消息列表（台词 + 卡片）
 * 发给 user：一张待领取卡；发给其它 OC：一张卡（记录 targets），其它 OC 不强制接话
 */
function buildGroupMoneyAwareMessages(selfMember, members, rawReply) {
  const parsed = parseGroupMoneyAwareReply(rawReply, members, selfMember);
  const out = [];
  if (parsed.speech) {
    out.push({
      role: 'assistant',
      ocId: selfMember.id,
      name: selfMember.name,
      content: parsed.speech
    });
  }
  if (!parsed.money) {
    if (!out.length) {
      out.push({
        role: 'assistant',
        ocId: selfMember.id,
        name: selfMember.name,
        content: String(rawReply || '').trim() || '……'
      });
    }
    return out;
  }

  const m = parsed.money;
  // 发给用户：用户可领取/退回
  if (m.includeUser) {
    const built = createMoneySend(m.type, m.amount, 'oc');
    built.game = Object.assign({}, built.game, {
      channel: 'group',
      mode: m.type === MONEY_TYPE_TRANSFER ? MONEY_MODE_TARGETED : m.mode,
      fromId: selfMember.id,
      fromName: selfMember.name,
      targetIds: ['user'],
      targetNames: ['我']
    });
    built.content = formatGroupMoneyContent(built.game);
    out.push(
      Object.assign({ role: 'assistant', ocId: selfMember.id, name: selfMember.name }, built)
    );
  }

  // 发给其它成员：展示卡；claims 记 pending（剧情用，不强制 AI 二次接）
  if (m.ocTargets && m.ocTargets.length) {
    const built = createGroupMoneySend({
      type: m.type,
      mode: m.mode,
      amount: m.amount,
      side: 'oc',
      fromId: selfMember.id,
      fromName: selfMember.name,
      targetIds: m.ocTargets,
      members: members
    });
    // OC 发出的给其它 OC：status sent 表示已发出
    built.game.status = 'sent';
    out.push(
      Object.assign({ role: 'assistant', ocId: selfMember.id, name: selfMember.name }, built)
    );
  }

  if (!out.length) {
    out.push({
      role: 'assistant',
      ocId: selfMember.id,
      name: selfMember.name,
      content: parsed.speech || '……'
    });
  }
  return out;
}

function moneyHistoryLine(msg) {
  if (!msg) return '';
  if (msg.kind === KIND_MONEY || (msg.game && msg.game.type)) {
    return msg.content || formatGroupMoneyContent(msg.game);
  }
  return String(msg.content || '');
}

module.exports = {
  MONEY_MODE_NORMAL,
  MONEY_MODE_LUCKY,
  MONEY_MODE_TARGETED,
  modeLabel,
  allocateEqualShares,
  allocateLuckyShares,
  createGroupMoneySend,
  formatGroupMoneyContent,
  buildGroupMoneyDecideUserMessage,
  applyGroupMoneyMemberReact,
  withGroupMoneyProactiveRules,
  withGroupMoneyReplyRules,
  parseGroupMoneyAwareReply,
  buildGroupMoneyAwareMessages,
  moneyHistoryLine,
  GROUP_MONEY_PROACTIVE_RULES
};
