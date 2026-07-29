const RELATION_CUSTOM = '自定义';

const RELATION_TYPES = [
  RELATION_CUSTOM,
  '挚友',
  '恋人',
  '群友',
  '竞争',
  '信任',
  '合作',
  '守护',
  '敌对',
  '忠诚',
  '怀疑',
  '疏离',
  '亲人',
  '师长'
];

function isPresetRelationType(type) {
  const t = String(type || '').trim();
  return RELATION_TYPES.indexOf(t) > 0;
}

function relationPickerButtonLabel(type) {
  const t = String(type || '').trim();
  if (isPresetRelationType(t)) return t;
  if (t && t !== RELATION_CUSTOM && t !== '其他') return t;
  return RELATION_CUSTOM;
}

function relationCustomDraftFromType(type) {
  const t = String(type || '').trim();
  if (isPresetRelationType(t) || !t || t === RELATION_CUSTOM) return '';
  return t;
}

function relationGraphLabel(type) {
  const t = String(type || '').trim();
  if (!t || t === RELATION_CUSTOM) return '';
  return t;
}

const PROFILE_TABS = [
  { key: 'basic', label: '基础信息', sub: 'PROFILE', glyph: '✦' },
  { key: 'world', label: '世界观', sub: 'WORLD', glyph: '◉' },
  { key: 'events', label: '身世背景', sub: 'ORIGIN', glyph: '❋' },
  { key: 'language', label: '语言态度', sub: 'LANGUAGE', glyph: '✎' },
  { key: 'relation', label: '人物关系网', sub: 'RELATION', glyph: '◎' }
];

const TIMELINE_LINE_STYLES = ['straight', 'curve'];
const TIMELINE_LINE_STYLE_LABELS = ['直线', '曲线'];

const TIMELINE_CARD_TEXT_COLORS = [
  { label: '文字：默认', value: '#5b4b8a' },
  { label: '文字：深褐', value: '#4a3728' },
  { label: '文字：墨黑', value: '#333333' },
  { label: '文字：酒红', value: '#7f1d1d' },
  { label: '文字：森绿', value: '#166534' }
];

const SCENE_LINE_STYLES = ['solid', 'dashed', 'dotted', 'dash-dot', 'segment-dash', 'double'];
const SCENE_LINE_STYLE_LABELS = ['实线', '虚线', '点线', '点虚线', '段虚线', '双线'];

/** 紫色主题时期写入的系统默认色；切换灰/粉主题时视为未自定义并替换 */
const LEGACY_PURPLE_SCENE_COLORS = {
  '#6d28d9': true,
  '#a78bfa': true,
  '#5b4b8a': true,
  '#8b7cb8': true,
  '#7c3aed': true,
  '#c4b5fd': true,
  '#ddd6fe': true
};

const DEFAULT_WORLD_TIMELINE_LINE_COLOR = '#6d28d9';
const DEFAULT_WORLD_TIMELINE_NODE_COLOR = '#a78bfa';
const DEFAULT_RELATION_NAME_COLOR = '#5b4b8a';
const DEFAULT_RELATION_RELATION_COLOR = '#8b7cb8';
const DEFAULT_RELATION_NOTE_COLOR = '#888888';
const DEFAULT_RELATION_LINE_COLOR = '#8b7cb8';

