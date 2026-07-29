const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const content = String((event && event.content) || '').trim();
  const contact = String((event && event.contact) || '').trim();
  if (!content) {
    return { ok: false, err: '请填写反馈内容' };
  }
  if (content.length > 2000) {
    return { ok: false, err: '反馈内容过长' };
  }
  const wxContext = cloud.getWXContext();
  const doc = {
    content,
    contact: contact.slice(0, 120),
    openid: wxContext.OPENID || '',
    appid: wxContext.APPID || '',
    status: 'unread',
    reply: '',
    replyTimeMs: 0,
    readTimeMs: 0,
    createTime: db.serverDate(),
    createTimeMs: Date.now()
  };
  try {
    const res = await db.collection('feedback').add({ data: doc });
    return { ok: true, id: res._id };
  } catch (e) {
    const msg = String(e.message || e.errMsg || e);
    if (msg.indexOf('collection not exists') !== -1 || msg.indexOf('Db or Table not exist') !== -1) {
      return {
        ok: false,
        err: '请先在云开发控制台创建数据库集合 feedback（所有用户可读不可写，仅云函数可写）'
      };
    }
    return { ok: false, err: msg };
  }
};
