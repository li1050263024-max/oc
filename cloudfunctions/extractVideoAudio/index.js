/**
 * 从云存储视频提取音轨（ffmpeg-static）
 *
 * 部署：右键 →「上传并部署：云端安装依赖」（必选）
 * 注意：不要上传本机 Windows 的 node_modules（已配 .wxcloudignore）
 *
 * 分步测试（测试框里只保留一个 JSON）：
 * 第1步 { "action": "hello" }
 * 第2步 { "action": "ping" }
 * 第3步 { "action": "pingFfmpeg" }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { pipeline } = require('stream');

/** 云端为 /tmp；本地调试在 Windows 上硬编码 /tmp 会变成 \tmp 导致 ENOENT */
function tmpDir() {
  try {
    const d = os.tmpdir();
    if (d && fs.existsSync(d)) return d;
  } catch (_) {}
  return process.platform === 'win32' ? path.join(process.cwd(), '.tmp') : '/tmp';
}

function ensureTmpDir() {
  const d = tmpDir();
  try {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  } catch (_) {}
  return d;
}

const CLOUD_ENV_ID = 'cloud1-d3gkbz2nf0c84c381';
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_DURATION_SEC = 60;
const FFMPEG_RELEASE = 'b6.0';
const FN_VERSION = '1.3.4';

let cloud = null;
let _cloudReady = false;
let _cloudInitErr = '';
let _sdkLoadErr = '';
let _ffmpegEnsurePromise = null;

function loadCloudSdk() {
  if (cloud) return true;
  try {
    cloud = require('wx-server-sdk');
    return true;
  } catch (e) {
    _sdkLoadErr = String((e && (e.message || e.errMsg)) || e);
    cloud = null;
    return false;
  }
}

function ensureCloud() {
  if (_cloudReady) return true;
  if (!loadCloudSdk()) {
    _cloudInitErr = _sdkLoadErr || '无法加载 wx-server-sdk';
    return false;
  }
  try {
    cloud.init({ env: CLOUD_ENV_ID });
    _cloudReady = true;
    return true;
  } catch (e) {
    _cloudInitErr = String((e && (e.message || e.errMsg)) || e);
    return false;
  }
}

function safeName(name) {
  const s = String(name || '视频BGM')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .slice(0, 80);
  return s || '视频BGM';
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      args,
      {
        timeout: 55000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
        })
      },
      (err, _stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message || err).slice(0, 500);
          reject(new Error(detail || 'ffmpeg 执行失败'));
          return;
        }
        resolve(String(stderr || ''));
      }
    );
  });
}

function isWindowsBinaryPath(p) {
  return /\.exe$/i.test(String(p || ''));
}

/** 当前平台可用的候选路径（Linux 绝不选用 .exe） */
function listFfmpegCandidates() {
  const win = process.platform === 'win32';
  const list = [
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN,
    '/opt/bin/ffmpeg',
    '/opt/ffmpeg/bin/ffmpeg',
    '/opt/ffmpeg',
    path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(
      __dirname,
      'node_modules',
      'ffmpeg-static',
      'bin',
      'linux',
      process.arch || 'x64',
      'ffmpeg'
    ),
    path.join(ensureTmpDir(), 'ffmpeg_oc_extract')
  ];
  if (win) {
    list.push(
      path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    );
  }
  return list.filter(Boolean);
}

