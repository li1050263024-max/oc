const { buildGroupPickSpeakerPrompt, buildGroupMemberReplyPrompt } = require('./ocContext.js');
const { isBreakCharacterAttempt } = require('./chatGuard.js');
const { callCloudFunction } = require('./cloudInit.js');
const { buildQuotaSyncPayload } = require('./aiChatQuota.js');

function roomIdFromMemberIds(ids) {
  return (ids || [])
    .slice()
    .sort()
    .join('|');
}

function formatGroupLines(messages, limit) {
  const recent = (messages || []).slice(-(limit || 12));
  return recent
    .map((m) => {
      if (!m) return '';
      const line =
        m.kind === 'game_money' || (m.game && m.game.type)
          ? m.content || '[红包/转账]'
          : m.content;
      if (!line) return '';
      if (m.role === 'user') return '用户：' + line;
      return (m.name || '角色') + '：' + line;
    })
    .filter(Boolean)
    .join('\n');
}

function parseSpeakerIds(raw, members) {
  const ids = [];
  const text = String(raw || '').trim();
  if (!text) return ids;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : JSON.parse(text);
    const arr = j && j.ids;
    if (Array.isArray(arr)) {
      arr.forEach((id) => {
        const sid = String(id || '').trim();
        if (sid && members.some((x) => x.id === sid) && ids.indexOf(sid) < 0) {
          ids.push(sid);
        }
      });
    }
  } catch (e) {
    (members || []).forEach((mem) => {
      if (text.indexOf(mem.name) >= 0 && ids.indexOf(mem.id) < 0) {
        ids.push(mem.id);
      }
    });
  }
  return ids.slice(0, 2);
}

function uniqueSpeakerIds(ids, members) {
  const out = [];
  (ids || []).forEach((id) => {
    const sid = String(id || '').trim();
    if (!sid) return;
    if (out.indexOf(sid) >= 0) return;
    if (!members.some((m) => m.id === sid)) return;
    out.push(sid);
  });
  return out;
}

let _lastSpeakerIdx = 0;

/** 每个对话窗口内，用户前 N 条消息全员接话 */
const WARMUP_USER_MESSAGES = 3;

function countUserMessages(messages) {
  return (messages || []).filter((m) => m && m.role === 'user').length;
}

function allReplyMemberIds(members) {
  return (members || [])
    .filter((m) => m && m.id && m.work)
    .map((m) => m.id);
}

function fallbackSpeakerIds(members, userMessage) {
  if (!members || !members.length) return [];
  const text = String(userMessage || '');
  for (let i = 0; i < members.length; i++) {
    if (members[i].name && text.indexOf(members[i].name) >= 0) {
      return [members[i].id];
    }
  }
  _lastSpeakerIdx = (_lastSpeakerIdx + 1) % members.length;
  return [members[_lastSpeakerIdx].id];
}

/** 消息里 @ 到的成员（按名字匹配） */
function membersMentionedInText(members, userMessage) {
  const text = String(userMessage || '');
  return (members || []).filter((m) => m.name && text.indexOf(m.name) >= 0);
}

/**
 * 补足接话人数：3 人及以上群默认至少 2 人接话；用户只点名一人时仅该人回
 */
function ensureSpeakerCount(members, ids, userMessage, minCount) {
  const picked = uniqueSpeakerIds(ids, members);
  const mentioned = membersMentionedInText(members, userMessage);
  if (mentioned.length === 1) {
    return uniqueSpeakerIds([mentioned[0].id], members);
  }
  if (mentioned.length >= 2) {
    return uniqueSpeakerIds(
      mentioned.map((m) => m.id),
      members
    ).slice(0, 2);
  }
  const target = Math.min(Math.max(minCount, 1), members.length, 2);
  if (picked.length >= target) return picked.slice(0, 2);
  const out = picked.slice();
  let pool = members.filter((m) => out.indexOf(m.id) < 0);
  while (out.length < target && pool.length) {
    const more = fallbackSpeakerIds(pool, userMessage);
    if (!more.length) break;
    const id = more[0];
    if (out.indexOf(id) < 0) out.push(id);
    pool = pool.filter((m) => m.id !== id);
  }
  return out.slice(0, 2);
}

function finalizeSpeakers(members, ids, userMessage) {
  const min = members.length >= 3 ? 2 : 1;
  return ensureSpeakerCount(members, ids, userMessage, min);
}

