/** 抽卡翻面：以卡片中线为轴旋转两圈半后停在牌面（180deg） */

/** 每圈 360° 用时（毫秒），三页抽卡统一 */
const SPIN_REV_MS = 1500;

const SPIN_ONCE_DEG = 900;

const SPIN_ONCE_MS = Math.round((SPIN_ONCE_DEG / 360) * SPIN_REV_MS);

const AI_WAIT_CYCLE_MS = SPIN_REV_MS;

/** 第二、三环节 AI 等待：紫 → 浅紫 */
const AI_WAIT_COLOR_MS = 3000;

/** 第一环节：等待转圈 + 紫 → 浅紫 + 诗句淡出 */
const LAYER1_WAIT_COLOR_MS = 1500;

function onCardSpinEnd(page, e, callback) {
  if (!page.data.cardSpinning) return;
  if (e && e.detail && e.detail.animationName && e.detail.animationName !== 'oc-card-spin-once') {
    return;
  }
  page.setData({ cardSpinning: false, cardFlipped: true }, callback);
}

function startCardSpin(page, dataPatch, callback) {
  page.setData(
    Object.assign({}, dataPatch, {
      cardAiWaiting: false,
      cardSpinning: true,
      cardFlipped: false
    }),
    callback
  );
}

/** 第二、三环节：旋转等待 + 3s 紫 → 浅紫 */
function startAiWaiting(page, dataPatch) {
  page._aiWaitStartedAt = Date.now();
  page.setData(
    Object.assign({}, dataPatch || {}, {
      cardAiWaiting: true,
      cardSpinning: false,
      cardFlipped: false
    })
  );
}

function cancelAiWaiting(page) {
  page._aiWaitStartedAt = null;
  page._layer1WaitStartedAt = null;
  page.setData({
    cardAiWaiting: false,
    cardLayer1Waiting: false
  });
}

/** 第一环节：1.5s 转圈等待 + 紫 → 浅紫（本地抽卡，无云端 AI） */
function startLayer1Waiting(page, dataPatch) {
  page._layer1WaitStartedAt = Date.now();
  page.setData(
    Object.assign({}, dataPatch || {}, {
      cardAiWaiting: true,
      cardLayer1Waiting: true,
      cardSpinning: false,
      cardFlipped: false
    })
  );
}

function endLayer1WaitingThenSpin(page, dataPatch, callback) {
  const started = page._layer1WaitStartedAt || Date.now();
  const elapsed = Date.now() - started;
  const colorRemain = Math.max(0, LAYER1_WAIT_COLOR_MS - elapsed);
  const cycleRemain = page.data.cardAiWaiting ? msUntilWaitCycleEnd(started) : 0;
  const delay = Math.max(colorRemain, cycleRemain);
  page._layer1WaitStartedAt = null;

  const runSpin = function () {
    page.setData(
      Object.assign({}, dataPatch || {}, {
        cardAiWaiting: false,
        cardLayer1Waiting: false,
        cardSpinning: true,
        cardFlipped: false
      }),
      callback
    );
  };

  if (delay > 0) {
    setTimeout(runSpin, delay);
  } else {
    runSpin();
  }
}

function msUntilWaitCycleEnd(startedAt) {
  const elapsed = Date.now() - startedAt;
  const cycle = AI_WAIT_CYCLE_MS;
  if (elapsed < cycle) {
    return cycle - elapsed;
  }
  const remainder = elapsed % cycle;
  return remainder === 0 ? 0 : cycle - remainder;
}

function endAiWaitingThenSpin(page, dataPatch, callback) {
  const started = page._aiWaitStartedAt || Date.now();
  page._aiWaitStartedAt = null;
  const elapsed = Date.now() - started;
  const cycleRemain = msUntilWaitCycleEnd(started);
  const colorRemain = Math.max(0, AI_WAIT_COLOR_MS - elapsed);
  const delay = Math.max(cycleRemain, colorRemain);

  const runSpin = function () {
    page.setData(
      Object.assign({}, dataPatch || {}, {
        cardAiWaiting: false,
        cardSpinning: true,
        cardFlipped: false
      }),
      callback
    );
  };

  if (delay > 0) {
    setTimeout(runSpin, delay);
  } else {
    runSpin();
  }
}

function isCardBusy(page) {
  return !!(page.data.cardSpinning || page.data.cardAiWaiting);
}

module.exports = {
  SPIN_REV_MS,
  SPIN_ONCE_MS,
  AI_WAIT_CYCLE_MS,
  AI_WAIT_COLOR_MS,
  LAYER1_WAIT_COLOR_MS,
  onCardSpinEnd,
  startCardSpin,
  startAiWaiting,
  startLayer1Waiting,
  cancelAiWaiting,
  endAiWaitingThenSpin,
  endLayer1WaitingThenSpin,
  isCardBusy
};
