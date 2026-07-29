const { getProfileSceneThemeDefaults, hexToRgba } = require('./ocProfileData.js');

const TIMELINE_PAD_TOP_RPX = 56;
const TIMELINE_PAD_BOTTOM_RPX = 32;
const TIMELINE_ROW_STEP_RPX = 128;
/** 导出画布像素上限，过高会导致真机闪退（部分安卓约 4M+ 即不稳定） */
const MAX_EXPORT_PIXELS = 3 * 1024 * 1024;
const MAX_EXPORT_SIDE = 2048;

function drawRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function parseSpineLinkStyle(style) {
  const s = String(style || '');
  const m = /left:([\d.-]+)rpx;top:([\d.-]+)rpx;width:([\d.-]+)rpx;transform:rotate\(([-\d.]+)deg\)/.exec(
    s
  );
  if (!m) return null;
  const hm = /height:([\d.]+)rpx/.exec(s);
  return {
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
    len: parseFloat(m[3]),
    deg: parseFloat(m[4]),
    height: hm ? parseFloat(hm[1]) : 3,
    dashed: /repeating-linear-gradient/.test(s) && s.indexOf('12rpx') >= 0,
    dotted: /repeating-linear-gradient/.test(s) && s.indexOf('4rpx') >= 0
  };
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const lines = [];
  let line = '';
  let overflow = false;
  for (let i = 0; i < raw.length; i += 1) {
    const next = line + raw.charAt(i);
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = raw.charAt(i);
      if (lines.length >= maxLines) {
        overflow = i < raw.length - 1;
        break;
      }
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (overflow && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }
  return lines.slice(0, maxLines);
}

function computeTimelineNodeCenters(nodes, axisCenterRpx, padTopRpx) {
  const padTop = padTopRpx != null ? padTopRpx : TIMELINE_PAD_TOP_RPX;
  const points = [];
  let yOffset = padTop;
  (nodes || []).forEach((node, index) => {
    const rowH = Number(node.rowHeightRpx) || TIMELINE_ROW_STEP_RPX;
    const offset = Number(node.curveOffsetRpx) || 0;
    points.push({
      x: axisCenterRpx + offset,
      y: yOffset + rowH / 2,
      rowH: rowH,
      node: node,
      index: index
    });
    yOffset += rowH;
  });
  return { points: points, contentHeight: yOffset + TIMELINE_PAD_BOTTOM_RPX };
}

function finite(n, fallback) {
  const v = Number(n);
  return isFinite(v) ? v : fallback;
}

function drawTimeline(ctx, width, height, opts) {
  const links = (opts && opts.links) || [];
  const nodes = (opts && opts.nodes) || [];
  const theme = getProfileSceneThemeDefaults();
  const lineColor = (opts && opts.lineColor) || theme.worldTimelineLineColor;
  const nodeColor = (opts && opts.nodeColor) || theme.worldTimelineNodeColor;
  const textColor = (opts && opts.textColor) || theme.worldTimelineCardTextColor;
  const bgColor = (opts && opts.bgColor) || theme.exportBg;
  const layoutW = finite(opts && opts.layoutWidthRpx, width) || width;
  const layoutH = finite(opts && opts.layoutHeightRpx, height) || height;
  const sx = width / Math.max(1, layoutW);
  const sy = height / Math.max(1, layoutH);
  const scale = (x, y) => ({ x: x * sx, y: y * sy });

  const axisCenterRpx = finite(
    opts && opts.axisCenterRpx,
    layoutW / 2
  );
  const padTopRpx = finite(opts && opts.padTopRpx, TIMELINE_PAD_TOP_RPX);

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  const bgImage = opts && opts.bgImage;
  if (bgImage) {
    try {
      ctx.drawImage(bgImage, 0, 0, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(0, 0, width, height);
    } catch (_) {}
  }

  links.forEach((link) => {
    const parsed = parseSpineLinkStyle(link && link.style);
    if (!parsed || !(parsed.len > 0) || !isFinite(parsed.x) || !isFinite(parsed.y)) return;
    const p = scale(parsed.x, parsed.y + parsed.height / 2);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((parsed.deg * Math.PI) / 180);
    ctx.strokeStyle = hexToRgba(lineColor, 0.55);
    ctx.lineWidth = Math.max(1.5, parsed.height * Math.min(sx, sy));
    ctx.lineCap = 'round';
    if (parsed.dotted) ctx.setLineDash([2, 5]);
    else if (parsed.dashed) ctx.setLineDash([8, 6]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(parsed.len * sx, 0);
    ctx.stroke();
    ctx.restore();
  });
  ctx.setLineDash([]);

  const layout = computeTimelineNodeCenters(nodes, axisCenterRpx, padTopRpx);
  layout.points.forEach((pt) => {
    const node = pt.node || {};
    const p = scale(pt.x, pt.y);
    if (!isFinite(p.x) || !isFinite(p.y)) return;
    const soft = theme.exportNodeSoft;
    const mid = nodeColor || theme.exportNodeMid;
    const r = 10 * Math.min(sx, sy);
    try {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(1, r));
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.55, soft);
      grad.addColorStop(1, mid);
      ctx.fillStyle = grad;
    } catch (_) {
      ctx.fillStyle = mid;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();

    const colorMatch =
      (node.cardTextStyle && /color:(#[0-9a-fA-F]{6})/.exec(node.cardTextStyle)) || null;
    const fill = colorMatch ? colorMatch[1] : textColor;
    ctx.fillStyle = fill;

    const leftSide = node.labelSide !== 'right';
    const title = (node.dateLabel || '—') + ' · ' + (node.title || '—');
    const maxTextW = Math.min(260 * sx, leftSide ? p.x - 28 * sx : width - p.x - 28 * sx);
    if (maxTextW < 40) return;

    ctx.font = 'bold ' + Math.round(22 * Math.min(sx, sy)) + 'px sans-serif';
    const titleLines = wrapText(ctx, title, maxTextW, 2);
    ctx.font = Math.round(18 * Math.min(sx, sy)) + 'px sans-serif';
    const descLines = wrapText(ctx, node.summaryPreview || '', maxTextW, 3);
    const lineHTitle = 28 * sy;
    const lineHDesc = 24 * sy;
    const blockH = titleLines.length * lineHTitle + descLines.length * lineHDesc;
    let ty = p.y - blockH / 2 + 18 * sy;

    ctx.textAlign = leftSide ? 'right' : 'left';
    const tx = leftSide ? p.x - 22 * sx : p.x + 22 * sx;
    ctx.font = 'bold ' + Math.round(22 * Math.min(sx, sy)) + 'px sans-serif';
    titleLines.forEach((line) => {
      ctx.fillText(line, tx, ty);
      ty += lineHTitle;
    });
    ctx.font = Math.round(18 * Math.min(sx, sy)) + 'px sans-serif';
    ctx.globalAlpha = 0.92;
    descLines.forEach((line) => {
      ctx.fillText(line, tx, ty);
      ty += lineHDesc;
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  });
}

function drawRelationGraph(ctx, width, height, opts) {
  const graph = (opts && opts.graph) || { center: {}, nodes: [] };
  const lines = (opts && opts.lines) || [];
  const theme = getProfileSceneThemeDefaults();
  const lineColor = (opts && opts.lineColor) || theme.relationGraphLineColor;
  const nameColor = (opts && opts.nameColor) || theme.relationGraphNameColor;
  const relationColor = (opts && opts.relationColor) || theme.relationGraphRelationColor;
  const bgColor = (opts && opts.bgColor) || theme.exportBg;
  const nodeFill = theme.exportNodeSoft;
  const nodeStroke = theme.exportNodeMid;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  const toPx = (pct, dim) => (pct / 100) * dim;
  lines.forEach((line) => {
    const sm = /width:([\d.]+)%.*left:([\d.]+)%.*top:([\d.]+)%.*rotate\(([-\d.]+)deg\)/.exec(
      line.style || ''
    );
    if (!sm) return;
    const len = toPx(parseFloat(sm[1]), Math.sqrt(width * width + height * height) * 0.5);
    const x = toPx(parseFloat(sm[2]), width);
    const y = toPx(parseFloat(sm[3]), height);
    const deg = (parseFloat(sm[4]) * Math.PI) / 180;
    ctx.strokeStyle = hexToRgba(lineColor, 0.55);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(deg);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
    if (line.label) {
      const mm = /left:([\d.]+)%.*top:([\d.]+)%/.exec(line.midStyle || '');
      if (mm) {
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const lx = toPx(parseFloat(mm[1]), width);
        const ly = toPx(parseFloat(mm[2]), height);
        ctx.font = '18px sans-serif';
        const tw = ctx.measureText(line.label).width;
        drawRoundRect(ctx, lx - tw / 2 - 6, ly - 12, tw + 12, 22, 8);
        ctx.fill();
        ctx.fillStyle = relationColor;
        ctx.fillText(line.label, lx - tw / 2, ly + 4);
      }
    }
  });
  ctx.setLineDash([]);
  const drawNode = (node, isCenter) => {
    const pm = /left:([\d.]+)%.*top:([\d.]+)%/.exec(node.style || '');
    if (!pm) return;
    const x = toPx(parseFloat(pm[1]), width);
    const y = toPx(parseFloat(pm[2]), height);
    const r = isCenter ? 36 : 28;
    ctx.fillStyle = nodeFill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = nodeStroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = nameColor;
    ctx.font = isCenter ? 'bold 22px sans-serif' : '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.name || '?', x, y + r + 22);
    if (node.title) {
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(node.title, x, y + r + 44);
    }
    if (node.note) {
      ctx.font = '16px sans-serif';
      ctx.fillText(node.note, x, y + r + (node.title ? 64 : 44));
    }
    ctx.textAlign = 'left';
  };
  drawNode(graph.center || {}, true);
  (graph.nodes || []).forEach((node) => drawNode(node, false));
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve) => {
    const url = String(src || '').trim();
    if (!url || !canvas || typeof canvas.createImage !== 'function') {
      resolve(null);
      return;
    }
    try {
      const img = canvas.createImage();
      const done = (val) => {
        clearTimeout(timer);
        resolve(val);
      };
      const timer = setTimeout(() => done(null), 4000);
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
    } catch (_) {
      resolve(null);
    }
  });
}

function pickExportSize(width, height) {
  let w = Math.max(1, Math.round(Number(width) || 750));
  let h = Math.max(1, Math.round(Number(height) || 1000));
  // 真机导出优先稳：固定 1x，避免高 dpr 放大缓冲导致 OOM 闪退
  let dpr = 1;
  w = Math.min(w, MAX_EXPORT_SIDE);
  h = Math.min(h, MAX_EXPORT_SIDE);
  while (w * h * dpr * dpr > MAX_EXPORT_PIXELS) {
    if (h > 900) {
      h = Math.round(h * 0.8);
      continue;
    }
    if (w > 480) {
      w = Math.round(w * 0.85);
      continue;
    }
    break;
  }
  w = Math.max(1, Math.min(MAX_EXPORT_SIDE, w));
  h = Math.max(1, Math.min(MAX_EXPORT_SIDE, h));
  return { w, h, dpr };
}

function resetCanvasBuffer(canvas, ctx) {
  try {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
    if (ctx && typeof ctx.setTransform === 'function') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  } catch (_) {}
}

function ensureAlbumAuth() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (setting) => {
        if (setting.authSetting && setting.authSetting['scope.writePhotosAlbum']) {
          resolve();
          return;
        }
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: () => resolve(),
          fail: () => {
            wx.showModal({
              title: '需要相册权限',
              content: '请允许保存图片到相册后再试',
              confirmText: '去设置',
              success: (modal) => {
                if (modal.confirm) {
                  wx.openSetting({
                    fail: () => reject(new Error('album auth denied'))
                  });
                }
                reject(new Error('album auth denied'));
              },
              fail: () => reject(new Error('album auth denied'))
            });
          }
        });
      },
      fail: () => resolve()
    });
  });
}

