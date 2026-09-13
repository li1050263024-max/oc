const ocImage = require('../../utils/ocImage.js');
const ocAlbum = require('../../utils/ocAlbum.js');
const staticAssets = require('../../utils/staticAssets.js');
const {
  loadFavoriteToWork,
  getFavoriteById,
  getFavorites,
  updateFavoriteItem
} = require('../../utils/favorite.js');
const { mergeWork, workSnapshot } = require('../../utils/ocNotebookData.js');
const { personalityBlend, normalizeResult } = require('../../utils/ocResult.js');
const { applyParsedSetting } = require('../../utils/parseOcWork.js');
const { syncPageTheme, getSwiperIndicatorColors } = require('../../utils/uiTheme.js');
const {
  buildProfileCollapseBarStyle,
  buildProfileTabRailStyle,
  buildProfileScrollPadStyle,
  buildProfilePanelHeadStyle,
  getWxNavSafeInsets
} = require('../../utils/wxNavSafe.js');
const {
  PROFILE_TABS,
  TIMELINE_LINE_STYLE_LABELS,
  TIMELINE_CARD_TEXT_COLORS,
  SCENE_LINE_STYLES,
  SCENE_LINE_STYLE_LABELS,
  buildSceneLinePaint,
  buildTimelineNodeStyle,
  RELATION_TYPES,
  isPresetRelationType,
  relationPickerButtonLabel,
  relationCustomDraftFromType,
  relationGraphLabel,
  normalizeRelationships,
  normalizeRelationEdges,
  normalizeTimelineEvents,
  normalizeProfileScene,
  normalizeTimelineNodeOffsets,
  normalizeTimelineSegmentBends,
  timelineLineStyleIndex,
  timelineEventsForSave,
  buildTimelineFromBackground,
  ensureDefaultWorldTimeline,
  buildRelationGraphNodes,
  buildRelationAddNodeStyle,
  buildAllGraphLines,
  buildRelationTextList,
  emptyRelationship,
  emptyTimelineEvent,
  splitTimelineByCategory,
  newId
} = require('../../utils/ocProfileData.js');
const { exportCanvasToAlbum, drawTimeline, drawRelationGraph } = require('../../utils/sceneExport.js');

function hsvToHex(h, s, v) {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, Number(s)));
  const vv = Math.max(0, Math.min(1, Number(v)));
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return ('#' + toHex(r) + toHex(g) + toHex(b)).toLowerCase();
}

function hexToHsv(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) return { h: 270, s: 0.35, v: 0.55 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function sceneBgSrc(path, key) {
  const p = String(path || '').trim();
  if (!p) return '';
  const base = typeof wx !== 'undefined' && wx.env ? wx.env.USER_DATA_PATH || wx.env.USERDATA_PATH || '' : '';
  if (
    /^wxfile:\/\//i.test(p) ||
    (base && p.indexOf(base) === 0)
  ) {
    return p;
  }
  return p + (p.indexOf('?') >= 0 ? '&' : '?') + 'v=' + (key || 0);
}

function relationBgSrc(path, key) {
  return sceneBgSrc(path, key);
}

function hasTimelineContent(item) {
  if (!item) return false;
  return !!(
    String(item.dateLabel || '').trim() ||
    String(item.title || '').trim() ||
    String(item.description || '').trim()
  );
}

const TIMELINE_ROW_STEP_RPX = 128;
const TIMELINE_INNER_PAD_TOP_RPX = 56;
const TIMELINE_BEZIER_STEPS = 14;
const TIMELINE_SUMMARY_MAX_LEN = 150;
const TIMELINE_SUMMARY_WIDTH_RPX = 260;
const TIMELINE_DETAIL_BTN_HEIGHT_RPX = 36;
const TIMELINE_EXPAND_HIT_HEIGHT_RPX = 48;
const TIMELINE_MIN_DETAIL_GAP_RPX = 36;
const TIMELINE_ROW_EXTRA_PAD_RPX = 16;

function pxToRpx(px) {
  const ww = wx.getSystemInfoSync().windowWidth || 375;
  return (px / ww) * 750;
}

function autoWaveOffsetRpx(index, lineStyle) {
  if (lineStyle !== 'curve') return 0;
  const group = Math.floor(index / 4);
  const posInGroup = index % 4;
  const waveDir = group % 2 === 0 ? 1 : -1;
  const t = posInGroup / 3;
  return Math.round(Math.sin(t * Math.PI) * waveDir * 44);
}

function nodeOffsetRpx(item, index, lineStyle, nodeOffsets) {
  const custom = nodeOffsets && item && item.id != null ? Number(nodeOffsets[item.id]) || 0 : 0;
  return autoWaveOffsetRpx(index, lineStyle) + custom;
}

function rotatedLinkStyle(x1, y1, x2, y2, linePaint) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return 'display:none;';
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    'left:' +
    x1.toFixed(1) +
    'rpx;top:' +
    y1.toFixed(1) +
    'rpx;width:' +
    len.toFixed(1) +
    'rpx;transform:rotate(' +
    deg.toFixed(2) +
    'deg);transform-origin:0 50%;' +
    (linePaint || '')
  );
}

function sampleSpineLinks(p0, p1, ctrl, lineStyle, linePaint) {
  if (lineStyle === 'straight') {
    return [{ key: p0.x + '-' + p0.y, style: rotatedLinkStyle(p0.x, p0.y, p1.x, p1.y, linePaint) }];
  }
  const links = [];
  let prev = p0;
  for (let step = 1; step <= TIMELINE_BEZIER_STEPS; step += 1) {
    const t = step / TIMELINE_BEZIER_STEPS;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    const point = { x, y };
    links.push({
      key: p0.x + '-' + p0.y + '-' + step,
      style: rotatedLinkStyle(prev.x, prev.y, point.x, point.y, linePaint)
    });
    prev = point;
  }
  return links;
}

function buildTimelineSpineData(events, lineStyle, profileScene, axisCenterRpx, curveEditMode) {
  const list = events || [];
  const scene = normalizeProfileScene(profileScene);
  const nodeOffsets = scene.worldTimelineNodeOffsets || {};
  let segmentBends = (scene.worldTimelineSegmentBends || []).slice();
  const spineLineStyle = scene.worldTimelineSpineLineStyle || 'solid';
  const linePaint = buildSceneLinePaint(
    scene.worldTimelineLineColor,
    spineLineStyle,
    spineLineStyle === 'double' ? 6 : 3
  );
  const handleColor = scene.worldTimelineLineColor;
  const links = [];
  const handles = [];
  if (list.length < 2) return { links, handles, handleColor };

  const points = [];
  let yOffset = TIMELINE_INNER_PAD_TOP_RPX;
  list.forEach((item, index) => {
    const rowH = Number(item.rowHeightRpx) || TIMELINE_ROW_STEP_RPX;
    points.push({
      x: axisCenterRpx + nodeOffsetRpx(item, index, lineStyle, nodeOffsets),
      y: yOffset + rowH / 2
    });
    yOffset += rowH;
  });

  for (let i = 1; i < points.length; i += 1) {
    while (segmentBends.length < i) segmentBends.push(0);
    const p0 = points[i - 1];
    const p1 = points[i];
    const bend = Number(segmentBends[i - 1]) || 0;
    const ctrl = {
      x: (p0.x + p1.x) / 2 + (lineStyle === 'curve' ? bend : 0),
      y: (p0.y + p1.y) / 2
    };
    sampleSpineLinks(p0, p1, ctrl, lineStyle, linePaint).forEach((link) => links.push(link));
    if (curveEditMode && lineStyle === 'curve') {
      handles.push({
        key: 'handle-' + (i - 1),
        segIndex: i - 1,
        style:
          'left:' +
          (ctrl.x - 14).toFixed(1) +
          'rpx;top:' +
          (ctrl.y - 14).toFixed(1) +
          'rpx;background:' +
          handleColor +
          ';'
      });
    }
  }

  return { links, handles, segmentBends, handleColor };
}

function truncateTimelinePreview(text, maxLen) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + '…';
}

function estimateTimelineTextHeightRpx(text, fontRpx, lineHeightRatio, widthRpx) {
  const len = String(text || '').length;
  if (!len) return 0;
  const charWidth = fontRpx * 0.92;
  const charsPerLine = Math.max(1, Math.floor(widthRpx / charWidth));
  const lines = Math.ceil(len / charsPerLine);
  return Math.ceil(lines * fontRpx * lineHeightRatio);
}

function buildTimelineCardBoxStyle(item) {
  const descText = truncateTimelinePreview(item.description, TIMELINE_SUMMARY_MAX_LEN);
  const descH = descText
    ? estimateTimelineTextHeightRpx(descText, 22, 1.6, TIMELINE_SUMMARY_WIDTH_RPX - 24)
    : 100;
  const minH = 32 + 44 + 44 + Math.max(100, descH) + 52 + 32;
  const cappedMinH = Math.min(Math.ceil(minH), 480);
  return 'min-height:' + cappedMinH + 'rpx;max-height:480rpx;';
}

function estimateCollapsedStackHeightRpx(item) {
  const titleText = (item.dateLabel || '—') + ' · ' + (item.title || '—');
  const titleH = estimateTimelineTextHeightRpx(titleText, 24, 1.5, TIMELINE_SUMMARY_WIDTH_RPX);
  const descH = item.summaryPreview
    ? estimateTimelineTextHeightRpx(item.summaryPreview, 20, 1.45, TIMELINE_SUMMARY_WIDTH_RPX)
    : 0;
  const summaryH = titleH + (descH ? 4 + descH : 0);
  if (item.hasContent) {
    return TIMELINE_EXPAND_HIT_HEIGHT_RPX + 6 + summaryH;
  }
  return TIMELINE_DETAIL_BTN_HEIGHT_RPX;
}

function computeTimelineRowHeights(viewItems) {
  const n = (viewItems || []).length;
  if (!n) return [];
  const stackHeights = viewItems.map((item) => estimateCollapsedStackHeightRpx(item));
  const heights = stackHeights.map((stackH) =>
    Math.max(TIMELINE_ROW_STEP_RPX, Math.ceil(stackH + TIMELINE_ROW_EXTRA_PAD_RPX))
  );
  const rowTops = [];
  let cumY = 0;
  for (let i = 0; i < n; i += 1) {
    rowTops.push(cumY);
    cumY += heights[i];
  }
  for (let i = 0; i < n - 1; i += 1) {
    const stackBottom = rowTops[i] + heights[i] / 2 + stackHeights[i] / 2;
    const nextTop = rowTops[i + 1] + heights[i + 1] / 2 - stackHeights[i + 1] / 2;
    const gap = nextTop - stackBottom;
    if (gap >= TIMELINE_MIN_DETAIL_GAP_RPX) continue;
    const need = TIMELINE_MIN_DETAIL_GAP_RPX - gap;
    if (i + 2 < n) {
      heights[i] += Math.ceil(need * 0.38);
      heights[i + 1] += Math.ceil(need * 0.34);
      heights[i + 2] += Math.ceil(need * 0.28);
    } else {
      heights[i] += Math.ceil(need * 0.55);
      heights[i + 1] += Math.ceil(need * 0.45);
    }
    cumY = rowTops[i] + heights[i];
    for (let k = i + 1; k < n; k += 1) {
      rowTops[k] = cumY;
      cumY += heights[k];
    }
  }
  return heights;
}