function resolveFfmpegPath(opts) {
  const prepareExec = !!(opts && opts.prepareExec);
  const candidates = listFfmpegCandidates();

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    try {
      if (!p || !fs.existsSync(p)) continue;
      // 云端 Linux 不能跑本机上传的 ffmpeg.exe
      if (process.platform !== 'win32' && isWindowsBinaryPath(p)) continue;
      if (prepareExec) {
        try {
          fs.chmodSync(p, 0o755);
        } catch (_) {}
      }
      return { path: p, source: 'candidate' };
    } catch (_) {}
  }

  let staticPath = '';
  let requireErr = '';
  try {
    staticPath = require('ffmpeg-static');
  } catch (e) {
    requireErr = String((e && e.message) || e).slice(0, 160);
    return { path: '', source: 'none', requireErr: requireErr };
  }

  if (
    staticPath &&
    process.platform !== 'win32' &&
    isWindowsBinaryPath(staticPath)
  ) {
    return {
      path: '',
      source: 'win_binary_on_linux',
      requireErr:
        '检测到 Windows 的 ffmpeg.exe 被上传到云端。请勿上传本机 node_modules，改用「云端安装依赖」',
      staticPath: String(staticPath)
    };
  }

  if (!staticPath || !fs.existsSync(staticPath)) {
    return {
      path: '',
      source: 'static_missing',
      requireErr: requireErr || 'ffmpeg-static 路径不存在',
      staticPath: String(staticPath || '')
    };
  }

  if (!prepareExec) {
    return { path: staticPath, source: 'ffmpeg-static' };
  }

  if (process.platform === 'win32') {
    return { path: staticPath, source: 'ffmpeg-static' };
  }
  const dest = path.join(ensureTmpDir(), 'ffmpeg_oc_extract');
  try {
    fs.copyFileSync(staticPath, dest);
    fs.chmodSync(dest, 0o755);
    return { path: dest, source: 'ffmpeg-static-tmp' };
  } catch (e) {
    try {
      fs.chmodSync(staticPath, 0o755);
    } catch (_) {}
    return {
      path: staticPath,
      source: 'ffmpeg-static',
      copyErr: String((e && e.message) || e).slice(0, 120)
    };
  }
}

function runFfmpegVersion(ffmpegPath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve({ ok: false, err: 'empty_path' });
      return;
    }
    let settled = false;
    const done = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    try {
      execFile(
        ffmpegPath,
        ['-version'],
        { timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024 },
        (err, stdout) => {
          if (err) {
            done({
              ok: false,
              err: String((err && (err.message || err.code)) || err).slice(0, 160)
            });
            return;
          }
          const line = String(stdout || '')
            .split(/\r?\n/)
            .find((x) => /ffmpeg\s+version/i.test(x));
          done({
            ok: true,
            versionLine: String(line || 'ffmpeg ok').slice(0, 120)
          });
        }
      );
    } catch (e) {
      done({
        ok: false,
        err: String((e && e.message) || e).slice(0, 160)
      });
    }
  });
}

function httpGetFollow(url, maxRedirects) {
  const left = maxRedirects == null ? 5 : maxRedirects;
  return new Promise((resolve, reject) => {
    const lib = /^http:/i.test(url) ? http : https;
    const req = lib.get(
      url,
      {
        timeout: 45000,
        headers: { 'User-Agent': 'extractVideoAudio/' + FN_VERSION }
      },
      (res) => {
        const code = res.statusCode || 0;
        if (
          code >= 300 &&
          code < 400 &&
          res.headers.location &&
          left > 0
        ) {
          res.resume();
          const next = res.headers.location;
          const abs = /^https?:\/\//i.test(next)
            ? next
            : new URL(next, url).href;
          httpGetFollow(abs, left - 1).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error('HTTP ' + code + ' ' + String(url).slice(0, 80)));
          return;
        }
        resolve(res);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch (_) {}
      reject(new Error('download timeout'));
    });
  });
}

function downloadGunzipToFile(url, destPath) {
  const partial = destPath + '.partial';
  return httpGetFollow(url)
    .then(
      (res) =>
        new Promise((resolve, reject) => {
          try {
            if (fs.existsSync(partial)) fs.unlinkSync(partial);
          } catch (_) {}
          const out = fs.createWriteStream(partial);
          pipeline(res, zlib.createGunzip(), out, (err) => {
            if (err) {
              try {
                fs.unlinkSync(partial);
              } catch (_) {}
              reject(err);
              return;
            }
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(partial, destPath);
              fs.chmodSync(destPath, 0o755);
              resolve(destPath);
            } catch (e2) {
              reject(e2);
            }
          });
        })
    );
}