function pickGroupSpeakers(members, userMessage, messages) {
  if (!members || members.length < 2) {
    return Promise.resolve(members && members[0] ? [members[0].id] : []);
  }

  const userTurn = countUserMessages(messages);
  if (userTurn <= WARMUP_USER_MESSAGES) {
    const allIds = allReplyMemberIds(members);
    if (allIds.length) return Promise.resolve(allIds);
  }

  if (members.length === 2) {
    return Promise.resolve(
      finalizeSpeakers(
        members,
        fallbackSpeakerIds(members, userMessage),
        userMessage
      )
    );
  }

  const systemPrompt = buildGroupPickSpeakerPrompt(
    members,
    formatGroupLines(messages, 12)
  );
  return callCloudFunction({
      name: 'ocChat',
      data: {
        systemPrompt,
        userMessage: String(userMessage || '…').slice(0, 800),
        history: [],
        skipQuota: true
      },
      timeout: 35000
    })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) {
        return finalizeSpeakers(
          members,
          fallbackSpeakerIds(members, userMessage),
          userMessage
        );
      }
      const picked = uniqueSpeakerIds(
        parseSpeakerIds(r.reply, members),
        members
      );
      const base = picked.length
        ? picked
        : fallbackSpeakerIds(members, userMessage);
      return finalizeSpeakers(members, base, userMessage);
    })
    .catch(() =>
      finalizeSpeakers(
        members,
        fallbackSpeakerIds(members, userMessage),
        userMessage
      )
    );
}

function buildMemberHistory(messages, ocId, limit) {
  const h = [];
  const cap = Math.max(4, limit || 10);
  (messages || []).slice(-cap).forEach((m) => {
    if (!m) return;
    if (m.kind === 'game_money' || (m.game && m.game.type)) {
      const g = m.game || {};
      const typeLabel = g.type === 'transfer' ? '转账' : '红包';
      const amt = g.amountText != null ? g.amountText : g.amount;
      const fromOc = g.side === 'oc' || (m.role === 'assistant' && g.side !== 'user');
      const fromName = fromOc
        ? m.name || '角色'
        : m.role === 'user'
          ? '用户'
          : m.name || '成员';
      const toHint = fromOc ? '向用户' : '向群内';
      const line =
        '[系统·金钱] ' +
        fromName +
        toHint +
        '发出了' +
        typeLabel +
        ' ' +
        amt +
        ' 元' +
        (fromOc && m.ocId === ocId
          ? '（这是你发的，不要说成用户发给你）'
          : fromOc
            ? '（其他角色发的）'
            : '（用户发的）');
      if (m.role === 'user' || (!fromOc && m.role !== 'assistant')) {
        h.push({ role: 'user', content: line });
      } else if (m.ocId === ocId) {
        h.push({ role: 'assistant', content: line });
      } else {
        h.push({ role: 'user', content: line });
      }
      return;
    }
    const line = m.content;
    if (!line) return;
    const short = String(line).slice(0, 400);
    if (m.role === 'user') {
      h.push({ role: 'user', content: '（群聊）用户：' + short });
    } else if (m.ocId === ocId) {
      h.push({ role: 'assistant', content: short });
    } else {
      h.push({
        role: 'user',
        content: '（' + (m.name || '角色') + '）' + short
      });
    }
  });
  return h.slice(-12);
}

function callMemberReply(member, members, userMessage, messages, scenario, options) {
  const opts = options || {};
  const others = members
    .filter((x) => x.id !== member.id)
    .map((x) => x.name)
    .join('、');
  const um = String(
    opts.decideUserMessage != null ? opts.decideUserMessage : userMessage || ''
  ).slice(0, 800);
  const breakCharacterAttempt = opts.moneyMode
    ? false
    : isBreakCharacterAttempt(String(userMessage || '').slice(0, 800));
  let systemPrompt = buildGroupMemberReplyPrompt(member.work, {
    scenario,
    groupLines: formatGroupLines(messages, 14),
    memberName: member.name,
    otherNames: others,
    userMessage: um,
    privateChatContext: (function () {
      try {
        const { buildSocialPlotContext } = require('./ocSocialContext.js');
        return buildSocialPlotContext({
          id: member.id,
          name: member.name,
          work: member.work,
          bioText: (member.work && member.work.generatedBio) || ''
        });
      } catch (_) {
        return '';
      }
    })()
  });
  if (typeof opts.wrapSystemPrompt === 'function') {
    systemPrompt = opts.wrapSystemPrompt(systemPrompt, member);
  }
  const history = buildMemberHistory(messages, member.id, opts.moneyMode ? 10 : 14);
  const data = Object.assign(
    {
      systemPrompt,
      userMessage: um,
      history,
      breakCharacterAttempt,
      channel: 'group',
      moneyMode: !!opts.moneyMode,
      moneyAware: !!opts.moneyAware && !opts.moneyMode
    },
    buildQuotaSyncPayload()
  );
  return callCloudFunction({
      name: 'ocChat',
      data: data,
      timeout: opts.moneyMode ? 45000 : 60000
    })
    .then((res) => {
      const r = res.result || {};
      if (!r.ok) throw new Error(r.errMsg || '回复失败');
      return String(r.reply || '').trim();
    });
}

module.exports = {
  roomIdFromMemberIds,
  formatGroupLines,
  pickGroupSpeakers,
  buildMemberHistory,
  callMemberReply,
  fallbackSpeakerIds,
  uniqueSpeakerIds
};
