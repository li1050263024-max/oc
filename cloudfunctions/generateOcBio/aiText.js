/**
 * 微信云开发混元（成长计划免费额度：hy3 / hy3-preview）
 * 需 wx-server-sdk >= 3.0.5-beta.1，控制台开启对应模型
 */
const cloud = require('wx-server-sdk');

let _ready = false;

function ensureCloud() {
  if (_ready) return;
  try {
    cloud.init({
      env: cloud.DYNAMIC_CURRENT_ENV || 'cloud1-d3gkbz2nf0c84c381',
      timeout: 60000
    });
  } catch (_) {
    // 调用方可能已 init
  }
  _ready = true;
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number, model?:string, provider?:string}} [opts]
 * @returns {Promise<{text:string, usage?:object, raw?:object}>}
 */
async function chatCompletions(messages, opts) {
  ensureCloud();
  const options = opts || {};
  if (typeof cloud.ai !== 'function') {
    throw new Error(
      'wx-server-sdk 过旧无 cloud.ai()，请升级到 3.0.5-beta.1+ 并「云端安装依赖」'
    );
  }

  const provider =
    options.provider ||
    process.env.AI_PROVIDER ||
    'cloudbase'; // 免费额度优先，用尽可扣套餐；仅吃免费包可改 hunyuan-v3
  const modelName =
    options.model || process.env.HUNYUAN_MODEL || 'hy3-preview';

  const ai = cloud.ai();
  const model = ai.createModel(provider);
  const payload = {
    model: modelName,
    messages: messages || []
  };
  if (options.temperature != null) payload.temperature = Number(options.temperature);
  if (options.maxTokens != null) payload.max_tokens = Number(options.maxTokens);

  const result = await model.generateText(payload);
  if (result && result.error) {
    const err = result.error;
    throw new Error(
      String((err && (err.message || err.errMsg || err.code)) || err || '混元调用失败')
    );
  }
  const text = String((result && result.text) || '').trim();
  return {
    text: text,
    usage: result && result.usage,
    raw: result
  };
}

/** 兼容旧 OpenAI 风格取 content */
function pickContent(resultLike) {
  if (!resultLike) return '';
  if (typeof resultLike.text === 'string') return resultLike.text.trim();
  const c =
    resultLike.choices &&
    resultLike.choices[0] &&
    resultLike.choices[0].message &&
    resultLike.choices[0].message.content;
  return String(c || '').trim();
}

module.exports = {
  chatCompletions,
  pickContent,
  ensureCloud
};
