/**
 * 朋友圈消息提醒：未读 inbox，点击查看后清空角标
 */
const STORAGE_KEY = 'oc_moments_msg_inbox_v1';
const MAX_KEEP = 80;

function readState() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return { unread: [], history: [] };
    return {
      unread: Array.isArray(raw.unread) ? raw.unread : [],
      history: Array.isArray(raw.history) ? raw.history : []
    };
  } catch (_) {
    return { unread: [], history: [] };
  }
}

function writeState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, {
      unread: (state.unread || []).slice(0, MAX_KEEP),
      history: (state.history || []).slice(0, MAX_KEEP),
      updatedAt: Date.now()
    });
  } catch (err) {
    console.warn('[ocMomentsNotify] write', err);
  }
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const text = String(raw.text || '').trim();
  if (!id || !text) return null;
  return {
    id,
    ocId: String(raw.ocId || ''),
    ocName: String(raw.ocName || 'OC').trim() || 'OC',
    avatarUrl: String(raw.avatarUrl || ''),
    text: text.slice(0, 200),
    postId: String(raw.postId || ''),
    createdAt: Number(raw.createdAt) || Date.now()
  };
}

function addReplyNotify(payload) {
  if (!payload || payload.skipped || !payload.text) return getUnreadInfo();
  const item = normalizeItem({
    id: 'mn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ocId: payload.ocId,
    ocName: payload.ocName,
    avatarUrl: payload.avatarUrl,
    text: payload.text,
    postId: payload.postId,
    createdAt: Date.now()
  });
  if (!item) return getUnreadInfo();
  const state = readState();
  state.unread.unshift(item);
  writeState(state);
  return getUnreadInfo();
}

function getUnreadInfo() {
  const state = readState();
  const unread = state.unread.map(normalizeItem).filter(Boolean);
  const latest = unread[0] || null;
  return {
    count: unread.length,
    latest: latest,
    text: unread.length ? unread.length + ' 条新消息' : '',
    visible: unread.length > 0
  };
}

/** 打开消息列表：未读并入历史并清空角标，返回完整列表（新在前） */
function openMessageList() {
  const state = readState();
  const unread = state.unread.map(normalizeItem).filter(Boolean);
  const history = state.history.map(normalizeItem).filter(Boolean);
  const merged = unread.concat(history).slice(0, MAX_KEEP);
  writeState({ unread: [], history: merged });
  return merged;
}

function getMessageList() {
  const state = readState();
  const unread = state.unread.map(normalizeItem).filter(Boolean);
  const history = state.history.map(normalizeItem).filter(Boolean);
  return unread.concat(history).slice(0, MAX_KEEP);
}

function formatMsgTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = d.getHours();
  const mm = d.getMinutes();
  return (
    m +
    '月' +
    day +
    '日 ' +
    (hh < 10 ? '0' : '') +
    hh +
    ':' +
    (mm < 10 ? '0' : '') +
    mm
  );
}

module.exports = {
  addReplyNotify,
  getUnreadInfo,
  openMessageList,
  getMessageList,
  formatMsgTime
};
