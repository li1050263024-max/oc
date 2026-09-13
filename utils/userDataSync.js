/**
 * 设定本 + 私聊记录云同步（客户端）
 * 云集合：user_notebook / user_chat_meta / user_chat_msgs
 *
 * 防复活：本地写入打 dirty + generation；推送中途若本地再变则重推；
 * 有未同步本地改动时启动拉取绝不覆盖设定本。
 */
const { callCloudFunction, ensureCloudReady } = require('./cloudInit.js');

const META_KEY = 'oc_cloud_sync_meta_v1';
const MAX_PUSH_MSGS = 160;

let _nbTimer = null;
let _chatTimers = {};
let _pulling = false;
let _lastPullAt = 0;
let _applyingCloud = false;
let _nbGeneration = 0;
let _nbPushing = false;
let _nbPushAgain = false;

function isApplyingCloud() {
  return !!_applyingCloud;
}

function withApplyingCloud(fn) {
  _applyingCloud = true;
  try {
    return fn();
  } finally {
    _applyingCloud = false;
  }
}

function readMeta() {
  try {
    const raw = wx.getStorageSync(META_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeMeta(patch) {
  const next = Object.assign({}, readMeta(), patch || {}, { updatedAt: Date.now() });
  try {
    wx.setStorageSync(META_KEY, next);
  } catch (_) {}
  return next;
}

function markNotebookDirty() {
  _nbGeneration += 1;
  writeMeta({
    notebookDirty: true,
    notebookDirtyAt: Date.now(),
    notebookGen: _nbGeneration
  });
  return _nbGeneration;
}

function clearNotebookDirty(pushedAt) {
  writeMeta({
    notebookDirty: false,
    notebookPushedAt: pushedAt || Date.now(),
    notebookCloudAt: pushedAt || Date.now()
  });
}

function markOcDeleted(ocId) {
  const id = String(ocId || '').trim();
  if (!id) return;
  try {
    require('./ocDeletedIds.js').addOcIds([id]);
  } catch (_) {}
  const meta = readMeta();
  const list = Array.isArray(meta.deletedOcIds) ? meta.deletedOcIds.slice() : [];
  if (list.indexOf(id) < 0) list.push(id);
  markNotebookDirty();
  writeMeta({ deletedOcIds: list.slice(-300) });
}

function markOcRestored(ocId) {
  const id = String(ocId || '').trim();
  if (!id) return;
  try {
    require('./ocDeletedIds.js').removeOcIds([id]);
  } catch (_) {}
  try {
    require('./ocDeletedArchive.js').removeIds([id]);
  } catch (_) {}
  const meta = readMeta();
  const list = (Array.isArray(meta.deletedOcIds) ? meta.deletedOcIds : []).filter(
    (x) => String(x) !== id
  );
  markNotebookDirty();
  writeMeta({ deletedOcIds: list.slice(-300) });
}

function filterCloudFavorites(favorites) {
  const deleted = new Set((readMeta().deletedOcIds || []).map(String));
  try {
    require('./ocDeletedIds.js').getDeletedOcIds().forEach((id) => deleted.add(String(id)));
  } catch (_) {}
  if (!deleted.size) return favorites;
  return (favorites || []).filter((f) => f && f.id && !deleted.has(String(f.id)));
}

function mergeDeletedOcIdsFromCloud(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const meta = readMeta();
  const set = new Set((meta.deletedOcIds || []).map(String));
  ids.forEach((id) => {
    if (id) set.add(String(id));
  });
  writeMeta({ deletedOcIds: Array.from(set).slice(-300) });
  try {
    require('./ocDeletedIds.js').addOcIds(Array.from(set));
  } catch (_) {}
}

function flushChatAfterDelete(ocId, sessionIds) {
  if (!ensureCloudReady() || !ocId) return Promise.resolve({ ok: false });
  const ids = (sessionIds || []).filter(Boolean);
  if (!ids.length) return pushChatMetaNow();
  const updatedAt = Date.now();
  return Promise.all(
    ids.map((sid) =>
      callCloudFunction({
        name: 'userDataSync',
        data: {
          action: 'pushChatSession',
          ocId: ocId,
          sessionId: sid,
          messages: [],
          memory: '',
          updatedAt: updatedAt
        },
        timeout: 55000
      })
    )
  ).then(() => pushChatMetaNow());
}

/** 手动从云端恢复当前 OC 的全部会话 */
function pullChatForOc(ocId) {
  if (!ensureCloudReady() || !ocId) return Promise.reject(new Error('无法同步'));
  return callCloudFunction({
    name: 'userDataSync',
    data: { action: 'pull' },
    timeout: 55000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.errMsg || '拉取失败');
    if (r.notebook && Array.isArray(r.notebook.deletedOcIds)) {
      mergeDeletedOcIdsFromCloud(r.notebook.deletedOcIds);
    }
    if (r.chatMeta) applyChatMetaFromCloud(r.chatMeta, { forceOcId: ocId });
    const chatSession = require('./chatSession.js');
    const sessions = (r.chatMeta && r.chatMeta.ocSessions && r.chatMeta.ocSessions[ocId]) || [];
    const tasks = sessions.slice(0, 12).map((s) => {
      const sid = (s && s.id) || 'default';
      return callCloudFunction({
        name: 'userDataSync',
        data: { action: 'pullChatSession', ocId: ocId, sessionId: sid },
        timeout: 40000
      })
        .then((res2) => {
          const r2 = (res2 && res2.result) || {};
          const sess = r2.session;
          if (!r2.ok || !sess || !Array.isArray(sess.messages)) return 0;
          withApplyingCloud(() => {
            chatSession.setMessages(ocId, sid, sess.messages);
            if (sess.memory) chatSession.setSessionMemory(ocId, sid, sess.memory);
          });
          return sess.messages.length;
        })
        .catch(() => 0);
    });
    return Promise.all(tasks).then((counts) => ({
      ok: true,
      sessions: sessions.length,
      messages: counts.reduce((a, b) => a + (Number(b) || 0), 0)
    }));
  });
}

function hasUnsyncedNotebook() {
  const m = readMeta();
  return !!m.notebookDirty;
}

function localNotebookUpdatedAt() {
  try {
    const m = wx.getStorageSync('oc_favorites_meta') || {};
    return Number(m.updatedAt) || 0;
  } catch (_) {
    return 0;
  }
}

function collectOcSessionsMap() {
  const { safeGetFavorites } = require('./favoriteStore.js');
  const chatSession = require('./chatSession.js');
  const map = {};
  const favs = safeGetFavorites();
  favs.forEach((f) => {
    if (!f || !f.id) return;
    const sessions = chatSession.listSessions(f.id).slice(0, 12).map((s) => ({
      id: s.id,
      title: s.title || '对话',
      updatedAt: Number(s.updatedAt) || 0,
      preview: String(s.preview || '').slice(0, 48)
    }));
    if (sessions.length) map[f.id] = sessions;
  });
  return map;
}

function schedulePushNotebook() {
  if (_nbTimer) clearTimeout(_nbTimer);
  _nbTimer = setTimeout(() => {
    _nbTimer = null;
    pushNotebookNow().catch(() => {});
  }, 2800);
}

/** 删除等关键写操作：立刻推云，避免切换页面前未同步被旧云数据盖回 */
function flushNotebookSoon() {
  if (_nbTimer) {
    clearTimeout(_nbTimer);
    _nbTimer = null;
  }
  return pushNotebookNow();
}

function schedulePushChatSession(ocId, sessionId) {
  const key = String(ocId || '') + '::' + String(sessionId || 'default');
  if (_chatTimers[key]) clearTimeout(_chatTimers[key]);
  _chatTimers[key] = setTimeout(() => {
    delete _chatTimers[key];
    pushChatSessionNow(ocId, sessionId).catch(() => {});
  }, 2200);
}

function pushNotebookNow() {
  if (!ensureCloudReady()) return Promise.resolve({ ok: false });
  if (_nbPushing) {
    _nbPushAgain = true;
    return Promise.resolve({ ok: false, queued: true });
  }
  const { safeGetFavorites } = require('./favoriteStore.js');
  let families = [];
  try {
    const fam = require('./ocNotebookFamily.js');
    if (typeof fam.getFamilies === 'function') families = fam.getFamilies() || [];
  } catch (_) {}
  const favorites = safeGetFavorites();
  const gen = _nbGeneration || Number(readMeta().notebookGen) || 0;
  const updatedAt = Math.max(Date.now(), localNotebookUpdatedAt());
  _nbPushing = true;
  _nbPushAgain = false;
  const deletedSet = new Set(
    (Array.isArray(readMeta().deletedOcIds) ? readMeta().deletedOcIds : []).map(String)
  );
  try {
    require('./ocDeletedIds.js')
      .getDeletedOcIds()
      .forEach((id) => deletedSet.add(String(id)));
  } catch (_) {}
  const deletedOcIds = Array.from(deletedSet).slice(-300);
  let deletedArchive = [];
  try {
    deletedArchive = require('./ocDeletedArchive.js').getArchive();
  } catch (_) {}
  return callCloudFunction({
    name: 'userDataSync',
    data: {
      action: 'pushNotebook',
      favorites: favorites,
      families: families,
      deletedOcIds: deletedOcIds,
      deletedArchive: deletedArchive,
      updatedAt: updatedAt
    },
    timeout: 55000
  })
    .then((res) => {
      const r = (res && res.result) || {};
      const stillSameGen = gen === _nbGeneration;
      if (r.ok && stillSameGen && !r.skipped) {
        clearNotebookDirty(r.updatedAt || updatedAt);
        pushChatMetaNow().catch(() => {});
      } else if (r.ok && r.skipped && stillSameGen) {
        // 云端更新，本地未变：接受云端时间戳，但仍保持 dirty 由下次 pull 处理
        writeMeta({ notebookCloudAt: r.updatedAt || updatedAt });
      }
      return r;
    })
    .catch((e) => ({ ok: false, errMsg: String((e && e.message) || e) }))
    .then((r) => {
      _nbPushing = false;
      if (_nbPushAgain || gen !== _nbGeneration) {
        _nbPushAgain = false;
        schedulePushNotebook();
      }
      return r;
    });
}

function pushChatMetaNow() {
  if (!ensureCloudReady()) return Promise.resolve({ ok: false });
  let hiddenOcIds = [];
  try {
    const raw = wx.getStorageSync('oc_chat_hidden_ids');
    if (Array.isArray(raw)) hiddenOcIds = raw;
  } catch (_) {}
  const ocSessions = collectOcSessionsMap();
  const updatedAt = Date.now();
  return callCloudFunction({
    name: 'userDataSync',
    data: {
      action: 'pushChatMeta',
      ocSessions: ocSessions,
      hiddenOcIds: hiddenOcIds,
      updatedAt: updatedAt
    },
    timeout: 30000
  }).then((res) => (res && res.result) || { ok: false });
}

function pushChatSessionNow(ocId, sessionId) {
  if (!ensureCloudReady() || !ocId) return Promise.resolve({ ok: false });
  const chatSession = require('./chatSession.js');
  const sid = sessionId || 'default';
  let messages = chatSession.getMessages(ocId, sid) || [];
  if (messages.length > MAX_PUSH_MSGS) messages = messages.slice(-MAX_PUSH_MSGS);
  const memory = chatSession.getSessionMemory(ocId, sid) || '';
  const updatedAt = Date.now();
  return callCloudFunction({
    name: 'userDataSync',
    data: {
      action: 'pushChatSession',
      ocId: ocId,
      sessionId: sid,
      messages: messages,
      memory: memory,
      updatedAt: updatedAt
    },
    timeout: 55000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (r.ok) pushChatMetaNow().catch(() => {});
    return r;
  });
}

function applyNotebookFromCloud(notebook) {
  if (!notebook || !Array.isArray(notebook.favorites)) return false;
  if (hasUnsyncedNotebook()) return false;
  if (Array.isArray(notebook.deletedOcIds)) {
    mergeDeletedOcIdsFromCloud(notebook.deletedOcIds);
  }
  if (Array.isArray(notebook.deletedArchive)) {
    try {
      require('./ocDeletedArchive.js').mergeFromCloud(notebook.deletedArchive);
    } catch (_) {}
  }
  const favorites = filterCloudFavorites(notebook.favorites);
  return withApplyingCloud(() => {
    const { safeSetFavorites } = require('./favoriteStore.js');
    const ok = safeSetFavorites(favorites, { allowShrink: true });
    if (!ok) return false;
    if (Array.isArray(notebook.families)) {
      try {
        wx.setStorageSync('oc_notebook_families', notebook.families);
      } catch (_) {}
    }
    writeMeta({
      notebookCloudAt: Number(notebook.updatedAt) || Date.now(),
      notebookPulledAt: Date.now(),
      notebookDirty: false
    });
    return true;
  });
}

function applyChatMetaFromCloud(chatMeta, opts) {
  if (!chatMeta) return;
  const forceOcId = opts && opts.forceOcId ? String(opts.forceOcId).trim() : '';
  const ocSessions = chatMeta.ocSessions || {};
  const chatSession = require('./chatSession.js');
  Object.keys(ocSessions).forEach((ocId) => {
    if (forceOcId && ocId !== forceOcId) return;
    const cloudList = ocSessions[ocId];
    if (!Array.isArray(cloudList) || !cloudList.length) return;
    try {
      const localList = chatSession.listSessions(ocId);
      let incoming = cloudList;
      try {
        incoming = require('./ocDeletedIds.js').filterSessions(ocId, cloudList);
      } catch (_) {}
      if (!localList.length || (forceOcId && ocId === forceOcId)) {
        chatSession.saveSessions(ocId, incoming);
        return;
      }
      const merged = localList.slice();
      incoming.forEach((cs) => {
        if (!cs || !cs.id) return;
        try {
          if (require('./ocDeletedIds.js').isSessionDeleted(ocId, cs.id)) return;
        } catch (_) {}
        const idx = merged.findIndex((s) => s.id === cs.id);
        if (idx >= 0) merged[idx] = Object.assign({}, merged[idx], cs);
      });
      chatSession.saveSessions(ocId, merged);
    } catch (_) {}
  });
  if (Array.isArray(chatMeta.hiddenOcIds)) {
    try {
      wx.setStorageSync('oc_chat_hidden_ids', chatMeta.hiddenOcIds);
    } catch (_) {}
  }
}

function pullChatSessionsFromMeta(chatMeta) {
  if (!chatMeta || !chatMeta.ocSessions) return Promise.resolve();
  const chatSession = require('./chatSession.js');
  const tasks = [];
  Object.keys(chatMeta.ocSessions).forEach((ocId) => {
    const sessions = chatMeta.ocSessions[ocId] || [];
    const localSessions = chatSession.listSessions(ocId);
    const localIdSet = {};
    localSessions.forEach((s) => {
      if (s && s.id) localIdSet[s.id] = true;
    });
    sessions.slice(0, 8).forEach((s) => {
      const sid = s && s.id ? s.id : 'default';
      if (localSessions.length && !localIdSet[sid]) return;
      try {
        if (require('./ocDeletedIds.js').isSessionDeleted(ocId, sid)) return;
      } catch (_) {}
      const localMsgs = chatSession.getMessages(ocId, sid) || [];
      const localLatest = localMsgs.length
        ? Number(localMsgs[localMsgs.length - 1].createdAt) || 0
        : 0;
      const cloudHint = Number(s.updatedAt) || 0;
      if (localMsgs.length && localLatest >= cloudHint) return;
      tasks.push(
        callCloudFunction({
          name: 'userDataSync',
          data: { action: 'pullChatSession', ocId: ocId, sessionId: sid },
          timeout: 40000
        })
          .then((res) => {
            const r = (res && res.result) || {};
            const sess = r.session;
            if (!r.ok || !sess || !Array.isArray(sess.messages)) return;
            if (!localMsgs.length || Number(sess.updatedAt) >= localLatest) {
              withApplyingCloud(() => {
                chatSession.setMessages(ocId, sid, sess.messages);
                if (sess.memory) chatSession.setSessionMemory(ocId, sid, sess.memory);
              });
            }
          })
          .catch(() => {})
      );
    });
  });
  const limited = tasks.slice(0, 20);
  return Promise.all(limited);
}

/**
 * 启动拉取：有未同步本地改动时只推不拉设定本；否则 LWW
 */
function pullOnLaunch() {
  if (!ensureCloudReady()) return Promise.resolve({ ok: false });
  if (_pulling) return Promise.resolve({ ok: false, busy: true });
  if (Date.now() - _lastPullAt < 8000) return Promise.resolve({ ok: true, skipped: true });
  _pulling = true;
  _lastPullAt = Date.now();

  if (hasUnsyncedNotebook()) {
    return pushNotebookNow()
      .catch(() => {})
      .then(() => {
        _pulling = false;
        return { ok: true, pushedInstead: true };
      });
  }

  return callCloudFunction({
    name: 'userDataSync',
    data: { action: 'pull' },
    timeout: 55000
  })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) return r;
      if (hasUnsyncedNotebook()) {
        pushNotebookNow().catch(() => {});
        return r;
      }
      const { safeGetFavorites } = require('./favoriteStore.js');
      const localFavs = safeGetFavorites();
      const localAt = localNotebookUpdatedAt();
      const cloudNb = r.notebook;
      const cloudAt = cloudNb ? Number(cloudNb.updatedAt) || 0 : 0;

      if (cloudNb && Array.isArray(cloudNb.favorites)) {
        if (Array.isArray(cloudNb.deletedOcIds)) {
          mergeDeletedOcIdsFromCloud(cloudNb.deletedOcIds);
        }
        // 本地为空且云有数据 → 拉；云明显更新且本地无 dirty → 拉
        // 允许云端空列表覆盖本地（用户已删光并同步成功）
        if (!localFavs.length && cloudNb.favorites.length) {
          applyNotebookFromCloud(cloudNb);
        } else if (cloudAt > localAt + 1500 && !hasUnsyncedNotebook()) {
          applyNotebookFromCloud(cloudNb);
        } else if (localFavs.length && cloudAt < localAt - 1500) {
          pushNotebookNow().catch(() => {});
        } else if (localFavs.length && !cloudAt) {
          pushNotebookNow().catch(() => {});
        }
      } else if (localFavs.length) {
        pushNotebookNow().catch(() => {});
      }

      if (r.chatMeta) {
        const localEmptyChat = !localFavs.length || localAt === 0;
        if (localEmptyChat || Number(r.chatMeta.updatedAt) >= localAt) {
          applyChatMetaFromCloud(r.chatMeta);
          return pullChatSessionsFromMeta(r.chatMeta).then(() => r);
        }
      }
      return r;
    })
    .catch((e) => ({ ok: false, errMsg: String((e && e.message) || e) }))
    .then((r) => {
      _pulling = false;
      return r;
    });
}

