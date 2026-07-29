/** 将 OC 对话绘制为长图（Canvas 2D） */
const { getSnapshotColors } = require('./uiTheme.js');
const CANVAS_WIDTH = 750;
const PADDING = 36;
const MSG_GAP = 28;
const BUBBLE_PAD_X = 28;
const BUBBLE_PAD_Y = 22;
const FONT_SIZE = 28;
const LINE_HEIGHT = 44;
const TITLE_GAP = 36;
const MAX_BUBBLE_RATIO = 0.78;
/** 逻辑高度上限；真机还需保证 height×dpr ≤ 系统画布上限 */
const MAX_CANVAS_HEIGHT = 14000;
/** iOS/部分安卓 Canvas 像素边长上限，超出会报 set height out of range */
const MAX_CANVAS_BUFFER = 16384;

const COLOR_TEXT = '#374151';
const COLOR_USER_TEXT = '#ffffff';
const COLOR_ASSIST_BG = 'rgba(255, 255, 255, 0.25)';
const COLOR_ASSIST_BORDER = 'rgba(255, 255, 255, 0.45)';

function wrapTextLines(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  paragraphs.forEach((para, pi) => {
    if (pi > 0) lines.push('');
    let line = '';
    const chars = para.split('');
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (!para && pi === 0) lines.push('');
  });
  return lines.length ? lines : [''];
}

function measureMessage(ctx, msg, contentWidth) {
  const maxBubbleW = Math.floor(contentWidth * MAX_BUBBLE_RATIO);
  const textMaxW = maxBubbleW - BUBBLE_PAD_X * 2;
  ctx.font = FONT_SIZE + 'px sans-serif';
  const lines = wrapTextLines(ctx, msg.content, textMaxW);
  const bubbleW = Math.min(
    maxBubbleW,
    Math.max(
      BUBBLE_PAD_X * 2 + 40,
      lines.reduce((w, ln) => Math.max(w, ctx.measureText(ln).width), 0) + BUBBLE_PAD_X * 2
    )
  );
  const bubbleH = lines.length * LINE_HEIGHT + BUBBLE_PAD_Y * 2;
  return { lines, bubbleW, bubbleH, isUser: msg.role === 'user' };
}

function calcLayout(ctx, title, messages) {
  const contentWidth = CANVAS_WIDTH - PADDING * 2;
  let y = PADDING + TITLE_GAP;
  const blocks = [];
  (messages || []).forEach((msg) => {
    const m = measureMessage(ctx, msg, contentWidth);
    blocks.push({ msg, ...m, y });
    y += m.bubbleH + MSG_GAP;
  });
  const totalHeight = Math.min(
    MAX_CANVAS_HEIGHT,
    Math.max(400, y + PADDING)
  );
  return { blocks, totalHeight, contentWidth, title: title || 'OC 对话' };
}

function fillPageBackground(ctx, width, height, colors) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, colors.bgTop);
  g.addColorStop(1, colors.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawChat(ctx, width, height, layout, colors) {
  fillPageBackground(ctx, width, height, colors);
  ctx.fillStyle = colors.title;
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(layout.title, PADDING, PADDING + 32);

  let truncated = false;
  layout.blocks.forEach((block) => {
    if (block.y + block.bubbleH > height - PADDING) {
      truncated = true;
      return;
    }
    const { bubbleW, bubbleH, lines, isUser } = block;
    const x = isUser
      ? width - PADDING - bubbleW
      : PADDING;
    const y = block.y;
    const radius = 20;

    if (isUser) {
      ctx.fillStyle = colors.userBg;
      roundRect(ctx, x, y, bubbleW, bubbleH, radius);
      ctx.fill();
      ctx.fillStyle = COLOR_USER_TEXT;
    } else {
      ctx.fillStyle = COLOR_ASSIST_BG;
      roundRect(ctx, x, y, bubbleW, bubbleH, radius);
      ctx.fill();
      ctx.strokeStyle = COLOR_ASSIST_BORDER;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, bubbleW, bubbleH, radius);
      ctx.stroke();
      ctx.fillStyle = COLOR_TEXT;
    }

    ctx.font = FONT_SIZE + 'px sans-serif';
    ctx.textBaseline = 'top';
    let ty = y + BUBBLE_PAD_Y;
    lines.forEach((ln) => {
      if (ln) ctx.fillText(ln, x + BUBBLE_PAD_X, ty);
      ty += LINE_HEIGHT;
    });
  });

  if (truncated) {
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = '24px sans-serif';
    ctx.fillText('（对话过长，截图已截断）', PADDING, height - PADDING - 8);
  }
}

/**
 * @param {object} page - 页面实例（用于 selectorQuery）
 * @param {{ title: string, messages: Array<{role, content}> }} opts
 * @returns {Promise<string>} tempFilePath
 */
function ensureSnapshotCanvas(page) {
  return new Promise((resolve) => {
    if (!page || typeof page.setData !== 'function') {
      resolve();
      return;
    }
    if (page.data && page.data.snapshotCanvasOn) {
      resolve();
      return;
    }
    page.setData({ snapshotCanvasOn: true }, () => {
      setTimeout(resolve, 60);
    });
  });
}

function hideSnapshotCanvas(page) {
  if (!page || typeof page.setData !== 'function') return;
  if (page.data && page.data.snapshotCanvasOn) {
    page.setData({ snapshotCanvasOn: false });
  }
}

function exportChatLongImage(page, opts) {
  return ensureSnapshotCanvas(page).then(
    () =>
      new Promise((resolve, reject) => {
        const messages = (opts && opts.messages) || [];
        if (!messages.length) {
          reject(new Error('暂无对话内容'));
          return;
        }
        const query = wx.createSelectorQuery().in(page);
        query
          .select('#chat-snapshot-canvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (!res || !res[0] || !res[0].node) {
              reject(new Error('画布未就绪'));
              return;
            }
            const canvas = res[0].node;
            const ctx = canvas.getContext('2d');
            const width = CANVAS_WIDTH;

            ctx.font = FONT_SIZE + 'px sans-serif';
            const layout = calcLayout(ctx, opts.title, messages);
            let height = layout.totalHeight;
            // 避免 height×dpr 超过系统上限（如 14000×2=28000 > 16384）
            let dpr = Math.min(2, Number(wx.getSystemInfoSync().pixelRatio) || 2);
            if (height * dpr > MAX_CANVAS_BUFFER) {
              dpr = Math.max(1, Math.floor((MAX_CANVAS_BUFFER / height) * 100) / 100);
            }
            if (height * dpr > MAX_CANVAS_BUFFER) {
              height = Math.floor(MAX_CANVAS_BUFFER / Math.max(1, dpr));
            }
            const bufW = Math.max(1, Math.round(width * dpr));
            const bufH = Math.max(1, Math.round(height * dpr));

            canvas.width = bufW;
            canvas.height = bufH;
            if (typeof ctx.setTransform === 'function') {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            ctx.scale(dpr, dpr);
            ctx.font = FONT_SIZE + 'px sans-serif';

            const colors = getSnapshotColors();
            drawChat(ctx, width, height, layout, colors);

            setTimeout(() => {
              wx.canvasToTempFilePath({
                canvas,
                fileType: 'jpg',
                quality: 0.85,
                destWidth: width,
                destHeight: height,
                success: (s) => resolve(s.tempFilePath),
                fail: (e) => reject(e || new Error('导出图片失败'))
              });
            }, 120);
          });
      })
  ).finally(() => {
    hideSnapshotCanvas(page);
  });
}

module.exports = {
  exportChatLongImage
};