function getProfileSceneThemeDefaults(theme) {
  let t = theme;
  if (!t) {
    try {
      t = require('./uiTheme.js').getUiTheme();
    } catch (_) {
      t = 'purple';
    }
  }
  if (t === 'mono') {
    return {
      worldTimelineLineColor: '#27272a',
      worldTimelineNodeColor: '#71717a',
      worldTimelineCardTextColor: '#3f3f46',
      relationGraphNameColor: '#3f3f46',
      relationGraphRelationColor: '#71717a',
      relationGraphNoteColor: '#888888',
      relationGraphLineColor: '#71717a',
      exportBg: '#f4f4f5',
      exportNodeSoft: '#e4e4e7',
      exportNodeMid: '#a1a1aa'
    };
  }
  if (t === 'pink') {
    return {
      worldTimelineLineColor: '#e8a6b3',
      worldTimelineNodeColor: '#f7c9d3',
      worldTimelineCardTextColor: '#8a8494',
      relationGraphNameColor: '#8a8494',
      relationGraphRelationColor: '#b5abcc',
      relationGraphNoteColor: '#888888',
      relationGraphLineColor: '#b5abcc',
      exportBg: '#fdf8fa',
      exportNodeSoft: '#f7c9d3',
      exportNodeMid: '#e8a6b3'
    };
  }
  return {
    worldTimelineLineColor: DEFAULT_WORLD_TIMELINE_LINE_COLOR,
    worldTimelineNodeColor: DEFAULT_WORLD_TIMELINE_NODE_COLOR,
    worldTimelineCardTextColor: '#5b4b8a',
    relationGraphNameColor: DEFAULT_RELATION_NAME_COLOR,
    relationGraphRelationColor: DEFAULT_RELATION_RELATION_COLOR,
    relationGraphNoteColor: DEFAULT_RELATION_NOTE_COLOR,
    relationGraphLineColor: DEFAULT_RELATION_LINE_COLOR,
    exportBg: '#f3effa',
    exportNodeSoft: '#ddd6fe',
    exportNodeMid: '#a78bfa'
  };
}

function isLegacyPurpleSceneColor(hex) {
  const s = String(hex || '').trim().toLowerCase();
  return !!LEGACY_PURPLE_SCENE_COLORS[s];
}

function resolveThemeAwareSceneColor(raw, themeKey, themeDefaults) {
  const s = String(raw || '').trim();
  if (!s) return themeDefaults[themeKey];
  const normalized = normalizeHexColor(s, '');
  if (!normalized || isLegacyPurpleSceneColor(normalized)) {
    return themeDefaults[themeKey];
  }
  return normalized;
}

