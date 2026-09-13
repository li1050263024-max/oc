const { buildOcPromptFromWork } = require('./ocContext.js');
const { getOcsForSocial } = require('./ocSocialEligible.js');
const { filterOcsUserHasChattedWith } = require('./ocChatHistory.js');
const { listGroupRooms } = require('./groupChatStore.js');
const momentsStore = require('./ocMomentsStore.js');

const FALLBACK_COMMENTS = [
  '哈哈哈有点意思',
  '看到了，记下了',
  '这也太真实了',
  '羡慕这种心情',
  '真的假的哈哈',
  '不错不错',
  '懂你意思',
  '好家伙'
];

const FALLBACK_REPLIES = [
  '是吧哈哈',
  '对呀就是这样',
  '被你发现了',
  '嗯嗯懂的',
  '嘿嘿',
  '那当然啦'
];

function findOcById(ocId) {
  if (!ocId) return null;
  const list = getOcsForSocial();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === ocId) return list[i];
  }
  return null;
}

function normalizeCommentContent(text) {
  return momentsStore.normalizeCommentContent(text);
}

function callMomentsCommentCloud(oc, mode, postContent, userComment, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('no cloud'));
      return;
    }
    const work = (oc && oc.work) || {};
    let chatSummary = '';
    try {
      const { buildSocialPlotContext } = require('./ocSocialContext.js');
      chatSummary = buildSocialPlotContext(oc).slice(0, 1200);
    } catch (_) {}
    wx.cloud.callFunction({
      name: 'generateOcMoments',
      data: {
        mode: mode === 'reply' ? 'reply' : 'comment',
        ocName: oc.name || 'OC',
        ocSetting: buildOcPromptFromWork(work).slice(0, 2800),
        ocBio: String(
          oc.bioText || (work && work.generatedBio) || ''
        ).slice(0, 1200),
        chatSummary: chatSummary,
        postContent: String(postContent || '').slice(0, 500),
        userComment: String(userComment || '').slice(0, 200),
        posterName: opts.posterName ? String(opts.posterName).slice(0, 40) : '',
        groupMate: !!opts.groupMate,
        replyMode: opts.replyMode ? String(opts.replyMode).slice(0, 20) : '',
        replyStyleHint: opts.replyStyleHint
          ? String(opts.replyStyleHint).slice(0, 240)
          : ''
      },
      timeout: 35000,
      success: (res) => {
        const r = (res && res.result) || {};
        if (r.ok && r.content) {
          resolve(normalizeCommentContent(r.content));
          return;
        }
        reject(new Error(r.errMsg || '评论生成失败'));
      },
      fail: (err) => reject(err || new Error('云函数失败'))
    });
  });
}

