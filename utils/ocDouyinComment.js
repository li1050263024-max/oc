const { getOcsForSocial } = require('./ocSocialEligible.js');
const { listGroupRooms } = require('./groupChatStore.js');
const douyinStore = require('./ocDouyinStore.js');

const CLOUD_NAME = 'generateOcDouyinComment';
/** 非会员：首次打开评论区路人数 */
const STRANGER_COUNT_FREE = 5;
/** 会员：首次打开评论区路人数 */
const STRANGER_COUNT_VIP = 20;
/** 单条视频路人评论硬上限 */
const STRANGER_COUNT_MAX = 20;
/** 每次加购加载的路人数（已关闭加购，保留常量） */
const STRANGER_BATCH = 5;
const MAX_MATES_PER_CLIP = 8;

function isVipMember() {
  try {
    return !!require('./ocMembership.js').isMember();
  } catch (_) {
    return false;
  }
}

/** 按会员档返回本次应生成的路人数 */
function getFreeStrangerCount() {
  return Math.min(STRANGER_COUNT_MAX, Math.max(0, STRANGER_COUNT_FREE));
}

function getStrangerLoadInfo(clipId) {
  const current = douyinStore.countStrangerComments(clipId);
  const cap = getFreeStrangerCount();
  return {
    current: current,
    free: cap,
    max: cap,
    remain: 0,
    nextBatch: 0,
    canLoadMore: false,
    cost: 0,
    isVip: isVipMember()
  };
}

const FALLBACK_COMMENTS = [
  '哈哈哈有点意思',
  '这套好好看',
  '这也太真实了',
  '羡慕这种心情',
  '真的假的哈哈',
  '不错不错',
  '出图了啊',
  '好家伙'
];

const FALLBACK_STRANGERS = [
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
  '这氛围我直接收藏反复看',
  '评论区先替我表白一下可以吗',
  '你这样一出镜我算法直接锁死了',
  '不是颜值高，是情绪值也在线',
  '这镜头感也太会了吧',
  '我先码住，等下再来复读三遍',
  '有被这情绪击中，沉默了三秒',
  '路过被硬控，已原地毕业',
  '这文案我能脑补一整部短剧',
  '谁还没有被这开口脆到过',
  '我不是来评论的，我是来报到的',
  '请系统把同类内容多推一点谢谢',
  '这气质一出来我就老实了',
  '先点赞后观感，手比脑子快',
  '有点上头，建议限流给我一个人',
  '这状态我直接列入今日最佳',
  '评论区气氛组报道，已就位',
  '看完突然觉得今天也没那么难熬'
];

const FALLBACK_REPLIES = [
  '是吧哈哈',
  '对呀就是这样',
  '被你发现了',
  '嗯嗯懂的',
  '嘿嘿谢谢',
  '那当然啦',
  '你又来了',
  '行吧你赢'
];

const STRANGER_NAME_POOL = [
  '今天也想躺',
  '电子榨菜用户',
  '熬夜冠军本冠',
  '已读不回专业户',
  '干饭人一号',
  '赛博钉子户',
  '月亮邮差',
  '小透明ing',
  '不是很想上班',
  '柠檬精本精',
  '绝绝子收藏夹',
  '摸鱼办主任',
  'i人观察日记',
  '脆皮大学生',
  '显眼包本包',
  '已读乱回',
  'emo回收站',
  '深夜食堂常客',
  '打工人の夜',
  '退退退.jpg',
  '嘿嘿不讲武德',
  '云端路过',
  '吃瓜第一排',
  '键盘侠实习生',
  '路过的风',
  '不喝奶茶会死',
  '周末消失术',
  '在逃班味',
  '人间清醒ing',
  '社恐营业中'
];

