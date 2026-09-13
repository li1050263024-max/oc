const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COL = 'oc_stranger_templates';

/** 内置热梗种子（会定期由运营覆盖；客户端也会本地兜底） */
const SEED_COMMENTS = [
  '宝宝，你要我微信不',
  '扑面而来的萌味是怎么回事？',
  '刚开始以为是AI合成的，看了两遍，才发现是我ai上你了',
  '昨天做了个手术，把恋爱脑摘了，手术失败，现在我是无脑爱你',
  '一秒没回我了是和别人结婚了吗',
  '姐姐 你读这句话的时候属于我',
  '不要对我使用美人计 不然我会将计就计 (ʊ ⩊ ʊ)',
  '我眼睛本来长这样 OvO 后来看见你后就变成 ♡v♡',
  '代入感很强 无名指已经戴上戒指了',
  '不是我说白了，说绿了，说蓝了，宝宝你怎么这么好看',
  '真可恶啊，明明下载了国家反诈中心App，可还是被你骗走了心',
  '记住了吗除了我以外其他都是坏女人',
  '被我这种人缠上是不是很可爱？是不是很无奈？',
  '我是学生给我亲一口我求求你了',
  '整体来说还行，就是微信消息没有推过来，有点美中不足',
  '我在美国留学三年，在英国呆了五年，现在是发挥我英语水平的时候了，cpdd',
  '救命这个氛围',
  '这波属于合法诈骗',
  '已读乱回现场',
  '刷到就是缘分'
];

const SEED_REPLIES = [
  '懂的都懂',
  '你又来了哈哈',
  '被你发现了',
  '那当然啦',
  '嘿嘿谢谢',
  '对对对就是这个味',
  '你赢了',
  '行吧算你狠',
  '嗯嗯',
  '是吧'
];

function weekTag(ts) {
  const t = Number(ts) || Date.now();
  const d = new Date(t + 8 * 3600 * 1000);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

async function ensureSeed() {
  try {
    const res = await db.collection(COL).limit(1).get();
    if (res && res.data && res.data.length) return;
  } catch (e) {
    // 集合可能不存在
  }
  const now = Date.now();
  try {
    await db.collection(COL).add({
      data: {
        _id: 'default',
        comments: SEED_COMMENTS,
        replies: SEED_REPLIES,
        weekTag: weekTag(now),
        updatedAt: now,
        note: 'builtin-seed'
      }
    });
  } catch (_) {
    try {
      await db.collection(COL).doc('default').set({
        data: {
          comments: SEED_COMMENTS,
          replies: SEED_REPLIES,
          weekTag: weekTag(now),
          updatedAt: now,
          note: 'builtin-seed'
        }
      });
    } catch (_) {}
  }
}

async function listTemplates() {
  await ensureSeed();
  try {
    const got = await db.collection(COL).doc('default').get();
    const row = (got && got.data) || {};
    const comments = Array.isArray(row.comments) ? row.comments : SEED_COMMENTS;
    const replies = Array.isArray(row.replies) ? row.replies : SEED_REPLIES;
    return {
      ok: true,
      comments: comments.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80),
      replies: replies.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 40),
      weekTag: row.weekTag || weekTag(Date.now()),
      updatedAt: Number(row.updatedAt) || 0
    };
  } catch (e) {
    return {
      ok: true,
      comments: SEED_COMMENTS,
      replies: SEED_REPLIES,
      weekTag: weekTag(Date.now()),
      updatedAt: 0,
      fallback: true
    };
  }
}

async function upsertTemplates(event) {
  const comments = Array.isArray(event && event.comments)
    ? event.comments.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80)
    : null;
  const replies = Array.isArray(event && event.replies)
    ? event.replies.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 40)
    : null;
  if (!comments && !replies) {
    return { ok: false, errMsg: '缺少 comments / replies' };
  }
  const now = Date.now();
  const patch = {
    updatedAt: now,
    weekTag: weekTag(now),
    note: String((event && event.note) || '').slice(0, 120)
  };
  if (comments) patch.comments = comments;
  if (replies) patch.replies = replies;
  try {
    await db.collection(COL).doc('default').update({ data: patch });
  } catch (_) {
    await db.collection(COL).doc('default').set({
      data: Object.assign(
        {
          comments: comments || SEED_COMMENTS,
          replies: replies || SEED_REPLIES
        },
        patch
      )
    });
  }
  return { ok: true, updatedAt: now, weekTag: patch.weekTag };
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'list').trim();
  try {
    if (action === 'list' || action === 'get') return await listTemplates();
    if (action === 'upsert' || action === 'update') return await upsertTemplates(event);
    if (action === 'seed') {
      await ensureSeed();
      return await listTemplates();
    }
    return { ok: false, errMsg: '未知 action' };
  } catch (e) {
    return { ok: false, errMsg: String((e && e.message) || e) };
  }
};
