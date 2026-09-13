/**
 * 极简探测：与其它云函数同样依赖 wx-server-sdk，只做立即返回。
 * 部署：右键 → 上传并部署：云端安装依赖（等进度条走完再测）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: 'cloud1-d3gkbz2nf0c84c381' });

exports.main = async (event) => {
  const ev = event && typeof event === 'object' ? event : {};
  return {
    ok: true,
    name: 'extractVideoHello',
    action: String(ev.action || 'hello'),
    msg: '极简云函数有返回',
    time: Date.now(),
    node: process.version,
    openid: (cloud.getWXContext && cloud.getWXContext().OPENID) || ''
  };
};
