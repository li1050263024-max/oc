/**
 * 检测卡背 PCA 中轴，旋转扶正并裁掉黑边 → images/card-back.png (504×756)
 * 用法：node scripts/straighten-card-back.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'images', 'card-back.src.png');
const fallbackSrc = path.join(root, 'images', 'card-back.png');
const inputPath = fs.existsSync(srcPath) ? srcPath : fallbackSrc;
const outPath = path.join(root, 'images', 'card-back.png');
const THRESH = 28;
/** 裁切边缘：高于此值才算「有内容」，用于去掉贴边的黑边 */
const EDGE_THRESH = 50;
/** 裁切后再内缩像素，去掉暗色过渡带 */
const CROP_INSET = 2;
/** 在紧 bbox 基础上再放大裁切（去掉圆角外的黑三角），0.9 ≈ 放大 11% */
const ZOOM_FACTOR = 0.90;
/** 若预览仍略歪，可在此微调（正数=顺时针，单位：度） */
const MANUAL_ROTATE_DEG = 0;
const OUT_W = 504;
const OUT_H = 756;

async function analyze(raw, w, h) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      if (r > THRESH || g > THRESH || b > THRESH) {
        sumX += x;
        sumY += y;
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!count) throw new Error('no content pixels');

  const cx = sumX / count;
  const cy = sumY / count;
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      if (r > THRESH || g > THRESH || b > THRESH) {
        const dx = x - cx;
        const dy = y - cy;
        mu20 += dx * dx;
        mu02 += dy * dy;
        mu11 += dx * dy;
      }
    }
  }

  let pcaDeg = (Math.atan2(2 * mu11, mu20 - mu02) / 2) * (180 / Math.PI);
  let pcaCorrection = 90 - pcaDeg;
  while (pcaCorrection > 90) pcaCorrection -= 180;
  while (pcaCorrection < -90) pcaCorrection += 180;

  // 左右边界线拟合（对小角度倾斜更敏感）
  const leftPts = [];
  const rightPts = [];
  const yStart = minY + Math.floor((maxY - minY) * 0.08);
  const yEnd = maxY - Math.floor((maxY - minY) * 0.08);
  for (let y = yStart; y <= yEnd; y++) {
    let lx = -1;
    let rx = -1;
    for (let x = minX; x <= maxX; x++) {
      const i = (y * w + x) * 4;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      if (r > THRESH || g > THRESH || b > THRESH) {
        if (lx < 0) lx = x;
        rx = x;
      }
    }
    if (lx >= 0) {
      leftPts.push({ x: lx, y });
      rightPts.push({ x: rx, y });
    }
  }

  function slopeXofY(points) {
    const n = points.length;
    if (n < 2) return 0;
    let sx = 0;
    let sy = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
      syy += p.y * p.y;
      sxy += p.x * p.y;
    }
    const denom = n * syy - sy * sy;
    if (Math.abs(denom) < 1e-6) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  // 对称性搜索：在 ±4° 内找使左右边距最接近的旋转角（比 PCA/边线更稳）
  function symmetryScore(rawBuf, w, h, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = w / 2;
    const cy = h / 2;
    let score = 0;
    let rows = 0;
    const yStart = Math.floor(h * 0.12);
    const yEnd = Math.floor(h * 0.88);
    for (let y = yStart; y <= yEnd; y += 2) {
      let minDx = Infinity;
      let maxDx = -Infinity;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const sx = Math.round(cos * dx - sin * dy + cx);
        const sy = Math.round(sin * dx + cos * dy + cy);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        const i = (sy * w + sx) * 4;
        const r = rawBuf[i];
        const g = rawBuf[i + 1];
        const b = rawBuf[i + 2];
        if (r > THRESH || g > THRESH || b > THRESH) {
          if (x < minDx) minDx = x;
          if (x > maxDx) maxDx = x;
        }
      }
      if (minDx < Infinity && maxDx > minDx) {
        score += Math.abs(minDx - cx - (cx - maxDx));
        rows++;
      }
    }
    return rows ? score / rows : Infinity;
  }

  // 上下中轴：各取 8% 高条带内金色/高亮像素质心，连线应竖直
  function bandCenterX(rawBuf, w, h, y0, y1) {
    let sx = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = rawBuf[i];
        const g = rawBuf[i + 1];
        const b = rawBuf[i + 2];
        const isGold = r > 160 && g > 120 && b < 140 && r > b + 40;
        const isBright = r + g + b > 420;
        if (isGold || isBright) {
          sx += x;
          n++;
        }
      }
    }
    return n ? sx / n : w / 2;
  }

  const bandH = Math.max(8, Math.floor(h * 0.08));
  const topCx = bandCenterX(raw, w, h, minY, minY + bandH);
  const botCx = bandCenterX(raw, w, h, maxY - bandH + 1, maxY + 1);
  const axisDx = botCx - topCx;
  const axisDy = maxY - minY;
  const axisTilt = (Math.atan2(axisDx, axisDy) * 180) / Math.PI;
  // 顶→底连线右偏 → 顺时针扶正
  const axisCorrection = axisTilt;

  let bestAngle = 0;
  let bestScore = Infinity;
  for (let a = -800; a <= 800; a++) {
    const deg = a / 100;
    const s = symmetryScore(raw, w, h, deg);
    if (s < bestScore) {
      bestScore = s;
      bestAngle = deg;
    }
  }

  let correction = bestAngle;
  if (Math.abs(axisCorrection) > 0.2 && Math.abs(axisCorrection - bestAngle) > 0.15) {
    correction = axisCorrection * 0.7 + bestAngle * 0.3;
  }
  if (Math.abs(correction) < 0.08) correction = 0;

  return {
    correction,
    pcaCorrection,
    symCorrection: bestAngle,
    axisCorrection,
    symScore: bestScore,
    minX,
    minY,
    maxX,
    maxY,
    cx,
    cy,
    pcaDeg
  };
}