function normalizeHexColor(raw, fallback) {
  const s = String(raw || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return fallback;
}

function normalizeSceneLineStyle(raw, fallback) {
  const s = String(raw || '').trim();
  return SCENE_LINE_STYLES.indexOf(s) >= 0 ? s : fallback;
}

function sceneLineStyleIndex(style, fallback) {
  const idx = SCENE_LINE_STYLES.indexOf(normalizeSceneLineStyle(style, fallback));
  return idx >= 0 ? idx : 0;
}

function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) {
    const fallback = getProfileSceneThemeDefaults().worldTimelineLineColor.replace('#', '');
    const r = parseInt(fallback.slice(0, 2), 16);
    const g = parseInt(fallback.slice(2, 4), 16);
    const b = parseInt(fallback.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function buildSceneLinePaint(color, lineStyle, heightRpx) {
  const c = normalizeHexColor(color, DEFAULT_RELATION_LINE_COLOR);
  const style = normalizeSceneLineStyle(lineStyle, 'solid');
  const h = heightRpx || 3;
  if (style === 'solid') {
    return 'background:' + c + ';height:' + h + 'rpx;';
  }
  if (style === 'dashed') {
    return (
      'background:repeating-linear-gradient(90deg,' +
      c +
      ' 0,' +
      c +
      ' 12rpx,transparent 12rpx,transparent 20rpx);height:' +
      h +
      'rpx;'
    );
  }
  if (style === 'dotted') {
    return (
      'background:repeating-linear-gradient(90deg,' +
      c +
      ' 0,' +
      c +
      ' 4rpx,transparent 4rpx,transparent 10rpx);height:' +
      h +
      'rpx;'
    );
  }
  if (style === 'dash-dot') {
    return (
      'background:repeating-linear-gradient(90deg,' +
      c +
      ' 0,' +
      c +
      ' 10rpx,transparent 10rpx,transparent 14rpx,' +
      c +
      ' 14rpx,' +
      c +
      ' 16rpx,transparent 16rpx,transparent 24rpx);height:' +
      h +
      'rpx;'
    );
  }
  if (style === 'segment-dash') {
    const seg = hexToRgba(c, 0.72);
    return (
      'background:repeating-linear-gradient(90deg,' +
      seg +
      ' 0,' +
      seg +
      ' 8rpx,transparent 8rpx,transparent 16rpx);height:' +
      h +
      'rpx;'
    );
  }
  if (style === 'double') {
    return (
      'background:linear-gradient(to bottom,' +
      c +
      ' 0,' +
      c +
      ' 2rpx,transparent 2rpx,transparent ' +
      (h - 2) +
      'rpx,' +
      c +
      ' ' +
      (h - 2) +
      'rpx,' +
      c +
      ' ' +
      h +
      'rpx);height:' +
      h +
      'rpx;'
    );
  }
  return 'background:' + c + ';height:' + h + 'rpx;';
}

function buildTimelineNodeStyle(nodeColor) {
  const c = normalizeHexColor(nodeColor, DEFAULT_WORLD_TIMELINE_NODE_COLOR);
  return (
    'background:#ffffff;' +
    'border:4rpx solid ' +
    c +
    ';' +
    'box-sizing:border-box;' +
    'box-shadow:0 0 12rpx ' +
    hexToRgba(c, 0.45) +
    ';'
  );
}

function normalizeProfileScene(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  let style = String(d.worldTimelineLineStyle || 'curve').trim();
  if (style === 'hidden') style = 'curve';
  const defaults = getProfileSceneThemeDefaults();
  const colorRaw = String(d.worldTimelineCardTextColor || '').trim();
  const preset = TIMELINE_CARD_TEXT_COLORS.find((c) => c.value === colorRaw);
  const hexOk = /^#[0-9a-fA-F]{6}$/.test(colorRaw);
  let cardText = defaults.worldTimelineCardTextColor;
  if (hexOk && !isLegacyPurpleSceneColor(colorRaw)) {
    cardText = colorRaw.toLowerCase();
  } else if (preset && !isLegacyPurpleSceneColor(preset.value)) {
    cardText = preset.value;
  }
  return {
    worldTimelineBg: String(d.worldTimelineBg || '').trim(),
    worldTimelineLineStyle: TIMELINE_LINE_STYLES.indexOf(style) >= 0 ? style : 'curve',
    worldTimelineCardTextColor: cardText,
    worldTimelineLineColor: resolveThemeAwareSceneColor(
      d.worldTimelineLineColor,
      'worldTimelineLineColor',
      defaults
    ),
    worldTimelineNodeColor: resolveThemeAwareSceneColor(
      d.worldTimelineNodeColor,
      'worldTimelineNodeColor',
      defaults
    ),
    worldTimelineSpineLineStyle: normalizeSceneLineStyle(
      d.worldTimelineSpineLineStyle,
      'solid'
    ),
    worldTimelineNodeOffsets: normalizeTimelineNodeOffsets(d.worldTimelineNodeOffsets),
    worldTimelineSegmentBends: normalizeTimelineSegmentBends(d.worldTimelineSegmentBends),
    relationGraphBg: String(d.relationGraphBg || '').trim(),
    relationGraphNameColor: resolveThemeAwareSceneColor(
      d.relationGraphNameColor,
      'relationGraphNameColor',
      defaults
    ),
    relationGraphRelationColor: resolveThemeAwareSceneColor(
      d.relationGraphRelationColor,
      'relationGraphRelationColor',
      defaults
    ),
    relationGraphNoteColor: resolveThemeAwareSceneColor(
      d.relationGraphNoteColor,
      'relationGraphNoteColor',
      defaults
    ),
    relationGraphLineColor: resolveThemeAwareSceneColor(
      d.relationGraphLineColor,
      'relationGraphLineColor',
      defaults
    ),
    relationGraphLineStyle: normalizeSceneLineStyle(d.relationGraphLineStyle, 'segment-dash'),
    relationAddPosX: (() => {
      const n = Number(d.relationAddPosX);
      return Number.isFinite(n) ? Math.max(5, Math.min(95, n)) : null;
    })(),
    relationAddPosY: (() => {
      const n = Number(d.relationAddPosY);
      return Number.isFinite(n) ? Math.max(5, Math.min(95, n)) : null;
    })()
  };
}

function normalizeTimelineNodeOffsets(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.keys(src).forEach((key) => {
    const n = Number(src[key]);
    if (Number.isFinite(n)) out[String(key)] = Math.max(-120, Math.min(120, Math.round(n)));
  });
  return out;
}

function normalizeTimelineSegmentBends(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-120, Math.min(120, Math.round(n))) : 0;
  });
}

