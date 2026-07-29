/**
 * OC 抖音题材池（运营可改文案标签，不接真热搜）
 */

const TOPIC_POOL = [
  { id: 'daily', label: '日常碎片', hint: '随手拍的日常感、生活小瞬间', tags: ['日常', '碎片'] },
  { id: 'outfit', label: '今日穿搭', hint: '出镜感、造型、氛围穿搭', tags: ['穿搭', '今日份'] },
  { id: 'mood', label: '情绪营业', hint: 'emo / 松弛 / 嘴硬心软等情绪向短句', tags: ['心情', '状态'] },
  { id: 'flex', label: '轻微凡尔赛', hint: '不露骨炫耀，用语气带出优越或得意', tags: ['随便拍拍'] },
  { id: 'roast', label: '吐槽一下', hint: '吐槽小事、吐槽自己、吐槽世界', tags: ['吐槽'] },
  { id: 'soft', label: '温柔营业', hint: '温柔、治愈、轻声细语式短文案', tags: ['治愈', '晚安'] },
  { id: 'cool', label: '高冷出图', hint: '短、冷、距离感，少废话', tags: ['出图'] },
  { id: 'play', label: '玩梗口吻', hint: '轻松玩梗但不提真实明星/政治热搜名', tags: ['整活'] },
  { id: 'night', label: '深夜发言', hint: '夜里才想发的句子，克制一点', tags: ['深夜'] },
  { id: 'work', label: '人设相关', hint: '结合职业/癖好/世界观的出镜感', tags: ['人设'] }
];

function localDateKey(ts) {
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function pickTopicForOc(oc, salt) {
  const pool = TOPIC_POOL;
  const name = String((oc && oc.name) || '');
  const pers = String((oc && oc.personalityText) || '');
  let idx =
    (String(salt || localDateKey()).length * 17 +
      name.length * 31 +
      pers.length * 13) %
    pool.length;
  if (idx < 0) idx = 0;
  // 性格偏向微调
  if (/冷|傲|高冷|孤/.test(pers)) {
    const cool = pool.find((t) => t.id === 'cool');
    if (cool && Math.random() > 0.45) return cool;
  }
  if (/温柔|软|治愈|黏/.test(pers)) {
    const soft = pool.find((t) => t.id === 'soft');
    if (soft && Math.random() > 0.45) return soft;
  }
  if (/活泼|吐槽|毒舌|损/.test(pers)) {
    const roast = pool.find((t) => t.id === 'roast');
    if (roast && Math.random() > 0.5) return roast;
  }
  return pool[idx] || pool[0];
}

function formatTopicForPrompt(topic) {
  const t = topic || TOPIC_POOL[0];
  return (
    '题材：' +
    t.label +
    '（' +
    t.hint +
    '）；可用话题标签：' +
    (t.tags || []).map((x) => '#' + x).join(' ')
  );
}

module.exports = {
  TOPIC_POOL,
  pickTopicForOc,
  formatTopicForPrompt,
  localDateKey
};
