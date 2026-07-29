const RECALL_MS = 2 * 60 * 1000;
const TIME_DIVIDER_GAP_MS = 5 * 60 * 1000;

/** 优先真实发送时刻 createdAt；无则 fakeAt（如 OC 主动消息） */
function getMessageTimestamp(msg) {
  if (!msg) return 0;
  const created = Number(msg.createdAt) || 0;
  if (created > 0) return created;
  const fake = Number(msg.fakeAt) || 0;
  return fake > 0 ? fake : 0;
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 按用户手机本地时区格式化 Unix 毫秒时间戳 */
function formatChatMessageTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const clock = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msgDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.floor((todayStart - msgDayStart) / 86400000);

  if (dayDiff === 0) return clock;
  if (dayDiff === 1) return '昨天 ' + clock;
  if (dayDiff < 7 && now.getFullYear() === d.getFullYear()) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[d.getDay()] + ' ' + clock;
  }
  if (now.getFullYear() === d.getFullYear()) {
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + clock;
  }
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + clock;
}

function enrichChatMessages(messages, now) {
  const list = Array.isArray(messages) ? messages : [];
  const tNow = Number(now) || Date.now();
  let lastTs = 0;
  return list.map((m) => {
    if (!m) return m;
    const ts = getMessageTimestamp(m);
    const showTimeDivider = ts > 0 && (!lastTs || ts - lastTs >= TIME_DIVIDER_GAP_MS);
    if (ts) lastTs = ts;
    const canRecall =
      m.role === 'user' &&
      !m.recalled &&
      !m.kind &&
      String(m.content || '').trim() &&
      ts > 0 &&
      tNow - ts <= RECALL_MS;
    return Object.assign({}, m, {
      timeLabel: ts ? formatChatMessageTime(ts) : '',
      showTimeDivider: !!showTimeDivider,
      canRecall: !!canRecall
    });
  });
}

function prepareMessagesForDisplay(messages, now) {
  const list = Array.isArray(messages) ? messages : [];
  return {
    list: enrichChatMessages(list, now),
    changed: false
  };
}

function stampOutgoingMessage(msg) {
  return Object.assign({}, msg || {}, { createdAt: Date.now() });
}

function findPrecedingUserMessage(list, beforeIndex) {
  const idx = Number(beforeIndex);
  if (isNaN(idx) || idx < 0) return -1;
  for (let i = idx - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.role === 'user' && !m.recalled && String(m.content || '').trim()) {
      return i;
    }
  }
  return -1;
}

const UI_FIELD_KEYS = ['timeLabel', 'showTimeDivider', 'canRecall'];

function stripMessageUiFields(messages) {
  return (messages || []).map((m) => {
    if (!m) return m;
    const out = Object.assign({}, m);
    UI_FIELD_KEYS.forEach((k) => {
      delete out[k];
    });
    return out;
  });
}

module.exports = {
  RECALL_MS,
  getMessageTimestamp,
  formatChatMessageTime,
  enrichChatMessages,
  prepareMessagesForDisplay,
  stampOutgoingMessage,
  findPrecedingUserMessage,
  stripMessageUiFields
};
