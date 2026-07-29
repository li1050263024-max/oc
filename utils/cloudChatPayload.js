/**
 * 压缩 ocChat 云函数入参，避免 cloud.callFunction data exceed max size（约 100KB 字节）
 * 注意：JSON.stringify().length 是字符数，中文 UTF-8 约 3 字节/字，必须按字节估算。
 */

const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CONTENT = 480;
const MAX_SYSTEM_PROMPT = 3600;
const MAX_USER_MESSAGE = 800;
/** 留余量，微信建议临界约 100KB */
const MAX_PAYLOAD_BYTES = 88000;

function utf8ByteLength(str) {
  const s = String(str || '');
  if (typeof TextEncoder !== 'undefined') {
    try {
      return new TextEncoder().encode(s).length;
    } catch (_) {}
  }
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x7f) n += 1;
    else if (c <= 0x7ff) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function roughByteSize(obj) {
  try {
    return utf8ByteLength(JSON.stringify(obj));
  } catch (_) {
    return MAX_PAYLOAD_BYTES + 1;
  }
}

function trimAiHistory(history, maxItems, maxContent) {
  const list = Array.isArray(history) ? history : [];
  const n = Math.max(1, maxItems || MAX_HISTORY_ITEMS);
  const cap = Math.max(80, maxContent || MAX_HISTORY_CONTENT);
  return list
    .filter((m) => m && m.content)
    .slice(-n)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, cap)
    }));
}

function trimOcChatPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const out = Object.assign({}, data);
  out.systemPrompt = String(out.systemPrompt != null ? out.systemPrompt : '').slice(
    0,
    MAX_SYSTEM_PROMPT
  );
  out.userMessage = String(out.userMessage != null ? out.userMessage : '').slice(
    0,
    MAX_USER_MESSAGE
  );
  out.history = trimAiHistory(out.history, MAX_HISTORY_ITEMS, MAX_HISTORY_CONTENT);

  // 去掉可能被误塞进 data 的大字段
  delete out.messages;
  delete out.work;
  delete out.members;
  delete out.scenario;

  let size = roughByteSize(out);
  let histCap = MAX_HISTORY_ITEMS;
  let contentCap = MAX_HISTORY_CONTENT;
  let sysCap = MAX_SYSTEM_PROMPT;

  while (size > MAX_PAYLOAD_BYTES && (histCap > 2 || contentCap > 120 || sysCap > 1600)) {
    if (histCap > 2) histCap = Math.max(2, Math.floor(histCap * 0.65));
    if (contentCap > 120) contentCap = Math.max(120, Math.floor(contentCap * 0.7));
    if (sysCap > 1600) sysCap = Math.max(1600, Math.floor(sysCap * 0.75));
    out.systemPrompt = String(data.systemPrompt != null ? data.systemPrompt : '').slice(
      0,
      sysCap
    );
    out.history = trimAiHistory(data.history, histCap, contentCap);
    size = roughByteSize(out);
  }

  if (size > MAX_PAYLOAD_BYTES) {
    out.history = trimAiHistory(out.history, 2, 100);
    out.systemPrompt = out.systemPrompt.slice(0, 1400);
    out.userMessage = out.userMessage.slice(0, 400);
  }
  return out;
}

module.exports = {
  trimOcChatPayload,
  trimAiHistory,
  roughByteSize,
  MAX_HISTORY_ITEMS,
  MAX_SYSTEM_PROMPT,
  MAX_PAYLOAD_BYTES
};
