const { buildTodayMomentTimestamps } = require('./ocMomentsStore.js');
const { newPostId } = require('./ocMomentsStore.js');
const { personalityBlend, quirkBlend } = require('./ocResult.js');
const { findUniqueFromPool, claimContent } = require('./ocSocialDedupe.js');

function pickOne(list) {
  if (!list || !list.length) return '';
  return list[Math.floor(Math.random() * list.length)];
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

function _lastUserLine(plotContext) {
  const text = String(plotContext || '');
  const lines = text.split('\n').filter((l) => l.indexOf('用户：') === 0);
  if (!lines.length) return '';
  return lines[lines.length - 1].replace(/^用户：/, '').trim().slice(0, 40);
}

function _bioHook(oc) {
  const bio = String(oc.bioText || (oc.work && oc.work.generatedBio) || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!bio) return '';
  const first = bio.split(/[。！？\n]/).filter(Boolean)[0] || bio;
  return first.slice(0, 28);
}

function _characterPools(oc, plotContext) {
  const name = oc.name || 'TA';
  const work = oc.work || {};
  const r = work.result || {};
  const cp = (work.catchphrases || []).filter(Boolean);
  const attitudes = (work.attitudes || []).filter((a) => a && a.attitude);
  const bioHook = _bioHook(oc);
  const userTail = _lastUserLine(plotContext);
  const personality = personalityBlend(r);
  const quirk = quirkBlend(r);
  const bg = (work.background && work.background.lifeEvents) || [];
  const events = bg.filter(Boolean);

  const chatPool = [];
  if (userTail) {
    chatPool.push('你刚才说的「' + userTail + '」我这边还在想。');
    chatPool.push('关于「' + userTail + '」……我有话想说。');
    chatPool.push('「' + userTail + '」这事，我琢磨了一下。');
  }
  if (cp.length) chatPool.push(pickOne(cp));
  if (attitudes.length) {
    const a = pickOne(attitudes);
    chatPool.push('想到' + (a.event || '那件事') + '，我还是' + (a.attitude || '放不下').slice(0, 20) + '。');
  }
  if (bioHook) {
    chatPool.push('突然想到' + bioHook + '……算了，你在吗？');
    chatPool.push('刚才又想起' + bioHook.slice(0, 18) + '，有点出神。');
  }
  if (personality) {
    chatPool.push('（' + personality.slice(0, 12) + '）有空回我一下。');
    chatPool.push('今天状态有点' + personality.slice(0, 10) + '，找你说两句。');
  }
  if (quirk) chatPool.push('……' + quirk.slice(0, 16) + '，先不说了，找你有事。');

  chatPool.push(
    '在吗？',
    name + '：刚忙完一阵，想跟你说两句。',
    name + '：这会儿空下来了。',
    '刚看到个东西，想分享给你。',
    '有点话想当面说，先打字吧。'
  );

  const momentPool = [];
  if (events.length) {
    const ev = String(pickOne(events)).slice(0, 14);
    momentPool.push(
      '翻相册时撞见一张旧票根，背面日期旁几个模糊的字，我盯了两秒就划走了。',
      '电台里随机播的歌，副歌部分莫名像' + ev.slice(0, 8) + '那阵子常听的。',
      '洗碗洗到一半，突然想起' + ev.slice(0, 10) + '——跟现在这天气居然有点像。'
    );
  }
  if (bioHook) {
    momentPool.push(
      '把' + bioHook.slice(0, 8) + '写进备忘录又删了，最后只留下一句「算了」。',
      '窗台上落了层灰，擦的时候想起小传里那句「' + bioHook.slice(0, 12) + '」。',
      '做梦梦到一个场景，醒来只记得和「' + bioHook.slice(0, 10) + '」有关。'
    );
  }
  if (cp.length) {
    const line = String(pickOne(cp)).slice(0, 16);
    momentPool.push(
      '把「' + line + '」写在本子边上了，笔迹丑，但看着还挺像我会说的。',
      '排队时脑子里循环「' + line + '」，前面的人回头看了我一眼。'
    );
  }
  if (personality) {
    const p = personality.slice(0, 10);
    momentPool.push(
      '同事说我今天看起来特别' + p + '，我说是吗，其实只是因为袜子穿反了。',
      '又是' + p + '的一天，连外卖都点晚了，骑手到的时候我已经饿过劲了。'
    );
  }
  if (quirk) {
    const q = quirk.slice(0, 12);
    momentPool.push(
      '明知道会' + q + '，还是把票根折成了小方块，揣兜里现在硌得慌。',
      '老毛病：' + q + '，今天因此把钥匙锁屋里了，在楼道坐了十分钟。'
    );
  }
  if (userTail) {
    momentPool.push(
      '看到一条动态，措辞有点像之前说的「' + userTail.slice(0, 10) + '」。',
      '路过公告栏，字排布莫名让我想起「' + userTail.slice(0, 12) + '」那茬。'
    );
  }

  momentPool.push(
    name + '：伞骨断了一根还硬撑回家，鞋袜全湿，进门先换歌单。',
    '冰箱里的酸奶过期了，闻了一下，没扔，又放回去了，别学我。',
    '地铁里有人背着和我同款包，我盯了背影三站路，下车才想起包里还有苹果。',
    '把头发剪短了，镜子里的自己愣了两秒，刘海还是翘，算了。',
    '快递盒比想象中小，拆完一地泡沫，坐泡沫堆里喝了口水。',
    '路灯闪了一下，整条巷子暗了半拍，脚步没停，心跳漏了一拍。',
    '楼下猫又在花坛边蹲着，今天它没理我，我也没理它。',
    '耳机没电了，走回家的路上只能听自己的脚步声，还挺响。'
  );

  return { chatPool, momentPool: shuffle(momentPool), name };
}

function fallbackMomentPosts(oc, count, beforeTime, plotContext) {
  const { momentPool } = _characterPools(oc, plotContext);
  const n = Math.max(1, Math.min(2, count || 1));
  const stamps = buildTodayMomentTimestamps(n, beforeTime || Date.now());
  const out = [];
  const localPool = momentPool.slice();
  for (let i = 0; i < n; i++) {
    const content = findUniqueFromPool(localPool);
    if (!content) break;
    if (!claimContent(content)) continue;
    out.push({
      id: newPostId(),
      ocId: oc.id,
      ocName: oc.name,
      avatarUrl: oc.avatarUrl || '',
      content,
      createdAt: stamps[i] || beforeTime,
      source: 'fallback'
    });
  }
  return out;
}

function fallbackChatMessages(oc, count, beforeTime, plotContext) {
  const { buildFakeTimestamps } = require('./ocMomentsStore.js');
  const { chatPool } = _characterPools(oc, plotContext);
  const n = Math.max(1, Math.min(3, count || 1));
  const stamps = buildFakeTimestamps(n, beforeTime, beforeTime - 2 * 3600000);
  const out = [];
  const localPool = chatPool.slice();
  for (let i = 0; i < n; i++) {
    const content = findUniqueFromPool(localPool);
    if (!content) break;
    out.push({
      role: 'assistant',
      content,
      ocId: oc.id,
      fakeAt: stamps[i],
      _fakeSocial: true
    });
  }
  return out;
}

function fallbackGroupMessage(member, beforeTime, plotContext) {
  const { chatPool, name } = _characterPools(member, plotContext);
  const pool = chatPool.length
    ? chatPool
    : [(name || 'TA') + '：群里有活人吗？', (name || 'TA') + '：冒个泡。'];
  const content = findUniqueFromPool(pool) || pickOne(pool);
  if (!content) return null;
  return {
    role: 'assistant',
    content,
    name: member.name,
    ocId: member.id,
    fakeAt: beforeTime - 60000 - Math.floor(Math.random() * 120000),
    _fakeSocial: true
  };
}

module.exports = {
  fallbackMomentPosts,
  fallbackChatMessages,
  fallbackGroupMessage,
  _characterPools
};