function pickStrangerDisplayName() {
  const base = pickFallback(STRANGER_NAME_POOL);
  const styles = [
    () => base,
    () => base + '_' + (10 + Math.floor(Math.random() * 89)),
    () => base + Math.floor(Math.random() * 900 + 100),
    () => base + 'x' + Math.floor(Math.random() * 9 + 1),
    () => base + '.ovo',
    () => base + '233',
    () => '是' + base + '呀',
    () => base + '本' + (Math.random() > 0.5 ? '人' : '尊')
  ];
  const name = styles[Math.floor(Math.random() * styles.length)]();
  return String(name).slice(0, 18);
}

function findOcById(ocId) {
  if (!ocId) return null;
  const list = getOcsForSocial();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === ocId) return list[i];
  }
  return null;
}

function normalizeCommentContent(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
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

function pickFallback(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickStrangerLine(usedMap) {
  try {
    const templates = require('./ocStrangerTemplates.js');
    const cached = templates.getCachedLists();
    const line = templates.pickFrom(cached.comments, FALLBACK_STRANGERS, usedMap);
    if (line) return line;
  } catch (_) {}
  const unused = usedMap
    ? FALLBACK_STRANGERS.filter((x) => {
        try {
          return !require('./ocStrangerTemplates.js').isNearDupComment(x, usedMap);
        } catch (_) {
          return true;
        }
      })
    : FALLBACK_STRANGERS;
  const pool = unused.length ? unused : FALLBACK_STRANGERS;
  const line = pickFallback(pool);
  try {
    require('./ocStrangerTemplates.js').markUsedComment(line, usedMap);
  } catch (_) {}
  return line;
}

function pickReplyLine(usedMap) {
  try {
    const templates = require('./ocStrangerTemplates.js');
    const cached = templates.getCachedLists();
    const line = templates.pickFrom(cached.replies, FALLBACK_REPLIES, usedMap);
    if (line) return line;
  } catch (_) {}
  return pickFallback(FALLBACK_REPLIES);
}

function collectUsedStrangerContents(clipId) {
  const used = {};
  try {
    const templates = require('./ocStrangerTemplates.js');
    douyinStore.getComments(clipId).forEach((c) => {
      if (c && c.authorType === 'stranger' && c.content) {
        templates.markUsedComment(c.content, used);
      }
    });
  } catch (_) {}
  return used;
}

/** 路人内容去重：近重复则换本地模板 */
function uniquifyStrangerContent(content, usedMap) {
  let text = normalizeCommentContent(content);
  try {
    const templates = require('./ocStrangerTemplates.js');
    if (text && !templates.isNearDupComment(text, usedMap)) {
      templates.markUsedComment(text, usedMap);
      return text;
    }
  } catch (_) {
    if (text) return text;
  }
  return pickStrangerLine(usedMap);
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

function buildOcSpeakerPayload(oc, key, kind, extra) {
  const work = (oc && oc.work) || {};
  let chatSummary = '';
  try {
    const { buildSocialPlotContext } = require('./ocSocialContext.js');
    chatSummary = buildSocialPlotContext(oc).slice(0, 400);
  } catch (_) {}
  let setting = '';
  try {
    const { buildOcPromptFromWork } = require('./ocContext.js');
    setting = buildOcPromptFromWork(work).slice(0, 700);
  } catch (_) {
    setting = String((work && work.generatedBio) || '').slice(0, 700);
  }
  const base = {
    key: key,
    kind: kind,
    name: (oc && oc.name) || 'OC',
    setting: setting,
    bio: String((oc && oc.bioText) || (work && work.generatedBio) || '').slice(0, 300),
    chatSummary: chatSummary
  };
  if (extra && extra.replyToName) {
    base.replyToName = String(extra.replyToName).slice(0, 40);
  }
  return base;
}

function callDouyinCommentCloud(data) {
  return new Promise((resolve, reject) => {
    let callFn;
    try {
      const cloudInit = require('./cloudInit.js');
      if (!cloudInit.ensureCloudReady()) {
        reject(new Error('no cloud'));
        return;
      }
      callFn = cloudInit.callCloudFunction;
    } catch (_) {
      if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
        reject(new Error('no cloud'));
        return;
      }
      callFn = (opts) => wx.cloud.callFunction(opts);
    }
    callFn({
      name: CLOUD_NAME,
      data: data || {},
      timeout: 60000
    })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) {
          resolve(r);
          return;
        }
        reject(new Error(r.errMsg || '评论生成失败'));
      })
      .catch((err) => reject(err || new Error('云函数失败')));
  });
}