function pickFallback(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateOcCommentText(oc, post, userComment, mode, options) {
  try {
    const text = await callMomentsCommentCloud(
      oc,
      mode,
      post.content,
      userComment,
      options
    );
    if (text && text.length >= 2) return normalizeCommentContent(text).slice(0, 80);
  } catch (e) {
    console.warn('[ocMomentsComment]', oc.id, e);
  }
  return mode === 'reply'
    ? pickFallback(FALLBACK_REPLIES)
    : pickFallback(FALLBACK_COMMENTS);
}

async function commentAsOc(oc, post, options) {
  if (!oc || !post || !post.id) return false;
  const text = await generateOcCommentText(oc, post, '', 'comment', options);
  momentsStore.addOcPostComment(post.id, text, oc);
  return true;
}

async function replyAsOc(oc, post, userComment, options) {
  if (!oc || !post || !post.id) return false;
  const text = await generateOcCommentText(
    oc,
    post,
    userComment,
    'reply',
    options || {}
  );
  momentsStore.addOcPostComment(post.id, text, oc);
  return true;
}

function shuffle(arr) {
  const a = (arr || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function findGroupMateIdsForOc(ocId) {
  const id = String(ocId || '').trim();
  if (!id) return [];
  const rooms = listGroupRooms();
  const mateSet = {};
  rooms.forEach((room) => {
    const ids = room && room.memberIds;
    if (!Array.isArray(ids) || ids.indexOf(id) < 0) return;
    ids.forEach((mid) => {
      if (mid && mid !== id) mateSet[mid] = true;
    });
  });
  return Object.keys(mateSet);
}

function pickRandomGroupCommenters(mateIds) {
  const list = shuffle((mateIds || []).filter(Boolean));
  if (!list.length) return [];
  const count = Math.floor(Math.random() * (list.length + 1));
  return list.slice(0, count);
}

async function commentFromGroupMates(post) {
  if (!post || !post.ocId || post.authorType === 'user') return 0;
  const mateIds = findGroupMateIdsForOc(post.ocId);
  const picked = pickRandomGroupCommenters(mateIds);
  if (!picked.length) return 0;

  const posterName = post.ocName || '群友';
  for (let i = 0; i < picked.length; i++) {
    const oc = findOcById(picked[i]);
    if (!oc) continue;
    await commentAsOc(oc, post, { groupMate: true, posterName });
  }
  return picked.length;
}

async function commentFromGroupMatesForPosts(posts) {
  const list = posts || [];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += await commentFromGroupMates(list[i]);
  }
  return total;
}

/**
 * 被「提醒谁看」的 OC 必须评论；返回可用于消息通知的结果列表
 * @returns {Promise<Array<{ocId:string,ocName:string,avatarUrl:string,text:string,postId:string}>>}
 */
async function inviteOcsToComment(post, ocIds) {
  const ids = (ocIds || []).filter(Boolean).slice(0, 5);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const oc = findOcById(ids[i]);
    if (!oc) continue;
    const text = await generateOcCommentText(oc, post, '', 'comment', {
      posterName: '我',
      invited: true
    });
    if (!text) continue;
    momentsStore.addOcPostComment(post.id, text, oc);
    out.push({
      ocId: oc.id,
      ocName: oc.name || 'OC',
      avatarUrl: oc.avatarUrl || '',
      text: text,
      postId: post.id,
      skipped: false
    });
  }
  return out;
}

/**
 * 用户发帖后的自动评论：有「提醒谁看」则只/优先让被提醒 OC 回复；否则随机聊过的 OC
 * @returns {Promise<Array>}
 */
async function autoCommentOnUserPost(post) {
  if (!post || !post.id || post.authorType !== 'user') return [];
  const invited = Array.isArray(post.invitedOcIds)
    ? post.invitedOcIds.filter(Boolean).slice(0, 5)
    : [];
  if (invited.length) {
    return inviteOcsToComment(post, invited);
  }
  const chatted = filterOcsUserHasChattedWith(getOcsForSocial());
  if (!chatted.length) return [];
  const shuffled = shuffle(chatted);
  const maxN = Math.min(3, shuffled.length);
  const n = 1 + Math.floor(Math.random() * maxN);
  const picked = shuffled.slice(0, n);
  const out = [];
  for (let i = 0; i < picked.length; i++) {
    const oc = picked[i];
    const text = await generateOcCommentText(oc, post, '', 'comment', {});
    if (!text) continue;
    momentsStore.addOcPostComment(post.id, text, oc);
    out.push({
      ocId: oc.id,
      ocName: oc.name || 'OC',
      avatarUrl: oc.avatarUrl || '',
      text: text,
      postId: post.id,
      skipped: false
    });
  }
  return out;
}

function pickReplyOcForUserPost(post) {
  const comments = momentsStore.getCommentsForPost(post.id);
  const ocIds = [];
  comments.forEach((c) => {
    if (c && c.authorType === 'oc' && c.ocId && ocIds.indexOf(c.ocId) < 0) {
      ocIds.push(c.ocId);
    }
  });
  if (ocIds.length) {
    return findOcById(ocIds[ocIds.length - 1]);
  }
  const invited = Array.isArray(post.invitedOcIds) ? post.invitedOcIds : [];
  for (let i = 0; i < invited.length; i++) {
    const oc = findOcById(invited[i]);
    if (oc) return oc;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * 用户评论后由 OC 异步回复（不阻塞 UI）。
 * @returns {Promise<null|{ ocId: string, ocName: string, text: string, skipped?: boolean }>}
 */
async function handleUserCommentReply(postId, userCommentText) {
  const post = momentsStore.findPostById(postId);
  if (!post || !String(userCommentText || '').trim()) return null;

  let oc = null;
  if (post.authorType === 'user') {
    oc = pickReplyOcForUserPost(post);
  } else if (post.ocId) {
    oc = findOcById(post.ocId);
  }
  if (!oc) return null;

  let plan = { skip: false, delayMs: 400, mode: 'instant' };
  let replyStyleHint = '';
  try {
    const replySettings = require('./ocMomentsReplySettings.js');
    const mode = replySettings.getReplyMode('moments');
    plan = replySettings.planReplyTiming(mode);
    replyStyleHint = replySettings.getReplyPromptHint(plan.mode);
  } catch (_) {}
  if (plan.skip) {
    return { ocId: oc.id, ocName: oc.name || 'OC', text: '', skipped: true };
  }
  if (plan.delayMs > 0) await sleep(plan.delayMs);
  const text = await generateOcCommentText(oc, post, userCommentText, 'reply', {
    replyMode: plan.mode,
    replyStyleHint: replyStyleHint
  });
  if (!text) return null;
  momentsStore.addOcPostComment(post.id, text, oc);
  return {
    ocId: oc.id,
    ocName: oc.name || 'OC',
    avatarUrl: oc.avatarUrl || '',
    text: text,
    postId: post.id,
    skipped: false
  };
}

module.exports = {
  inviteOcsToComment,
  autoCommentOnUserPost,
  handleUserCommentReply,
  commentAsOc,
  replyAsOc,
  commentFromGroupMates,
  commentFromGroupMatesForPosts,
  findGroupMateIdsForOc,
  normalizeCommentContent
};