function buildWorldTimelineView(events, profileScene) {
  const scene = normalizeProfileScene(profileScene);
  const style = scene.worldTimelineLineStyle || 'curve';
  const cardTextStyle = 'color:' + scene.worldTimelineCardTextColor + ';';
  const nodeStyle = buildTimelineNodeStyle(scene.worldTimelineNodeColor);
  const offsets = scene.worldTimelineNodeOffsets || {};
  const baseItems = (events || []).map((item, index) => {
    const labelSide = index % 2 === 0 ? 'left' : 'right';
    const curveOffsetRpx = nodeOffsetRpx(item, index, style, offsets);
    return Object.assign({}, item, {
      labelSide,
      curveOffsetRpx,
      starStyle: curveOffsetRpx ? 'transform:translateX(' + curveOffsetRpx + 'rpx);' : '',
      hasContent: hasTimelineContent(item),
      summaryPreview: truncateTimelinePreview(item.description, TIMELINE_SUMMARY_MAX_LEN),
      cardTextStyle,
      cardBoxStyle: buildTimelineCardBoxStyle(item),
      nodeStyle,
      detailExpandDown: index <= 1,
      detailHeaderClearance: index === 0
    });
  });
  const rowHeights = computeTimelineRowHeights(baseItems);
  return baseItems.map((item, index) => {
    const rowHeightRpx = rowHeights[index] || TIMELINE_ROW_STEP_RPX;
    const rowStyle =
      'height:' + rowHeightRpx + 'rpx;min-height:' + rowHeightRpx + 'rpx;';
    const nodeRowStyle = rowStyle + (item.starStyle || '');
    return Object.assign({}, item, {
      rowHeightRpx,
      rowStyle,
      nodeRowStyle
    });
  });
}

function joinSlash3(list) {
  const arr = (list || []).map((s) => String(s || '').trim());
  while (arr.length < 3) arr.push('');
  return arr.slice(0, 3).join(' / ');
}

