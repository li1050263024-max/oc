const https = require('https');

let _cloud = null;
let _db = null;
try {
  _cloud = require('wx-server-sdk');
  _cloud.init({ env: 'cloud1-d3gkbz2nf0c84c381' });
  _db = _cloud.database();
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
  '- 按人设财力：有钱就大方，清贫就小额但仍真诚\n' +
  '- 富豪/知名有钱角色（如钢铁侠、霸总、财阀等）：关系不错时转账尽量 ≥ 1000，随手给钱常见几千～十几万，严禁寒酸到几十几百（除非故意玩笑）\n' +
  '- 「倾尽所有」例外：人设虽穷但深情，或与用户聊到很动感情/告白/承诺/补偿时，可用 transfer 转一笔贴合身份、却像清空余额的金额\n' +
  '  · 这种金额必须「有零有整」、忌整数整十整百（禁止 10/50/100/200/520 等好看整数）\n' +
  '  · 示例风格：86.43、327.18、1586.72、2037.55（像账户里剩多少转多少）\n' +
  '  · 穷学生倾尽所有可在几十～几百带小数；打工族可到一千多带小数；勿写成富翁级\n' +
  '富裕/钢铁侠级人设：红包可顶格 200，真正大手笔必须用转账（几千到十几万+）；清贫认真给钱至少 1 元。\n' +
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
  if (!_db || !_cloud) return;
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

function postJson(hostname, path, headers, body, timeoutMs) {
  const data = JSON.stringify(body);
  const wait = Number(timeoutMs) > 0 ? Number(timeoutMs) : 55000;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => {
          chunks += d;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(chunks);
            if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(chunks.slice(0, 200) || e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(wait, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.write(data);
    req.end();
  });
}

exports.main = async (event) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, errMsg: '请配置云函数环境变量 DEEPSEEK_API_KEY' };
  }

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
  // 摇骰子/收红包只要近文，降低超时概率
  const shortMode = diceMode || moneyMode;
  const recent = history.slice(shortMode ? -10 : -20);
  recent.forEach((m) => {
    if (!m || !m.content) return;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      content: String(m.content).slice(0, shortMode ? 600 : 1400)
    });
  });
  messages.push({ role: 'user', content: userMessage });

  const breakCharacterAttempt = !!(event && event.breakCharacterAttempt);
  const temperature = shortMode ? 0.7 : breakCharacterAttempt ? 0.72 : 0.88;
  const maxTokens = shortMode ? 160 : moneyAware ? 680 : 600;
  // 骰子/红包回复短，给 API 更紧的超时，避免拖到云函数上限
  const apiTimeoutMs = shortMode ? 45000 : 55000;

  try {
    const result = await postJson(
      'api.deepseek.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      {
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        messages,
        temperature,
        max_tokens: maxTokens
      },
      apiTimeoutMs
    );

    const reply =
      result.choices &&
      result.choices[0] &&
      result.choices[0].message &&
      result.choices[0].message.content;

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

    // 日汇总可异步；免费额度必须 await
    reportUsageDaily(channel).catch(() => {});

    let quotaSync = null;
    try {
      const wxContext = _cloud ? _cloud.getWXContext() : {};
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

      // 只要有 openid：写 freeUsed（有绝对值用绝对值，否则 +1）
      // 群聊「选人」请求：无 channel 且 history 为空，跳过避免误加
      if (openid && !skip) {
        const looksLikePicker =
          !explicitChannel &&
          !hasReport &&
          Array.isArray(event && event.history) &&
          (event.history || []).length === 0;
        if (!looksLikePicker) {
          const mode = report.freeUsed == null ? 'inc' : 'set';
          quotaSync = await reportUserFreeQuota(openid, report, mode);
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
      apiVer: 'ocChat-quota-sync-v3'
    };
  } catch (e) {
    return { ok: false, errMsg: e.message || '调用失败' };
  }
};