/** 云端依赖未装好时，运行时拉取 Linux 二进制到 /tmp */
async function downloadLinuxFfmpeg() {
  if (process.platform === 'win32') {
    return { ok: false, err: 'win32_skip' };
  }
  const arch =
    process.arch === 'arm64' || process.arch === 'arm'
      ? process.arch
      : 'x64';
  const dest = path.join(ensureTmpDir(), 'ffmpeg_oc_extract');
  const fileName = 'ffmpeg-linux-' + arch + '.gz';
  const mirrors = [
    'https://cdn.npmmirror.com/binaries/ffmpeg-static/' +
      FFMPEG_RELEASE +
      '/' +
      fileName,
    'https://npmmirror.com/mirrors/ffmpeg-static/' +
      FFMPEG_RELEASE +
      '/' +
      fileName,
    'https://github.com/eugeneware/ffmpeg-static/releases/download/' +
      FFMPEG_RELEASE +
      '/' +
      fileName
  ];
  let lastErr = '';
  for (let i = 0; i < mirrors.length; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await downloadGunzipToFile(mirrors[i], dest);
      // eslint-disable-next-line no-await-in-loop
      const ver = await runFfmpegVersion(dest);
      if (ver && ver.ok) {
        return {
          ok: true,
          path: dest,
          source: 'runtime_download',
          mirror: mirrors[i],
          versionLine: ver.versionLine || ''
        };
      }
      lastErr = (ver && ver.err) || 'downloaded_but_not_runnable';
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 160);
    }
  }
  return { ok: false, err: lastErr || 'download_failed' };
}

/**
 * 解析并确保可执行；云端缺二进制或误传 .exe 时自动下载 Linux 版
 */
function ensureFfmpegReady() {
  if (_ffmpegEnsurePromise) return _ffmpegEnsurePromise;
  _ffmpegEnsurePromise = (async () => {
    const resolved = resolveFfmpegPath({ prepareExec: true });
    if (resolved.path) {
      const ver = await runFfmpegVersion(resolved.path);
      if (ver && ver.ok) {
        return {
          ok: true,
          path: resolved.path,
          source: resolved.source,
          versionLine: ver.versionLine || '',
          requireErr: resolved.requireErr || ''
        };
      }
    }

    // 本机 Windows 调试：不下载 Linux 包
    if (process.platform === 'win32') {
      return {
        ok: false,
        path: resolved.path || '',
        source: resolved.source || 'none',
        requireErr: resolved.requireErr || '本地 ffmpeg 不可用',
        runErr: 'local_windows_binary_issue'
      };
    }

    const dl = await downloadLinuxFfmpeg();
    if (dl.ok) {
      return {
        ok: true,
        path: dl.path,
        source: dl.source,
        versionLine: dl.versionLine || '',
        mirror: dl.mirror || ''
      };
    }

    return {
      ok: false,
      path: resolved.path || '',
      source: resolved.source || 'none',
      requireErr: resolved.requireErr || '',
      runErr: dl.err || 'ffmpeg_unavailable',
      tip:
        '云端 ffmpeg 未就绪。请右键 extractVideoAudio →「上传并部署：云端安装依赖」（不要上传本机 node_modules）'
    };
  })().then(
    (r) => {
      if (!r || !r.ok) _ffmpegEnsurePromise = null;
      return r;
    },
    (err) => {
      _ffmpegEnsurePromise = null;
      return {
        ok: false,
        path: '',
        source: 'exception',
        runErr: String((err && err.message) || err).slice(0, 160)
      };
    }
  );
  return _ffmpegEnsurePromise;
}