function splitSlash3(text) {
  const parts = String(text || '')
    .split(/[/／、,，|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  while (parts.length < 3) parts.push('');
  return parts.slice(0, 3);
}

function buildBasicDraft(result, personalityText, quirkText, likeText) {
  const r = normalizeResult(result || {});
  return {
    name: r.name || '',
    race: r.race || '',
    gender: r.gender || '',
    age: r.age || '',
    hairColor: r.hairColor || '',
    eyeColor: r.eyeColor || '',
    personalityText: personalityText || joinSlash3(r.personalities),
    quirkText: quirkText || joinSlash3(r.quirks),
    likeText: likeText != null ? String(likeText === '—' ? '' : likeText) : r.likes || ''
  };
}

function splitStoryParagraphs(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const blocks = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  return raw.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

function buildStoryDisplayList(list) {
  return (list || []).map((s) => {
    const paragraphs = splitStoryParagraphs(s.content);
    return {
      id: s.id,
      title: s.title,
      content: s.content || '',
      previewText: paragraphs.slice(0, 3).join('\n\n') || s.content || '',
      hasMoreParagraphs: paragraphs.length > 3
    };
  });
}

Page({
  data: {
    favoriteId: '',
    activeTab: 'basic',
    activeTabIndex: 0,
    activeTabLabel: '基础信息',
    activeTabSub: 'PROFILE',
    tabRailCollapsed: false,
    collapseBarStyle: '',
    tabRailStyle: '',
    scrollPadStyle: '',
    panelHeadStyle: '',
    fullscreenBodyStyle: '',
    profileTabs: PROFILE_TABS,
    relationTypes: RELATION_TYPES,
    result: {},
    background: { worldview: '', origins: [], lifeEvents: [] },
    catchphrases: [],
    attitudes: [],
    generatedBio: '',
    ocStories: [],
    ocStoriesDisplay: [],
    bioExpanded: false,
    storyExpanded: false,
    storyFullExpanded: {},
    ocImages: [],
    ocImageIndex: 0,
    ocImagePath: '',
    ocImageExpanded: false,
    ocAlbums: [],
    ocAlbumCards: [],
    featuredAlbum: null,
    gridAlbums: [],
    uploadingImages: false,
    portraitPlaceholder: staticAssets.getOcPortraitPlaceholder(),
    personalityText: '',
    quirkText: '',
    likeText: '',
    basicEditing: false,
    basicDraft: {
      name: '',
      race: '',
      gender: '',
      age: '',
      hairColor: '',
      eyeColor: '',
      personalityText: '',
      quirkText: '',
      likeText: ''
    },
    relationships: [],
    relationEdges: [],
    relationTextList: [],
    relationLinkMode: false,
    relationLinkPickId: '',
    relationLinkFormVisible: false,
    relationLinkFromId: '',
    relationLinkToId: '',
    relationLinkFormTitle: '',
    relationLinkTypePickerIndex: 1,
    relationLinkPickerLabel: '挚友',
    relationLinkCustomDraft: '',
    relationLinkNote: '',
    timelineEvents: [],
    worldTimelineEvents: [],
    eventsTimelineEvents: [],
    worldTimelineView: [],
    profileScene: normalizeProfileScene(null),
    expandedTimelineCards: {},
    timelineSpineLinks: [],
    timelineCurveHandles: [],
    timelineCurveEditMode: false,
    colorPickerVisible: false,
    colorPickerHue: 270,
    colorPickerSat: 0.35,
    colorPickerVal: 0.55,
    colorPickerPreview: '#5b4b8a',
    colorPickerTarget: '',
    colorPickerTitle: '选择颜色',
    colorPresets: TIMELINE_CARD_TEXT_COLORS,
    sceneLineStyleLabels: SCENE_LINE_STYLE_LABELS,
    relationGraphNameStyle: '',
    worldTimelineBgDisplay: '',
    worldTimelineBgSrc: '',
    worldTimelineBgKey: 0,
    relationGraphBgDisplay: '',
    relationGraphBgSrc: '',
    relationGraphBgKey: 0,
    timelineLineStyleLabels: TIMELINE_LINE_STYLE_LABELS,
    timelineLineStyleIndex: 0,
    relationGraph: { center: {}, nodes: [] },
    graphLines: [],
    relationAddStyle: '',
    relationNodeDense: false,
    relationEditorVisible: false,
    relationEditIndex: -1,
    relationTypePickerIndex: 0,
    relationPickerLabel: '自定义',
    relationCustomDraft: '',
    tabSmartText: '',
    notebookOcPickerList: [],
    notebookOcNames: [],
    autoText: '',
    parsing: false,
    swiperIndicatorColor: 'rgba(109, 40, 217, 0.25)',
    swiperIndicatorActiveColor: '#6d28d9',
    saving: false,
    uiThemeClass: ''
  },

  onLoad(options) {
    syncPageTheme(this);
    this._syncSwiperTheme();
    this._updateLayout();
    const id = options && options.id ? decodeURIComponent(options.id) : '';
    if (!id) {
      wx.showToast({ title: '缺少 OC 信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    this.setData({ favoriteId: id });
    if (this.data.activeTab === 'timeline') {
      this._applyTab('world');
    }
    this._loadNotebookOcPicker(id);
    this.loadProfile();
  },

  onShow() {
    syncPageTheme(this);
    this._syncSwiperTheme();
    this._updateLayout();
    if (this._skipProfileReloadOnce || this._pickingSceneBg) {
      if (!this._pickingSceneBg) this._skipProfileReloadOnce = false;
      if (this.data.favoriteId) this._loadNotebookOcPicker(this.data.favoriteId);
      return;
    }
    if (this.data.favoriteId) {
      this._loadNotebookOcPicker(this.data.favoriteId);
      this.loadProfile();
    }
  },

  _loadNotebookOcPicker(currentId) {
    const list = getFavorites()
      .filter((f) => f.id !== currentId)
      .map((f) => ({
        id: f.id,
        name: String((f.result && f.result.name) || '').trim() || '未命名',
        avatarUrl: f.ocImagePath || '',
        race: String((f.result && f.result.race) || '').trim()
      }));
    this.setData({
      notebookOcPickerList: list,
      notebookOcNames: list.map((o) => o.name)
    });
  },

  _enrichRelationships(list) {
    return (list || []).map((rel) => {
      const item = Object.assign({}, rel);
      if (!item.avatarUrl && item.targetOcId) {
        const fav = getFavoriteById(item.targetOcId);
        if (fav && fav.ocImagePath) item.avatarUrl = fav.ocImagePath;
      }
      return item;
    });
  },

  _updateLayout() {
    const insets = getWxNavSafeInsets();
    const tabRailCollapsed = !!this.data.tabRailCollapsed;
    this.setData({
      collapseBarStyle: buildProfileCollapseBarStyle(insets),
      tabRailStyle: buildProfileTabRailStyle(insets),
      scrollPadStyle: buildProfileScrollPadStyle(insets, tabRailCollapsed),
      panelHeadStyle: buildProfilePanelHeadStyle(insets),
      fullscreenBodyStyle: 'padding-top:' + insets.topHeight + 'px;'
    });
  },

  _getRelationAspectWH() {
    return this._relationAspectWH || 0.78;
  },

  _measureRelationGraphAspect(cb) {
    try {
      const query = wx.createSelectorQuery().in(this);
      query.select('.relation-graph').boundingClientRect();
      query.exec((res) => {
        const rect = res && res[0];
        if (rect && rect.width > 40 && rect.height > 40) {
          this._relationAspectWH = rect.width / rect.height;
        }
        if (typeof cb === 'function') cb(this._getRelationAspectWH());
      });
    } catch (_) {
      if (typeof cb === 'function') cb(this._getRelationAspectWH());
    }
  },

  _refreshRelationGraph(relationships, relationEdges) {
    const ocName = (this.data.result && this.data.result.name) || '未命名';
    const list = normalizeRelationships(relationships || this.data.relationships);
    const edges = normalizeRelationEdges(relationEdges != null ? relationEdges : this.data.relationEdges);
    const profileScene = normalizeProfileScene(this.data.profileScene);
    const nameStyle = 'color:' + profileScene.relationGraphNameColor + ';';
    const aspectWH = this._getRelationAspectWH();
    const graph = buildRelationGraphNodes(ocName, this.data.ocImagePath, list, { aspectWH });
    graph.center = Object.assign({}, graph.center, { nameStyle });
    const graphNodes = (graph.nodes || []).map((node) => {
      const rel = list.find((r) => r.id === node.id);
      const next = rel ? Object.assign({}, node, { title: rel.title }) : node;
      return Object.assign({}, next, { nameStyle, titleStyle: nameStyle });
    });
    graph.nodes = graphNodes;
    const addPos = this._getRelationAddPos(profileScene);
    this.setData({
      relationGraph: graph,
      graphLines: buildAllGraphLines(graph.center, graph.nodes, edges, profileScene),
      relationGraphNameStyle: nameStyle,
      relationAddStyle: buildRelationAddNodeStyle(graph.nodes.length, aspectWH, addPos),
      relationTextList: buildRelationTextList(ocName, list, edges),
      relationNodeDense: graph.nodes.length >= 4
    });
    // 量到真实宽高后再排一次，校正椭圆
    if (this.data.activeTab === 'relation') {
      this._measureRelationGraphAspect((nextAspect) => {
        if (Math.abs(nextAspect - aspectWH) < 0.04) return;
        const g2 = buildRelationGraphNodes(ocName, this.data.ocImagePath, list, {
          aspectWH: nextAspect
        });
        g2.center = Object.assign({}, g2.center, { nameStyle });
        g2.nodes = (g2.nodes || []).map((node) => {
          const rel = list.find((r) => r.id === node.id);
          const next = rel ? Object.assign({}, node, { title: rel.title }) : node;
          return Object.assign({}, next, { nameStyle, titleStyle: nameStyle });
        });
        this.setData({
          relationGraph: g2,
          graphLines: buildAllGraphLines(g2.center, g2.nodes, edges, profileScene),
          relationAddStyle: buildRelationAddNodeStyle(g2.nodes.length, nextAspect, addPos)
        });
      });
    }
  },

  _getRelationAddPos(profileScene) {
    const scene = profileScene || normalizeProfileScene(this.data.profileScene);
    if (scene.relationAddPosX != null && scene.relationAddPosY != null) {
      return { x: scene.relationAddPosX, y: scene.relationAddPosY };
    }
    return null;
  },

  _syncSwiperTheme() {
    const { indicatorColor, indicatorActiveColor } = getSwiperIndicatorColors();
    this.setData({
      swiperIndicatorColor: indicatorColor,
      swiperIndicatorActiveColor: indicatorActiveColor
    });
  },

  _syncTimelineViews(list, options) {
    return splitTimelineByCategory(list, options);
  },

  async loadProfile() {
    const id = this.data.favoriteId;
    const work = loadFavoriteToWork(id);
    if (!work) {
      wx.showToast({ title: '未找到该 OC', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    await ocImage.normalizeWorkImages(work);
    const fav = getFavoriteById(id) || {};
    const albumCountBefore = Array.isArray(fav.ocAlbums) ? fav.ocAlbums.length : 0;
    ocAlbum.syncWorkImagesFromAlbums(work);
    const albumCountAfter = Array.isArray(work.ocAlbums) ? work.ocAlbums.length : 0;
    const m = mergeWork(work);
    let profileScene = normalizeProfileScene(work.profileScene || fav.profileScene);
    const relationships = this._enrichRelationships(
      normalizeRelationships(work.relationships || fav.relationships)
    );
    const relationEdges = normalizeRelationEdges(work.relationEdges || fav.relationEdges);
    const timelineBundle = this._syncTimelineViews(
      ensureDefaultWorldTimeline(
        buildTimelineFromBackground(
          m.background,
          work.timelineEvents && work.timelineEvents.length
            ? work.timelineEvents
            : fav.timelineEvents
        )
      )
    );
    const ocName = (m.result && m.result.name) || '未命名';
    let ocImagePath = m.ocImagePath || '';
    // 与背景一致：校验本地文件；失效则从图册再取一张可用图
    const resolvedPrimary = await ocImage.resolveLocalImagePath(ocImagePath);
    if (resolvedPrimary) {
      ocImagePath = resolvedPrimary;
    } else {
      const albums = ocAlbum.normalizeOcAlbums(work);
      const flat = ocAlbum.flattenAlbumImages(albums);
      ocImagePath = '';
      for (let i = 0; i < flat.length; i++) {
        const p = await ocImage.resolveLocalImagePath(flat[i] && flat[i].path);
        if (p) {
          ocImagePath = p;
          break;
        }
      }
      if (!ocImagePath && flat.length) ocImagePath = (flat[0] && flat[0].path) || '';
    }
    const graph = buildRelationGraphNodes(ocName, ocImagePath, relationships, {
      aspectWH: this._getRelationAspectWH()
    });
    const nameStyle = 'color:' + profileScene.relationGraphNameColor + ';';
    graph.center = Object.assign({}, graph.center, { nameStyle });
    const graphNodes = (graph.nodes || []).map((node) => {
      const rel = relationships.find((r) => r.id === node.id);
      const next = rel ? Object.assign({}, node, { title: rel.title }) : node;
      return Object.assign({}, next, { nameStyle, titleStyle: nameStyle });
    });
    graph.nodes = graphNodes;
    const personalities = (m.result && m.result.personalities) || [];
    const quirks = (m.result && m.result.quirks) || [];
    const lineStyle = profileScene.worldTimelineLineStyle;
    let worldBg = profileScene.worldTimelineBg || '';
    let relBg = profileScene.relationGraphBg || '';
    worldBg = (await ocImage.resolveLocalImagePath(worldBg)) || '';
    relBg = (await ocImage.resolveLocalImagePath(relBg)) || '';
    if (
      worldBg !== (profileScene.worldTimelineBg || '') ||
      relBg !== (profileScene.relationGraphBg || '')
    ) {
      profileScene = Object.assign({}, profileScene, {
        worldTimelineBg: worldBg,
        relationGraphBg: relBg
      });
    }
    const worldBgKey =
      worldBg && worldBg === this.data.worldTimelineBgDisplay
        ? this.data.worldTimelineBgKey || 0
        : (this.data.worldTimelineBgKey || 0) + (worldBg !== this.data.worldTimelineBgDisplay ? 1 : 0);
    const relBgKey =
      relBg && relBg === this.data.relationGraphBgDisplay
        ? this.data.relationGraphBgKey || 0
        : (this.data.relationGraphBgKey || 0) + (relBg !== this.data.relationGraphBgDisplay ? 1 : 0);
    const albumLayout = ocAlbum.buildAlbumLayout(m.ocAlbums || []);
    this.setData({
      result: m.result,
      background: m.background || { worldview: '', origins: [], lifeEvents: [] },
      catchphrases: m.catchphrases || [],
      attitudes: m.attitudes || [],
      generatedBio: m.generatedBio || '',
      ocStories: Array.isArray(fav.ocStories) ? fav.ocStories : [],
      ocStoriesDisplay: buildStoryDisplayList(Array.isArray(fav.ocStories) ? fav.ocStories : []),
      ocImages: m.ocImages || [],
      ocImagePath,
      ocAlbums: m.ocAlbums || [],
      ocAlbumCards: albumLayout.cards,
      featuredAlbum: albumLayout.featured,
      gridAlbums: albumLayout.grid,
      ocImageIndex: Math.min(
        this.data.ocImageIndex || 0,
        Math.max(0, (m.ocImages || []).length - 1)
      ),
      personalityText: joinSlash3(personalities) || personalityBlend(m.result),
      quirkText: joinSlash3(quirks),
      likeText: (m.result && m.result.likes) || '—',
      relationships,
      relationEdges,
      timelineEvents: timelineBundle.timelineEvents,
      worldTimelineEvents: timelineBundle.worldTimelineEvents,
      eventsTimelineEvents: timelineBundle.eventsTimelineEvents,
      worldTimelineView: buildWorldTimelineView(timelineBundle.worldTimelineEvents, profileScene),
      profileScene,
      worldTimelineBgDisplay: worldBg,
      worldTimelineBgKey: worldBgKey,
      worldTimelineBgSrc: sceneBgSrc(worldBg, worldBgKey),
      relationGraphBgDisplay: relBg,
      relationGraphBgKey: relBgKey,
      relationGraphBgSrc: relationBgSrc(relBg, relBgKey),
      timelineLineStyleIndex: timelineLineStyleIndex(lineStyle),
      relationGraph: graph,
      graphLines: buildAllGraphLines(graph.center, graph.nodes, relationEdges, profileScene),
      relationGraphNameStyle: nameStyle,
      relationAddStyle: buildRelationAddNodeStyle(
        graph.nodes.length,
        this._getRelationAspectWH(),
        this._getRelationAddPos(profileScene)
      ),
      relationNodeDense: (graph.nodes || []).length >= 4,
      relationTextList: buildRelationTextList(ocName, relationships, relationEdges),
      relationEditorVisible: false,
      relationEditIndex: -1,
      relationTypePickerIndex: 0
    }, () => {
      if (this.data.activeTab === 'timeline') this._rebuildTimelineSpine();
      // 首次迁移 / 超额拆册：写回收藏
      if (
        !Array.isArray(fav.ocAlbums) ||
        !fav.ocAlbums.length ||
        albumCountAfter > albumCountBefore
      ) {
        this._saveProfile(
          {
            ocAlbums: m.ocAlbums,
            ocImages: m.ocImages,
            ocImagePath: m.ocImagePath
          },
          false,
          { reload: false }
        );
      }
    });
  },

  _relationTypeIndex(type) {
    const t = String(type || '').trim();
    const idx = RELATION_TYPES.indexOf(t);
    if (idx > 0) return idx;
    return 0;
  },

  _syncRelationFormUi(list, editIndex) {
    const rel = editIndex >= 0 && list && list[editIndex] ? list[editIndex] : null;
    const pickerIndex = rel ? this._relationTypeIndex(rel.relationType) : 0;
    return {
      relationTypePickerIndex: pickerIndex,
      relationPickerLabel: relationPickerButtonLabel(rel && rel.relationType),
      relationCustomDraft: relationCustomDraftFromType(rel && rel.relationType)
    };
  },

  _openRelationEdit(id) {
    const list = this.data.relationships || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const rel = list[idx];
    this.setData({
      relationEditorVisible: true,
      relationEditIndex: idx,
      ...this._syncRelationFormUi(list, idx)
    });
  },

  _applyTab(key, label, sub) {
    const idx = PROFILE_TABS.findIndex((t) => t.key === key);
    const apply = () => {
      if (key === 'relation') {
        this._refreshRelationGraph(this.data.relationships, this.data.relationEdges);
      }
      if (key === 'timeline') this._scheduleTimelineSpinePaint();
    };
    if (idx >= 0) {
      const tab = PROFILE_TABS[idx];
      this.setData(
        {
          activeTab: tab.key,
          activeTabIndex: idx,
          activeTabLabel: tab.label,
          activeTabSub: tab.sub
        },
        apply
      );
      return;
    }
    this.setData(
      {
        activeTab: key,
        activeTabIndex: -1,
        activeTabLabel: label || key,
        activeTabSub: sub || ''
      },
      apply
    );
  },

  onTabChange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeTab) return;
    this._applyTab(key);
    this.setData({ tabSmartText: '', relationEditorVisible: false, relationEditIndex: -1 });
  },

  onToggleTabRail() {
    this._timelineInnerWidthPx = null;
    this.setData({ tabRailCollapsed: !this.data.tabRailCollapsed }, () => {
      this._updateLayout();
      if (this.data.activeTab === 'timeline') this._scheduleTimelineSpinePaint();
    });
  },

  onOpenBioStory() {
    if (this.data.activeTab === 'bioStory') return;
    this._applyTab('bioStory', '小传故事', 'NARRATIVE');
    this.setData({ tabSmartText: '', relationEditorVisible: false, relationEditIndex: -1 });
  },

  onOpenArt() {
    if (this.data.activeTab === 'art') return;
    this._applyTab('art', '立绘', 'ART');
    this.setData({ tabSmartText: '', relationEditorVisible: false, relationEditIndex: -1 });
  },

  onOpenTimeline() {
    if (this.data.activeTab === 'timeline') return;
    this._applyTab('timeline', '时间轴', 'TIMELINE');
    this.setData({ tabSmartText: '', relationEditorVisible: false, relationEditIndex: -1 });
    if (!(this.data.worldTimelineEvents || []).length) {
      const list = ensureDefaultWorldTimeline(this.data.timelineEvents || []);
      this._setTimelineEvents(list);
    } else {
      this._rebuildTimelineSpine();
    }
  },

  preventMove() {},

  _timelineAxisCenterRpx(innerWidthPx) {
    const ww = wx.getSystemInfoSync().windowWidth || 375;
    const widthPx = innerWidthPx || ww * 0.86;
    return (widthPx / ww) * 750 / 2;
  },

  _refreshWorldTimelineView(profileScene) {
    const scene = profileScene || this.data.profileScene || normalizeProfileScene(null);
    return buildWorldTimelineView(this.data.worldTimelineEvents, scene);
  },

  _rebuildTimelineSpine() {
    if (this.data.activeTab !== 'timeline') return;
    const profileScene = this.data.profileScene || normalizeProfileScene(null);
    const lineStyle = profileScene.worldTimelineLineStyle || 'curve';
    const events = this.data.worldTimelineView || [];
    const apply = (axisCenterRpx) => {
      const spine = buildTimelineSpineData(
        events,
        lineStyle,
        profileScene,
        axisCenterRpx,
        this.data.timelineCurveEditMode
      );
      this.setData({
        timelineSpineLinks: spine.links,
        timelineCurveHandles: spine.handles
      });
    };
    if (this._timelineInnerWidthPx) {
      apply(this._timelineAxisCenterRpx(this._timelineInnerWidthPx));
      return;
    }
    const query = wx.createSelectorQuery().in(this);
    query.select('.vintage-timeline-inner').boundingClientRect();
    query.exec((res) => {
      const inner = res && res[0];
      if (inner && inner.width) this._timelineInnerWidthPx = inner.width;
      apply(this._timelineAxisCenterRpx(inner && inner.width));
    });
  },

  _scheduleTimelineSpinePaint() {
    if (this._spinePaintTimer) clearTimeout(this._spinePaintTimer);
    this._spinePaintTimer = setTimeout(() => this._rebuildTimelineSpine(), 120);
  },

  onOpenTimelineStyleSettings() {
    wx.showActionSheet({
      itemList: ['背景', '连线走向', '线条样式', '文字颜色', '线条颜色', '节点颜色'],
      success: (res) => {
        const pick = res.tapIndex;
        if (pick === 0) {
          this._openTimelineBgSheet();
          return;
        }
        if (pick === 1) {
          this._openTimelineLineStyleSheet();
          return;
        }
        if (pick === 2) {
          this._openSceneLineStyleSheet('timeline');
          return;
        }
        if (pick === 3) {
          this._openSceneColorPicker('worldTimelineCardTextColor', '文字颜色');
          return;
        }
        if (pick === 4) {
          this._openSceneColorPicker('worldTimelineLineColor', '线条颜色');
          return;
        }
        if (pick === 5) {
          this._openSceneColorPicker('worldTimelineNodeColor', '节点颜色');
        }
      }
    });
  },

  _openTimelineBgSheet() {
    const hasBg = !!(
      this.data.worldTimelineBgDisplay ||
      (this.data.profileScene && this.data.profileScene.worldTimelineBg)
    );
    const items = ['更换背景'];
    if (hasBg) items.push('清除背景');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const pick = items[res.tapIndex];
        if (pick === '更换背景') this.onChooseWorldTimelineBg();
        if (pick === '清除背景') this.onClearWorldTimelineBg();
      }
    });
  },

  onOpenRelationStyleSettings() {
    wx.showActionSheet({
      itemList: ['背景', '线条样式', '线条颜色', '名字颜色', '关系颜色', '备注颜色'],
      success: (res) => {
        const pick = res.tapIndex;
        if (pick === 0) {
          this._openRelationBgSheet();
          return;
        }
        if (pick === 1) {
          this._openSceneLineStyleSheet('relation');
          return;
        }
        if (pick === 2) {
          this._openSceneColorPicker('relationGraphLineColor', '线条颜色');
          return;
        }
        if (pick === 3) {
          this._openSceneColorPicker('relationGraphNameColor', '名字颜色');
          return;
        }
        if (pick === 4) {
          this._openSceneColorPicker('relationGraphRelationColor', '关系颜色');
          return;
        }
        if (pick === 5) {
          this._openSceneColorPicker('relationGraphNoteColor', '备注颜色');
        }
      }
    });
  },

  _openRelationBgSheet() {
    const hasBg = !!(
      this.data.relationGraphBgDisplay ||
      (this.data.profileScene && this.data.profileScene.relationGraphBg)
    );
    const items = ['更换背景'];
    if (hasBg) items.push('清除背景');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const pick = items[res.tapIndex];
        if (pick === '更换背景') this.onChooseRelationGraphBg();
        if (pick === '清除背景') this.onClearRelationGraphBg();
      }
    });
  },

  _openSceneLineStyleSheet(scope) {
    wx.showActionSheet({
      itemList: SCENE_LINE_STYLE_LABELS,
      success: (res) => {
        const style = SCENE_LINE_STYLES[res.tapIndex];
        if (!style) return;
        const field =
          scope === 'relation' ? 'relationGraphLineStyle' : 'worldTimelineSpineLineStyle';
        const profileScene = Object.assign({}, this.data.profileScene, { [field]: style });
        this._applyProfileSceneStyle(profileScene);
      }
    });
  },

  _openTimelineLineStyleSheet() {
    const editing = !!this.data.timelineCurveEditMode;
    wx.showActionSheet({
      itemList: ['直线', '曲线', editing ? '结束拖拽调整' : '拖拽调整曲线', '清除拖动重置'],
      success: (res) => {
        if (res.tapIndex === 0) {
          if (editing) this.setData({ timelineCurveEditMode: false });
          this.onWorldLineStylePick({ detail: { value: 0 } });
          return;
        }
        if (res.tapIndex === 1) {
          this.onWorldLineStylePick({ detail: { value: 1 } });
          return;
        }
        if (res.tapIndex === 2) {
          this._toggleTimelineCurveEdit();
          return;
        }
        if (res.tapIndex === 3) {
          this._resetTimelineDrag();
        }
      }
    });
  },

  _resetTimelineDrag() {
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineSegmentBends: [],
      worldTimelineNodeOffsets: {}
    });
    this.setData(
      {
        profileScene,
        worldTimelineView: this._refreshWorldTimelineView(profileScene)
      },
      () => {
        this._rebuildTimelineSpine();
        this._saveProfile({ profileScene }, false, { reload: false });
        wx.showToast({ title: '曲线与节点位置已重置', icon: 'none' });
      }
    );
  },

  _toggleTimelineCurveEdit() {
    const next = !this.data.timelineCurveEditMode;
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineLineStyle: 'curve'
    });
    this.setData(
      {
        timelineCurveEditMode: next,
        profileScene,
        timelineLineStyleIndex: 1,
        worldTimelineView: this._refreshWorldTimelineView(profileScene)
      },
      () => {
        this._rebuildTimelineSpine();
        if (next) {
          wx.showToast({ title: '可拖动圆点与星形节点', icon: 'none' });
        } else {
          this._saveProfile({ profileScene }, false, { reload: false });
        }
      }
    );
  },

  onCurveHandleTouchStart(e) {
    if (!this.data.timelineCurveEditMode) return;
    const segIndex = Number(e.currentTarget.dataset.segIndex);
    if (Number.isNaN(segIndex)) return;
    const profileScene = this.data.profileScene || normalizeProfileScene(null);
    const bends = (profileScene.worldTimelineSegmentBends || []).slice();
    while (bends.length <= segIndex) bends.push(0);
    this._curveDrag = {
      segIndex,
      startX: e.touches[0].clientX,
      startBend: bends[segIndex] || 0,
      bends
    };
  },

  onCurveHandleTouchMove(e) {
    if (!this._curveDrag) return;
    const dxRpx = pxToRpx(e.touches[0].clientX - this._curveDrag.startX);
    const segIndex = this._curveDrag.segIndex;
    const bends = this._curveDrag.bends.slice();
    bends[segIndex] = Math.max(
      -120,
      Math.min(120, Math.round(this._curveDrag.startBend + dxRpx))
    );
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineSegmentBends: bends
    });
    this.setData({ profileScene }, () => this._rebuildTimelineSpine());
  },

  onCurveHandleTouchEnd() {
    if (!this._curveDrag) return;
    this._curveDrag = null;
    this._saveProfile({ profileScene: this.data.profileScene }, false, { reload: false });
  },

  onTimelineNodeTouchStart(e) {
    if (!this.data.timelineCurveEditMode) return;
    const nodeId = e.currentTarget.dataset.id;
    if (!nodeId) return;
    const profileScene = this.data.profileScene || normalizeProfileScene(null);
    const offsets = Object.assign({}, profileScene.worldTimelineNodeOffsets || {});
    this._nodeDragDidMove = false;
    this._nodeDrag = {
      nodeId,
      startX: e.touches[0].clientX,
      startOffset: Number(offsets[nodeId]) || 0,
      offsets
    };
  },

  onTimelineNodeTouchMove(e) {
    if (!this._nodeDrag) return;
    const dxPx = e.touches[0].clientX - this._nodeDrag.startX;
    if (Math.abs(dxPx) > 4) this._nodeDragDidMove = true;
    const dxRpx = pxToRpx(dxPx);
    const offsets = Object.assign({}, this._nodeDrag.offsets);
    offsets[this._nodeDrag.nodeId] = Math.max(
      -120,
      Math.min(120, Math.round(this._nodeDrag.startOffset + dxRpx))
    );
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineNodeOffsets: offsets
    });
    this.setData(
      {
        profileScene,
        worldTimelineView: buildWorldTimelineView(this.data.worldTimelineEvents, profileScene)
      },
      () => this._rebuildTimelineSpine()
    );
  },

  onTimelineNodeTouchEnd() {
    if (!this._nodeDrag) return;
    this._nodeDrag = null;
    this._saveProfile({ profileScene: this.data.profileScene }, false, { reload: false });
  },

  _openSceneColorPicker(field, title) {
    const scene = normalizeProfileScene(this.data.profileScene);
    const cur = scene[field] || '#5b4b8a';
    const hsv = hexToHsv(cur);
    this.setData({
      colorPickerVisible: true,
      colorPickerTarget: field,
      colorPickerTitle: title || '选择颜色',
      colorPickerHue: Math.round(hsv.h),
      colorPickerSat: hsv.s,
      colorPickerVal: hsv.v,
      colorPickerPreview: cur
    });
  },

  onCloseColorPicker() {
    this.setData({ colorPickerVisible: false, colorPickerTarget: '' });
  },

  _syncColorPickerPreview(patch) {
    const hue = patch.colorPickerHue != null ? patch.colorPickerHue : this.data.colorPickerHue;
    const sat = patch.colorPickerSat != null ? patch.colorPickerSat : this.data.colorPickerSat;
    const val = patch.colorPickerVal != null ? patch.colorPickerVal : this.data.colorPickerVal;
    patch.colorPickerPreview = hsvToHex(hue, sat, val);
    return patch;
  },

  onColorHueChange(e) {
    const patch = this._syncColorPickerPreview({ colorPickerHue: Number(e.detail.value) || 0 });
    this.setData(patch);
  },

  onColorHueChanging(e) {
    const patch = this._syncColorPickerPreview({ colorPickerHue: Number(e.detail.value) || 0 });
    this.setData(patch);
  },

  onColorSvTouch(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.color-picker-sv').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width) return;
      const sat = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      const val = Math.max(0, Math.min(1, 1 - (touch.clientY - rect.top) / rect.height));
      const patch = this._syncColorPickerPreview({ colorPickerSat: sat, colorPickerVal: val });
      this.setData(patch);
    });
  },

  onColorHexInput(e) {
    const val = String(e.detail.value || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
    const hsv = hexToHsv(val);
    this.setData({
      colorPickerHue: Math.round(hsv.h),
      colorPickerSat: hsv.s,
      colorPickerVal: hsv.v,
      colorPickerPreview: val.toLowerCase()
    });
  },

  onPickPresetColor(e) {
    const color = e.currentTarget.dataset.color;
    if (!color) return;
    const hsv = hexToHsv(color);
    this.setData({
      colorPickerHue: Math.round(hsv.h),
      colorPickerSat: hsv.s,
      colorPickerVal: hsv.v,
      colorPickerPreview: color
    });
  },

  onConfirmColorPicker() {
    const target = this.data.colorPickerTarget;
    const color = this.data.colorPickerPreview;
    if (target) {
      const profileScene = Object.assign({}, this.data.profileScene, { [target]: color });
      this._applyProfileSceneStyle(profileScene);
    } else {
      this.onTimelineCardTextColorPick(color);
    }
    this.setData({ colorPickerVisible: false, colorPickerTarget: '' });
  },

  onExportTimeline() {
    if (this._exportingTimeline) return;
    this._exportingTimeline = true;
    wx.showLoading({ title: '生成中…', mask: true });
    const scene = normalizeProfileScene(this.data.profileScene);
    const nodes = this.data.worldTimelineView || [];
    const finishExport = (ok, err) => {
      this._exportingTimeline = false;
      try {
        wx.hideLoading();
      } catch (_) {}
      if (ok) {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      } else {
        console.error('export timeline fail', err);
        const msg =
          (err && (err.errMsg || err.message)) ||
          (typeof err === 'string' ? err : '');
        wx.showToast({
          title: /auth|authorize|denied|权限/i.test(msg) ? '请允许相册权限' : '保存失败，请重试',
          icon: 'none'
        });
      }
    };
    const runExport = (axisCenterRpx, layoutWidthRpx) => {
      let contentH = TIMELINE_INNER_PAD_TOP_RPX;
      nodes.forEach((n) => {
        contentH += Number(n.rowHeightRpx) || TIMELINE_ROW_STEP_RPX;
      });
      contentH += 32;
      // 限制导出逻辑高度，避免超长时间轴撑爆内存
      contentH = Math.min(contentH, 2800);
      const width = Math.max(600, Math.min(750, Math.round(layoutWidthRpx || 750)));
      const height = Math.max(600, Math.round(contentH));
      const axis = axisCenterRpx != null ? axisCenterRpx : width / 2;
      const lineStyle = scene.worldTimelineLineStyle || 'curve';
      let spine;
      try {
        spine = buildTimelineSpineData(nodes, lineStyle, scene, axis, false);
      } catch (e) {
        finishExport(false, e);
        return;
      }
      exportCanvasToAlbum(
        this,
        '#sceneExportCanvas',
        drawTimeline,
        {
          links: spine.links || [],
          nodes: nodes,
          axisCenterRpx: axis,
          padTopRpx: TIMELINE_INNER_PAD_TOP_RPX,
          lineColor: scene.worldTimelineLineColor,
          nodeColor: scene.worldTimelineNodeColor,
          textColor: scene.worldTimelineCardTextColor,
          bgSrc:
            this.data.worldTimelineBgSrc ||
            this.data.worldTimelineBgDisplay ||
            scene.worldTimelineBg ||
            ''
        },
        width,
        height
      )
        .then(() => finishExport(true))
        .catch((err) => finishExport(false, err));
    };

    const applyWithInner = (innerWidthPx) => {
      try {
        const ww = wx.getSystemInfoSync().windowWidth || 375;
        const widthRpx = innerWidthPx ? (innerWidthPx / ww) * 750 : 750;
        runExport(this._timelineAxisCenterRpx(innerWidthPx), widthRpx);
      } catch (e) {
        finishExport(false, e);
      }
    };

    setTimeout(() => {
      if (this._timelineInnerWidthPx) {
        applyWithInner(this._timelineInnerWidthPx);
        return;
      }
      const query = wx.createSelectorQuery().in(this);
      query.select('.vintage-timeline-inner').boundingClientRect();
      query.exec((res) => {
        const inner = res && res[0];
        if (inner && inner.width) this._timelineInnerWidthPx = inner.width;
        applyWithInner(inner && inner.width);
      });
    }, 40);
  },

  onExportRelation() {
    wx.showLoading({ title: '生成中…', mask: true });
    const scene = normalizeProfileScene(this.data.profileScene);
    exportCanvasToAlbum(
      this,
      '#sceneExportCanvas',
      drawRelationGraph,
      {
        graph: this.data.relationGraph,
        lines: this.data.graphLines,
        lineColor: scene.relationGraphLineColor,
        nameColor: scene.relationGraphNameColor,
        relationColor: scene.relationGraphRelationColor
      },
      750,
      900
    )
      .then(() => wx.showToast({ title: '已保存到相册', icon: 'success' }))
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  },

  _applyProfileSceneStyle(profileScene, extraPatch) {
    const scene = normalizeProfileScene(profileScene);
    const patch = Object.assign(
      {
        profileScene: scene,
        worldTimelineView: buildWorldTimelineView(this.data.worldTimelineEvents, scene),
        relationGraphNameStyle: 'color:' + scene.relationGraphNameColor + ';'
      },
      extraPatch || {}
    );
    this.setData(patch, () => {
      this._rebuildTimelineSpine();
      this._refreshRelationGraph(this.data.relationships, this.data.relationEdges);
    });
    this._saveProfile({ profileScene: scene }, false, { reload: false });
  },

  onTimelineCardTextColorPick(color) {
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineCardTextColor: color
    });
    this._applyProfileSceneStyle(profileScene);
  },

  onToggleBioExpanded() {
    this.setData({ bioExpanded: !this.data.bioExpanded });
  },

  onStartEditBasic() {
    this.setData({
      basicEditing: true,
      basicDraft: buildBasicDraft(
        this.data.result,
        this.data.personalityText,
        this.data.quirkText,
        this.data.likeText
      )
    });
  },

  onCancelEditBasic() {
    this.setData({ basicEditing: false });
  },

  onBasicDraftInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const basicDraft = Object.assign({}, this.data.basicDraft, {
      [key]: e.detail.value || ''
    });
    this.setData({ basicDraft });
  },

  onSaveBasicInfo() {
    if (this.data.saving) return;
    const draft = this.data.basicDraft || {};
    const name = String(draft.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    const personalities = splitSlash3(draft.personalityText);
    const quirks = splitSlash3(draft.quirkText);
    const result = normalizeResult(
      Object.assign({}, this.data.result, {
        name: name,
        race: String(draft.race || '').trim(),
        gender: String(draft.gender || '').trim(),
        age: String(draft.age || '').trim(),
        hairColor: String(draft.hairColor || '').trim(),
        eyeColor: String(draft.eyeColor || '').trim(),
        personalities: personalities,
        quirks: quirks,
        likes: String(draft.likeText || '').trim()
      })
    );
    const personalityText = joinSlash3(personalities) || personalityBlend(result);
    const quirkText = joinSlash3(quirks);
    const likeText = result.likes || '—';
    const ok = this._saveProfile({ result: result }, false, { reload: false });
    if (!ok) return;
    this.setData({
      result: result,
      personalityText: personalityText,
      quirkText: quirkText,
      likeText: likeText,
      basicEditing: false
    });
    this._refreshRelationGraph(this.data.relationships, this.data.relationEdges);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onProfileScroll() {},

  onToggleStoryExpanded() {
    const next = !this.data.storyExpanded;
    this.setData({
      storyExpanded: next,
      storyFullExpanded: next ? this.data.storyFullExpanded : {}
    });
  },

  onToggleStoryItemFull(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const storyFullExpanded = Object.assign({}, this.data.storyFullExpanded);
    storyFullExpanded[id] = !storyFullExpanded[id];
    this.setData({ storyFullExpanded });
  },

  onAutoTextInput(e) {
    this.setData({ autoText: e.detail.value || '' });
  },

  onParseSetting() {
    if (this.data.parsing) {
      wx.showToast({ title: '正在填写中…', icon: 'none' });
      return;
    }
    const text = (this.data.autoText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入设定文本', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用云开发基础库', icon: 'none' });
      return;
    }
    this.setData({ parsing: true });
    wx.showLoading({ title: '智能填写中…', mask: true });
    wx.cloud
      .callFunction({
        name: 'parseOcSetting',
        data: { text },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (!r.ok || !r.setting) {
          wx.showToast({ title: r.errMsg || '识别失败', icon: 'none', duration: 3000 });
          return;
        }
        const patch = applyParsedSetting(this.data, r.setting);
        if (!patch) {
          wx.showToast({ title: '识别结果无效', icon: 'none' });
          return;
        }
        const personalities = (patch.result && patch.result.personalities) || [];
        const quirks = (patch.result && patch.result.quirks) || [];
        this.setData({
          result: patch.result,
          background: patch.background,
          catchphrases: patch.catchphrases,
          attitudes: patch.attitudes,
          personalityText: joinSlash3(personalities) || personalityBlend(patch.result),
          quirkText: joinSlash3(quirks),
          likeText: (patch.result && patch.result.likes) || '—'
        });
        this._saveProfile(
          {
            result: patch.result,
            background: patch.background,
            catchphrases: patch.catchphrases,
            attitudes: patch.attitudes
          },
          false
        );
        wx.showToast({ title: '已智能填写', icon: 'success' });
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || '调用失败';
        wx.showToast({
          title: /timeout|超时/i.test(msg) ? '请求超时，请重试' : msg,
          icon: 'none',
          duration: 3000
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ parsing: false });
      });
  },

  onOcImageSwiperChange(e) {
    const idx = (e.detail && e.detail.current) || 0;
    this.setData({ ocImageIndex: idx });
  },

  onExpandOcImage(e) {
    const list = this.data.ocImages || [];
    if (!list.length) return;
    let index = this.data.ocImageIndex || 0;
    if (e && e.currentTarget && e.currentTarget.dataset.index != null) {
      index = Number(e.currentTarget.dataset.index);
      if (Number.isNaN(index)) index = this.data.ocImageIndex || 0;
    }
    this.setData({ ocImageExpanded: true, ocImageIndex: index });
  },

  onCloseOcImageExpand() {
    this.setData({ ocImageExpanded: false });
  },

  _syncAlbumCards(albums) {
    const seed = {
      ocAlbums: albums,
      ocImages: this.data.ocImages || [],
      ocImagePath: this.data.ocImagePath || ''
    };
    ocAlbum.syncWorkImagesFromAlbums(seed);
    const layout = ocAlbum.buildAlbumLayout(seed.ocAlbums);
    return {
      ocAlbums: seed.ocAlbums,
      ocAlbumCards: layout.cards,
      featuredAlbum: layout.featured,
      gridAlbums: layout.grid,
      ocImages: seed.ocImages,
      ocImagePath: seed.ocImagePath
    };
  },

  onOpenAlbumDetail(e) {
    const albumId = e.currentTarget.dataset.id;
    const favoriteId = this.data.favoriteId;
    if (!albumId || !favoriteId) return;
    wx.navigateTo({
      url:
        '/pages/ocAlbumDetail/ocAlbumDetail?id=' +
        encodeURIComponent(favoriteId) +
        '&albumId=' +
        encodeURIComponent(albumId)
    });
  },

  onCreateAlbum() {
    wx.showModal({
      title: '新建图册',
      editable: true,
      placeholderText: '请输入图册名称',
      success: (res) => {
        if (!res.confirm) return;
        const name = String(res.content || '').trim() || '未命名图册';
        const albums = ocAlbum.addAlbum(this.data.ocAlbums || [], name);
        const patch = this._syncAlbumCards(albums);
        this.setData(patch);
        this._saveProfile(patch, false, { reload: false });
        wx.showToast({ title: '已创建', icon: 'success' });
      }
    });
  },

  onDeleteAlbum(e) {
    const albumId = e.currentTarget.dataset.id;
    if (!albumId) return;
    const album = ocAlbum.findAlbum(this.data.ocAlbums, albumId);
    if (!album) return;
    if (album.preset) {
      wx.showToast({ title: '预设图册不可删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除图册',
      content: '确定删除「' + (album.name || '未命名') + '」？图册内图片也会移除。',
      confirmColor: '#c45c5c',
      success: (res) => {
        if (!res.confirm) return;
        const albums = ocAlbum.removeAlbum(this.data.ocAlbums || [], albumId);
        const patch = this._syncAlbumCards(albums);
        this.setData(patch);
        this._saveProfile(patch, false, { reload: false });
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  onPreviewAlbumCardImage(e) {
    // 原生 previewImage 会触发 App 进后台，返回时被 reLaunch 首页，表现为闪退；改为进图册详情
    const albumId = e.currentTarget.dataset.albumId;
    if (!albumId) return;
    this.onOpenAlbumDetail({ currentTarget: { dataset: { id: albumId } } });
  },

  /** 立绘页顶栏上传：进入「立绘」图册 */
  onChooseOcImage() {
    const artId = ocAlbum.PRESET_ART_ID || 'preset_art';
    this.onOpenAlbumDetail({ currentTarget: { dataset: { id: artId } } });
  },

  _formatWxErr(err, fallback) {
    if (!err) return fallback || '未知错误';
    if (typeof err === 'string') return err;
    return String(err.message || err.errMsg || fallback || '未知错误');
  },

  async _applySceneBgPath(field, path) {
    const savedPath = await ocImage.resolveLocalImagePath(path);
    if (!savedPath) {
      throw new Error('背景图片未写入成功，请重试');
    }

    const profileScene = Object.assign({}, this.data.profileScene, { [field]: savedPath });
    const isTimeline = field === 'worldTimelineBg';
    const displayFlag = isTimeline ? 'worldTimelineBgDisplay' : 'relationGraphBgDisplay';
    const srcField = isTimeline ? 'worldTimelineBgSrc' : 'relationGraphBgSrc';
    const keyField = isTimeline ? 'worldTimelineBgKey' : 'relationGraphBgKey';
    const nextKey = (this.data[keyField] || 0) + 1;
    const src = isTimeline ? sceneBgSrc(savedPath, nextKey) : relationBgSrc(savedPath, nextKey);

    await new Promise((resolve) => {
      this.setData(
        {
          [displayFlag]: '',
          [srcField]: ''
        },
        () => {
          setTimeout(() => {
            this.setData(
              {
                profileScene,
                [displayFlag]: savedPath,
                [srcField]: src,
                [keyField]: nextKey
              },
              () => {
                if (isTimeline) this._scheduleTimelineSpinePaint();
                resolve();
              }
            );
          }, 32);
        }
      );
    });

    const ok = this._saveProfile({ profileScene }, false, { reload: false });
    if (!ok) {
      throw new Error('背景保存失败');
    }
  },

  _chooseSceneBg(field) {
    this._skipProfileReloadOnce = true;
    this._pickingSceneBg = true;
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) {
          this._pickingSceneBg = false;
          this._skipProfileReloadOnce = false;
          return;
        }
        const pickPath =
          ocImage.stabilizeTempImagePathSync(file.tempFilePath) || file.tempFilePath;
        const oldPath = (this.data.profileScene && this.data.profileScene[field]) || '';
        wx.showLoading({ title: '处理中…', mask: true });
        ocImage
          .saveProfileSceneBgFromTemp(this.data.favoriteId, field, pickPath, oldPath)
          .then((path) => this._applySceneBgPath(field, path))
          .then(() => {
            wx.showToast({ title: '背景已更换', icon: 'success' });
          })
          .catch((e) => {
            wx.showToast({
              title: this._formatWxErr(e, '背景设置失败'),
              icon: 'none',
              duration: 2800
            });
          })
          .finally(() => {
            wx.hideLoading();
            this._pickingSceneBg = false;
            this._skipProfileReloadOnce = false;
          });
      },
      fail: (err) => {
        this._skipProfileReloadOnce = false;
        this._pickingSceneBg = false;
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        wx.showToast({ title: this._formatWxErr(err, '选图失败'), icon: 'none' });
      }
    });
  },

  onChooseWorldTimelineBg() {
    this._chooseSceneBg('worldTimelineBg');
  },

  onChooseRelationGraphBg() {
    this._chooseSceneBg('relationGraphBg');
  },

  onClearWorldTimelineBg() {
    const profileScene = Object.assign({}, this.data.profileScene, { worldTimelineBg: '' });
    const bgKey = (this.data.worldTimelineBgKey || 0) + 1;
    this.setData({
      profileScene,
      worldTimelineBgDisplay: '',
      worldTimelineBgSrc: '',
      worldTimelineBgKey: bgKey
    }, () => this._scheduleTimelineSpinePaint());
    this._saveProfile({ profileScene }, false, { reload: false });
  },

  onClearRelationGraphBg() {
    const profileScene = Object.assign({}, this.data.profileScene, { relationGraphBg: '' });
    const nextKey = (this.data.relationGraphBgKey || 0) + 1;
    this.setData({
      profileScene,
      relationGraphBgDisplay: '',
      relationGraphBgSrc: '',
      relationGraphBgKey: nextKey
    });
    this._saveProfile({ profileScene }, false, { reload: false });
  },

  onWorldLineStylePick(e) {
    const idx = Number(e.detail.value) || 0;
    const styles = ['straight', 'curve'];
    const lineStyle = styles[idx] || 'curve';
    const profileScene = Object.assign({}, this.data.profileScene, {
      worldTimelineLineStyle: lineStyle
    });
    const patch = {
      profileScene,
      timelineLineStyleIndex: idx,
      worldTimelineView: buildWorldTimelineView(this.data.worldTimelineEvents, profileScene)
    };
    if (lineStyle === 'straight' && this.data.timelineCurveEditMode) {
      patch.timelineCurveEditMode = false;
    }
    this.setData(patch, () => this._rebuildTimelineSpine());
    this._saveProfile({ profileScene }, false, { reload: false });
  },

  onToggleTimelineCard(e) {
    if (this._nodeDragDidMove) {
      this._nodeDragDidMove = false;
      return;
    }
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const expanded = Object.assign({}, this.data.expandedTimelineCards);
    expanded[id] = !expanded[id];
    this._setExpandedTimelineCards(expanded);
  },

  onExpandTimelineFromSummary(e) {
    if (this._nodeDragDidMove) {
      this._nodeDragDidMove = false;
      return;
    }
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const expanded = Object.assign({}, this.data.expandedTimelineCards);
    expanded[id] = true;
    this._setExpandedTimelineCards(expanded);
  },

  _setExpandedTimelineCards(expanded) {
    this.setData({ expandedTimelineCards: expanded });
  },

  _buildWorkForSave(extra) {
    const snap = workSnapshot({
      favoriteId: this.data.favoriteId,
      result: this.data.result,
      background: this.data.background,
      catchphrases: this.data.catchphrases,
      attitudes: this.data.attitudes,
      generatedBio: this.data.generatedBio,
      ocImages: this.data.ocImages,
      ocImagePath: this.data.ocImagePath,
      ocAlbums: this.data.ocAlbums,
      relationships: this.data.relationships,
      relationEdges: this.data.relationEdges,
      timelineEvents: this.data.timelineEvents,
      profileScene: this.data.profileScene,
      ...(extra || {})
    });
    snap.notebookFavoriteId = this.data.favoriteId;
    snap.layer2Done = true;
    snap.layer3Done = true;
    snap.layer3Confirmed = true;
    return snap;
  },

  _saveProfile(extra, toast, options) {
    // 同步锁 + 排队，避免切换页/连点时误报「保存失败」
    if (this._savingLock) {
      const prev = this._pendingSave || {
        extra: {},
        toast: false,
        options: { reload: false }
      };
      this._pendingSave = {
        extra: Object.assign({}, prev.extra, extra || {}),
        toast: toast === false ? false : prev.toast,
        options: Object.assign({ reload: false }, prev.options || {}, options || {})
      };
      return false;
    }
    this._savingLock = true;
    this.setData({ saving: true });
    let ok = false;
    try {
      const work = this._buildWorkForSave(extra);
      ok = updateFavoriteItem(this.data.favoriteId, work);
      if (ok) {
        try {
          wx.setStorageSync('oc_work_in_progress', work);
        } catch (e) {
          console.error('[ocProfileDetail] work storage fail', e);
        }
        if (toast !== false) wx.showToast({ title: '已保存', icon: 'success' });
        if (!options || options.reload !== false) {
          this.loadProfile();
        }
      } else if (toast !== false) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } catch (err) {
      console.error('[ocProfileDetail] _saveProfile', err);
      if (toast !== false) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
      ok = false;
    }
    this._savingLock = false;
    this.setData({ saving: false });
    const pending = this._pendingSave;
    this._pendingSave = null;
    if (pending) {
      setTimeout(() => {
        this._saveProfile(pending.extra, pending.toast, pending.options);
      }, 0);
    }
    return ok;
  },

  onHide() {
    if (this.data.activeTab !== 'relation') return;
    if (this._savingLock) return;
    try {
      this._saveProfile(
        {
          relationships: this.data.relationships,
          relationEdges: this.data.relationEdges,
          profileScene: this.data.profileScene
        },
        false,
        { reload: false }
      );
    } catch (_) {}
  },

  onTabSmartTextInput(e) {
    this.setData({ tabSmartText: e.detail.value || '' });
  },

  _applyWorldExpand(expand) {
    const payload = expand || {};
    const background = Object.assign({}, this.data.background, {
      worldview: payload.worldview || this.data.background.worldview
    });
    const eventsPart = (this.data.timelineEvents || []).filter(
      (item) => item.category === 'events'
    );
    let worldPart = (this.data.timelineEvents || []).filter((item) => item.category === 'world');
    if (!worldPart.length) {
      worldPart = ensureDefaultWorldTimeline([]).filter((item) => item.category === 'world');
    }
    while (worldPart.length < 10) {
      worldPart.push(emptyTimelineEvent(worldPart.length, 'world'));
    }
    (payload.worldTimeline || []).forEach((item, index) => {
      if (index >= worldPart.length) return;
      worldPart[index] = Object.assign({}, worldPart[index], {
        dateLabel: item.dateLabel != null ? String(item.dateLabel) : worldPart[index].dateLabel,
        title: item.title != null ? String(item.title) : worldPart[index].title,
        description:
          item.description != null ? String(item.description) : worldPart[index].description,
        category: 'world',
        sortKey: index
      });
    });
    const timelineEvents = worldPart.concat(eventsPart);
    this._setTimelineEvents(timelineEvents);
    this.setData({ background, expandedTimelineCards: {} });
    return {
      background,
      timelineEvents: timelineEventsForSave(timelineEvents)
    };
  },

  onSmartFillActiveTab() {
    if (this.data.activeTab !== 'world') {
      wx.showToast({ title: '请在世界观页使用智能填写', icon: 'none' });
      return;
    }
    if (this.data.parsing) {
      wx.showToast({ title: '正在填写中…', icon: 'none' });
      return;
    }
    const text = String(this.data.tabSmartText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入关键词或描述', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用云开发环境', icon: 'none' });
      return;
    }
    this.setData({ parsing: true });
    wx.showLoading({ title: '智能填写中…', mask: true });
    wx.cloud
      .callFunction({
        name: 'parseOcSetting',
        data: {
          mode: 'expandWorldview',
          text,
          context: {
            ocName: (this.data.result && this.data.result.name) || '',
            race: (this.data.result && this.data.result.race) || '',
            existingWorldview: (this.data.background && this.data.background.worldview) || ''
          }
        },
        timeout: 60000
      })
      .then((res) => {
        const r = (res && res.result) || {};
        if (!r.ok || !r.expand) {
          wx.showToast({ title: r.errMsg || '智能填写失败', icon: 'none', duration: 3000 });
          return;
        }
        const patch = this._applyWorldExpand(r.expand);
        this._saveProfile(patch, false);
        wx.showToast({ title: '已智能填写', icon: 'success' });
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || '调用失败';
        wx.showToast({
          title: /timeout|超时|fail|cloud/i.test(msg) ? '云函数调用失败，请检查网络与部署' : msg,
          icon: 'none',
          duration: 3000
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ parsing: false });
      });
  },

  onSaveActiveTab() {
    const tab = this.data.activeTab;
    if (tab === 'world') {
      this._saveProfile({ background: this.data.background });
      return;
    }
    if (tab === 'timeline') {
      const exitCurveEdit = this.data.timelineCurveEditMode;
      const saveTimeline = () => {
        this._saveProfile({
          timelineEvents: timelineEventsForSave(this.data.timelineEvents),
          profileScene: this.data.profileScene
        });
      };
      if (exitCurveEdit) {
        this.setData({ timelineCurveEditMode: false }, () => {
          this._rebuildTimelineSpine();
          saveTimeline();
        });
        return;
      }
      saveTimeline();
      return;
    }
    if (tab === 'events') {
      this._saveProfile({
        background: this.data.background
      });
      return;
    }
    if (tab === 'language') {
      this._saveProfile({
        catchphrases: this.data.catchphrases,
        attitudes: this.data.attitudes
      });
      return;
    }
    if (tab === 'relation') {
      this.onSaveRelations();
      return;
    }
    if (tab === 'art') {
      this._saveProfile({
        ocAlbums: this.data.ocAlbums,
        ocImages: this.data.ocImages,
        ocImagePath: this.data.ocImagePath
      });
    }
  },

  onWorldviewInput(e) {
    this.setData({
      background: Object.assign({}, this.data.background, {
        worldview: e.detail.value || ''
      })
    });
  },

  onEventSlotInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const kind = e.currentTarget.dataset.kind;
    const value = e.detail.value || '';
    const background = Object.assign({}, this.data.background);
    if (kind === 'origin') {
      const origins = (background.origins || []).slice();
      origins[index] = value;
      background.origins = origins;
    } else {
      const lifeEvents = (background.lifeEvents || []).slice();
      lifeEvents[index] = value;
      background.lifeEvents = lifeEvents;
    }
    this.setData({ background });
  },

  onCatchphraseInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const catchphrases = (this.data.catchphrases || []).slice();
    catchphrases[index] = e.detail.value || '';
    this.setData({ catchphrases });
  },

  onAttitudeInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const attitudes = (this.data.attitudes || []).map((a) => ({ ...a }));
    if (!attitudes[index]) return;
    attitudes[index][field] = e.detail.value || '';
    this.setData({ attitudes });
  },

  onAddRelationTap() {
    if (this._dragAddMoved) {
      this._dragAddMoved = false;
      return;
    }
    const list = (this.data.relationships || []).slice();
    const last = list[list.length - 1];
    const needNew =
      !list.length || (last && String(last.name || last.title || last.note || '').trim());
    let editIndex = list.length - 1;
    if (needNew) {
      list.push(emptyRelationship());
      editIndex = list.length - 1;
    }
    this.setData({
      relationships: list,
      relationEditorVisible: true,
      relationEditIndex: editIndex,
      ...this._syncRelationFormUi(list, editIndex)
    });
    this._refreshRelationGraph(list);
  },

  onRelationAddTouchStart(e) {
    if (this.data.relationLinkMode) return;
    this._dragAdd = true;
    this._dragAddMoved = false;
    const touch = e.touches && e.touches[0];
    if (touch) {
      this._touchStartX = touch.clientX;
      this._touchStartY = touch.clientY;
    }
    this._graphRect = null;
    wx.createSelectorQuery()
      .in(this)
      .select('.relation-graph')
      .boundingClientRect((rect) => {
        this._graphRect = rect || null;
      })
      .exec();
  },

  onRelationAddTouchMove(e) {
    if (!this._dragAdd || this.data.relationLinkMode) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (this._touchStartX != null) {
      const dx = Math.abs(touch.clientX - this._touchStartX);
      const dy = Math.abs(touch.clientY - this._touchStartY);
      if (dx > 6 || dy > 6) this._dragAddMoved = true;
    }
    const apply = () => {
      const pos = this._positionFromTouch(touch);
      if (!pos) return;
      const aspectWH = this._getRelationAspectWH();
      const nodeCount = ((this.data.relationGraph && this.data.relationGraph.nodes) || []).length;
      this.setData({
        relationAddStyle: buildRelationAddNodeStyle(nodeCount, aspectWH, pos),
        profileScene: Object.assign({}, this.data.profileScene, {
          relationAddPosX: pos.x,
          relationAddPosY: pos.y
        })
      });
    };
    if (!this._graphRect) {
      wx.createSelectorQuery()
        .in(this)
        .select('.relation-graph')
        .boundingClientRect((rect) => {
          this._graphRect = rect || null;
          apply();
        })
        .exec();
      return;
    }
    apply();
  },

  onRelationAddTouchEnd() {
    if (!this._dragAdd) return;
    const moved = this._dragAddMoved;
    this._dragAdd = false;
    this._graphRect = null;
    if (moved) {
      this._saveProfile({ profileScene: this.data.profileScene }, false, { reload: false });
      return;
    }
    this.onAddRelationTap();
  },

  onCloseRelationForm() {
    this.setData({ relationEditorVisible: false, relationEditIndex: -1 });
  },

  onChooseRelationPortrait() {
    const app = getApp();
    if (app && app.globalData) app.globalData.skipNextRelaunch = true;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          const path = ocImage.stabilizeTempImagePathSync(file.tempFilePath) || file.tempFilePath;
          const idx = this.data.relationEditIndex;
          const list = (this.data.relationships || []).slice();
          if (idx < 0 || !list[idx]) return;
          list[idx] = Object.assign({}, list[idx], { avatarUrl: path, targetOcId: '' });
          this.setData({ relationships: list });
          this._refreshRelationGraph(list);
          this._saveProfile({ relationships: list }, false, { reload: false });
        } catch (e) {
          wx.showToast({ title: '头像设置失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
        wx.showToast({ title: '未选择图片', icon: 'none' });
      }
    });
  },

  onPickRelationOc(e) {
    const pickIdx = Number(e.detail.value);
    const oc = (this.data.notebookOcPickerList || [])[pickIdx];
    if (!oc) return;
    const idx = this.data.relationEditIndex;
    const list = (this.data.relationships || []).slice();
    if (idx < 0 || !list[idx]) return;
    list[idx] = Object.assign({}, list[idx], {
      name: oc.name,
      targetOcId: oc.id,
      avatarUrl: oc.avatarUrl || '',
      title: list[idx].title || oc.race || ''
    });
    this.setData({ relationships: list });
    this._refreshRelationGraph(list);
  },

  _positionFromTouch(touch) {
    const rect = this._graphRect;
    if (!rect || !touch) return null;
    let x = ((touch.clientX - rect.left) / rect.width) * 100;
    let y = ((touch.clientY - rect.top) / rect.height) * 100;
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));
    return { x, y };
  },

  _applyRelationDrag(touch) {
    if (!this._dragRelId || !touch) return;
    const pos = this._positionFromTouch(touch);
    if (!pos) return;
    const list = (this.data.relationships || []).slice();
    const idx = list.findIndex((r) => r.id === this._dragRelId);
    if (idx < 0) return;
    list[idx] = Object.assign({}, list[idx], { posX: pos.x, posY: pos.y });
    this.setData({ relationships: list });
    this._refreshRelationGraph(list);
  },

  _enterRelationLinkMode(initialPickId) {
    this._dragRelId = null;
    this._linkPressTimer = null;
    this._linkPressNodeId = '';
    const pickId = initialPickId || '';
    this.setData({
      relationLinkMode: true,
      relationLinkPickId: pickId,
      relationEditorVisible: false,
      relationEditIndex: -1
    });
    wx.showToast({
      title: pickId ? '已选中第一个，再点另一头像' : '点击两个头像建立连线',
      icon: 'none'
    });
  },

  onCancelRelationLinkMode() {
    this._closeRelationLinkForm(false);
    this.setData({ relationLinkMode: false, relationLinkPickId: '' });
  },

  onSaveRelationLinkMode() {
    this._closeRelationLinkForm(false);
    const relationships = normalizeRelationships(this.data.relationships);
    const relationEdges = normalizeRelationEdges(this.data.relationEdges);
    this.setData({ relationLinkMode: false, relationLinkPickId: '' });
    this._saveProfile({ relationships, relationEdges });
    this._refreshRelationGraph(relationships, relationEdges);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  _relationLinkNodeName(nodeId) {
    if (nodeId === 'center') {
      return (this.data.relationGraph.center && this.data.relationGraph.center.name) || '主人物';
    }
    const rel = (this.data.relationships || []).find((r) => r.id === nodeId);
    return (rel && rel.name) || '—';
  },

  _findExistingRelationLink(fromId, toId) {
    const hasCenter = fromId === 'center' || toId === 'center';
    if (hasCenter) {
      const otherId = fromId === 'center' ? toId : toId === 'center' ? fromId : '';
      const rel = (this.data.relationships || []).find((r) => r.id === otherId);
      if (rel) {
        return { relationType: rel.relationType || '', note: rel.note || '' };
      }
      return { relationType: '', note: '' };
    }
    const pairKey = [fromId, toId].sort().join(':');
    const edge = normalizeRelationEdges(this.data.relationEdges).find(
      (e) => [e.fromId, e.toId].sort().join(':') === pairKey
    );
    if (edge) return { relationType: edge.relationType || '', note: edge.note || '' };
    return { relationType: '', note: '' };
  },

  _openRelationLinkForm(fromId, toId) {
    const existing = this._findExistingRelationLink(fromId, toId);
    const relationType = existing.relationType || '';
    const pickerIndex = relationType ? this._relationTypeIndex(relationType) : 1;
    this.setData({
      relationLinkFormVisible: true,
      relationLinkFromId: fromId,
      relationLinkToId: toId,
      relationLinkFormTitle:
        this._relationLinkNodeName(fromId) + ' → ' + this._relationLinkNodeName(toId),
      relationLinkTypePickerIndex: pickerIndex,
      relationLinkPickerLabel: relationPickerButtonLabel(relationType || RELATION_TYPES[pickerIndex] || '挚友'),
      relationLinkCustomDraft: relationCustomDraftFromType(relationType),
      relationLinkNote: existing.note || ''
    });
  },

  _closeRelationLinkForm(keepLinkMode) {
    const patch = {
      relationLinkFormVisible: false,
      relationLinkFromId: '',
      relationLinkToId: '',
      relationLinkFormTitle: '',
      relationLinkCustomDraft: '',
      relationLinkNote: ''
    };
    if (!keepLinkMode) {
      patch.relationLinkMode = false;
      patch.relationLinkPickId = '';
    }
    this.setData(patch);
  },

  _resolveRelationLinkFormType() {
    const idx = Number(this.data.relationLinkTypePickerIndex) || 0;
    if (idx === 0) {
      return String(this.data.relationLinkCustomDraft || '').trim();
    }
    return RELATION_TYPES[idx] || '';
  },

  onCloseRelationLinkForm() {
    this._closeRelationLinkForm(true);
  },

  onRelationLinkTypePick(e) {
    const pickIdx = Number(e.detail.value) || 0;
    const label =
      pickIdx === 0
        ? relationPickerButtonLabel(this.data.relationLinkCustomDraft || '自定义')
        : RELATION_TYPES[pickIdx] || '自定义';
    this.setData({
      relationLinkTypePickerIndex: pickIdx,
      relationLinkPickerLabel: label
    });
  },

  onRelationLinkCustomTypeInput(e) {
    const value = e.detail.value || '';
    this.setData({
      relationLinkCustomDraft: value,
      relationLinkPickerLabel: relationPickerButtonLabel(value || '自定义')
    });
  },

  onRelationLinkNoteInput(e) {
    this.setData({ relationLinkNote: e.detail.value || '' });
  },

  onConfirmRelationLinkForm() {
    const fromId = this.data.relationLinkFromId;
    const toId = this.data.relationLinkToId;
    if (!fromId || !toId) return;
    const relationType = this._resolveRelationLinkFormType();
    if (!relationType) {
      wx.showToast({ title: '请选择或填写关系', icon: 'none' });
      return;
    }
    this._applyRelationLink(fromId, toId, relationType, this.data.relationLinkNote || '');
    this._closeRelationLinkForm(false);
    wx.showToast({ title: '连线已保存', icon: 'success' });
  },

  _handleRelationLinkTap(nodeId) {
    if (!this.data.relationLinkMode) return;
    const id = nodeId || 'center';
    const pick = this.data.relationLinkPickId;
    if (!pick) {
      this.setData({ relationLinkPickId: id });
      wx.showToast({ title: '已选第一个，再点另一头像', icon: 'none' });
      return;
    }
    if (pick === id) return;
    this._openRelationLinkForm(pick, id);
  },

  _applyRelationLink(fromId, toId, relationType, note) {
    const noteText = String(note || '').trim();
    const hasCenter = fromId === 'center' || toId === 'center';
    const otherId = fromId === 'center' ? toId : toId === 'center' ? fromId : '';
    if (hasCenter && otherId) {
      const list = (this.data.relationships || []).slice();
      const idx = list.findIndex((r) => r.id === otherId);
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], { relationType, note: noteText });
        this.setData({ relationships: list, relationLinkMode: false, relationLinkPickId: '' });
        this._refreshRelationGraph(list, this.data.relationEdges);
        this._saveProfile({ relationships: list }, false, { reload: false });
        return;
      }
    }
    const a = fromId;
    const b = toId;
    let edges = normalizeRelationEdges(this.data.relationEdges).slice();
    const pairKey = [a, b].sort().join(':');
    const existIdx = edges.findIndex((e) => [e.fromId, e.toId].sort().join(':') === pairKey);
    const edge = {
      id: existIdx >= 0 ? edges[existIdx].id : newId('edge'),
      fromId: a,
      toId: b,
      relationType,
      note: noteText
    };
    if (existIdx >= 0) edges[existIdx] = edge;
    else edges.push(edge);
    this.setData({ relationEdges: edges, relationLinkMode: false, relationLinkPickId: '' });
    this._refreshRelationGraph(this.data.relationships, edges);
    this._saveProfile({ relationEdges: edges }, false, { reload: false });
  },

  onRelationCenterTap() {
    if (this._relationLinkTouchHandled) {
      this._relationLinkTouchHandled = false;
      return;
    }
    if (!this.data.relationLinkMode) return;
    this._handleRelationLinkTap('center');
  },

  onRelationCenterTouchStart() {
    if (this.data.relationLinkMode) return;
    if (this._linkPressTimer) clearTimeout(this._linkPressTimer);
    this._linkPressNodeId = 'center';
    this._linkPressTimer = setTimeout(() => {
      this._enterRelationLinkMode(this._linkPressNodeId);
    }, 550);
  },

  onRelationCenterTouchEnd() {
    if (this._linkPressTimer) {
      clearTimeout(this._linkPressTimer);
      this._linkPressTimer = null;
    }
    if (this.data.relationLinkMode) {
      this._relationLinkTouchHandled = true;
      this._handleRelationLinkTap('center');
    }
  },

  onRelationNodeTap(e) {
    if (this._relationLinkTouchHandled) {
      this._relationLinkTouchHandled = false;
      return;
    }
    if (!this.data.relationLinkMode) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._handleRelationLinkTap(id);
  },

  onRelationNodeTouchStart(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.relationLinkMode) return;
    this._dragRelId = id;
    this._dragMoved = false;
    this._linkPressNodeId = id;
    if (this._linkPressTimer) clearTimeout(this._linkPressTimer);
    this._linkPressTimer = setTimeout(() => {
      this._enterRelationLinkMode(this._linkPressNodeId);
    }, 550);
    const touch = e.touches && e.touches[0];
    if (touch) {
      this._touchStartX = touch.clientX;
      this._touchStartY = touch.clientY;
    }
    this._graphRect = null;
    wx.createSelectorQuery()
      .in(this)
      .select('.relation-graph')
      .boundingClientRect((rect) => {
        this._graphRect = rect || null;
      })
      .exec();
  },

  onRelationNodeTouchMove(e) {
    if (this.data.relationLinkMode) return;
    if (!this._dragRelId) return;
    if (this._linkPressTimer) {
      clearTimeout(this._linkPressTimer);
      this._linkPressTimer = null;
    }
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (this._touchStartX != null) {
      const dx = Math.abs(touch.clientX - this._touchStartX);
      const dy = Math.abs(touch.clientY - this._touchStartY);
      if (dx > 8 || dy > 8) this._dragMoved = true;
    }
    if (!this._graphRect) {
      wx.createSelectorQuery()
        .in(this)
        .select('.relation-graph')
        .boundingClientRect((rect) => {
          this._graphRect = rect || null;
          this._applyRelationDrag(touch);
        })
        .exec();
      return;
    }
    this._applyRelationDrag(touch);
  },

  onRelationNodeTouchEnd(e) {
    if (this._linkPressTimer) {
      clearTimeout(this._linkPressTimer);
      this._linkPressTimer = null;
    }
    if (this.data.relationLinkMode) {
      const id = e.currentTarget.dataset.id;
      if (id) {
        this._relationLinkTouchHandled = true;
        this._handleRelationLinkTap(id);
      }
      return;
    }
    const id = this._dragRelId;
    const moved = this._dragMoved;
    this._dragRelId = null;
    this._graphRect = null;
    this._dragMoved = false;
    if (!id) return;
    if (moved) {
      this._saveProfile({ relationships: this.data.relationships }, false, { reload: false });
    } else {
      this._openRelationEdit(id);
    }
  },

  onRelationInput(e) {
    const { field } = e.currentTarget.dataset;
    const idx = this.data.relationEditIndex;
    const list = (this.data.relationships || []).slice();
    if (idx < 0 || !list[idx]) return;
    const patch = { [field]: e.detail.value };
    if (field === 'name') {
      patch.targetOcId = '';
    }
    list[idx] = Object.assign({}, list[idx], patch);
    this.setData({ relationships: list });
    this._refreshRelationGraph(list);
  },

  onRelationTypePick(e) {
    const pickIdx = Number(e.detail.value) || 0;
    const idx = this.data.relationEditIndex;
    const list = (this.data.relationships || []).slice();
    if (idx < 0 || !list[idx]) return;
    if (pickIdx === 0) {
      const cur = String(list[idx].relationType || '').trim();
      if (isPresetRelationType(cur)) {
        list[idx] = Object.assign({}, list[idx], { relationType: '自定义' });
      }
    } else {
      list[idx] = Object.assign({}, list[idx], { relationType: RELATION_TYPES[pickIdx] });
    }
    this.setData(
      Object.assign({ relationships: list }, this._syncRelationFormUi(list, idx))
    );
    this._refreshRelationGraph(list);
  },

  onRelationCustomTypeInput(e) {
    const value = String(e.detail.value || '');
    const idx = this.data.relationEditIndex;
    const list = (this.data.relationships || []).slice();
    if (idx < 0 || !list[idx]) return;
    const trimmed = value.trim();
    list[idx] = Object.assign({}, list[idx], {
      relationType: trimmed || '自定义'
    });
    this.setData(
      Object.assign(
        {
          relationships: list,
          relationCustomDraft: value,
          relationPickerLabel: relationPickerButtonLabel(list[idx].relationType)
        },
        { relationTypePickerIndex: 0 }
      )
    );
    this._refreshRelationGraph(list);
  },

  onRemoveActiveRelation() {
    const idx = this.data.relationEditIndex;
    if (idx < 0) return;
    const list = (this.data.relationships || []).slice();
    list.splice(idx, 1);
    this.setData({
      relationships: list,
      relationEditorVisible: false,
      relationEditIndex: -1
    });
    this._refreshRelationGraph(list);
    this._saveProfile({ relationships: list }, false);
  },

  onSaveRelations() {
    const relationships = normalizeRelationships(this.data.relationships);
    const relationEdges = normalizeRelationEdges(this.data.relationEdges);
    this._saveProfile({ relationships, relationEdges });
    this.setData({ relationEditorVisible: false, relationEditIndex: -1, relationLinkMode: false, relationLinkPickId: '' });
    this._refreshRelationGraph(relationships, relationEdges);
  },

  _setTimelineEvents(list, options) {
    const bundle = this._syncTimelineViews(list, options);
    const profileScene = this.data.profileScene || normalizeProfileScene(null);
    bundle.worldTimelineView = buildWorldTimelineView(bundle.worldTimelineEvents, profileScene);
    this.setData(bundle, () => this._rebuildTimelineSpine());
  },

  _patchTimelineEventField(id, field, value) {
    const list = (this.data.timelineEvents || []).slice();
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0) return;
    list[idx] = Object.assign({}, list[idx], { [field]: value });
    const profileScene = this.data.profileScene || normalizeProfileScene(null);
    const worldTimelineEvents = list.filter((item) => item && item.category === 'world');
    const eventsTimelineEvents = list.filter((item) => item && item.category === 'events');
    const worldTimelineView = buildWorldTimelineView(worldTimelineEvents, profileScene);
    this.setData(
      {
        timelineEvents: list,
        worldTimelineEvents,
        eventsTimelineEvents,
        worldTimelineView
      },
      () => this._rebuildTimelineSpine()
    );
  },

  onAddWorldTimeline() {
    const list = (this.data.timelineEvents || []).slice();
    list.push(emptyTimelineEvent(list.length, 'world'));
    this._setTimelineEvents(list);
  },

  onTimelineInput(e) {
    const { id, field } = e.currentTarget.dataset;
    if (!id || !field) return;
    this._patchTimelineEventField(id, field, e.detail.value);
  },

  onTimelineInputBlur(e) {
    const { id, field } = e.currentTarget.dataset;
    if (!id || !field) return;
    const list = (this.data.timelineEvents || []).slice();
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0) return;
    list[idx] = Object.assign({}, list[idx], { [field]: e.detail.value });
    this._setTimelineEvents(list);
  },

  onRemoveTimeline(e) {
    const id = e.currentTarget.dataset.id;
    const list = (this.data.timelineEvents || []).filter((item) => item.id !== id);
    const expanded = Object.assign({}, this.data.expandedTimelineCards);
    delete expanded[id];
    this._setTimelineEvents(list);
    this._setExpandedTimelineCards(expanded);
    this._saveProfile({ timelineEvents: timelineEventsForSave(list) }, false, { reload: false });
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/ocNotebook/ocNotebook' });
      }
    });
  }
});
