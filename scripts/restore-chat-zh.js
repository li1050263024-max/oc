const fs = require('fs');

const chatPath = 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocChat/ocChat.js';
const bakPath = 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocChat/ocChat.js.bak_im4A';
const groupPath = 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocGroupChat/ocGroupChat.js';

function restoreChat(src) {
  let s = src;

  const pairs = [
    // loading timeout
    [
      /this\.setData\(\{ loading: false, scrollTo: 'chat-bottom' \}\);\s*\n\s*wx\.showToast\(\{ title: '[^']*', icon: 'none' \}\);/,
      "this.setData({ loading: false, scrollTo: 'chat-bottom' });\n      wx.showToast({ title: '请求超时，请重试', icon: 'none' });"
    ],
    [/sessionTitle: \(meta && meta\.title\) \|\| '[^']*',/, "sessionTitle: (meta && meta.title) || '对话',"],
    [/const label = name \|\| '[^']*';/, "const label = name || '该 OC';"],
    [
      /title: '…',\s*\n\s*content:\s*\n\s*'确定删除「'/,
      "title: '移出对话列表',\n      content:\n        '确定删除「'"
    ],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*\}\s*\n\s*\}\);/, "wx.showToast({ title: '已移出', icon: 'none' });\n      }\n    });"],
    [/stories\.map\(\(s\) => s\.title \|\| '[^']*'\)/, "stories.map((s) => s.title || '未命名')"],
    [/title: '…',\s*\n\s*content: '…',\s*\n\s*confirmText:/, "title: '清除情景',\n      content: '确定清除当前对话的情景设定？',\n      confirmText:"],
    // more specific by unique neighbors
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*const names = stories/, "wx.showToast({ title: '该 OC 暂无已保存故事', icon: 'none' });\n      return;\n    }\n    const names = stories"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*wx\.showModal\(\{\s*\n\s*title: '…',\s*\n\s*content: '…' \+ ids\.length/, "wx.showToast({ title: '请先勾选对话', icon: 'none' });\n      return;\n    }\n    wx.showModal({\n      title: '批量删除',\n      content: '确定删除选中的 ' + ids.length"],
    [/content: '…' \+ ids\.length \+ '…',/, "content: '确定删除选中的 ' + ids.length + ' 个对话？删除后不可恢复。',"],
    [/wx\.showToast\(\{ title: '…' \+ result\.deleted \+ '…', icon: 'none' \}\);/, "wx.showToast({ title: '已删除 ' + result.deleted + ' 个对话', icon: 'none' });"],
    [/const label = \(item && item\.title\) \|\| '[^']*';/, "const label = (item && item.title) || '对话';"],
    [
      /title: '…',\s*\n\s*content: '确定删除「' \+ label \+ '」吗？',/,
      "title: '删除对话',\n      content: '确定删除「' + label + '」吗？',"
    ],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*\}\s*\n\s*\}\);?\s*\n\s*\},\s*\n\s*onRenameOcTap/, "wx.showToast({ title: '已删除', icon: 'none' });\n      }\n    });\n  },\n\n  onRenameOcTap"],
    [/renameInput: this\.data\.selectedName \|\| '[^']*',/, "renameInput: this.data.selectedName || '未命名',"],
    [/renameInput: \(s && s\.title\) \|\| '[^']*',/, "renameInput: (s && s.title) || '对话',"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*const name = \(this\.data\.renameInput/, "wx.showToast({ title: '名称不能为空', icon: 'none' });\n      return;\n    }\n    const name = (this.data.renameInput"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*this\.setData\(\{\s*\n\s*renameVisible: false/, "wx.showToast({ title: '修改失败', icon: 'none' });\n        return;\n      }\n      this.setData({\n        renameVisible: false"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*this\.refreshOcList\(\);\s*\n\s*return;/, "wx.showToast({ title: '备注已更新', icon: 'none' });\n      this.refreshOcList();\n      return;"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*this\.setData\(\{\s*\n\s*sessionTitle: name/, "wx.showToast({ title: '改名失败', icon: 'none' });\n      return;\n    }\n    this.setData({\n      sessionTitle: name"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*this\.setData\(\{\s*\n\s*sessionList:/, "wx.showToast({ title: '已改名', icon: 'none' });\n    this.setData({\n      sessionList:"],
    [/if \(showToast\) \{\s*\n\s*wx\.showToast\(\{ title: '…', icon: 'none' \}\);/, "if (showToast) {\n      wx.showToast({ title: '已新建对话', icon: 'none' });"],
    [/title: '…',\s*\n\s*content: preview \?/, "title: '删除这条消息',\n      content: preview ?"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(!this\.data\.selectedId\)/, "wx.showToast({ title: '无法重说这条消息', icon: 'none' });\n      return;\n    }\n    if (!this.data.selectedId)"],
    [/wx\.showToast\(\{ title: '… OC', icon: 'none' \}\);/g, "wx.showToast({ title: '请先选择 OC', icon: 'none' });"],
    [/wx\.showToast\(\{ title: '…OC …', icon: 'none' \}\);/g, "wx.showToast({ title: '该 OC 无有效设定', icon: 'none' });"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*ensureCloudReady/, "wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });\n        return;\n      }\n      ensureCloudReady"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*wx\.showModal\(\{\s*\n\s*title: '…',\s*\n\s*content: '…',\s*\n\s*confirmText:/, "wx.showToast({ title: '已超过2分钟，无法撤回', icon: 'none' });\n      return;\n    }\n    wx.showModal({\n      title: '撤回这条消息',\n      content: '撤回后对方（AI）侧会看到已撤回，本地记录会保留痕迹。',\n      confirmText:"],
    [/r\.errMsg \|\| '…'/g, "r.errMsg || '发送失败'"],
    [/\|\| '…';\s*\n\s*wx\.showToast\(\{\s*\n\s*title: \/timeout/g, "|| '请求失败';\n          wx.showToast({\n            title: /timeout"],
    [/\|\| '…';\s*\n\s*wx\.showToast\(\{ title: msg/g, "|| '请求失败';\n        wx.showToast({ title: msg"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*const messages = raw\.map/, "wx.showToast({ title: '暂无对话可保存', icon: 'none' });\n      return;\n    }\n    const messages = raw.map"],
    [/'…' \+ \(this\.data\.selectedName \|\| 'OC'\) \+ '…' \+ \(this\.data\.sessionTitle \|\| '…'\)/, "'与' + (this.data.selectedName || 'OC') + ' · ' + (this.data.sessionTitle || '对话')"],
    [/wx\.showLoading\(\{ title: '…', mask: true \}\);/g, "wx.showLoading({ title: '生成长图…', mask: true });"],
    [/wx\.showToast\(\{ title: '…', icon: 'success' \}\)/g, "wx.showToast({ title: '已保存到相册', icon: 'success' })"],
    [/title: '…',\s*\n\s*content: '…',\s*\n\s*confirmText: '去设置'/, "title: '需要相册权限',\n                  content: '请在设置中允许保存到相册',\n                  confirmText: '去设置'"],
    [/wx\.showToast\(\{ title: msg \|\| '…', icon: 'none' \}\);/, "wx.showToast({ title: msg || '保存失败', icon: 'none' });"],
    [/title: \(err && err\.message\) \|\| '…'/, "title: (err && err.message) || '导出失败'"],
    [/title: name \? '…' \+ name \+ '…' : meta\.title/, "title: name ? ('和' + name + '聊天中') : meta.title"],
    [/confirmText: '…'/g, "confirmText: '确定'"],
    [/cancelText: '…'/g, "cancelText: '取消'"],
    // 导入 / 导出
    [
      /itemList:\s*\[[^\]]*txt[^\]]*\],/,
      "itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],"
    ],
    [
      /itemList:\s*\['… txt …',\s*'… JSON …',\s*'…'\],/,
      "itemList: ['导出 txt 文本', '导出 JSON 备份', '导入对话'],"
    ],
    [
      /(buildChatShareText\(favId\);\s*\n\s*if\s*\(!text\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
      "$1'导出失败'"
    ],
    [
      /(buildChatPack\(favId\);\s*\n\s*if\s*\(!pack\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
      "$1'导出失败'"
    ],
    [
      /(if\s*\(!this\.data\.selectedId\s*\|\|\s*!messages\.length\)\s*\{\s*\n\s*wx\.showToast\(\{\s*title:\s*)'[^']*'/,
      "$1'暂无对话可保存'"
    ],
    [
      /title:\s*'…',\s*\n\s*content:\s*'…',\s*\n\s*confirmText:\s*'去设置'/,
      "title: '需要相册权限',\n                  content: '保存长图需要相册写入权限',\n                  confirmText: '去设置'"
    ],
    [
      /title:\s*'…',\s*\n\s*content:\s*'…',\s*\n\s*confirmText:\s*'确定',\s*\n\s*cancelText:\s*'取消',\s*\n\s*success:\s*\(r\)\s*=>\s*\{\s*\n\s*if\s*\(r\.confirm\)\s*wx\.openSetting/,
      "title: '需要相册权限',\n                  content: '保存长图需要相册写入权限',\n                  confirmText: '去设置',\n                  cancelText: '取消',\n                  success: (r) => {\n                    if (r.confirm) wx.openSetting"
    ]
  ];

  for (const [re, rep] of pairs) {
    s = s.replace(re, rep);
  }

  // leftover clear-scenario toast
  s = s.replace(
    /wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*\}\s*\n\s*\}\);?\s*\n\s*\},\s*\n\s*onClearScenario/,
    "wx.showToast({ title: '已清除情景', icon: 'none' });\n      }\n    });\n  },\n\n  onClearScenario"
  );

  return s;
}

function restoreGroup(src) {
  let s = src;
  const pairs = [
    [/wx\.showToast\(\{ title: '…' \+ MAX_MEMBERS \+ '…', icon: 'none' \}\);/, "wx.showToast({ title: '最多 ' + MAX_MEMBERS + ' 人', icon: 'none' });"],
    [/wx\.showToast\(\{ title: '…' \+ result\.deleted \+ '…', icon: 'none' \}\);/, "wx.showToast({ title: '已删除 ' + result.deleted + ' 个对话', icon: 'none' });"],
    [/content: '…' \+ ids\.length \+ '…',/, "content: '确定删除选中的 ' + ids.length + ' 个对话？删除后不可恢复。',"],
    [/wx\.showLoading\(\{ title: '…', mask: true \}\);/g, "wx.showLoading({ title: '生成长图…', mask: true });"],
    [/wx\.showToast\(\{ title: '…', icon: 'success' \}\)/g, "wx.showToast({ title: '已保存到相册', icon: 'success' })"],
    [/title: '…',\s*\n\s*content: '…',\s*\n\s*confirmText: '去设置'/, "title: '需要相册权限',\n                  content: '请在设置中允许保存到相册',\n                  confirmText: '去设置'"],
    [/confirmText: '…'/g, "confirmText: '确定'"],
    [/wx\.showToast\(\{ title: '…', icon: 'none' \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*const messages = raw\.map/, "wx.showToast({ title: '暂无对话可保存', icon: 'none' });\n      return;\n    }\n    const messages = raw.map"],
    [/\(this\.data\.roomTitle \|\| '…'\) \+ '[^']*' \+ \(this\.data\.sessionTitle \|\| '…'\)/, "(this.data.roomTitle || '群聊') + ' · ' + (this.data.sessionTitle || '对话')"]
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  return s;
}

let chat = restoreChat(fs.readFileSync(chatPath, 'utf8'));
fs.writeFileSync(chatPath, chat, 'utf8');
let group = restoreGroup(fs.readFileSync(groupPath, 'utf8'));
fs.writeFileSync(groupPath, group, 'utf8');

const vm = require('vm');
for (const f of [chatPath, groupPath]) {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
    console.log('OK', f);
  } catch (e) {
    console.log('FAIL', f, e.message);
  }
}

const left = (fs.readFileSync(chatPath, 'utf8').match(/'…'/g) || []).length;
console.log('remaining … literals in ocChat:', left);
console.log('remaining … literals in group:', (fs.readFileSync(groupPath, 'utf8').match(/'…'/g) || []).length);
