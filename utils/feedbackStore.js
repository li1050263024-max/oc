const STORAGE_KEY = 'oc_feedback_records';
const MAX_RECORDS = 50;

function normalizeStatus(status) {
  return status === 'read' ? 'read' : 'unread';
}

function getRecords() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function setRecords(list) {
  const next = (list || []).slice(0, MAX_RECORDS);
  wx.setStorageSync(STORAGE_KEY, next);
  return next;
}

function addRecord(entry) {
  const item = {
    id: (entry && entry.cloudId) || 'local_' + Date.now(),
    content: String((entry && entry.content) || '').trim(),
    timeMs: (entry && entry.timeMs) || Date.now(),
    status: normalizeStatus(entry && entry.status),
    reply: String((entry && entry.reply) || '').trim(),
    replyTimeMs: (entry && entry.replyTimeMs) || 0
  };
  if (!item.content) return getRecords();
  const list = getRecords().filter((r) => r.id !== item.id);
  list.unshift(item);
  return setRecords(list);
}

function syncFromCloud(items) {
  const mapped = (items || [])
    .map((item) => ({
      id: item._id || item.id || '',
      content: String(item.content || '').trim(),
      timeMs: item.createTimeMs || 0,
      status: normalizeStatus(item.status),
      reply: String(item.reply || '').trim(),
      replyTimeMs: item.replyTimeMs || 0
    }))
    .filter((item) => item.content)
    .sort((a, b) => (b.timeMs || 0) - (a.timeMs || 0));
  return setRecords(mapped);
}

function formatTimeLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function mapRecordsForDisplay(list) {
  return (list || []).map((item) => {
    const status = normalizeStatus(item.status);
    return {
      id: item.id,
      content: item.content,
      timeLabel: formatTimeLabel(item.timeMs),
      status,
      statusLabel: status === 'read' ? '已查收' : '未查收',
      reply: item.reply || '',
      replyTimeLabel: item.reply ? formatTimeLabel(item.replyTimeMs) : ''
    };
  });
}

module.exports = {
  getRecords,
  addRecord,
  syncFromCloud,
  formatTimeLabel,
  mapRecordsForDisplay,
  normalizeStatus
};
