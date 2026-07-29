const { normalizeResult, personalityBlend, quirkBlend } = require('./ocResult.js');

/**
 * 人设逻辑图绘制：将 result + background + catchphrases + attitudes 画到 ctx
 * @param {Canvas2DContext} ctx
 * @param {number} width
 * @param {number} height
 * @param {{ result, background?, catchphrases?, attitudes? }} data
 */
function drawMindMap(ctx, width, height, data) {
  const r = normalizeResult(data.result);
  if (!r) return;
  const bg = data.background;
  const catchphrases = data.catchphrases || [];
  const attitudes = data.attitudes || [];

  const padding = 28;
  const lineH = 22;
  let y = 40;

  ctx.fillStyle = '#faf9f7';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#a89888';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  ctx.fillStyle = '#4a4540';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('【人设逻辑图】', width / 2, y);
  y += 36;

  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(r.name, width / 2, y);
  y += 44;

  ctx.textAlign = 'left';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#5a4a2e';
  const sections = [
    [
      '外貌',
      `种族：${r.race}  性别：${r.gender}  年龄：${r.age}  发色：${r.hairColor}  瞳色：${r.eyeColor}`
    ],
    ['性格', `性格：${personalityBlend(r)}  怪癖：${quirkBlend(r)}`]
  ];
  if (bg && bg.worldview) {
    sections.push(['世界观', bg.worldview]);
    if (bg.origins && bg.origins.filter(Boolean).length) {
      sections.push(['身世设定', (bg.origins || []).join('  |  ')]);
    }
    sections.push(['人生大事件', (bg.lifeEvents || []).join('  |  ')]);
  }
  if (catchphrases.length) {
    sections.push(['常用语', catchphrases.join('  |  ')]);
  }
  if (attitudes.length) {
    sections.push(['态度', attitudes.map(a => `${a.event} → ${a.attitude}`).join('\n')]);
  }

  sections.forEach(([title, content]) => {
    ctx.fillStyle = '#5a4a2e';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(title, padding, y);
    y += lineH + 4;
    ctx.fillStyle = '#4a4540';
    ctx.font = '14px sans-serif';
    const lines = content.split('\n');
    lines.forEach(line => {
      if (line.length > 48) {
        for (let i = 0; i < line.length; i += 48) {
          ctx.fillText(line.slice(i, i + 48), padding, y);
          y += lineH;
        }
      } else {
        ctx.fillText(line, padding, y);
        y += lineH;
      }
    });
    y += 16;
  });
}

module.exports = { drawMindMap };