function buildSeedPlan(clip) {
  const isUserPost = !!(clip && (clip.isUserPost || clip.authorType === 'user'));
  const poster = isUserPost ? null : findOcById(clip && clip.ocId);
  const posterName = isUserPost
    ? String((clip && (clip.authorName || clip.displayName)) || '我')
    : (poster && poster.name) || (clip && clip.ocName) || 'OC';
  // 每个群友都评一条（人数过多时截断，避免一次 prompt 过大）
  const mateIds = isUserPost
    ? []
    : shuffle(findGroupMateIdsForOc(clip && clip.ocId)).slice(0, MAX_MATES_PER_CLIP);
  const mates = [];
  mateIds.forEach((mid) => {
    const oc = findOcById(mid);
    if (oc) mates.push(oc);
  });

  const strangers = [];
  const usedNames = {};
  const strangerCount = getFreeStrangerCount();
  for (let i = 0; i < strangerCount; i++) {
    let name = pickStrangerDisplayName();
    let guard = 0;
    while (usedNames[name] && guard < 12) {
      name = pickStrangerDisplayName();
      guard += 1;
    }
    usedNames[name] = true;
    strangers.push(name);
  }

  return { poster, posterName, mates, strangers, isUserPost: isUserPost };
}

function collectUsedStrangerNames(clipId) {
  const used = {};
  const list = douyinStore.getComments(clipId);
  list.forEach((c) => {
    if (c && c.authorType === 'stranger' && c.author) {
      used[String(c.author)] = true;
    }
  });
  return used;
}

/** 已关闭：不再支持加购路人评论（非会员 5 / 会员 20，打开时一次灌入） */
async function addMoreStrangersForClip(clipId) {
  return {
    ok: false,
    errMsg: '暂不支持加载更多路人',
    info: getStrangerLoadInfo(clipId)
  };
}

function applyLocalSeedFallback(clip) {
  const plan = buildSeedPlan(clip);
  const usedContents = {};
  const usedReplies = {};
  const rows = [];
  plan.strangers.forEach((name) => {
    rows.push({
      author: name,
      authorType: 'stranger',
      content: pickStrangerLine(usedContents)
    });
  });
  plan.mates.forEach((mate) => {
    rows.push({
      author: mate.name || 'OC',
      authorType: 'oc',
      ocId: mate.id || '',
      groupMate: true,
      content: pickFallback(FALLBACK_COMMENTS)
    });
    if (plan.poster) {
      rows.push({
        author: plan.poster.name || 'OC',
        authorType: 'oc',
        ocId: plan.poster.id || '',
        reply: true,
        replyToName: mate.name || '群友',
        replyToOcId: mate.id || '',
        content: pickReplyLine(usedReplies)
      });
    }
  });
  douyinStore.replaceComments(clip.id, rows);
  return rows.length;
}

/**
 * 首次打开评论：
 * - 路人：非会员 5 条 / 会员 20 条
 * - 每个群友一条
 * - 发帖 OC 逐条回复每个群友
 */
/** 会员打开已有评论时，把路人补到档位上限（不重建群友/回复） */
function topUpStrangersForClip(clip, need) {
  const n = Math.max(0, Math.floor(Number(need) || 0));
  if (!clip || !clip.id || n <= 0) return 0;
  const usedNames = collectUsedStrangerNames(clip.id);
  const usedContents = collectUsedStrangerContents(clip.id);
  const rows = [];
  for (let i = 0; i < n; i++) {
    let name = pickStrangerDisplayName();
    let guard = 0;
    while (usedNames[name] && guard < 12) {
      name = pickStrangerDisplayName();
      guard += 1;
    }
    usedNames[name] = true;
    rows.push({
      author: name,
      authorType: 'stranger',
      content: pickStrangerLine(usedContents)
    });
  }
  if (!rows.length) return 0;
  douyinStore.appendComments(clip.id, rows);
  return rows.length;
}

