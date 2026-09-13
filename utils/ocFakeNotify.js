const { getTopChattedOcsForProactive } = require('./ocChatHistory.js');
const { revealOcInChatList } = require('./ocChatList.js');
const { getMessages, setMessages, findPrimaryChatSessionId, getLastMessageTimestamp } = require('./chatSession.js');
const { getMessageTimestamp } = require('./chatMessageUi.js');
const {
  assignMessageKindsForBatch
} = require('./ocProactiveScenes.js');
const {
  buildForbiddenForPrompt,
  claimContent
} = require('./ocSocialDedupe.js');
const {
  generateProactiveMessageForOc,
  recordProactiveSuccess,
  shouldInjectProactiveForOc,
  getProactiveInjectBlockReason,
  localDateKey,
  extractProactiveSceneSignature
} = require('./ocProactive.js');

const STORAGE_BADGES = 'oc_nav_badges';
const STORAGE_FAKE_META = 'oc_fake_social_meta';

function getBadges() {
  const raw = wx.getStorageSync(STORAGE_BADGES) || {};
  return {
    chat: !!raw.chat,
    groupChat: !!raw.groupChat,
    chatOcIds: Array.isArray(raw.chatOcIds) ? raw.chatOcIds : [],
    groupRoomIds: Array.isArray(raw.groupRoomIds) ? raw.groupRoomIds : []
  };
}

function setBadges(patch) {
  const prev = getBadges();
  wx.setStorageSync(STORAGE_BADGES, Object.assign({}, prev, patch || {}));
}

function clearChatBadge() {
  setBadges({ chat: false, chatOcIds: [] });
}

function clearGroupChatBadge() {
  setBadges({ groupChat: false, groupRoomIds: [] });
}

function clearChatBadgeForOc(ocId) {
  if (!ocId) return;
  const prev = getBadges();
  const chatOcIds = (prev.chatOcIds || []).filter((id) => id !== ocId);
  setBadges({
    chat: chatOcIds.length > 0,
    chatOcIds
  });
}

function clearGroupBadgeForRoom(roomId) {
  if (!roomId) return;
  const prev = getBadges();
  const groupRoomIds = (prev.groupRoomIds || []).filter((id) => id !== roomId);
  setBadges({
    groupChat: groupRoomIds.length > 0,
    groupRoomIds
  });
}

