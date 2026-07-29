const { buildFakeTimestamps } = require('./ocMomentsStore.js');

function randomCount1to3() {
  return 1 + Math.floor(Math.random() * 3);
}

/** 假消息：每个 OC 每次仅 1 条 */
function buildFakeChatPlan(eligible) {
  return (eligible || []).map((oc) => ({
    oc,
    count: 1
  }));
}

/** 朋友圈：每个 OC 每天 1～2 条（由 ocMomentsStore 按配额计算） */
function buildAllOcPlan(eligibleWithCount) {
  return (eligibleWithCount || []).map((entry) => ({
    oc: entry.oc,
    count: Math.max(1, Math.min(2, Number(entry.count) || 1))
  }));
}

/** 朋友圈发帖时间：当天内分散，展示为年月日 */
function assignMomentsCalendarTimestamps(interleaved, now) {
  const { buildTodayMomentTimestamps } = require('./ocMomentsStore.js');
  const list = interleaved || [];
  if (!list.length) return [];
  const t = Number(now) || Date.now();
  const stamps = buildTodayMomentTimestamps(list.length, t);
  return list.map((item, i) =>
    Object.assign({}, item, {
      createdAt: stamps[i] != null ? stamps[i] : t,
      fakeAt: stamps[i] != null ? stamps[i] : t
    })
  );
}

/**
 * 多 OC 内容轮询交错：A1,B1,C1,A2,B2…
 * @param {Array<{ oc, items: Array }>} groups
 */
function interleaveOcItems(groups) {
  const queues = (groups || []).map((g) => ({
    oc: g.oc,
    items: (g.items || []).slice()
  }));
  const out = [];
  let round = 0;
  while (queues.some((q) => q.items.length)) {
    for (let i = 0; i < queues.length; i++) {
      const q = queues[i];
      if (!q.items.length) continue;
      const item = q.items.shift();
      out.push(Object.assign({}, item, { oc: q.oc, ocId: q.oc.id, ocName: q.oc.name }));
    }
    round += 1;
    if (round > 500) break;
  }
  return out;
}

/** 为交错后的列表统一分配假时间（新→旧，均在 beforeTime 之前） */
function assignInterleavedTimestamps(interleaved, beforeTime, lastOpenTime) {
  const list = interleaved || [];
  if (!list.length) return [];
  const spanHours = Math.min(14, Math.max(4, Math.ceil(list.length / 3)));
  const last = Number(lastOpenTime) || Number(beforeTime) - spanHours * 3600000;
  const stamps = buildFakeTimestamps(list.length, beforeTime, last);
  return list.map((item, i) =>
    Object.assign({}, item, {
      createdAt: stamps[i],
      fakeAt: stamps[i]
    })
  );
}

module.exports = {
  randomCount1to3,
  buildFakeChatPlan,
  buildAllOcPlan,
  interleaveOcItems,
  assignInterleavedTimestamps,
  assignMomentsCalendarTimestamps
};