function exportCanvasToAlbum(page, canvasId, drawFn, drawOpts, width, height) {
  return new Promise((resolve, reject) => {
    const query = wx.createSelectorQuery().in(page);
    query
      .select(canvasId)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('canvas unavailable'));
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas context unavailable'));
          return;
        }
        const layoutW = Math.max(1, Math.round(Number(width) || 750));
        const layoutH = Math.max(1, Math.round(Number(height) || 1000));
        const sized = pickExportSize(layoutW, layoutH);
        const opts = Object.assign({}, drawOpts || {}, {
          layoutWidthRpx: layoutW,
          layoutHeightRpx: layoutH
        });

        const finish = (bgImage) => {
          try {
            if (bgImage) opts.bgImage = bgImage;
            const bufW = Math.max(1, Math.round(sized.w * sized.dpr));
            const bufH = Math.max(1, Math.round(sized.h * sized.dpr));
            if (bufW * bufH > MAX_EXPORT_PIXELS) {
              reject(new Error('export too large'));
              return;
            }
            canvas.width = bufW;
            canvas.height = bufH;
            if (typeof ctx.setTransform === 'function') {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            ctx.scale(sized.dpr, sized.dpr);
            drawFn(ctx, sized.w, sized.h, opts);
          } catch (e) {
            resetCanvasBuffer(canvas, ctx);
            reject(e);
            return;
          }
          setTimeout(() => {
            wx.canvasToTempFilePath(
              {
                canvas,
                fileType: 'jpg',
                quality: 0.82,
                destWidth: sized.w,
                destHeight: sized.h,
                success: (s) => {
                  resetCanvasBuffer(canvas, ctx);
                  ensureAlbumAuth()
                    .then(() => {
                      wx.saveImageToPhotosAlbum({
                        filePath: s.tempFilePath,
                        success: () => resolve(s.tempFilePath),
                        fail: (e) => reject(e)
                      });
                    })
                    .catch((e) => reject(e));
                },
                fail: (e) => {
                  resetCanvasBuffer(canvas, ctx);
                  reject(e);
                }
              },
              page
            );
          }, 120);
        };

        if (opts.bgSrc) {
          loadCanvasImage(canvas, opts.bgSrc)
            .then((img) => finish(img))
            .catch(() => finish(null));
        } else {
          finish(null);
        }
      });
  });
}

module.exports = {
  drawTimeline,
  drawRelationGraph,
  exportCanvasToAlbum,
  computeTimelineNodeCenters,
  TIMELINE_PAD_TOP_RPX,
  TIMELINE_PAD_BOTTOM_RPX
};
