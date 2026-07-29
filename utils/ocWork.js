/**
 * 三条常用语与三条态度是否已填写完整（可用于 OC 对话 / OC 小传）
 */
function isLayer3Ready(work) {
  if (!work || !work.result) return false;
  const c = work.catchphrases || [];
  const a = work.attitudes || [];
  if (c.length < 3 || a.length < 3) return false;
  for (let i = 0; i < 3; i++) {
    if (!String(c[i] || '').trim()) return false;
  }
  for (let i = 0; i < 3; i++) {
    if (!a[i] || !String(a[i].attitude || '').trim()) return false;
  }
  return true;
}

/** 设定本保存时写入进行中存档的完成标记 */
function applyNotebookFlags(work) {
  if (!work) return work;
  const hasBg = work.background && String(work.background.worldview || '').trim();
  work.layer2Done = !!hasBg;
  const ready = isLayer3Ready(work);
  work.layer3Done = ready;
  work.layer3Confirmed = ready;
  return work;
}

module.exports = {
  isLayer3Ready,
  applyNotebookFlags
};
