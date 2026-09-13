const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'mp4'];

function safeDecode(s) {
  const raw = String(s || '');
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    try {
      return decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch (_) {
      return raw;
    }
  }
}

function extFromUrl(u) {
  try {
    const p = new URL(u).pathname || '';
    const m = p.match(/\.([a-zA-Z0-9]{1,8})$/);
    const ext = m ? String(m[1]).toLowerCase() : '';
    return ALLOWED_EXT.indexOf(ext) >= 0 ? ext : '';
  } catch (_) {
    return '';
  }
}

function extFromContentType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.indexOf('audio/mpeg') >= 0 || t.indexOf('audio/mp3') >= 0) return 'mp3';
  if (t.indexOf('audio/mp4') >= 0 || t.indexOf('audio/m4a') >= 0 || t.indexOf('audio/x-m4a') >= 0) {
    return 'm4a';
  }
  if (t.indexOf('audio/aac') >= 0) return 'aac';
  if (t.indexOf('audio/wav') >= 0 || t.indexOf('audio/x-wav') >= 0) return 'wav';
  if (t.indexOf('audio/ogg') >= 0) return 'ogg';
  if (t.indexOf('video/mp4') >= 0 || t.indexOf('audio/mp4') >= 0) return 'mp4';
  return '';
}

function displayNameFromUrl(u) {
  try {
    const path = new URL(u).pathname || '';
    const base = safeDecode((path.split('/').pop() || '').split('?')[0]);
    const cleaned = String(base || '')
      .replace(/\.(mp3|m4a|aac|wav|ogg|mp4)$/i, '')
      .trim();
    if (cleaned && cleaned !== '/' && cleaned.length <= 40) return cleaned;
  } catch (_) {}
  return '网络 BGM';
}

function downloadBuffer(fileUrl, redirects) {
  const left = redirects == null ? 5 : redirects;
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(fileUrl);
    } catch (e) {
      reject(new Error('链接无效'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error('仅支持 http(s) 链接'));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'GET',
        headers: {
          // 部分 CDN 会拦自定义 UA；用常见浏览器 UA
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'audio/*,video/*,application/octet-stream,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 45000
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location && left > 0) {
          let next;
          try {
            next = new URL(res.headers.location, fileUrl).toString();
          } catch (_) {
            res.resume();
            reject(new Error('重定向地址无效'));
            return;
          }
          res.resume();
          downloadBuffer(next, left - 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error('下载失败 HTTP ' + code));
          return;
        }
        const contentType = res.headers['content-type'] || '';
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new Error('音频过大，请控制在 12MB 内'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 明显是 HTML 页面，不是音频文件
          const head = buf.slice(0, 64).toString('utf8').toLowerCase();
          if (
            /text\/html/i.test(contentType) ||
            head.indexOf('<!doctype html') >= 0 ||
            head.indexOf('<html') >= 0
          ) {
            reject(new Error('链接不是直接音频文件，请用 .mp3/.m4a 直链'));
            return;
          }
          resolve({
            buf,
            contentType,
            finalUrl: fileUrl
          });
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
    req.on('error', (err) => {
      reject(new Error((err && err.message) || '网络错误'));
    });
    req.end();
  });
}

exports.main = async (event) => {
  const url = String((event && event.url) || '').trim();
  if (!url) return { ok: false, errMsg: '请提供音频链接' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, errMsg: '仅支持 http(s) 链接' };

  try {
    const downloaded = await downloadBuffer(url);
    const buf = downloaded && downloaded.buf;
    if (!buf || !buf.length) return { ok: false, errMsg: '下载内容为空' };

    let ext =
      extFromUrl(downloaded.finalUrl || url) ||
      extFromContentType(downloaded.contentType) ||
      'mp3';
    if (ALLOWED_EXT.indexOf(ext) < 0) ext = 'mp3';

    const cloudPath =
      'oc_douyin_bgm/' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '.' +
      ext;
    const up = await cloud.uploadFile({
      cloudPath,
      fileContent: buf
    });
    const fileID = up.fileID;
    let tempFileURL = '';
    try {
      const tr = await cloud.getTempFileURL({ fileList: [fileID] });
      const row = (tr.fileList && tr.fileList[0]) || {};
      tempFileURL = row.tempFileURL || '';
    } catch (_) {}

    const name = displayNameFromUrl(downloaded.finalUrl || url);
    // 同步登记到曲库（失败不影响本次播放）
    try {
      const db = cloud.database();
      const exist = await db.collection('oc_douyin_bgm_lib').where({ fileID: fileID }).limit(1).get();
      if (!(exist && exist.data && exist.data.length)) {
        const wxContext = cloud.getWXContext();
        await db.collection('oc_douyin_bgm_lib').add({
          data: {
            fileID: fileID,
            name: name,
            size: buf.length,
            createdAt: Date.now(),
            openid: (wxContext && wxContext.OPENID) || ''
          }
        });
      }
    } catch (_) {}

    return {
      ok: true,
      fileID,
      tempFileURL,
      name: name
    };
  } catch (e) {
    const msg = String((e && e.message) || e || '拉取失败');
    // 把底层 URI / JSON 等英文错误转成可读中文
    let errMsg = msg;
    if (/URI malformed|uri error|解码/i.test(msg)) errMsg = '链接格式有误，请换一条直链';
    else if (/ENOTFOUND|getaddrinfo|解析错误/i.test(msg)) errMsg = '云端无法解析此外链域名，请改用上传音频';
    else if (/ECONNRESET|ETIMEDOUT|timeout/i.test(msg)) errMsg = '下载超时，请换链接或稍后重试';
    else if (/certificate|SSL|TLS/i.test(msg)) errMsg = '该站点证书异常，请换链接';
    return { ok: false, errMsg };
  }
};