async function deleteFiles(ids) {
  if (!ensureCloud()) return;
  const list = (ids || []).filter((id) => id && /^cloud:\/\//i.test(String(id)));
  if (!list.length) return;
  try {
    await cloud.deleteFile({ fileList: list });
  } catch (_) {}
}

async function cleanup(event) {
  const ids = [];
  if (event && event.fileID) ids.push(String(event.fileID));
  if (event && event.audioFileID) ids.push(String(event.audioFileID));
  if (event && event.videoFileID) ids.push(String(event.videoFileID));
  if (Array.isArray(event && event.fileList)) {
    event.fileList.forEach((id) => ids.push(String(id || '')));
  }
  await deleteFiles(ids);
  return { ok: true, step: 'cleanup' };
}

async function extract(event) {
  if (!ensureCloud()) {
    return {
      ok: false,
      step: 'extract',
      errMsg: '云开发 SDK 未就绪：' + (_cloudInitErr || _sdkLoadErr || '未知')
    };
  }
  const fileID = String((event && event.fileID) || '').trim();
  const name = safeName(event && event.name);
  if (!fileID || !/^cloud:\/\//i.test(fileID)) {
    return { ok: false, errMsg: '缺少有效的视频 fileID', step: 'extract' };
  }

  const ready = await ensureFfmpegReady();
  const ffmpegPath = ready.path;
  if (!ready.ok || !ffmpegPath) {
    return {
      ok: false,
      step: 'extract',
      errMsg:
        '云函数未找到可执行的 ffmpeg（真机走云端 Linux，不是本机）。请开发者工具右键 extractVideoAudio →「上传并部署：云端安装依赖」。详情：' +
        (ready.runErr || ready.requireErr || ready.source || ''),
      ffmpeg: ready,
      platform: process.platform,
      arch: process.arch,
      version: FN_VERSION
    };
  }

  const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const workDir = ensureTmpDir();
  const inPath = path.join(workDir, 'in_' + stamp + '.mp4');
  const outPath = path.join(workDir, 'out_' + stamp + '.m4a');

  try {
    const dl = await cloud.downloadFile({ fileID: fileID });
    const buf = dl && dl.fileContent;
    if (!buf || !buf.length) {
      return { ok: false, errMsg: '下载视频失败', step: 'extract' };
    }
    if (buf.length > MAX_BYTES) {
      return { ok: false, errMsg: '视频过大，请控制在 30MB 内', step: 'extract' };
    }
    fs.writeFileSync(inPath, buf);

    const common = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inPath,
      '-t',
      String(MAX_DURATION_SEC),
      '-vn',
      '-sn',
      '-dn'
    ];

    let lastErr = null;
    try {
      await runFfmpeg(
        ffmpegPath,
        common.concat(['-c:a', 'copy', '-movflags', '+faststart', outPath])
      );
    } catch (e1) {
      lastErr = e1;
      try {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      } catch (_) {}
      try {
        await runFfmpeg(
          ffmpegPath,
          common.concat([
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
            '-ar',
            '44100',
            '-movflags',
            '+faststart',
            outPath
          ])
        );
        lastErr = null;
      } catch (e2) {
        lastErr = e2;
      }
    }

    if (lastErr || !fs.existsSync(outPath) || !fs.statSync(outPath).size) {
      const tip = lastErr ? String(lastErr.message || lastErr).slice(0, 180) : '';
      return {
        ok: false,
        step: 'extract',
        errMsg: tip
          ? '未能提取音轨：' + tip
          : '未能从视频中提取到音轨（可能无音轨）'
      };
    }

    const audioBuf = fs.readFileSync(outPath);
    const cloudPath = 'oc_douyin_bgm_tmp/extract_' + stamp + '.m4a';
    const up = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: audioBuf
    });
    const audioFileID = (up && up.fileID) || '';
    if (!audioFileID) {
      return { ok: false, errMsg: '音频上传失败', step: 'extract' };
    }

    let url = '';
    try {
      const tr = await cloud.getTempFileURL({ fileList: [audioFileID] });
      const row = (tr && tr.fileList && tr.fileList[0]) || {};
      url = row.tempFileURL || '';
    } catch (_) {}

    await deleteFiles([fileID]);

    return {
      ok: true,
      step: 'extract',
      fileID: audioFileID,
      url: url,
      name: name,
      size: audioBuf.length,
      registered: false,
      localOnly: true,
      ffmpeg: path.basename(ffmpegPath),
      ffmpegSource: ready.source,
      version: FN_VERSION
    };
  } catch (e) {
    return {
      ok: false,
      step: 'extract',
      errMsg: String((e && e.message) || e || '提取失败'),
      version: FN_VERSION
    };
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch (_) {}
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch (_) {}
  }
}

