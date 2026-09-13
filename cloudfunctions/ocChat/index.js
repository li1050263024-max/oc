const cloud = require('wx-server-sdk');
const { chatCompletions } = require('./aiText.js');

let _db = null;
try {
  cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV || 'cloud1-d3gkbz2nf0c84c381',
    timeout: 60000
  });
  _db = cloud.database();
} catch (_) {}

const DICE_RULES =
  '\n\n【摇骰子小游戏规则】用户在聊天里掷了骰。你必须严格按下述格式回复（不要其它前缀）：\n' +
  '第1行只能是 JOIN:1（愿意一起摇）或 JOIN:0（不想玩/拒绝）。\n' +
  '第2行必须是 ---\n' +
  '然后写一两句角色台词（可含动作）。\n' +
  '判断依据：人设、情绪与上文；可拒绝，不要默认配合。\n' +
  'JOIN:1：台词必须准确使用用户消息里给出的双方点数与输赢，禁止说错点数或说反结果。\n' +
  'JOIN:0：明确拒绝或回避，不要假装自己也掷过，不要编造自己的点数。\n' +
  '台词中不要出现「系统」「指令」「JOIN」。';

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

const MONEY_PROACTIVE_RULES =
  '\n\n【虚拟红包/转账·主动·白名单】默认 TYPE:none。平常闲聊、调情、寒暄、讲日常一律禁止发钱。\n' +
  '请先写角色台词，末尾追加且只追加一次：\n' +
  '<<<MONEY\nTYPE:none|red_packet|transfer\nAMOUNT:数字\n>>>\n' +
  '或：SEND:none / SEND:red_packet:金额 / SEND:transfer:金额\n' +
  '仅当本轮用户消息属于下列之一时，才可 red_packet/transfer，否则必须 none：\n' +
  'A) 用户主动提到钱/红包/转账/打钱/借钱/给我钱/生活费等；\n' +
  'B) 用户正在哭穷、卖惨、诉苦缺钱、交不起房租学费、救急、求补偿；\n' +
  'C) 用户刚给你发了红包/转账，你可礼尚往来回一份（不强制）。\n' +
  '禁止：用户没提钱、也没卖惨哭穷时，因关系好/人设有钱/想讨好而主动塞钱。\n' +
  '金额：认真给钱 ≥ 1 元；红包 ≤ 200；转账按人设。近几轮刚发过则本轮 none。\n' +
  '方向：【角色→用户】发钱；严禁写成用户转给你。\n' +
  '台词禁止「[红包]」「[转账]」「X元已发送」；红包台词勿报金额；拿不准就 none。\n';

