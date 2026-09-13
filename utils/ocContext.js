/**

 * 将 OC 工作数据拼成给模型用的纯文本设定（小传提示 / 对话 system 等）

 */

const gacha = require('./gacha.js');

const { normalizeBackground, normalizeResult, personalityBlend, quirkBlend } = require('./ocResult.js');



/** 抽卡 API 用精简上下文，减少 token */

function buildCompactDrawContext(work, layer) {
  const applied = !!(work && work.gachaScopeApplied);
  const hint = applied ? String((work && work.gachaScopeHint) || '').trim() : '';
  const hintLine = hint ? `【强制抽卡方向】${hint.slice(0, 160)}` : '';
  if (!work || !work.result) {
    return hintLine.slice(0, layer === 2 ? 480 : 900);
  }

  const r = normalizeResult(work.result);
  const lines = [

    [r.name, r.gender, r.age, r.race].filter(Boolean).join(' '),

    [r.hairColor && `发${r.hairColor}`, r.eyeColor && `眼${r.eyeColor}`].filter(Boolean).join(' '),

    personalityBlend(r) && `性格:${personalityBlend(r)}`,

    r.likes && `喜欢:${r.likes}`,

    quirkBlend(r) && `特质:${quirkBlend(r)}`

  ].filter(Boolean);

  if (hintLine) lines.unshift(hintLine);

  if (layer >= 3 && work.background) {

    const bg = normalizeBackground(work.background);

    if (bg.worldview) lines.push(`世界观:${bg.worldview}`);

    const o = (bg.origins || []).filter(Boolean);

    if (o.length) lines.push(`身世:${o.join('；')}`);

  }

  const maxLen = layer === 2 ? 480 : 900;

  return lines.join('\n').slice(0, maxLen);

}



function buildOcPromptFromWork(work) {
  if (!work || !work.result) return '';

  let t = gacha.toCopyText(work.result);

  const bg = work.background ? normalizeBackground(work.background) : null;

  if (bg) {

    t += '\n\n【背景】\n世界观：' + (bg.worldview || '');

    const origins = (bg.origins || []).filter(Boolean);

    if (origins.length) {

      t += '\n身世设定：\n' + origins.map((e, i) => `${i + 1}. ${e || ''}`).join('\n');

    }

    const ev = bg.lifeEvents || [];

    if (ev.filter(Boolean).length) {

      t += '\n人生大事件：\n' + ev.map((e, i) => `${i + 1}. ${e || ''}`).join('\n');

    }

  }

  const cp = work.catchphrases || [];

  if (cp.length) {

    t += '\n\n【常用语】\n' + cp.filter(Boolean).join('\n');

  }

  const ad = work.attitudes || [];

  if (ad.length) {

    t +=

      '\n\n【态度】\n' +

      ad.map((x) => `${x.event || ''} → ${x.attitude || ''}`).join('\n');

  }

  return t.trim();

}

function buildImmutableCoreBlock(work) {
  if (!work || !work.result) return '';
  const r = normalizeResult(work.result);
  const quirks = quirkBlend(r);
  const appearance = [
    r.race ? '种族 ' + r.race : '',
    r.hairColor ? '发色 ' + r.hairColor : '',
    r.eyeColor ? '瞳色 ' + r.eyeColor : ''
  ]
    .filter(Boolean)
    .join('，');
  const lines = [
    '【不可变更基础设定·强制遵守】',
    '以下字段在全部对话轮次中绝对不可修改、否定、遗忘或与用户协商改写：',
    '姓名：' + (r.name || '未命名'),
    '性别：' + (r.gender || '—'),
    '年龄：' + (r.age || '—'),
    '外貌设定：' + (appearance || '—'),
  ];
  if (quirks) lines.push('癖好（怪癖）：' + quirks);
  lines.push(
    '即使用户要求改名字、改性别年龄、改外貌或改癖好，也必须在【' +
      (r.name || '该角色') +
      '】的人设内合理回应，不得接受并更改以上事实。'
  );
  return lines.join('\n');
}

