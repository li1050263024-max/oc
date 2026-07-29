const { getMomentsFeed } = require('./ocMomentsStore.js');
const { getOcsForSocial } = require('./ocSocialEligible.js');
const { listSessions, getMessages } = require('./chatSession.js');
const {
  listGroupRooms,
  listSessions: listGroupSessions,
  getMessages: getGroupMessages
} = require('./groupChatStore.js');

function normalizeForDedupe(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）【】…—~·,.!?;:'"()\[\]♥♡💬]/g, '')
    .toLowerCase();
}

function shuffle(arr) {
  const a = (arr || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function isNearDuplicate(normalized, usedSet) {
  if (!normalized || normalized.length < 2) return true;
  if (usedSet.has(normalized)) return true;
  for (const existing of usedSet) {
    if (!existing || existing.length < 6 || normalized.length < 6) continue;
    if (existing === normalized) return true;
    if (existing.includes(normalized) || normalized.includes(existing)) return true;
  }
  return false;
}

function markNormalized(normalized, usedSet) {
  if (normalized) usedSet.add(normalized);
}

function _pushText(list, seen, text) {
  const raw = String(text || '').trim();
  if (!raw) return;
  const n = normalizeForDedupe(raw);
  if (!n || seen.has(n)) return;
  seen.add(n);
  list.push(raw);
}

function collectAllUsedTexts() {
  const texts = [];
  const seen = new Set();

  (getMomentsFeed() || []).forEach((p) => {
    if (p && p.authorType !== 'user' && p.content) _pushText(texts, seen, p.content);
  });

  (getOcsForSocial() || []).forEach((oc) => {
    if (!oc || !oc.id) return;
    (listSessions(oc.id) || []).forEach((s) => {
      (getMessages(oc.id, s.id) || []).forEach((m) => {
        if (m && m.role === 'assistant' && m.content) _pushText(texts, seen, m.content);
      });
    });
  });

  (listGroupRooms() || []).forEach((room) => {
    if (!room || !room.roomId) return;
    (listGroupSessions(room.roomId) || []).forEach((s) => {
      (getGroupMessages(room.roomId, s.id) || []).forEach((m) => {
        if (m && m.role === 'assistant' && m.content) _pushText(texts, seen, m.content);
      });
    });
  });

  return texts;
}

function buildUsedSetFromTexts(texts) {
  const used = new Set();
  (texts || []).forEach((t) => {
    const n = normalizeForDedupe(t);
    if (n) used.add(n);
  });
  return used;
}

let _activeRegistry = null;

function beginDedupeSession() {
  const texts = collectAllUsedTexts();
  _activeRegistry = {
    used: buildUsedSetFromTexts(texts),
    originals: texts.slice()
  };
  return _activeRegistry;
}

function getActiveRegistry() {
  if (!_activeRegistry) beginDedupeSession();
  return _activeRegistry;
}

function endDedupeSession() {
  _activeRegistry = null;
}

function isContentUsed(content) {
  const n = normalizeForDedupe(content);
  return isNearDuplicate(n, getActiveRegistry().used);
}

function claimContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return false;
  const n = normalizeForDedupe(raw);
  const reg = getActiveRegistry();
  if (isNearDuplicate(n, reg.used)) return false;
  markNormalized(n, reg.used);
  reg.originals.push(raw);
  return true;
}

function buildForbiddenForPrompt(maxItems, maxChars) {
  const reg = getActiveRegistry();
  const list = (reg.originals || []).slice(-Math.max(1, maxItems || 30));
  const lines = list.map((t, i) => i + 1 + '. ' + String(t).trim().slice(0, 72));
  return lines.join('\n').slice(0, maxChars || 2200);
}

function findUniqueFromPool(pool) {
  const candidates = shuffle(pool || []).filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    if (!isContentUsed(candidates[i])) return candidates[i];
  }
  const stamp = Date.now().toString(36).slice(-5);
  for (let i = 0; i < candidates.length; i++) {
    const variant = candidates[i] + '·' + stamp + String(i);
    if (!isContentUsed(variant)) return variant;
  }
  const fallback = '……' + stamp;
  return isContentUsed(fallback) ? '' : fallback;
}

function pickUniqueFromPool(pool) {
  const picked = findUniqueFromPool(pool);
  if (!picked) return '';
  return claimContent(picked) ? picked : '';
}

function reserveUniqueContent(content, pool) {
  const raw = String(content || '').trim();
  if (raw && !isContentUsed(raw) && claimContent(raw)) return raw;
  const picked = findUniqueFromPool(pool);
  if (picked && claimContent(picked)) return picked;
  return '';
}

function ensureUniqueContent(content, pool) {
  return reserveUniqueContent(content, pool);
}

function ensureUniqueOrPick(pool, content) {
  return ensureUniqueContent(content, pool);
}

module.exports = {
  normalizeForDedupe,
  collectAllUsedTexts,
  buildUsedSetFromTexts,
  beginDedupeSession,
  getActiveRegistry,
  endDedupeSession,
  isContentUsed,
  claimContent,
  buildForbiddenForPrompt,
  pickUniqueFromPool,
  findUniqueFromPool,
  ensureUniqueContent,
  reserveUniqueContent,
  ensureUniqueOrPick,
  filterUniqueByContent: function filterUniqueByContent(items, getContent) {
    const out = [];
    (items || []).forEach((item) => {
      const c = getContent(item);
      if (claimContent(c)) out.push(item);
    });
    return out;
  }
};
