const MEMORY_HINT_RE =
  /记住|记得|以后|别忘|固定|设定|前提是|世界观|性格|口癖|背景|关系|我们是|你是/;

/** 用户明确声明的人际/扮演关系 */
const RELATION_DECLARE_RE =
  /我们(?:是|就是|算)|你是我的|我是你的|当你的|做我的|当我的|算(?:恋人|情侣)|是(?:恋人|情侣|夫妻|老公|老婆|男朋友|女朋友|母子|父子|父女|母女|家人|朋友|闺蜜|兄弟|姐妹|师生|师徒|主仆|上下级)|当(?:我)?(?:妈|爸|儿子|女儿|女朋友|男朋友|老婆|老公|朋友|闺蜜)|叫我(?:老公|老婆|宝宝|宝贝)|你(?:当|做)我(?:妈|爸|儿子|女儿)/;

const CORE_SETTING_CHANGE_RE =
  /(?:改|换|变成|改成|以后叫|你叫|我叫|称呼|名字是|姓名是).{0,10}(?:名字|姓名|性别|年龄|种族|发色|瞳色|外貌|怪癖|癖好|人设)|(?:名字|姓名|性别|年龄|种族|发色|瞳色|外貌|怪癖|癖好)(?:改成|改为|变成|是)|你(?:其实|现在)?(?:是|叫)/;

function extractRelationLines(messages) {
  const lines = [];
  (messages || []).forEach((m) => {
    if (!m || m.role !== 'user' || !m.content) return;
    const t = String(m.content).trim();
    if (!t || t.length > 240) return;
    if (CORE_SETTING_CHANGE_RE.test(t) && !RELATION_DECLARE_RE.test(t)) return;
    if (RELATION_DECLARE_RE.test(t)) lines.push(t);
  });
  return lines;
}

function extractSessionMemory(messages, existingMemory) {
  const relationLines = extractRelationLines(messages);
  const hints = [];
  (messages || []).forEach((m) => {
    if (!m || m.role !== 'user' || !m.content) return;
    const t = String(m.content).trim();
    if (!t || t.length > 240) return;
    if (CORE_SETTING_CHANGE_RE.test(t) && !RELATION_DECLARE_RE.test(t)) return;
    if (RELATION_DECLARE_RE.test(t)) return; // 关系单独成段，避免重复
    if (MEMORY_HINT_RE.test(t)) hints.push(t);
  });
  const recentFacts = (messages || [])
    .slice(-8)
    .filter((m) => m && m.content && !(m.kind === 'game_money' || (m.game && m.game.type)))
    .map((m) => {
      const who = m.role === 'user' ? '用户' : '角色';
      return who + '：' + String(m.content).trim().slice(0, 100);
    });
  const parts = [];
  // 从旧记忆里抽出已确认关系行，避免刷新时丢掉
  const existing = String(existingMemory || '').trim();
  const prevRelations = [];
  if (existing) {
    existing.split(/\n+/).forEach((line) => {
      const t = String(line || '').trim();
      if (!t) return;
      if (RELATION_DECLARE_RE.test(t) || /^【已确认关系】/.test(t)) {
        if (!/^【已确认关系】/.test(t)) prevRelations.push(t);
      }
    });
  }
  const allRelations = [];
  const seen = {};
  prevRelations.concat(relationLines).forEach((t) => {
    const key = t.slice(0, 80);
    if (seen[key]) return;
    seen[key] = true;
    allRelations.push(t);
  });
  if (allRelations.length) {
    parts.push(
      '【已确认关系·须持续遵守】\n' + allRelations.slice(-6).join('\n')
    );
  }
  if (existing) {
    // 去掉旧的关系段与近期要点，避免无限膨胀；保留其它设定类记忆
    const cleaned = existing
      .replace(/【已确认关系[^\n]*】[\s\S]*?(?=\n【|$)/g, '')
      .replace(/【近期对话要点】[\s\S]*$/g, '')
      .trim();
    if (cleaned) parts.push(cleaned.slice(0, 400));
  }
  if (hints.length) {
    parts.push(hints.slice(-8).join('\n'));
  }
  if (recentFacts.length) {
    parts.push('【近期对话要点】\n' + recentFacts.join('\n'));
  }
  const merged = parts.join('\n\n').trim();
  return merged.slice(0, 900);
}

function shouldRefreshMemory(messageCount, messages) {
  if (messageCount > 0 && messageCount % 4 === 0) return true;
  const list = messages || [];
  for (let i = list.length - 1; i >= Math.max(0, list.length - 4); i--) {
    const m = list[i];
    if (m && m.role === 'user' && isRelationDeclareMessage(m.content)) return true;
  }
  return false;
}

/** 用户本轮是否在声明关系（用于立刻强化提示） */
function isRelationDeclareMessage(text) {
  return RELATION_DECLARE_RE.test(String(text || '').trim());
}

module.exports = {
  extractSessionMemory,
  extractRelationLines,
  shouldRefreshMemory,
  isRelationDeclareMessage,
  RELATION_DECLARE_RE
};
