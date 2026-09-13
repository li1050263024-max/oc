/**
 * 按 OC 世界观 / 身世 / 小传推断抖音「IP」展示地
 * 可以是现实地名，也可以是设定内地名，禁止与人设冲突的乱抽省份
 */

const LORE_RULES = [
  { re: /哈利.?波特|霍格沃茨|魔法部|格兰芬多|斯莱特林|赫奇帕奇|拉文克劳|对角巷|麻瓜/, ip: '英国' },
  { re: /钢铁侠|斯塔克|复仇者|漫威|美国队长|纽约.*英雄|皇后区/, ip: '美国' },
  { re: /蝙蝠侠|哥谭|小丑|阿卡姆/, ip: '哥谭' },
  { re: /超人|大都会/, ip: '大都会' },
  { re: /火影|木叶|忍界|宇智波|漩涡鸣人/, ip: '木叶' },
  { re: /海贼王|伟大航路|东海.*海贼|草帽/, ip: '东海' },
  { re: /死神|尸魂界|浦原|黑崎/, ip: '尸魂界' },
  { re: /进击的巨人|帕拉迪岛|墙内/, ip: '帕拉迪岛' },
  { re: /原神|提瓦特|蒙德/, ip: '蒙德' },
  { re: /璃月/, ip: '璃月' },
  { re: /稻妻/, ip: '稻妻' },
  { re: /须弥/, ip: '须弥' },
  { re: /枫丹/, ip: '枫丹' },
  { re: /纳塔|至冬/, ip: '提瓦特' },
  { re: /崩坏|星穹铁道|列车/, ip: '星穹列车' },
  { re: /赛博朋克|夜之城|赛博/, ip: '夜之城' },
  { re: /巫师3|杰洛特|利维亚/, ip: '辛特拉' },
  { re: /指环王|中土|霍比特|刚铎|魔戒/, ip: '中土' },
  { re: /星球大战|绝地|西斯|外环/, ip: '外环星域' },
  { re: /星际迷航|联邦星舰/, ip: '联邦' },
  { re: /三体|地球文明|智子/, ip: '地球' },
  { re: /西游|天庭|花果山|灵山/, ip: '东胜神洲' },
  { re: /封神|朝歌/, ip: '朝歌' },
  { re: /武侠|江湖|中原.*武林|武林/, ip: '中原' },
  { re: /修仙|仙侠|玄幻|宗门|灵根|飞升|修真/, ip: '修仙界' },
  { re: /异世界|穿越|转生|魔王|勇者|剑与魔法/, ip: '异世界' },
  { re: /和风|江户|武士|京都|平成|昭和|日本/, ip: '日本' },
  { re: /韩|首尔|朝鲜半岛/, ip: '韩国' },
  { re: /伦敦|英格兰|苏格兰|英国|英伦/, ip: '英国' },
  { re: /巴黎|法兰西|法国/, ip: '法国' },
  { re: /柏林|德国/, ip: '德国' },
  { re: /莫斯科|俄罗斯|苏联/, ip: '俄罗斯' },
  { re: /洛杉矶|加州|美利坚|美国|华盛顿|芝加哥/, ip: '美国' },
  { re: /香港/, ip: '香港' },
  { re: /台湾|台北/, ip: '台湾' },
  { re: /澳门/, ip: '澳门' },
  { re: /古代中国|大唐|大明|大清|宋朝|汉朝|穿越.*朝/, ip: '中原' },
  { re: /民国|十里洋场|上海滩/, ip: '上海' },
  { re: /末日|废土|避难所/, ip: '废土' },
  { re: /校园|高中|大学.*都市|现代都市|一线城市/, ip: '' } // 交给后文抽取/现代兜底
];

const CN_PROVINCES = [
  '北京',
  '上海',
  '广东',
  '浙江',
  '江苏',
  '四川',
  '湖北',
  '湖南',
  '河南',
  '山东',
  '福建',
  '陕西',
  '云南',
  '重庆',
  '天津',
  '河北',
  '辽宁',
  '安徽',
  '江西',
  '广西',
  '贵州',
  '山西',
  '吉林',
  '黑龙江',
  '海南',
  '甘肃',
  '青海',
  '宁夏',
  '新疆',
  '西藏',
  '内蒙古'
];

