/**
 * 用户图片内容安全（微信免费接口 security.imgSecCheck）
 *
 * 部署：右键本云函数 →「上传并部署：云端安装依赖」
 * 测试：{ "action": "ping" }
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_BYTES = 1024 * 1024;

function guessContentType(nameOrId) {
  const s = String(nameOrId || '').toLowerCase();
  if (/\.png(\?|$)/.test(s) || /image\/png/.test(s)) return 'image/png';
  if (/\.gif(\?|$)/.test(s) || /image\/gif/.test(s)) return 'image/gif';
  if (/\.webp(\?|$)/.test(s)) return 'image/jpeg';
  return 'image/jpeg';
}

async function deleteTemp(fileID) {
  if (!fileID || !/^cloud:\/\//i.test(String(fileID))) return;
  try {
    await cloud.deleteFile({ fileList: [String(fileID)] });
  } catch (_) {}
}

function stepPing() {
  return {
    ok: true,
    action: 'ping',
    msg: 'imgSecCheck 云函数已响应',
    hasOpenapi: !!(cloud.openapi && cloud.openapi.security),
    time: Date.now(),
    version: '1.0.0'
  };
}

async function checkByFileID(event) {
  const fileID = String((event && event.fileID) || '').trim();
  if (!fileID || !/^cloud:\/\//i.test(fileID)) {
    return { ok: false, pass: false, errMsg: '缺少有效的图片 fileID' };
  }

  try {
    const dl = await cloud.downloadFile({ fileID: fileID });
    const buf = dl && dl.fileContent;
    if (!buf || !buf.length) {
      return { ok: false, pass: false, errMsg: '下载待审图片失败' };
    }
    if (buf.length > MAX_BYTES) {
      return {
        ok: false,
        pass: false,
        errMsg: '图片超过 1MB，请换一张或再压缩后重试'
      };
    }

    const contentType = guessContentType(
      (event && event.contentType) || fileID
    );
    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: contentType,
        value: buf
      }
    });

    const errCode = Number(
      res && (res.errCode != null ? res.errCode : res.errcode)
    );
    const code = Number.isFinite(errCode) ? errCode : 0;
    // 0 通过；87014 违规
    if (code === 87014) {
      return {
        ok: true,
        pass: false,
        risky: true,
        errCode: code,
        errMsg: '图片含违规内容，无法使用'
      };
    }
    if (code !== 0) {
      return {
        ok: false,
        pass: false,
        errCode: code,
        errMsg:
          String(
            (res && (res.errMsg || res.errmsg)) ||
              '图片审核失败，请稍后重试'
          ).slice(0, 120)
      };
    }
    return { ok: true, pass: true, risky: false, errCode: 0 };
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || e || '');
    const code = Number((e && (e.errCode != null ? e.errCode : e.errcode)) || 0);
    if (code === 87014 || /87014|risky|违法违规/i.test(msg)) {
      return {
        ok: true,
        pass: false,
        risky: true,
        errCode: 87014,
        errMsg: '图片含违规内容，无法使用'
      };
    }
    return {
      ok: false,
      pass: false,
      errMsg: msg.slice(0, 160) || '图片审核异常',
      errCode: code || undefined
    };
  } finally {
    if (!(event && event.keepFile)) {
      await deleteTemp(fileID);
    }
  }
}

exports.main = async (event) => {
  const ev = event && typeof event === 'object' ? event : {};
  const action = String(ev.action || 'check').trim();
  if (action === 'ping' || action === 'hello') {
    return stepPing();
  }
  return checkByFileID(ev);
};