function timelineLineStyleIndex(style) {
  const s = style === 'hidden' ? 'curve' : style || 'curve';
  const idx = TIMELINE_LINE_STYLES.indexOf(s);
  return idx >= 0 ? idx : 1;
}

/** 关系网节点默认角度起点（正上方），再按人数均分；最多 6 个 */
const RELATION_RING_MAX = 6;
/** 默认按竖屏关系图画布估算宽高比（宽/高），用于把百分比半径校正成视觉正圆 */
const RELATION_DEFAULT_ASPECT_WH = 0.78;

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function nodeStyleFromPos(x, y) {
  return (
    'left:' +
    x.toFixed(1) +
    '%;top:' +
    y.toFixed(1) +
    '%;transform:translate(-50%,-50%);'
  );
}

/** 按人数与画布宽高比，给出椭圆半径（百分比），避免竖屏下节点挤在左右 */
function getRelationRingRadii(nodeCount, aspectWH) {
  const n = Math.max(1, Math.min(RELATION_RING_MAX, Number(nodeCount) || 1));
  let a = Number(aspectWH);
  if (!Number.isFinite(a) || a < 0.35 || a > 2.5) a = RELATION_DEFAULT_ASPECT_WH;
  // 人越多略收半径，但保持足够间距避免头像重叠
  let rY = n >= 6 ? 28 : n >= 5 ? 30 : n >= 4 ? 32 : 34;
  let rX = rY / a;
  rX = Math.max(24, Math.min(40, rX));
  rY = Math.max(22, Math.min(36, rY));
  return { rX: rX, rY: rY };
}

function relationRingDegree(index, total) {
  const n = Math.max(1, total);
  return -90 + (360 / n) * index;
}

function relationPosFromRing(index, total, aspectWH) {
  const { rX, rY } = getRelationRingRadii(total, aspectWH);
  const rad = (relationRingDegree(index, total) * Math.PI) / 180;
  return {
    x: 50 + rX * Math.cos(rad),
    y: 50 + rY * Math.sin(rad)
  };
}