async function seedCommentsForClip(clip) {
  if (!clip || !clip.id) return 0;
  const isUserPost = !!(clip.isUserPost || clip.authorType === 'user');
  if (!isUserPost && !clip.ocId) return 0;
  const existing = douyinStore.getComments(clip.id);
  const target = getFreeStrangerCount();
  const strangerN = douyinStore.countStrangerComments(clip.id);

  // 已有评论：会员档若路人不足则补齐（本地模板，不重打整页 seed）
  if (existing.length) {
    if (strangerN >= target) return 0;
    try {
      await require('./ocStrangerTemplates.js').syncTemplates(false);
    } catch (_) {}
    return topUpStrangersForClip(clip, target - strangerN);
  }

  try {
    await require('./ocStrangerTemplates.js').syncTemplates(false);
  } catch (_) {}

  const plan = buildSeedPlan(clip);
  const speakers = [];
  const speakerMeta = {};

  plan.strangers.forEach((name, i) => {
    const key = 'stranger_' + i;
    speakers.push({ key: key, kind: 'stranger', name: name });
    speakerMeta[key] = { type: 'stranger', name: name };
  });

  plan.mates.forEach((mate, i) => {
    const mateKey = 'mate_' + i;
    speakers.push(buildOcSpeakerPayload(mate, mateKey, 'groupMate'));
    speakerMeta[mateKey] = { type: 'mate', oc: mate, groupMate: true };

    if (plan.poster) {
      const replyKey = 'reply_' + i;
      speakers.push(
        buildOcSpeakerPayload(plan.poster, replyKey, 'authorReply', {
          replyToName: mate.name || '群友'
        })
      );
      speakerMeta[replyKey] = {
        type: 'authorReply',
        oc: plan.poster,
        reply: true,
        replyToName: mate.name || '群友',
        replyToOcId: mate.id || ''
      };
    }
  });

  if (!speakers.length) {
    return applyLocalSeedFallback(clip);
  }

  try {
    const result = await callDouyinCommentCloud({
      mode: 'seed',
      postContent: clip.content || '',
      posterName: plan.posterName,
      speakers: speakers
    });
    const list = (result && result.comments) || [];
    const byKey = {};
    list.forEach((item) => {
      if (!item || !item.key) return;
      const content = normalizeCommentContent(item.content);
      if (content) byKey[item.key] = content;
    });

    const usedContents = {};
    const usedReplies = {};
    const rows = [];
    plan.strangers.forEach((name, i) => {
      const content = uniquifyStrangerContent(
        byKey['stranger_' + i] || '',
        usedContents
      );
      rows.push({
        author: name,
        authorType: 'stranger',
        content: content
      });
    });
    plan.mates.forEach((mate, i) => {
      const mateContent = byKey['mate_' + i] || pickFallback(FALLBACK_COMMENTS);
      rows.push({
        author: mate.name || 'OC',
        authorType: 'oc',
        ocId: mate.id || '',
        groupMate: true,
        content: mateContent
      });
      if (plan.poster) {
        let replyContent = normalizeCommentContent(byKey['reply_' + i] || '');
        if (!replyContent) replyContent = pickReplyLine(usedReplies);
        else {
          try {
            require('./ocStrangerTemplates.js').markUsedComment(replyContent, usedReplies);
          } catch (_) {}
        }
        rows.push({
          author: plan.poster.name || 'OC',
          authorType: 'oc',
          ocId: plan.poster.id || '',
          reply: true,
          replyToName: mate.name || '群友',
          replyToOcId: mate.id || '',
          content: replyContent
        });
      }
    });

    if (rows.length) {
      douyinStore.replaceComments(clip.id, rows);
      return rows.length;
    }
  } catch (e) {
    console.warn(
      '[ocDouyinComment] seed cloud fail',
      (e && e.errMsg) || (e && e.message) || e
    );
  }
  return applyLocalSeedFallback(clip);
}