function mergeBadgeIds(prevList, nextList) {
  const out = (prevList || []).slice();
  (nextList || []).forEach((id) => {
    if (id && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

function getFakeMeta() {
  const raw = wx.getStorageSync(STORAGE_FAKE_META) || {};
  return {
    lastInjectAt: raw.lastInjectAt || 0,
    lastOpenTime: raw.lastOpenTime || 0,
    openDateKey: String(raw.openDateKey || ''),
    todayOpenCount: Number(raw.todayOpenCount) || 0
  };
}

function bumpTodayAppOpenCount(now) {
  const t = Number(now) || Date.now();
  const key = localDateKey(t);
  const meta = getFakeMeta();
  if (meta.openDateKey !== key) {
    return { openDateKey: key, todayOpenCount: 1 };
  }
  return { openDateKey: key, todayOpenCount: (meta.todayOpenCount || 0) + 1 };
}

function setFakeMeta(patch) {
  wx.setStorageSync(STORAGE_FAKE_META, Object.assign({}, getFakeMeta(), patch || {}));
}

function sortMessagesChronologically(messages) {
  return (messages || []).slice().sort((a, b) => {
    const ta = getMessageTimestamp(a) || 0;
    const tb = getMessageTimestamp(b) || 0;
    return ta - tb;
  });
}

async function injectProactiveForChattedOcs(eligible, beforeTime, todayOpenCount) {
  const now = Number(beforeTime) || Date.now();
  const openCount = Number(todayOpenCount) || 1;
  const chatOcIds = [];
  const batchForbidden = [];
  const batchSceneSignatures = [];
  const batchSceneBriefs = [];
  const baseForbidden = buildForbiddenForPrompt(30, 2200)
    .split('\n')
    .map((s) => s.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  const list = eligible || [];
  const skipReasons = [];
  const batchKinds = assignMessageKindsForBatch(list.length, now);
  const batchOpeners = [];

  for (let i = 0; i < list.length; i++) {
    const oc = list[i];
    if (!oc || !oc.id) continue;
    const storageId = oc.chatStorageId || oc.id;
    const messageKind = batchKinds[i] || 'greeting';

    const blockReason = getProactiveInjectBlockReason(oc.id, now);
    if (blockReason || !shouldInjectProactiveForOc(oc.id, openCount, now)) {
      skipReasons.push({ ocId: oc.id, name: oc.name, reason: blockReason || 'blocked' });
      continue;
    }

    const sessionId = findPrimaryChatSessionId(storageId);
    const existingMsgs = getMessages(storageId, sessionId) || [];
    const baseFakeAt = Math.max(now, getLastMessageTimestamp(existingMsgs) + 1000);
    const forbidden = baseForbidden.concat(batchForbidden);
    let generated = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const g = await generateProactiveMessageForOc(oc, {
          now: now + i * 1000 + attempt * 137,
          forbidden,
          storageId,
          batchIndex: i + attempt,
          forbiddenSceneSignatures: batchSceneSignatures,
          batchSceneBriefs: batchSceneBriefs,
          batchOpeners: batchOpeners.slice(),
          messageKind,
          localOnly: true
        });
        const content = String(g.content || '').trim();
        if (!content) continue;
        const opener = content.replace(/\s+/g, '').slice(0, 6);
        if (opener && batchOpeners.indexOf(opener) >= 0) continue;
        claimContent(content);
        generated = g;
        batchForbidden.push(content);
        batchSceneSignatures.push(extractProactiveSceneSignature(content, messageKind));
        batchSceneBriefs.push(content.slice(0, 36));
        if (opener) batchOpeners.push(opener);
        break;
      } catch (e) {
        console.warn('[ocProactive]', storageId, attempt, e);
      }
    }

    if (!generated) {
      skipReasons.push({ ocId: oc.id, name: oc.name, reason: 'generate_failed' });
      continue;
    }

    const content = String(generated.content || '').trim();
    const newMsgs = [{
      role: 'assistant',
      content,
      ocId: storageId,
      fakeAt: baseFakeAt,
      _proactive: true,
      _fakeSocial: true
    }];
    recordProactiveSuccess(storageId, content, generated.topicDirection, now);

    const merged = sortMessagesChronologically(existingMsgs.concat(newMsgs));
    setMessages(storageId, sessionId, merged);
    revealOcInChatList(oc.id);
    chatOcIds.push(oc.id);
    console.warn('[ocFakeNotify] injected', oc.name || oc.id, messageKind, 'session', sessionId);
  }

  if (skipReasons.length) {
    console.warn('[ocFakeNotify] skipped', skipReasons);
  }

  return chatOcIds;
}

async function injectFakeChatForAllOcs(eligible, beforeTime, lastOpenTime, todayOpenCount) {
  return injectProactiveForChattedOcs(eligible, beforeTime, todayOpenCount);
}

async function maybeInjectFakeMessagesOnAppOpen(openTime, options) {
  const opts = options || {};
  const force = !!opts.force;
  const fromShow = !!opts.fromShow;
  const now = Number(openTime) || Date.now();
  const metaBefore = getFakeMeta();

  const debounceMs = fromShow ? 8000 : 15000;
  if (!force && metaBefore.lastInjectAt && now - metaBefore.lastInjectAt < debounceMs) {
    return { skipped: true, reason: 'debounce' };
  }

  const chatted = getTopChattedOcsForProactive(3);
  if (!chatted.length) {
    clearChatBadge();
    clearGroupChatBadge();
    // 尚未聊过任何 OC：正常跳过，不刷黄字
    return { skipped: true, reason: 'no_chatted_oc' };
  }

  console.warn(
    '[ocFakeNotify] candidates',
    chatted.map((o) => ({ id: o.id, name: o.name, rounds: o.chatRounds }))
  );

  const openBump = bumpTodayAppOpenCount(now);
  setFakeMeta(openBump);

  const lastOpen = metaBefore.lastOpenTime || now - 4 * 3600000;

  let chatOcIds = [];
  try {
    chatOcIds = await injectFakeChatForAllOcs(
      chatted,
      now,
      lastOpen,
      openBump.todayOpenCount
    );
  } catch (e) {
    console.warn('[ocFakeNotify] chat', e);
  }

  clearGroupChatBadge();

  setBadges({
    chat: mergeBadgeIds(getBadges().chatOcIds, chatOcIds).length > 0,
    chatOcIds: mergeBadgeIds(getBadges().chatOcIds, chatOcIds)
  });

  setFakeMeta(
    Object.assign({}, openBump, {
      lastInjectAt: chatOcIds.length ? now : metaBefore.lastInjectAt || 0,
      lastOpenTime: now
    })
  );
  return {
    ok: chatOcIds.length > 0,
    chatOcIds,
    ocCount: chatted.length,
    topOcIds: chatted.map((o) => o.id),
    skipped: !chatOcIds.length,
    reason: chatOcIds.length ? '' : 'none_injected'
  };
}
async function tryInjectProactiveForOc(ocId, openTime) {
  void ocId;
  void openTime;
  return { ok: false, reason: 'app_open_only' };
}

module.exports = {
  getBadges,
  setBadges,
  clearChatBadge,
  clearGroupChatBadge,
  clearChatBadgeForOc,
  clearGroupBadgeForRoom,
  maybeInjectFakeMessagesOnAppOpen,
  tryInjectProactiveForOc
};