function positionsTooClose(a, b) {
  if (!a || !b) return false;
  const dx = Number(a.posX) - Number(b.posX);
  const dy = Number(a.posY) - Number(b.posY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  // 约 18% 画布距离，对应头像+名字大致占位
  return dx * dx + dy * dy < 18 * 18;
}

function pickNodePos(raw) {
  const x = Number(raw && raw.posX);
  const y = Number(raw && raw.posY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { posX: null, posY: null };
  }
  return {
    posX: Math.max(5, Math.min(95, x)),
    posY: Math.max(5, Math.min(95, y))
  };
}

function normalizeRelationship(raw) {
  if (!raw) return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const pos = pickNodePos(raw);
  return {
    id: String(raw.id || newId('rel')),
    name,
    title: String(raw.title || raw.role || '').trim(),
    relationType: String(raw.relationType || raw.relation || RELATION_CUSTOM).trim(),
    note: String(raw.note || '').trim(),
    targetOcId: String(raw.targetOcId || '').trim(),
    avatarUrl: String(raw.avatarUrl || '').trim(),
    posX: pos.posX,
    posY: pos.posY
  };
}

function normalizeRelationships(list) {
  const out = [];
  const seen = {};
  (list || []).forEach((item) => {
    const r = normalizeRelationship(item);
    if (!r || seen[r.id]) return;
    seen[r.id] = true;
    out.push(r);
  });
  return out.slice(0, 12);
}

function normalizeRelationEdge(raw) {
  if (!raw) return null;
  const fromId = String(raw.fromId || '').trim();
  const toId = String(raw.toId || '').trim();
  if (!fromId || !toId || fromId === toId) return null;
  return {
    id: String(raw.id || newId('edge')),
    fromId,
    toId,
    relationType: String(raw.relationType || raw.label || '关联').trim(),
    note: String(raw.note || '').trim()
  };
}

function normalizeRelationEdges(list) {
  const out = [];
  const seen = {};
  (list || []).forEach((item) => {
    const edge = normalizeRelationEdge(item);
    if (!edge) return;
    const key = [edge.fromId, edge.toId].sort().join(':');
    if (seen[key]) return;
    seen[key] = true;
    out.push(edge);
  });
  return out.slice(0, 24);
}

function parseNodeStylePercent(style) {
  const m = /left:([\d.]+)%.*top:([\d.]+)%/.exec(style || '');
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

function buildLineBetween(x1, y1, x2, y2, label, note, paintOptions) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) {
    return { style: 'display:none;', label: '', note: '', midStyle: 'display:none;', noteStyle: 'display:none;' };
  }
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const labelText = String(label || '').trim();
  const noteText = String(note || '').trim();
  const labelTop = labelText && noteText ? midY - 1.4 : midY;
  const noteTop = labelText ? midY + 2.8 : midY;
  const opts = paintOptions || {};
  const lineColor = normalizeHexColor(opts.lineColor, DEFAULT_RELATION_LINE_COLOR);
  const lineStyle = normalizeSceneLineStyle(opts.lineStyle, 'segment-dash');
  const relationColor = normalizeHexColor(opts.relationColor, DEFAULT_RELATION_RELATION_COLOR);
  const noteColor = normalizeHexColor(opts.noteColor, DEFAULT_RELATION_NOTE_COLOR);
  const linePaint = buildSceneLinePaint(lineColor, lineStyle, lineStyle === 'double' ? 6 : 2);
  return {
    style:
      'width:' +
      len.toFixed(2) +
      '%;left:' +
      x1.toFixed(1) +
      '%;top:' +
      y1.toFixed(1) +
      '%;transform:rotate(' +
      deg.toFixed(2) +
      'deg);transform-origin:0 50%;' +
      linePaint,
    label: labelText,
    note: noteText,
    midStyle:
      'left:' +
      midX.toFixed(1) +
      '%;top:' +
      labelTop.toFixed(1) +
      '%;transform:translate(-50%,-50%);color:' +
      relationColor +
      ';',
    noteStyle: noteText
      ? 'left:' +
        midX.toFixed(1) +
        '%;top:' +
        noteTop.toFixed(1) +
        '%;transform:translate(-50%,0);color:' +
        noteColor +
        ';'
      : 'display:none;'
  };
}

function buildRelationLinePaintOptions(profileScene) {
  const scene = normalizeProfileScene(profileScene);
  return {
    lineColor: scene.relationGraphLineColor,
    lineStyle: scene.relationGraphLineStyle,
    relationColor: scene.relationGraphRelationColor,
    noteColor: scene.relationGraphNoteColor
  };
}