async function ensureCommentsForClip(clipId) {
  const clip = douyinStore.findClipById(clipId);
  if (!clip) return [];
  await seedCommentsForClip(clip);
  return douyinStore.getComments(clipId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function handleUserCommentReply(clipId, userCommentText, userCommentId) {
  const clip = douyinStore.findClipById(clipId);
  if (!clip || !String(userCommentText || '').trim()) return null;
  const oc = findOcById(clip.ocId);
  if (!oc) {
    console.warn('[ocDouyinComment] reply: oc not found', clip.ocId);
    return null;
  }

  let plan = { skip: false, delayMs: 120, mode: 'instant' };
  let replyStyleHint = '';
  try {
    const replySettings = require('./ocMomentsReplySettings.js');
    const mode = replySettings.getReplyMode('douyin');
    plan = replySettings.planReplyTiming(mode);
    replyStyleHint = replySettings.getReplyPromptHint(plan.mode);
  } catch (_) {}

  // 严格按设置：随机模式才允许不回；秒回/不定时必回
  if (plan.skip && plan.mode === 'random') {
    return { skipped: true, mode: plan.mode };
  }
  if (plan.delayMs > 0) await sleep(plan.delayMs);

  const work = oc.work || {};
  let chatSummary = '';
  try {
    const { buildSocialPlotContext } = require('./ocSocialContext.js');
    chatSummary = buildSocialPlotContext(oc).slice(0, 800);
  } catch (_) {}
  let ocSetting = '';
  try {
    const { buildOcPromptFromWork } = require('./ocContext.js');
    ocSetting = buildOcPromptFromWork(work).slice(0, 1800);
  } catch (_) {
    ocSetting = String(work.generatedBio || '').slice(0, 1800);
  }

  const cloudPayload = {
    mode: 'reply',
    ocName: oc.name || 'OC',
    ocSetting: ocSetting,
    ocBio: String(oc.bioText || work.generatedBio || '').slice(0, 800),
    chatSummary: chatSummary,
    postContent: String(clip.content || '').slice(0, 400),
    userComment: String(userCommentText || '').slice(0, 200),
    replyMode: plan.mode,
    replyStyleHint: replyStyleHint
  };

  let text = '';
  try {
    // 秒回：云请求超过约 2.2s 先用本地短评顶上，避免「设了秒回却干等」
    if (plan.mode === 'instant') {
      const cloudP = callDouyinCommentCloud(cloudPayload)
        .then((result) => normalizeCommentContent(result && result.content))
        .catch(() => '');
      const raced = await Promise.race([
        cloudP.then((t) => ({ t: t })),
        sleep(2200).then(() => ({ t: '' }))
      ]);
      text = raced && raced.t ? raced.t : '';
    } else {
      const result = await callDouyinCommentCloud(cloudPayload);
      text = normalizeCommentContent(result && result.content);
    }
  } catch (e) {
    console.warn(
      '[ocDouyinComment] reply cloud fail',
      (e && e.errMsg) || (e && e.message) || e
    );
  }
  if (!text || text.length < 2) text = pickFallback(FALLBACK_REPLIES);
  return douyinStore.addOcComment(clipId, text, oc, {
    reply: true,
    replyToName: '我',
    replyToCommentId: userCommentId ? String(userCommentId) : ''
  });
}

module.exports = {
  ensureCommentsForClip,
  seedCommentsForClip,
  addMoreStrangersForClip,
  getStrangerLoadInfo,
  handleUserCommentReply,
  STRANGER_COUNT_FREE,
  STRANGER_COUNT_VIP,
  STRANGER_COUNT_MAX,
  STRANGER_BATCH,
  getFreeStrangerCount,
  CLOUD_NAME
};
