/**
 * Rebuild ocChat.js from .corrupted, restore Chinese (esp. import/export), keep quota/dice.
 * Uses Node fs only (utf8) — never PowerShell.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'pages/ocChat/ocChat.js');
const SRC = path.join(ROOT, 'pages/ocChat/ocChat.js.corrupted');
const BAK = path.join(ROOT, 'pages/ocChat/ocChat.js.bak_im4A');

// Reuse encoding fixer
const fixMod = (() => {
  // Inline: load fix-chat-encoding by evaluating its fixFile — simpler to shell out
  return null;
})();

function locate(code) {
  try {
    new vm.Script(code, { filename: 'file.js' });
    return null;
  } catch (e) {
    const m = /file\.js:(\d+)/.exec(e.stack || '');
    return { message: e.message, line: m ? Number(m[1]) : null };
  }
}

// Run existing fixer as child by requiring via Function extraction is messy —
// instead spawn by reading and duplicating key post-steps on already-fixed logic.
const { execFileSync } = require('child_process');
execFileSync(process.execPath, [path.join(__dirname, 'fix-chat-encoding.js')], {
  stdio: 'inherit'
});

let s = fs.readFileSync(OUT, 'utf8');

// Ensure sharePackFile import
if (!s.includes("require('../../utils/ocShare.js')")) {
  s = s.replace(
    "const packPage = require('../../utils/ocPackPage.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');",
    "const packPage = require('../../utils/ocPackPage.js');\nconst { sharePackFile } = require('../../utils/ocShare.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');"
  );
}

// Import / export menu (user-reported broken text)
s = s.replace(
  /itemList:\s*\[[^\]]*\],\s*\n\s*success:\s*\(res\)\s*=>\s*\{\s*\n\s*const favId = resolveFavoriteId/,
  "itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],\n      success: (res) => {\n        const favId = resolveFavoriteId"
);

// Toasts inside that menu: empty text / pack fail → 导出失败
s = s.replace(
  /(buildChatShareText\(favId\);\s*\n\s*if\s*\(!text\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
  "$1'导出失败'"
);
s = s.replace(
  /(buildChatPack\(favId\);\s*\n\s*if\s*\(!pack\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
  "$1'导出失败'"
);

// Save long image + album permission (same menu group UX)
s = s.replace(
  /(onSaveChatImage\(\)\s*\{[\s\S]*?if\s*\(!this\.data\.selectedId\s*\|\|\s*!messages\.length\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
  "$1'暂无对话可保存'"
);
s = s.replace(
  /const title =\s*\n\s*'[^']*'\s*\+\s*\(this\.data\.selectedName \|\| 'OC'\)\s*\+\s*'[^']*'\s*\+\s*\(this\.data\.sessionTitle \|\| '[^']*'\)/,
  "const title =\n      '与 ' + (this.data.selectedName || 'OC') + ' · ' + (this.data.sessionTitle || '对话')"
);
s = s.replace(
  /wx\.showLoading\(\{\s*title:\s*'[^']*',\s*mask:\s*true\s*\}\);(\s*\n\s*exportChatLongImage)/,
  "wx.showLoading({ title: '生成长图…', mask: true });$1"
);
s = s.replace(
  /wx\.showToast\(\{\s*title:\s*'[^']*',\s*icon:\s*'success'\s*\}\)/g,
  "wx.showToast({ title: '已保存到相册', icon: 'success' })"
);
s = s.replace(
  /title:\s*'[^']*',\s*\n\s*content:\s*'[^']*',\s*\n\s*confirmText:\s*'[^']*',\s*\n\s*cancelText:\s*'[^']*',\s*\n\s*success:\s*\(r\)\s*=>\s*\{\s*\n\s*if\s*\(r\.confirm\)\s*wx\.openSetting\(\);/,
  "title: '需要相册权限',\n                  content: '保存长图需要相册写入权限',\n                  confirmText: '去设置',\n                  cancelText: '取消',\n                  success: (r) => {\n                    if (r.confirm) wx.openSetting();"
);

// Pull more Chinese from bak for identical structural keys where bak still has good strings
if (fs.existsSync(BAK)) {
  const bak = fs.readFileSync(BAK, 'utf8');
  // Copy onOpenDataMenu block from bak if present
  const bakMenu = bak.match(
    /onOpenDataMenu\(\)\s*\{[\s\S]*?\n  \},\n\n  onToggleListMode/
  );
  const curMenu = s.match(
    /onOpenDataMenu\(\)\s*\{[\s\S]*?\n  \},\n\n  onToggleListMode/
  );
  if (bakMenu && curMenu) {
    // Prefer bak menu body but keep calling same helpers
    s = s.replace(curMenu[0], bakMenu[0]);
    // Re-ensure sharePackFile still works (bak uses bare sharePackFile)
  }
}

// Re-apply sharePackFile import after bak swap
if (!s.includes("require('../../utils/ocShare.js')")) {
  s = s.replace(
    "const packPage = require('../../utils/ocPackPage.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');",
    "const packPage = require('../../utils/ocPackPage.js');\nconst { sharePackFile } = require('../../utils/ocShare.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');"
  );
}

// Known critical strings from bak (safe exact replacements for placeholders)
const exact = [
  [/String\(rawReply \|\| ''\)\.trim\(\) \|\| '[^']*'/, "String(rawReply || '').trim() || '……'"],
  [/\/timeout\|\?+\/i/g, '/timeout|超时/i'],
  [/\/timeout\|超时\/i\.test\((\w+)\)\s*\?\s*'[^']*'/g, "/timeout|超时/i.test($1) ? '请求超时，请重试'"],
  [/\{ key: 'dm', label: '[^']*' \},\s*\n\s*\{ key: 'group', label: '[^']*' \}/, "{ key: 'dm', label: '私聊' },\n      { key: 'group', label: '群聊' }"],
  [/wx\.showToast\(\{ title: '请先选择 OC', icon: 'none' \}\);/g, "wx.showToast({ title: '请先选择 OC', icon: 'none' });"]
];
for (const [re, rep] of exact) s = s.replace(re, rep);

// Run restore-chat-zh extras inline for leftovers that restore script knows
try {
  execFileSync(process.execPath, [path.join(__dirname, 'restore-chat-zh.js')], {
    stdio: 'inherit'
  });
  s = fs.readFileSync(OUT, 'utf8');
} catch (_) {}

// Final ensure import/export strings (restore script may not touch them if already Chinese)
s = fs.readFileSync(OUT, 'utf8');
s = s.replace(
  /itemList:\s*\[[^\]]*txt[^\]]*\],/,
  "itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],"
);
// If still placeholders
s = s.replace(
  /itemList:\s*\['[^']*txt[^']*',\s*'[^']*JSON[^']*',\s*'[^']*'\],/,
  "itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],"
);

if (!s.includes("require('../../utils/ocShare.js')")) {
  s = s.replace(
    "const packPage = require('../../utils/ocPackPage.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');",
    "const packPage = require('../../utils/ocPackPage.js');\nconst { sharePackFile } = require('../../utils/ocShare.js');\nconst { buildChatPack, buildChatShareText } = require('../../utils/ocPack.js');"
  );
}

const err = locate(s);
if (err) {
  console.error('FAIL', err.message, err.line);
  process.exit(1);
}

fs.writeFileSync(OUT, s, 'utf8');
const menu = s.match(/itemList:\s*\[[^\]]+\]/);
console.log('OK', OUT);
console.log('menu', menu && menu[0]);
console.log('has 导出', s.includes('导出 txt'));
console.log('has sharePackFile import', s.includes("ocShare.js"));