function flushPending() {
  if (_nbTimer) {
    clearTimeout(_nbTimer);
    _nbTimer = null;
  }
  if (hasUnsyncedNotebook() || localNotebookUpdatedAt() > 0) {
    pushNotebookNow().catch(() => {});
  }
  Object.keys(_chatTimers).forEach((key) => {
    clearTimeout(_chatTimers[key]);
    delete _chatTimers[key];
    const parts = key.split('::');
    if (parts[0]) pushChatSessionNow(parts[0], parts[1] || 'default').catch(() => {});
  });
}

function listCloudBackup() {
  if (!ensureCloudReady()) return Promise.resolve({ ok: false, errMsg: '云开发未就绪' });
  return callCloudFunction({
    name: 'userDataSync',
    data: { action: 'listBackup' },
    timeout: 40000
  }).then((res) => {
    const r = (res && res.result) || {};
    if (!r.ok) return r;
    try {
      if (Array.isArray(r.deletedArchive)) {
        require('./ocDeletedArchive.js').mergeFromCloud(r.deletedArchive);
      }
    } catch (_) {}
    return r;
  });
}

module.exports = {
  schedulePushNotebook,
  schedulePushChatSession,
  pushNotebookNow,
  pushChatSessionNow,
  flushNotebookSoon,
  pullOnLaunch,
  flushPending,
  isApplyingCloud,
  markNotebookDirty,
  markOcDeleted,
  markOcRestored,
  listCloudBackup,
  hasUnsyncedNotebook,
  flushChatAfterDelete,
  pullChatForOc
};
