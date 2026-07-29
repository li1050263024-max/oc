/**
 * 本地一键诊断 usage_daily（不依赖后台静态页是否已上传）
 * 用法：在项目 oc/oc 目录执行
 *   node scripts/diag-usage.js
 */
const https = require('https');

const API =
  process.env.OC_FEEDBACK_API ||
  'https://cloud1-d3gkbz2nf0c84c381-1433404171.ap-shanghai.app.tcloudbase.com/feedbackApi';
const KEY = process.env.OC_FEEDBACK_ADMIN_KEY || 'oc-feedback-admin-2026';

function post(action, extra) {
  const body = JSON.stringify(
    Object.assign({ action: action, adminKey: KEY }, extra || {})
  );
  const u = new URL(API);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Feedback-Admin-Key': KEY,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 20000
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(d), raw: d });
          } catch (e) {
            resolve({ status: res.statusCode, data: null, raw: d });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('API:', API);
  console.log('--- 1) 探测 diagUsage ---');
  const diag = await post('diagUsage');
  console.log('HTTP', diag.status);
  if (!diag.data) {
    console.log('非 JSON:', diag.raw.slice(0, 400));
    process.exit(1);
  }
  if (!diag.data.ok && /未知 action/i.test(String(diag.data.err || ''))) {
    console.log('❌ 云端 feedbackApi 仍是旧版，不支持 diagUsage');
    console.log('   请右键 cloudfunctions/feedbackApi → 上传并部署：云端安装依赖');
    console.log('   返回:', JSON.stringify(diag.data));
    process.exit(2);
  }
  if (diag.data.apiVer && String(diag.data.apiVer).indexOf('diag-v3') < 0) {
    console.log('⚠️ 云端还不是 diag-v3（当前 ' + diag.data.apiVer + '）');
    console.log('   请确认：开发者工具打开的是 oc/oc 目录，并「上传并部署：云端安装依赖」feedbackApi');
  }
  console.log(JSON.stringify(diag.data, null, 2));

  console.log('\n--- 2) 再拉 usageSummary ---');
  const sum = await post('usageSummary', { days: 3 });
  console.log(JSON.stringify(sum.data, null, 2));

  console.log('\n--- 3) redeemLogs 抽样 ---');
  const logs = await post('redeemLogs', { limit: 1 });
  const row = logs.data && logs.data.list && logs.data.list[0];
  if (row) {
    console.log({
      code: row.code,
      openid: row.openid,
      已用额度: row.quotaUsed,
      剩余额度: row.quotaLeft,
      累计兑入: row.redeemedTotal,
      本周免费: (row.freeUsed || 0) + '/' + (row.freeAllowed || 0),
      createTimeMs: row.createTimeMs,
      apiVer: logs.data.apiVer
    });
  } else {
    console.log(logs.data);
  }

  console.log('\n判定建议:');
  if (diag.data.writeOk && diag.data.readBack) {
    console.log('✅ 写入 OK。若后台仍空：上传 feedback-admin 或强刷缓存后再点「加载日汇总」。');
  } else {
    console.log('❌ 写入失败，把上面 steps 红字发给开发者。');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