function buildAllGraphLines(center, nodes, relationEdges, profileScene) {
  const lines = [];
  const paintOptions = buildRelationLinePaintOptions(profileScene);
  const centerPos = { x: 50, y: 50 };
  const nodeMap = {};
  (nodes || []).forEach((node) => {
    const pos = parseNodeStylePercent(node.style);
    if (pos) nodeMap[node.id] = pos;
  });
  (nodes || []).forEach((node) => {
    const pos = nodeMap[node.id];
    if (!pos) return;
    lines.push(
      Object.assign(
        { key: 'center-' + node.id },
        buildLineBetween(
          centerPos.x,
          centerPos.y,
          pos.x,
          pos.y,
          relationGraphLabel(node.relationType),
          node.note,
          paintOptions
        )
      )
    );
  });
  const centerPairs = {};
  (nodes || []).forEach((node) => {
    centerPairs[['center', node.id].sort().join(':')] = true;
  });
  (relationEdges || []).forEach((edge) => {
    const pairKey = [edge.fromId, edge.toId].sort().join(':');
    if (centerPairs[pairKey]) return;
    const p1 = edge.fromId === 'center' ? centerPos : nodeMap[edge.fromId];
    const p2 = edge.toId === 'center' ? centerPos : nodeMap[edge.toId];
    if (!p1 || !p2) return;
    lines.push(
      Object.assign(
        { key: edge.id },
        buildLineBetween(
          p1.x,
          p1.y,
          p2.x,
          p2.y,
          relationGraphLabel(edge.relationType),
          edge.note,
          paintOptions
        )
      )
    );
  });
  return lines;
}

function buildRelationTextList(ocName, relationships, relationEdges) {
  const nameMap = { center: ocName || '主人物' };
  (relationships || []).forEach((r) => {
    nameMap[r.id] = r.name;
  });
  const items = [];
  (relationships || []).forEach((r) => {
    const label = relationGraphLabel(r.relationType) || '关联';
    let text = (ocName || '主人物') + ' — ' + label + ' — ' + r.name;
    if (r.title) text += '（' + r.title + '）';
    if (r.note) text += '：' + r.note;
    items.push({ key: 'rel-' + r.id, text });
  });
  (relationEdges || []).forEach((edge) => {
    const fromName = nameMap[edge.fromId] || '—';
    const toName = nameMap[edge.toId] || '—';
    const label = relationGraphLabel(edge.relationType) || '关联';
    let text = fromName + ' — ' + label + ' — ' + toName;
    if (edge.note) text += '：' + edge.note;
    items.push({ key: edge.id, text });
  });
  return items;
}

function inferTimelineCategory(raw) {
  const c = String((raw && (raw.category || raw.scope)) || '').trim();
  if (c === 'world' || c === 'events') return c;
  const title = String((raw && raw.title) || '').trim();
  const dateLabel = String((raw && raw.dateLabel) || '').trim();
  if (title === '身世设定' || title === '人生大事件' || dateLabel === '身世') return 'events';
  return 'world';
}

function normalizeTimelineEvent(raw, index) {
  if (!raw) return null;
  const title = String(raw.title || raw.event || '').trim();
  const description = String(raw.description || raw.desc || raw.content || '').trim();
  const dateLabel = String(raw.dateLabel || raw.date || raw.era || '').trim();
  const id = String(raw.id || newId('tl'));
  const brief = String(raw.brief || '').trim();
  const hasContent = !!(title || description || dateLabel || brief);
  if (!hasContent && !raw.id) return null;
  return {
    id,
    dateLabel,
    title,
    description,
    brief,
    sortKey: Number(raw.sortKey != null ? raw.sortKey : index) || index,
    category: inferTimelineCategory(raw)
  };
}

function timelineEventsForSave(list) {
  return normalizeTimelineEvents(list).filter(
    (e) =>
      String(e.dateLabel || '').trim() ||
      String(e.title || '').trim() ||
      String(e.description || '').trim() ||
      String(e.brief || '').trim()
  );
}

function normalizeTimelineEvents(list) {
  const out = [];
  (list || []).forEach((item, i) => {
    const e = normalizeTimelineEvent(item, i);
    if (e) out.push(e);
  });
  return out.sort((a, b) => a.sortKey - b.sortKey);
}

/** 从身世/大事件补全时间轴（无独立时间轴数据时） */
function buildTimelineFromBackground(background, existingTimeline) {
  const existing = normalizeTimelineEvents(existingTimeline);
  if (existing.length) return existing;
  const bg = background || {};
  const out = [];
  let idx = 0;
  (bg.origins || []).forEach((text) => {
    const t = String(text || '').trim();
    if (!t) return;
    out.push({
      id: newId('tl'),
      dateLabel: '身世',
      title: '身世设定',
      description: t,
      sortKey: idx++,
      category: 'events'
    });
  });
  (bg.lifeEvents || []).forEach((text) => {
    const t = String(text || '').trim();
    if (!t) return;
    out.push({
      id: newId('tl'),
      dateLabel: '',
      title: '人生大事件',
      description: t,
      sortKey: idx++,
      category: 'events'
    });
  });
  return out;
}