function isContentPixel(raw, i, thresh) {
  const r = raw[i];
  const g = raw[i + 1];
  const b = raw[i + 2];
  return r > thresh || g > thresh || b > thresh;
}

/** 从四边向内扫描；竖边/横边用中间 65% 区域，避开圆角黑三角 */
function getTightBounds(raw, w, h, thresh = EDGE_THRESH) {
  let looseMinY = h;
  let looseMaxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isContentPixel(raw, (y * w + x) * 4, thresh)) {
        if (y < looseMinY) looseMinY = y;
        if (y > looseMaxY) looseMaxY = y;
      }
    }
  }
  if (looseMinY >= looseMaxY) throw new Error('no content');

  const spanY = looseMaxY - looseMinY + 1;
  const y0 = looseMinY + Math.floor(spanY * 0.18);
  const y1 = looseMaxY - Math.floor(spanY * 0.18);

  let minX = w;
  let maxX = 0;
  for (let x = 0; x < w; x++) {
    for (let y = y0; y <= y1; y++) {
      if (isContentPixel(raw, (y * w + x) * 4, thresh)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  const spanX = maxX - minX + 1;
  const x0 = minX + Math.floor(spanX * 0.12);
  const x1 = maxX - Math.floor(spanX * 0.12);

  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isContentPixel(raw, (y * w + x) * 4, thresh)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  minX = Math.min(w - 2, minX + CROP_INSET);
  minY = Math.min(h - 2, minY + CROP_INSET);
  maxX = Math.max(minX + 1, maxX - CROP_INSET);
  maxY = Math.max(minY + 1, maxY - CROP_INSET);

  let width = maxX - minX + 1;
  let height = maxY - minY + 1;
  let left = minX;
  let top = minY;

  const zw = Math.round(width * ZOOM_FACTOR);
  const zh = Math.round(height * ZOOM_FACTOR);
  left += Math.round((width - zw) / 2);
  top += Math.round((height - zh) / 2);
  width = zw;
  height = zh;

  left = Math.max(0, left);
  top = Math.max(0, top);
  if (left + width > w) width = w - left;
  if (top + height > h) height = h - top;

  return { left, top, width, height };
}

const input = sharp(inputPath);
const meta = await input.metadata();
const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const analysis = await analyze(data, info.width, info.height);
console.log(
  `sym ${analysis.symCorrection.toFixed(2)}°, axis ${analysis.axisCorrection.toFixed(2)}° → use ${analysis.correction.toFixed(2)}°`
);

let pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .rotate(analysis.correction + MANUAL_ROTATE_DEG, { background: { r: 0, g: 0, b: 0, alpha: 0 } });

const rotatedBuf = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const crop = getTightBounds(rotatedBuf.data, rotatedBuf.info.width, rotatedBuf.info.height);
console.log(`crop ${crop.width}×${crop.height} @ (${crop.left},${crop.top})`);

const outBuf = await sharp(rotatedBuf.data, {
  raw: { width: rotatedBuf.info.width, height: rotatedBuf.info.height, channels: 4 }
})
  .extract(crop)
  .resize(OUT_W, OUT_H, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer();

const tmpPath = path.join(root, 'images', 'card-back.straight.png');
fs.writeFileSync(tmpPath, outBuf);
try {
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  fs.renameSync(tmpPath, outPath);
} catch (e) {
  console.warn('Could not replace card-back.png, kept:', tmpPath);
}
console.log(`Saved ${outPath} (${outBuf.length} bytes, ${OUT_W}×${OUT_H}) from ${path.basename(inputPath)}`);
