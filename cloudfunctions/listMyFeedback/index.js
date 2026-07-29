const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  if (!openid) {
    return { ok: false, err: '无法识别用户' };
  }
  try {
    const res = await db
      .collection('feedback')
      .where({ openid })
      .limit(50)
      .get();
    const list = (res.data || [])
      .slice()
      .sort((a, b) => (b.createTimeMs || 0) - (a.createTimeMs || 0));
    return { ok: true, list };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
};
