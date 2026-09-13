const douyinStore = require('../../../utils/ocDouyinStore.js');
const { getOcsForSocial } = require('../../../utils/ocSocialEligible.js');
const chatAvatar = require('../../../utils/chatAvatar.js');
const ocAlbum = require('../../../utils/ocAlbum.js');
const membership = require('../../../utils/ocMembership.js');

function genderPronoun(gender) {
  const g = String(gender || '');
  if (/女|雌|娘|妹|姐/.test(g)) return '她';
  if (/男|雄|哥|弟|爷/.test(g)) return '他';
  return 'TA';
}

function genderAgeLabel(oc) {
  if (!oc) return '';
  const gender = String(oc.gender || '').trim();
  const age = String(oc.age || '').trim();
  const gShort = /女|雌|娘/.test(gender)
    ? '女'
    : /男|雄/.test(gender)
      ? '男'
      : gender && gender !== '—'
        ? gender
        : '';
  const ageNum = age && age !== '—' ? age.replace(/岁/g, '') + '岁' : '';
  if (gShort && ageNum) return gShort + ' · ' + ageNum;
  return gShort || ageNum || '';
}

function shortBio(oc) {
  const raw = String((oc && oc.bioText) || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > 36 ? raw.slice(0, 36) + '…' : raw;
}

Page({
  data: {
    ocId: '',
    ocName: '',
    avatarUrl: '',
    avatarLetter: 'O',
    coverUrl: '',
    douyinId: '',
    ipRegion: '',
    bioText: '',
    genderAgeText: '',
    pronoun: 'TA',
    likeTotalText: '0',
    followingText: '0',
    fansText: '0',
    followed: false,
    followsYou: false,
    mutual: false,
    worksCount: 0,
    works: [],
    isVip: false,
    menuTop: 48,
    menuHeight: 32,
    loading: true,
    empty: false
  },

  onLoad(options) {
    this._alive = true;
    const ocId = options && options.id ? decodeURIComponent(options.id) : '';
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : null;
      if (menu && menu.height) {
        this.setData({ menuTop: menu.top, menuHeight: menu.height });
      } else {
        this.setData({
          menuTop: (Number(sys.statusBarHeight) || 20) + 4,
          menuHeight: 32
        });
      }
    } catch (_) {}
    this.setData({ ocId: ocId });
    this.loadProfile();
  },

  onShow() {
    if (this.data.ocId) this.loadProfile();
  },

  onUnload() {
    this._alive = false;
  },

  _applyRelation(card) {
    const c = card || {};
    return {
      followed: !!c.followed,
      followsYou: !!c.followsYou,
      mutual: !!(c.followed && c.followsYou)
    };
  },

  async loadProfile() {
    const ocId = this.data.ocId;
    if (!ocId) {
      this.setData({ loading: false, empty: true });
      return;
    }
    const ocs = getOcsForSocial();
    const oc = ocs.find((x) => x && String(x.id) === String(ocId)) || null;
    const card = douyinStore.getOcProfileCard(ocId, oc);
    let clips = douyinStore.getClipsByOcId(ocId);
    clips = (clips || []).map((c) => douyinStore.ensureClipEngagement(c));

    const ocName = (oc && oc.name) || (clips[0] && clips[0].ocName) || 'OC';
    let avatarUrl = (oc && oc.avatarUrl) || (clips[0] && clips[0].avatarUrl) || '';
    try {
      const resolved = await chatAvatar.resolveOcAvatar(ocId, avatarUrl);
      if (resolved) avatarUrl = resolved;
    } catch (_) {}

    let coverUrl = '';
    if (oc && oc.work) {
      try {
        const albums = ocAlbum.normalizeOcAlbums(oc.work);
        const flat = ocAlbum.flattenAlbumImages(albums);
        coverUrl = (flat[0] && flat[0].path) || '';
      } catch (_) {}
    }
    if (!coverUrl && clips[0]) {
      const imgs = clips[0].images || [];
      coverUrl = (imgs[0] && imgs[0].path) || clips[0].imagePath || avatarUrl;
    }
    if (!coverUrl) coverUrl = avatarUrl;

    const likeTotal = clips.reduce(
      (sum, c) => sum + douyinStore.getLikeCount(c.id),
      0
    );
    const isVip = !!membership.isMember();
    const works = clips.map((c) => {
      const imgs = Array.isArray(c.images) ? c.images : [];
      const cover = (imgs[0] && imgs[0].path) || c.imagePath || '';
      const likes = douyinStore.getLikeCount(c.id);
      const unlocked = douyinStore.isClipUnlocked(c.id);
      return {
        id: c.id,
        cover: cover,
        likeText: douyinStore.formatCount(likes),
        multi: imgs.length > 1,
        locked: !unlocked
      };
    });

    if (!this._alive) return;
    this.setData(
      Object.assign(
        {
          loading: false,
          empty: !oc && !clips.length,
          ocName: ocName,
          avatarUrl: avatarUrl,
          avatarLetter: String(ocName || 'O').slice(0, 1),
          coverUrl: coverUrl,
          douyinId: card.douyinId,
          ipRegion: card.ipRegion,
          bioText: shortBio(oc),
          genderAgeText: genderAgeLabel(oc),
          pronoun: genderPronoun(oc && oc.gender),
          likeTotalText: douyinStore.formatCount(likeTotal),
          followingText: douyinStore.formatCount(card.following),
          fansText: douyinStore.formatCount(card.fans),
          worksCount: works.length,
          works: works,
          isVip: isVip
        },
        this._applyRelation(card)
      )
    );
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  onTapFollow() {
    const card = douyinStore.setOcFollow(this.data.ocId, true);
    this.setData(this._applyRelation(card));
    wx.showToast({
      title: card.mutual ? '已互关，成为朋友' : '已关注',
      icon: 'none'
    });
  },

  onTapRelation() {
    wx.showActionSheet({
      itemList: ['取消关注'],
      success: (res) => {
        if (res.tapIndex !== 0) return;
        const card = douyinStore.setOcFollow(this.data.ocId, false);
        this.setData(this._applyRelation(card));
        wx.showToast({ title: '已取消关注', icon: 'none' });
      }
    });
  },

  onTapMessage() {
    const ocId = this.data.ocId;
    if (!ocId) {
      wx.showToast({ title: '无法打开聊天', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/ocChat/ocChat?ocId=' + encodeURIComponent(ocId),
      fail() {
        wx.showToast({ title: '无法打开聊天', icon: 'none' });
      }
    });
  },

  onTapWork(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const clipId = ds.id;
    if (!clipId) return;
    if (ds.locked === true || ds.locked === 'true' || !douyinStore.isClipUnlocked(clipId)) {
      wx.showToast({ title: '开通会员可回看更早作品', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/ocApp/ocDouyin/ocDouyin?clipId=' + encodeURIComponent(clipId),
      fail() {
        wx.showToast({ title: '无法打开作品', icon: 'none' });
      }
    });
  }
});
