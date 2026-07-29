/**
 * Repair PowerShell-corrupted UTF-8 JS: Chinese became ?, some quotes lost.
 * Never collapses empty string literals ''.
 */
const fs = require('fs');
const vm = require('vm');

function locate(code) {
  try {
    new vm.Script(code, { filename: 'file.js' });
    return null;
  } catch (e) {
    const m = /file\.js:(\d+)/.exec(e.stack || '');
    return { message: e.message, line: m ? Number(m[1]) : null };
  }
}

const PROP_AFTER =
  '(?:icon|confirmText|cancelText|duration|confirmColor|title|content|success|mask)';

function rewriteBody(body) {
  const t = String(body).trim();
  if (t === '') return '';
  if (/^\?+$/.test(t)) return '…';
  if (/\?/.test(body) && /OC/i.test(body)) return body.replace(/\?+/g, '…');
  if (/^\?[\?\s]*$/.test(t)) return '…';
  if (/\?{2,}/.test(body)) return body.replace(/\?{2,}/g, '…');
  return body;
}

/**
 * If a "string body" actually ate `, icon:` etc., split it back out.
 * Returns { body, after } where after is e.g. ", icon:"
 */
function splitSwallowedProps(body) {
  const re = new RegExp(`^(.*?),\\s*(${PROP_AFTER}\\s*:)(.*)$`);
  const m = re.exec(body);
  if (!m) return null;
  // Only when left side looks like corrupted text (has ?)
  if (!/\?/.test(m[1])) return null;
  // Avoid splitting legitimate commas inside longer Chinese once restored
  if (m[1].length > 80) return null;
  return { body: m[1], after: ', ' + m[2] + m[3] };
}

function fixLine(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          out += line[i] + (line[i + 1] || '');
          i += 2;
          continue;
        }
        out += line[i];
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "'") {
      // Empty string
      if (line[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }

      i++;
      let body = '';
      let closed = false;
      while (i < line.length) {
        if (line[i] === '\\') {
          body += line[i] + (line[i + 1] || '');
          i += 2;
          continue;
        }
        if (line[i] === "'") {
          closed = true;
          i++;
          break;
        }
        body += line[i];
        i++;
      }

      let suffix = '';

      // Unterminated: trailing code punct that belonged outside the string
      if (!closed) {
        const peels = [
          [/^(.*?)\s*\+\s*$/, ' + '],
          [/^(.*?)\s*:\s*meta\.title(\s*,)?\s*$/, (m) => ' : meta.title' + (m[2] || '')],
          [/^(.*?)\s*:\s*raw\s*;\s*$/, ' : raw;'],
          [/^(.*?)\s*:\s*raw\s*$/, ' : raw'],
          [/^(.*?)\s*,\s*$/, ','],
          [/^(.*?)\s*\);\s*$/, ');'],
          [/^(.*?)\s*\)\s*;\s*$/, ');'],
          [/^(.*?)\s*\)\s*$/, ')'],
          [/^(.*?)\s*;\s*$/, ';']
        ];
        let peeled = false;
        for (const [re, suf] of peels) {
          const m = re.exec(body);
          if (!m) continue;
          if (!/\?/.test(m[1]) && typeof suf === 'string' && suf !== ' + ' && suf !== ',') continue;
          body = m[1];
          suffix = typeof suf === 'function' ? suf(m) : suf;
          peeled = true;
          break;
        }
        void peeled;
      }

      const split = splitSwallowedProps(body);
      if (split) {
        out += "'" + rewriteBody(split.body) + "'" + split.after;
        out += suffix;
        // The quote we consumed was actually the opener of the next literal (e.g. 'none')
        if (closed) i -= 1;
        continue;
      }

      out += "'" + rewriteBody(body) + "'" + suffix;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function fixFile(src) {
  let s = src.replace(/\r\n/g, '\n');

  // Comment line that swallowed following code (encoding loss merged lines)
  s = s.replace(
    /^([ \t]*)\/\/[^\n]*?\s{2,}(setTimeout\s*\(|let\s+|const\s+|var\s+|this\.|wx\.|if\s*\()/gm,
    '$1// recovered\n$1$2'
  );

  s = s.replace(
    /content:\s*\n\s*'[^'\n]*\+?\s*\n\s*label\s*\+\s*\n\s*'[^'\n]*,?/g,
    "content:\n        '确定删除「' +\n        label +\n        '」吗？删除后对话记录将一并移除。',"
  );

  s = s.replace(
    /content:\s*'[^']*'\s*\+\s*label\s*\+\s*'[^']*',?/g,
    "content: '确定删除「' + label + '」吗？',"
  );
  s = s.replace(
    /content:\s*'[^'\n]*\+\s*label\s*\+\s*'[^'\n]*,?/g,
    "content: '确定删除「' + label + '」吗？',"
  );

  s = s.replace(
    /preview\s*\?\s*'[^'\n]*\+\s*preview\s*\+\s*'[^'\n:]*/g,
    "preview ? ('「' + preview + '」')"
  );

  // Ternary with missing quote before colon: result.last ? '??? : '???,
  s = s.replace(
    /result\.last \?\s*'[^']*:\s*'[^']*',/g,
    "result.last ? '部分失败' : '删除失败',"
  );

  // mem.name + '?? + (s.title || '??????)
  s = s.replace(
    /mem\.name \+\s*'[^'\n]*\+\s*\(s\.title \|\|\s*'[^'\n]*\)/g,
    "mem.name + ' · ' + (s.title || '未命名')"
  );

  // slice preview ternary: + '??? : raw;
  s = s.replace(
    /raw\.slice\(0,\s*28\)\s*\+\s*'[^']*:\s*raw;/g,
    "raw.slice(0, 28) + '…' : raw;"
  );

  s = s.split('\n').map(fixLine).join('\n');

  s = s.replace(
    /String\(rawReply \|\| ''\)\.trim\(\) \|\| '[^']*'/g,
    "String(rawReply || '').trim() || '……'"
  );
  s = s.replace(/const label = name \|\| '[^']*';/g, "const label = name || '该 OC';");
  s = s.replace(
    /const label = \(item && item\.title\) \|\| '[^']*';/g,
    "const label = (item && item.title) || '会话';"
  );
  s = s.replace(
    /\{ key: 'dm', label: '[^']*' \},\s*\n\s*\{ key: 'group', label: '[^']*' \}/g,
    "{ key: 'dm', label: '私聊' },\n      { key: 'group', label: '群聊' }"
  );

  // Regex bodies: Chinese became ?? which breaks /timeout|??/i
  s = s.replace(/\/timeout\|\?+\/i/g, '/timeout|超时/i');
  s = s.replace(
    /\/timeout\|超时\/i\.test\((\w+)\)\s*\?\s*'[^']*'/g,
    "/timeout|超时/i.test($1) ? '请求超时，请重试'"
  );

  return s;
}