/** 无世界观时间轴节点时默认 10 个；不足 10 个时补齐空节点 */
function ensureDefaultWorldTimeline(timelineEvents) {
  const list = Array.isArray(timelineEvents) ? timelineEvents.slice() : [];
  const eventsPart = list.filter((e) => e && e.category === 'events');
  let world = list.filter((e) => e && e.category === 'world');
  if (!world.length) {
    world = [];
    for (let i = 0; i < 10; i += 1) {
      world.push(emptyTimelineEvent(i, 'world'));
    }
  } else {
    while (world.length < 10) {
      world.push(emptyTimelineEvent(world.length, 'world'));
    }
  }
  return world.concat(
    eventsPart.map((e, i) => Object.assign({}, e, { sortKey: world.length + i }))
  );
}

function buildRelationGraphNodes(ocName, ocImagePath, relationships, opts) {
  const center = {
    id: 'center',
    name: ocName || '你的人物',
    title: '',
    relationType: '',
    isCenter: true,
    avatarUrl: ocImagePath || '',
    style: 'left:50%;top:50%;transform:translate(-50%,-50%);'
  };
  const list = normalizeRelationships(relationships).slice(0, RELATION_RING_MAX);
  const aspectWH =
    opts && Number(opts.aspectWH) > 0 ? Number(opts.aspectWH) : RELATION_DEFAULT_ASPECT_WH;
  const total = Math.max(list.length, 1);
  // 有完整自定义坐标且未挤在一起时沿用；否则均匀环绕（含 ≥4 人）
  let useCustom = list.length > 0 && list.every((rel) => rel.posX != null && rel.posY != null);
  if (useCustom && list.length >= 2) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (positionsTooClose(list[i], list[j])) {
          useCustom = false;
          break;
        }
      }
      if (!useCustom) break;
    }
  }
  const nodes = list.map((rel, i) => {
    let x;
    let y;
    if (useCustom) {
      x = rel.posX;
      y = rel.posY;
    } else {
      const p = relationPosFromRing(i, list.length || 1, aspectWH);
      x = p.x;
      y = p.y;
    }
    return Object.assign({}, rel, {
      isCenter: false,
      style: nodeStyleFromPos(x, y)
    });
  });
  return { center, nodes, aspectWH: aspectWH, ringTotal: total };
}

function mergeRelationNodeNotes(nodes, relationships, relationEdges) {
  const list = normalizeRelationships(relationships);
  const edges = normalizeRelationEdges(relationEdges);
  return (nodes || []).map((node) => {
    const rel = list.find((r) => r.id === node.id);
    if (!rel) return node;
    const baseNote = String(rel.note || '').trim();
    const edgeNotes = edges
      .filter(
        (e) =>
          (e.fromId === node.id || e.toId === node.id) &&
          e.fromId !== 'center' &&
          e.toId !== 'center'
      )
      .map((e) => String(e.note || '').trim())
      .filter(Boolean);
    const parts = [];
    if (baseNote) parts.push(baseNote);
    edgeNotes.forEach((n) => {
      if (parts.indexOf(n) < 0) parts.push(n);
    });
    return Object.assign({}, node, { note: parts.join(' · '), title: rel.title });
  });
}

function buildRelationAddNodeStyle(nodeCount, aspectWH, customPos) {
  if (nodeCount >= RELATION_RING_MAX) return '';
  if (
    customPos &&
    Number.isFinite(Number(customPos.x)) &&
    Number.isFinite(Number(customPos.y))
  ) {
    return nodeStyleFromPos(
      Math.max(5, Math.min(95, Number(customPos.x))),
      Math.max(5, Math.min(95, Number(customPos.y)))
    );
  }
  const nextTotal = nodeCount + 1;
  const p = relationPosFromRing(nodeCount, Math.max(nextTotal, 4), aspectWH);
  return nodeStyleFromPos(p.x, p.y);
}

