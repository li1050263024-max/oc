/** 第二、三环节 AI 等待牌面诗句（Keats, Bright Star 节选） */
const AI_WAIT_QUOTE =
  'Bright star, would I were steadfast as thou art, Not in lone splendour hung aloft the night, And watching, with eternal lids apart......';

let _fontLoaded = false;

function loadAiWaitScriptFont() {
  if (_fontLoaded) return;
  _fontLoaded = true;
  wx.loadFontFace({
    family: 'OcWaitScript',
    global: true,
    source: 'url("/fonts/great-vibes-latin-400.woff")',
    desc: {
      style: 'italic',
      weight: 'normal'
    },
    fail: function () {
      _fontLoaded = false;
    }
  });
}

module.exports = {
  AI_WAIT_QUOTE,
  loadAiWaitScriptFont
};