function stepHello() {
  return {
    ok: true,
    step: 1,
    action: 'hello',
    msg: '云函数已响应（未加载云 SDK / ffmpeg）',
    node: process.version,
    time: Date.now(),
    env: CLOUD_ENV_ID,
    platform: process.platform,
    arch: process.arch,
    version: FN_VERSION
  };
}

function stepPing() {
  const ok = ensureCloud();
  return {
    ok: ok,
    step: 2,
    action: 'ping',
    msg: ok ? 'cloud.init 成功' : 'cloud.init 或 SDK 失败',
    cloudReady: ok,
    sdkLoadErr: _sdkLoadErr || '',
    cloudInitErr: _cloudInitErr || '',
    node: process.version,
    env: CLOUD_ENV_ID,
    platform: process.platform,
    arch: process.arch,
    time: Date.now(),
    version: FN_VERSION,
    tip: ok
      ? '第2步通过，请测 pingFfmpeg'
      : '请重新「上传并部署：云端安装依赖」'
  };
}

async function stepPingFfmpeg() {
  ensureCloud();
  const platform = process.platform;
  const arch = process.arch;
  const ready = await ensureFfmpegReady();
  const runnable = !!ready.ok;
  return {
    ok: runnable,
    step: 3,
    action: 'pingFfmpeg',
    msg: runnable
      ? 'ffmpeg 可执行（' + (ready.versionLine || 'ok') + '）'
      : 'ffmpeg 不可用：' + (ready.runErr || ready.requireErr || ''),
    hasFfmpeg: !!(ready.path || ready.ok),
    runnable: runnable,
    ffmpegPath: String(ready.path || '').slice(0, 160),
    ffmpegSource: ready.source || '',
    requireErr: ready.requireErr || '',
    runErr: ready.ok ? '' : ready.runErr || '',
    platform: platform,
    arch: arch,
    node: process.version,
    env: CLOUD_ENV_ID,
    time: Date.now(),
    version: FN_VERSION,
    tip: runnable
      ? platform === 'win32'
        ? '本地调试通过≠真机可用。请「上传并部署：云端安装依赖」后再真机试'
        : '云端 ffmpeg 就绪，可用真机提取'
      : platform === 'win32'
        ? '当前是本地 Windows。真机走云端：请右键 →「上传并部署：云端安装依赖」'
        : ready.tip ||
          '请「上传并部署：云端安装依赖」，并确认未勾选上传本机 node_modules'
  };
}

function normalizeEvent(event) {
  if (event == null) return {};
  if (typeof event === 'object' && !Array.isArray(event)) return event;
  if (typeof event === 'string') {
    const s = event.trim();
    if (!s) return {};
    try {
      const obj = JSON.parse(s);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch (_) {
      return { action: 'hello', _rawInvalid: true };
    }
  }
  return {};
}

exports.main = async (event) => {
  try {
    const ev = normalizeEvent(event);
    const action = String(ev.action || 'hello').trim();

    if (ev._rawInvalid) {
      return {
        ok: false,
        step: 0,
        errMsg: 'Invalid JSON event data',
        tip: '测试参数请只保留合法 JSON，例如：{"action":"pingFfmpeg"}（用英文双引号，不要注释）',
        version: FN_VERSION
      };
    }

    if (action === 'hello' || action === 'ping0' || action === '1') {
      return stepHello();
    }
    if (action === 'ping' || action === 'pingSdk' || action === '2') {
      return stepPing();
    }
    if (action === 'pingFfmpeg' || action === 'ping3' || action === '3') {
      return await stepPingFfmpeg();
    }
    if (action === 'cleanup') {
      return await cleanup(ev);
    }
    if (action === 'extract') {
      return await extract(ev);
    }

    return {
      ok: false,
      errMsg: '未知 action',
      got: action,
      use: ['hello', 'ping', 'pingFfmpeg', 'extract'],
      tip: '测试框示例：{"action":"pingFfmpeg"}',
      version: FN_VERSION
    };
  } catch (e) {
    return {
      ok: false,
      errMsg: String((e && (e.message || e.errMsg)) || e || '云函数异常'),
      step: 'fatal',
      version: FN_VERSION
    };
  }
};