function emptyRelationship() {
  return {
    id: newId('rel'),
    name: '',
    title: '',
    relationType: RELATION_CUSTOM,
    note: '',
    targetOcId: '',
    avatarUrl: '',
    posX: null,
    posY: null
  };
}

function emptyTimelineEvent(sortKey, category) {
  return {
    id: newId('tl'),
    dateLabel: '',
    title: '',
    description: '',
    brief: '',
    sortKey: Number(sortKey) || 0,
    category: category === 'events' ? 'events' : 'world'
  };
}

function preserveTimelineEvent(raw, index, options) {
  if (!raw || !raw.id) return null;
  const trimFields = !(options && options.keepRawInput);
  const strField = (val) => {
    const s = val != null ? String(val) : '';
    return trimFields ? s.trim() : s;
  };
  return {
    id: String(raw.id),
    dateLabel: strField(raw.dateLabel),
    title: strField(raw.title || raw.event),
    description: strField(raw.description || raw.desc || raw.content),
    brief: strField(raw.brief),
    sortKey: Number(raw.sortKey != null ? raw.sortKey : index) || index,
    category: inferTimelineCategory(raw)
  };
}

function splitTimelineByCategory(list, options) {
  const timelineEvents = (list || [])
    .map((item, i) => preserveTimelineEvent(item, i, options))
    .filter(Boolean)
    .sort((a, b) => a.sortKey - b.sortKey);
  return {
    timelineEvents,
    worldTimelineEvents: timelineEvents.filter((e) => e.category === 'world'),
    eventsTimelineEvents: timelineEvents.filter((e) => e.category === 'events')
  };
}

function mergeProfileFields(work, favoriteItem) {
  const w = work || {};
  const fav = favoriteItem || {};
  return {
    relationships: normalizeRelationships(
      w.relationships && w.relationships.length
        ? w.relationships
        : fav.relationships
    ),
    relationEdges: normalizeRelationEdges(
      w.relationEdges && w.relationEdges.length
        ? w.relationEdges
        : fav.relationEdges
    ),
    timelineEvents: normalizeTimelineEvents(
      w.timelineEvents && w.timelineEvents.length
        ? w.timelineEvents
        : fav.timelineEvents
    )
  };
}

module.exports = {
  RELATION_CUSTOM,
  RELATION_TYPES,
  isPresetRelationType,
  relationPickerButtonLabel,
  relationCustomDraftFromType,
  relationGraphLabel,
  PROFILE_TABS,
  TIMELINE_LINE_STYLES,
  TIMELINE_LINE_STYLE_LABELS,
  TIMELINE_CARD_TEXT_COLORS,
  SCENE_LINE_STYLES,
  SCENE_LINE_STYLE_LABELS,
  getProfileSceneThemeDefaults,
  normalizeHexColor,
  hexToRgba,
  normalizeSceneLineStyle,
  sceneLineStyleIndex,
  buildSceneLinePaint,
  buildTimelineNodeStyle,
  buildRelationLinePaintOptions,
  normalizeProfileScene,
  timelineLineStyleIndex,
  timelineEventsForSave,
  normalizeRelationship,
  normalizeRelationships,
  normalizeRelationEdge,
  normalizeRelationEdges,
  buildAllGraphLines,
  buildRelationTextList,
  parseNodeStylePercent,
  normalizeTimelineEvent,
  normalizeTimelineEvents,
  buildTimelineFromBackground,
  ensureDefaultWorldTimeline,
  buildRelationGraphNodes,
  mergeRelationNodeNotes,
  buildRelationAddNodeStyle,
  nodeStyleFromPos,
  pickNodePos,
  emptyRelationship,
  emptyTimelineEvent,
  splitTimelineByCategory,
  mergeProfileFields,
  newId
};