function localDateKey() {
  const t = Date.now() + 8 * 3600000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 服务端直接写 usage_daily：先 where 再 update/add（禁止盲 update） */
async function reportUsageDaily(channel) {
  if (!_db || !cloud) return;
  const _ = _db.command;
  const dateKey = localDateKey();
  const isGroup = channel === 'group';
  const inc = {
    chatRounds: _.inc(1),
    apiCalls: _.inc(1),
    reportCount: _.inc(1),
    updatedAt: _db.serverDate(),
    'apiByName.ocChat': _.inc(1)
  };
  if (isGroup) inc.chatRoundsGroup = _.inc(1);
  else inc.chatRoundsDm = _.inc(1);

  let existing = null;
  try {
    const res = await _db
      .collection('usage_daily')
      .where({ dateKey: dateKey })
      .limit(1)
      .get();
    if (res && res.data && res.data.length) existing = res.data[0];
  } catch (_) {}

  try {
    if (existing && existing._id) {
      await _db.collection('usage_daily').doc(existing._id).update({ data: inc });
      return;
    }
    await _db.collection('usage_daily').add({
      data: {
        dateKey,
        chatRounds: 1,
        chatRoundsDm: isGroup ? 0 : 1,
        chatRoundsGroup: isGroup ? 1 : 0,
        apiCalls: 1,
        apiByName: { ocChat: 1 },
        unlockAd: 0,
        unlockShare: 0,
        unlockFailOpen: 0,
        unlockRoundsAd: 0,
        unlockRoundsShare: 0,
        unlockRoundsFailOpen: 0,
        reportCount: 1,
        createdAt: _db.serverDate(),
        updatedAt: _db.serverDate()
      }
    });
  } catch (e2) {
    console.warn('[ocChat] usage_daily write fail', e2);
  }
}

/**
 * 把本周免费用量写到 user_quota，供管理后台及时看到。
 * - 有 freeUsed：按绝对值只增不减（群聊多成员回复也不会重复加）
 * - 无 freeUsed 且 mode=inc：服务端 +1（兼容未更新的旧客户端单聊）
 */
async function reportUserFreeQuota(openid, report, mode) {
  if (!_db || !openid) return { ok: false, err: 'no openid' };
  const weekKey = String((report && report.weekKey) || currentWeekKey()).slice(0, 32);
  const reportedUsed = report && report.freeUsed != null
    ? Math.max(0, Math.floor(Number(report.freeUsed) || 0))
    : null;
  const freeAllowed = Math.max(
    30,
    Math.floor(Number(report && report.freeAllowed) || 0) || 30
  );
  const incMode = mode === 'inc' && reportedUsed == null;
  const forceFreeReset = !!(
    report &&
    (report.forceFreeReset || report.forceReset || report.resetFree)
  );

  const col = _db.collection('user_quota');
  let doc = null;
  try {
    const byId = await col.doc(openid).get();
    if (byId && byId.data && Object.keys(byId.data).length) {
      doc = Object.assign({ _id: openid }, byId.data);
    }
  } catch (_) {}
  if (!doc) {
    try {
      const res = await col.where({ openid: openid }).limit(1).get();
      if (res && res.data && res.data.length) doc = res.data[0];
    } catch (_) {}
  }

  const now = Date.now();
  let nextUsed = 0;
  if (doc && doc._id) {
    const prevWeek = String(doc.weekKey || '');
    const prevFree = Math.max(0, Number(doc.freeUsed) || 0);
    const weekChanged = !!(weekKey && weekKey !== prevWeek);
    if (forceFreeReset && reportedUsed != null) {
      nextUsed = reportedUsed;
    } else if (reportedUsed != null) {
      nextUsed = weekChanged ? reportedUsed : Math.max(prevFree, reportedUsed);
    } else if (incMode) {
      nextUsed = weekChanged ? 1 : prevFree + 1;
    } else {
      return { ok: true, skipped: true };
    }

    const patch = {
      openid: openid,
      weekKey: weekKey,
      freeUsed: nextUsed,
      freeAllowed: Math.max(
        freeAllowed,
        Math.max(0, Number(doc.freeAllowed) || 0),
        30
      ),
      updateTimeMs: now,
      updatedAt: now
    };
    if (forceFreeReset) {
      patch.adminClearedAt = 0;
      patch.adminClearedNote = 'schema-upgrade-reset';
    }
    try {
      await col.doc(doc._id).update({ data: patch });
      return { ok: true, freeUsed: nextUsed, method: 'update' };
    } catch (e) {
      console.warn('[ocChat] user_quota update fail', e);
      return { ok: false, err: String((e && e.message) || e) };
    }
  }

  nextUsed = reportedUsed != null ? reportedUsed : incMode ? 1 : 0;
  const init = {
    openid: openid,
    extraRounds: 0,
    extraConsumed: 0,
    redeemedTotal: 0,
    freeUsed: nextUsed,
    freeAllowed: freeAllowed,
    weekKey: weekKey,
    createTimeMs: now,
    updateTimeMs: now
  };
  try {
    await col.doc(openid).set({ data: init });
    return { ok: true, freeUsed: nextUsed, method: 'set' };
  } catch (e2) {
    try {
      await col.add({ data: init });
      return { ok: true, freeUsed: nextUsed, method: 'add' };
    } catch (e3) {
      console.warn('[ocChat] user_quota create fail', e3);
      return { ok: false, err: String((e3 && e3.message) || e3) };
    }
  }
}

function currentWeekKey() {
  const t = Date.now() + 8 * 3600000;
  const d = new Date(t);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dayNum = String(monday.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dayNum;
}

exports.main = async (event, context) => {
  const diceMode = !!(event && event.diceMode);
  const moneyMode = !!(event && event.moneyMode);
  const moneyAware = !!(event && event.moneyAware) && !diceMode && !moneyMode;
  let systemPrompt =
    event && event.systemPrompt != null ? String(event.systemPrompt).trim() : '';
  const userMessage =
    event && event.userMessage != null ? String(event.userMessage).trim() : '';
  const history = Array.isArray(event && event.history) ? event.history : [];

  if (!userMessage) {
    return { ok: false, errMsg: '消息不能为空' };
  }
  if (userMessage.length > 800) {
    return { ok: false, errMsg: '单条消息请控制在 800 字以内' };
  }

  if (diceMode) {
    systemPrompt = (systemPrompt + DICE_RULES).slice(0, 5800);
  } else if (moneyMode) {
    if (systemPrompt.indexOf('ACCEPT:1') < 0 && systemPrompt.indexOf('【红包/转账回应') < 0) {
      systemPrompt = (systemPrompt + MONEY_REPLY_RULES).slice(0, 5800);
    } else {
      systemPrompt = systemPrompt.slice(0, 5800);
    }
  } else if (moneyAware) {
    // 群聊客户端已带 GROUP 红包规则；单聊客户端只带财力参考，此处补全主动发红包规则
    const hasMoneyBlock =
      systemPrompt.indexOf('<<<MONEY') >= 0 ||
      systemPrompt.indexOf('【群聊·虚拟红包') >= 0 ||
      systemPrompt.indexOf('【虚拟红包/转账·主动】') >= 0;
    if (!hasMoneyBlock) {
      systemPrompt = (systemPrompt + MONEY_PROACTIVE_RULES).slice(0, 5800);
    } else {
      systemPrompt = systemPrompt.slice(0, 5800);
    }
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt.slice(0, 5800) });
  }
  // 摇骰子/收红包只要近文；普通对话也缩短上下文，降低超时概率
  const shortMode = diceMode || moneyMode;
  const recent = history.slice(-8);
  recent.forEach((m) => {
    if (!m || !m.content) return;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      content: String(m.content).slice(0, shortMode ? 500 : 900)
    });
  });
  messages.push({
    role: 'user',
    content: String(userMessage || '').slice(0, 1200)
  });

  const breakCharacterAttempt = !!(event && event.breakCharacterAttempt);
  const temperature = shortMode ? 0.7 : breakCharacterAttempt ? 0.72 : 0.85;
  // 收紧生成长度，优先在客户端超时前返回
  const maxTokens = shortMode ? 140 : moneyAware ? 420 : 380;

  try {
    const result = await chatCompletions(messages, {
      temperature: temperature,
      maxTokens: maxTokens
    });

    const reply = result && result.text;

    if (!reply || !String(reply).trim()) {
      return { ok: false, errMsg: '模型未返回有效内容' };
    }
    const explicitChannel =
      event &&
      (event.channel === 'dm' ||
        event.channel === 'group' ||
        event.isGroup === true);
    const channel =
      event && (event.channel === 'group' || event.isGroup) ? 'group' : 'dm';

    // 日汇总异步；额度同步最多等 3 秒，超时先回消息，后台继续写库
    reportUsageDaily(channel).catch(() => {});
    let quotaSync = null;
    try {
      const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
      const openid = (wxContext && wxContext.OPENID) || '';
      const skip = !!(event && event.skipQuota);
      const hasReport =
        !!event &&
        (event.reportQuota === true ||
          event.freeUsed != null ||
          (event.quotaReport && event.quotaReport.freeUsed != null));
      const report = (event && event.quotaReport) || {
        weekKey: event && event.weekKey,
        freeUsed: event && event.freeUsed,
        freeAllowed: event && event.freeAllowed
      };

      if (openid && !skip) {
        const looksLikePicker =
          !explicitChannel &&
          !hasReport &&
          Array.isArray(event && event.history) &&
          (event.history || []).length === 0;
        if (!looksLikePicker) {
          const mode = report.freeUsed == null ? 'inc' : 'set';
          const quotaPromise = reportUserFreeQuota(openid, report, mode);
          const raced = await Promise.race([
            quotaPromise
              .then((r) => ({ done: true, r: r }))
              .catch((qe) => ({
                done: true,
                r: { ok: false, err: String((qe && qe.message) || qe) }
              })),
            new Promise((resolve) =>
              setTimeout(() => resolve({ done: false }), 3000)
            )
          ]);
          if (raced.done) {
            quotaSync = raced.r;
          } else {
            // 超过 3 秒：先把回复发给客户端，写库继续跑（勿等事件循环清空）
            if (context && typeof context === 'object') {
              context.callbackWaitsForEmptyEventLoop = false;
            }
            quotaPromise
              .then((r) => {
                console.log('[ocChat] quota sync deferred ok', r && r.ok);
              })
              .catch((qe) => {
                console.warn('[ocChat] quota sync deferred fail', qe);
              });
            quotaSync = { ok: false, deferred: true };
          }
        }
      }
    } catch (qe) {
      console.warn('[ocChat] quota sync fail', qe);
      quotaSync = { ok: false, err: String((qe && qe.message) || qe) };
    }

    return {
      ok: true,
      reply: String(reply).trim(),
      quotaSync: quotaSync || undefined,
      apiVer: 'ocChat-quota-3s-v7'
    };
  } catch (e) {
    const msg = (e && e.message) || '调用失败';
    return {
      ok: false,
      errMsg: /超时|timeout/i.test(msg) ? '模型响应较慢，请重试' : msg
    };
  }
};
