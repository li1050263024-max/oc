const fs = require('fs');
const vm = require('vm');
const p = 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocChat/ocChat.js.fixed_attempt';
const code = fs.readFileSync(p, 'utf8');
try {
  new vm.Script(code, { filename: 'ocChat.js' });
  console.log('ok');
} catch (e) {
  console.log(e.message);
  const m = /ocChat\.js:(\d+)/.exec(e.stack || '');
  if (m) {
    const n = Number(m[1]);
    const lines = code.split(/\n/);
    for (let k = n - 3; k <= n + 3; k++) {
      if (lines[k - 1] != null) console.log(k + '|' + lines[k - 1]);
    }
  }
}
