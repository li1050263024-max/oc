/**
 * 判断语言与态度层是否已生成（可用于 OC 对话 / OC 小传）
 */
function isLayer3Ready(work) {
  if (!work || !work.result) return false;
  const c = work.catchphrases || [];
  const a = work.attitudes || [];
  return c.length >= 3 && a.length >= 3;
}

module.exports = {
  isLayer3Ready
};