const jobs = [
  {
    out: 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocChat/ocChat.js',
    src: 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocChat/ocChat.js.corrupted'
  },
  {
    out: 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocGroupChat/ocGroupChat.js',
    src: 'E:/桌面/oc 2.0/oc (2)/oc/oc/pages/ocGroupChat/ocGroupChat.js.corrupted'
  }
];

for (const job of jobs) {
  let s = fixFile(fs.readFileSync(job.src, 'utf8'));
  let err = locate(s);
  let guard = 0;
  while (err && guard < 50) {
    const lines = s.split('\n');
    const idx = (err.line || 1) - 1;
    console.log(guard, err.message, 'L' + err.line, (lines[idx] || '').trim().slice(0, 140));

    if (
      lines[idx] &&
      lines[idx + 1] &&
      /['"\d\]\}]\s*$/.test(lines[idx].trim()) &&
      /^\s*[a-zA-Z_]/.test(lines[idx + 1]) &&
      !/,\s*$/.test(lines[idx].trim()) &&
      !/^\s*[\.\[\(]/.test(lines[idx + 1]) &&
      !/^\s*(else|catch|finally|while|function)\b/.test(lines[idx + 1])
    ) {
      lines[idx] = lines[idx].replace(/\s*$/, ',');
      s = lines.join('\n');
      err = locate(s);
      guard++;
      continue;
    }

    break;
  }

  if (!err) {
    fs.writeFileSync(job.out, s, 'utf8');
    console.log('OK', job.out);
  } else {
    console.log('FAIL', err.message, err.line);
    const lines = s.split('\n');
    for (let k = err.line - 3; k <= err.line + 3; k++) {
      if (lines[k - 1] != null) console.log(k + '|' + lines[k - 1]);
    }
    fs.writeFileSync(job.out + '.fixed_attempt', s, 'utf8');
  }
}