function appendScenarioBlock(prompt, scenario) {

  if (!scenario || !scenario.excerpt) return prompt;

  let s = prompt + '\n\n【当前情景演绎】\n';

  if (scenario.title) s += '标题：' + scenario.title + '\n';

  s +=

    '场景正文（请在此氛围下接话，勿大段复述设定）：\n' +

    String(scenario.excerpt).trim().slice(0, 900);

  return s;

}

function fitChatPromptBudget(sections, maxLen) {
  const max = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 5800;
  let out = '';
  (sections || []).forEach((part) => {
    const block = String(part || '');
    if (!block) return;
    if (out.length + block.length <= max) {
      out += block;
      return;
    }
    const remain = max - out.length;
    if (remain > 80) {
      out += block.slice(0, remain - 1) + '…';
    }
  });
  return out;
}

function trimBioForChat(bio, maxLen) {
  const t = String(bio || '').trim();
  if (!t) return '';
  const max = maxLen || 900;
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

/** 说话方式：常用语为底，小传可改口吻 */
function buildSpeechStyleBlock(work) {
  const cp = ((work && work.catchphrases) || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!cp.length) {
    return (
      '【说话方式】\n' +
      '本角色暂无常用语；请按性格、态度与人物小传自然说话。小传可塑造与改写口吻。\n\n'
    );
  }
  return (
    '【说话方式·常用语（基础）】\n' +
    '下列常用语是口吻与用词的基础参考（可自然化用，勿机械复读同一句）：\n' +
    cp.map((s, i) => i + 1 + '. ' + s).join('\n') +
    '\n若【人物小传】对语气、措辞、说话习惯有描述，可用小传改口吻、细化或覆盖常用语中的风格，使对话更贴合小传人物。\n\n'
  );
}

/** 小传：补全经历/关系，并可用于改口吻 */
function buildBioCompensateBlock(bioText) {
  if (!bioText) {
    return (
      '【警告】缺少人物小传，人设不完整；请仅作极简回应并提示用户先填写小传。\n\n'
    );
  }
  return (
    '【人物小传·补全与口吻（必须遵守）】\n' +
    '小传用于补全经历、人际关系、情绪底色与处事逻辑；也可据此改写、细化说话口吻与用词习惯。' +
    '当小传与常用语的语气冲突时，以小传塑造的口吻为准，常用语作参考。' +
    '若小传与基础设定冲突：姓名/性别/年龄/外貌/癖好以【不可变更基础设定】为准。\n' +
    bioText +
    '\n\n'
  );
}

function buildChatSystemPrompt(work, options) {
  const { RP_CORE_RULES, breakCharacterGuardBlock, isBreakCharacterAttempt } =
    require('./chatGuard.js');
  const block = buildOcPromptFromWork(work);
  const name =
    (work && work.result && work.result.name) || '该角色';
  const bioText = trimBioForChat(work && work.generatedBio, 1600);
  const sections = [RP_CORE_RULES.replace(/\{name\}/g, name) + '\n\n'];
  sections.push(
    '【称呼再确认】你是【' +
      name +
      '】；用户不是【' +
      name +
      '】。用户叫你的名字时是在称呼你。对用户不要叫【' +
      name +
      '】。\n\n'
  );
  const coreBlock = buildImmutableCoreBlock(work);
  if (coreBlock) sections.push(coreBlock + '\n\n');
  sections.push(buildSpeechStyleBlock(work));
  sections.push(buildBioCompensateBlock(bioText));
  sections.push('【角色卡片设定】\n');
  sections.push(block || '（设定由玩家在对话中补充）');
  const sessionMemory = options && options.sessionMemory;
  if (sessionMemory && String(sessionMemory).trim()) {
    sections.push(
      '\n\n【对话记忆·须遵守】\n' +
        '以下为用户在对话中补充的信息；若与【不可变更基础设定】（姓名、性别、年龄、外貌、癖好）冲突，一律以基础设定为准，不得改写。' +
        '口吻可结合常用语与小传。若含【已确认关系】，必须按该关系扮演。\n' +
        String(sessionMemory).trim().slice(0, 900)
    );
  }
  const userMessage = options && options.userMessage;
  try {
    const { isRelationDeclareMessage } = require('./chatMemory.js');
    if (userMessage && isRelationDeclareMessage(userMessage)) {
      sections.push(
        '\n\n【本轮关系声明】用户正在明确你们的关系。请从本轮起按用户所述关系自然代入扮演，不要否认、不要装作没听见，也不要突然变得过度粘腻到出戏。\n'
      );
    }
  } catch (_) {}
  if (userMessage && isBreakCharacterAttempt(userMessage)) {
    sections.push(breakCharacterGuardBlock(name));
  }
  const scenario = options && options.scenario;
  let prompt = fitChatPromptBudget(sections, 5600);
  return appendScenarioBlock(prompt, scenario);
}



function buildGroupPickSpeakerPrompt(members, groupLines) {

  const memberBlock = (members || [])

    .map((m) => '- id:' + m.id + ' 名字:' + m.name)

    .join('\n');

  const lines = groupLines || '';

  return (

    '你是群聊场控。根据近期对话与用户最新消息，判断本轮应由哪 1～2 名角色接话（用户在本窗口的前 3 条发言已由系统安排全员接话，无需处理）。优先选 2 名；若用户只点名或只追问其中一人则只选该人。\n' +

    '成员：\n' +

    memberBlock +

    '\n\n【近期群聊】\n' +

    (lines || '（尚无记录）') +

    '\n\n只输出一行 JSON，例如 {"ids":["成员id"]} 或 {"ids":["id1","id2"]}，不要其它文字。'

  ).slice(0, 5800);

}



function buildGroupMemberReplyPrompt(work, ctx) {
  const { RP_CORE_RULES, breakCharacterGuardBlock, isBreakCharacterAttempt } =
    require('./chatGuard.js');
  const block = buildOcPromptFromWork(work);
  const name =
    (ctx && ctx.memberName) ||
    (work && work.result && work.result.name) ||
    '角色';
  const bioText = trimBioForChat(work && work.generatedBio, 1200);
  const sections = [
    RP_CORE_RULES.replace(/\{name\}/g, name) +
      '\n你正在多 OC 群聊中，只扮演【' +
      name +
      '】；不要替其他角色发言。\n\n'
  ];
  sections.push(
    '【称呼再确认】你是【' +
      name +
      '】；用户不是【' +
      name +
      '】。对用户不要叫【' +
      name +
      '】。\n\n'
  );
  const coreBlock = buildImmutableCoreBlock(work);
  if (coreBlock) sections.push(coreBlock + '\n\n');
  sections.push(buildSpeechStyleBlock(work));
  if (bioText) {
    sections.push(buildBioCompensateBlock(bioText));
  }
  sections.push('【你的卡片设定】\n');
  sections.push(block || '（设定略）');
  const userMessage = ctx && ctx.userMessage;
  if (userMessage && isBreakCharacterAttempt(userMessage)) {
    sections.push(breakCharacterGuardBlock(name));
  }

  if (ctx && ctx.otherNames) {
    sections.push('\n\n【同群其它角色】' + ctx.otherNames);
  }

  if (ctx && ctx.groupLines) {
    sections.push('\n\n【近期群聊记录】\n' + String(ctx.groupLines).slice(0, 1200));
  }

  if (ctx && ctx.privateChatContext) {
    sections.push(
      '\n\n【与该用户的私聊记忆·须记得并自然呼应，勿装作不认识】\n' +
        String(ctx.privateChatContext).slice(0, 1400)
    );
  }

  let prompt = fitChatPromptBudget(sections, 5200);
  prompt = appendScenarioBlock(prompt, ctx && ctx.scenario);

  prompt +=

    '\n\n【回复要求】以【' +

    name +

    '】的口吻回复用户上一条消息，1～5 句，自然接话；口吻结合常用语，可用小传改写细化。';

  return prompt.slice(0, 5800);
}



module.exports = {

  buildCompactDrawContext,

  buildOcPromptFromWork,

  buildImmutableCoreBlock,

  buildChatSystemPrompt,

  buildGroupPickSpeakerPrompt,

  buildGroupMemberReplyPrompt,

  fitChatPromptBudget
};