function collectLoreText(oc) {
  if (!oc) return '';
  const work = oc.work || {};
  const bg = work.background || {};
  const parts = [
    oc.name,
    oc.race,
    oc.bioText,
    work.generatedBio,
    bg.worldview,
    Array.isArray(bg.origins) ? bg.origins.join(' ') : bg.origins,
    Array.isArray(bg.lifeEvents) ? bg.lifeEvents.join(' ') : bg.lifeEvents,
    work.result && work.result.race,
    work.result && work.result.name
  ];
  return parts
    .filter(Boolean)
    .map((x) => String(x))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlaceToken(text) {
  const t = String(text || '');
  if (!t) return '';
  const patterns = [
    /(?:出生于|生于|居于|住在|来自|位于|现身于|活动于|定居)([\u4e00-\u9fffA-Za-z]{2,12})/,
    /([\u4e00-\u9fff]{2,10}(?:大陆|王国|帝国|公国|星域|星系|星球|星|城邦|城|镇|村|岛|国|省|市|郡|州|界|域|区))/,
    /([A-Za-z][A-Za-z\s-]{1,20}(?:City|Kingdom|Empire|Realm|Island))/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = t.match(patterns[i]);
    if (!m) continue;
    let place = String(m[1] || '')
      .replace(/[，。；、\s]+$/g, '')
      .trim();
    // 去掉常见尾巴噪声
    place = place.replace(/(的一员|一带|附近|人)$/g, '');
    if (place.length >= 2 && place.length <= 12) return place.slice(0, 12);
  }
  // 直接命中省份名
  for (let i = 0; i < CN_PROVINCES.length; i++) {
    if (t.indexOf(CN_PROVINCES[i]) >= 0) return CN_PROVINCES[i];
  }
  return '';
}

function isModernMundane(text) {
  const t = String(text || '');
  if (/修仙|仙侠|玄幻|异世界|魔法|魔法世界|忍界|海贼|星际|赛博|中土|提瓦特|霍格沃茨/.test(t)) {
    return false;
  }
  return /现代|都市|校园|现实|当代|一线|互联网|短视频|公司|上班/.test(t) || !t;
}

function hashPick(seed, list) {
  const arr = list || [];
  if (!arr.length) return '';
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/**
 * @param {object} oc getOcsForSocial 条目或含 work/bio 的对象
 * @returns {string} 短地名，如「英国」「木叶」「璃月」
 */
function resolveIpFromOc(oc) {
  const lore = collectLoreText(oc);
  if (!lore) return '';

  for (let i = 0; i < LORE_RULES.length; i++) {
    const rule = LORE_RULES[i];
    if (rule.re.test(lore) && rule.ip) return rule.ip;
  }

  const extracted = extractPlaceToken(lore);
  if (extracted) return extracted;

  if (isModernMundane(lore)) {
    return hashPick((oc && oc.id) || lore, CN_PROVINCES) || '未知';
  }

  // 非现代设定又抽不到具体地名：用世界观关键词作 IP，绝不乱填现实省份
  if (/修仙|仙侠|玄幻|修真/.test(lore)) return '修仙界';
  if (/魔法|巫师|魔导/.test(lore)) return '魔法界';
  if (/机甲|未来|太空|星际/.test(lore)) return '星港';
  if (/江湖|武侠/.test(lore)) return '江湖';
  if (/异世界|穿越/.test(lore)) return '异世界';

  const wv = String((oc.work && oc.work.background && oc.work.background.worldview) || '').trim();
  if (wv) {
    const short = wv.replace(/[，。；\s].*$/, '').slice(0, 8);
    if (short.length >= 2) return short;
  }
  return '未知之地';
}

function isGenericChinaIp(ip) {
  return CN_PROVINCES.indexOf(String(ip || '')) >= 0;
}

module.exports = {
  resolveIpFromOc,
  isGenericChinaIp,
  collectLoreText
};
