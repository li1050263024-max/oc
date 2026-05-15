const gacha = require('../../utils/gacha.js');
const colors = require('../../utils/colors.js');
const defaultPools = require('../../data/pools.js');
const background = require('../../utils/background.js');
const mindmap = require('../../utils/mindmap.js');
const { isLayer3Ready } = require('../../utils/ocWork.js');

const STORAGE_FAVORITES = 'oc_favorites';
const STORAGE_CUSTOM_POOLS = 'oc_custom_pools';
const STORAGE_OC_WORK = 'oc_work_in_progress';

Page({
  data: {
    step: 0,
    result: null,
    hairHex: '#4a4a4a',
    eyeHex: '#37474f',
    cardAnimate: false,
    cardFlipped: false,
    saved: false,
    contentScrollTop: 0,
    locked: {
      name: false,
      race: false,
      hairColor: false,
      eyeColor: false,
      personality: false,
      quirk: false
    },
    // 第二层：背景故事
    background: null,
    lockedBackground: { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false },
    layer2Done: false,
    // 第三层：常用语与态度
    catchphrases: [],
    attitudes: [],
    layer3Done: false
  },

  onLoad() {
    const d = this.data;
    if (d.result == null && (d.step === undefined || d.step > 0)) {
      this.setData({ step: 0, result: null });
    }
  },

  onShow() {
    this.syncWorkToStorage();
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const merge = {};
    if (!work.result) {
      return;
    }
    if (work.background) {
      merge.background = work.background;
      merge.layer2Done = true;
    }
    if (work.catchphrases && work.catchphrases.length) {
      merge.catchphrases = work.catchphrases;
      merge.attitudes = work.attitudes || [];
      merge.layer3Done = !!work.layer3Done;
    }
    this.setData(merge);
  },

  onNavHomeScroll() {
    this.setData({ contentScrollTop: 1 });
    wx.nextTick(() => {
      this.setData({ contentScrollTop: 0 });
    });
  },

  /** 获取当前选项池（自定义优先，否则默认） */
  getPools() {
    const custom = wx.getStorageSync(STORAGE_CUSTOM_POOLS);
    if (custom && Array.isArray(custom.names)) return custom;
    return defaultPools;
  },

  /** 将当前抽卡进度写入进行中存档（供设定本 / 对话 / 小传使用） */
  syncWorkToStorage() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (this.data.result) {
      work.result = { ...this.data.result };
      work.step = this.data.step;
      work.locked = { ...this.data.locked };
      work.hairHex = this.data.hairHex;
      work.eyeHex = this.data.eyeHex;
    }
    if (this.data.background) work.background = { ...this.data.background };
    if (this.data.catchphrases && this.data.catchphrases.length) {
      work.catchphrases = this.data.catchphrases.slice();
      work.attitudes = (this.data.attitudes || []).map((a) => ({ ...a }));
    }
    if (work.result) {
      work.layer3Done = isLayer3Ready(work);
    }
    wx.setStorageSync(STORAGE_OC_WORK, work);
  },

  /** 开始抽卡（第一步）：一次抽齐 6 项，从姓名开始逐项展示 */
  onStartDraw() {
    const pools = this.getPools();
    const result = gacha.draw(pools);
    const hairHex = colors.getHairColor(result.hairColor);
    const eyeHex = colors.getEyeColor(result.eyeColor);
    this.setData({
      result,
      step: 1,
      hairHex,
      eyeHex,
      saved: false,
      cardAnimate: false,
      locked: { name: false, race: false, hairColor: false, eyeColor: false, personality: false, quirk: false }
    }, () => {
      setTimeout(() => this.setData({ cardAnimate: true }), 50);
      setTimeout(() => this.setData({ cardFlipped: true }), 150);
    });
  },

  /** 下一项（步进到下一维度的展示） */
  onNextStep() {
    const step = this.data.step;
    if (step >= 6) return;
    this.setData({
      step: step + 1,
      cardAnimate: false
    }, () => {
      setTimeout(() => this.setData({ cardAnimate: true }), 50);
    });
  },

  /** 再抽一次：回到初始 */
  onDrawAgain() {
    wx.removeStorageSync(STORAGE_OC_WORK);
    this.setData({
      step: 0,
      result: null,
      saved: false,
      cardFlipped: false,
      locked: { name: false, race: false, hairColor: false, eyeColor: false, personality: false, quirk: false },
      background: null,
      lockedBackground: { worldview: false, lifeEvent0: false, lifeEvent1: false, lifeEvent2: false },
      layer2Done: false,
      catchphrases: [],
      attitudes: [],
      layer3Done: false
    });
  },

  /** 跳转背景故事页（第二层） */
  onGoBackground() {
    const work = {
      result: this.data.result,
      step: this.data.step,
      locked: this.data.locked,
      hairHex: this.data.hairHex,
      eyeHex: this.data.eyeHex,
      background: this.data.background,
      lockedBackground: this.data.lockedBackground
    };
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/background/background' });
  },

  /** 跳转语言与态度页（第三层） */
  onGoAttitude() {
    if (!this.data.layer2Done) return;
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = this.data.result;
    work.background = this.data.background;
    work.lockedBackground = this.data.lockedBackground;
    work.layer2Done = true;
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/attitude/attitude' });
  },

  /** 抽到的设定：用户自行输入修改 */
  onResultInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value || '';
    if (!key || !this.data.result) return;
    const result = { ...this.data.result, [key]: value };
    const update = { result };
    if (key === 'hairColor') update.hairHex = colors.getHairColor(value);
    if (key === 'eyeColor') update.eyeHex = colors.getEyeColor(value);
    this.setData(update);
  },

  /** 切换某一项锁定状态 */
  onLockToggle(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const locked = { ...this.data.locked };
    locked[key] = !locked[key];
    this.setData({ locked });
  },

  /** 对未锁定项再抽一次 */
  onRedrawUnlocked() {
    const { result, locked } = this.data;
    if (!result) return;
    const allLocked = Object.keys(locked).every(k => locked[k]);
    if (allLocked) {
      wx.showToast({ title: '请先取消至少一项的锁定', icon: 'none' });
      return;
    }
    const pools = this.getPools();
    const next = gacha.drawPartial(result, locked, pools);
    const hairHex = colors.getHairColor(next.hairColor);
    const eyeHex = colors.getEyeColor(next.eyeColor);
    this.setData({
      result: next,
      hairHex,
      eyeHex,
      saved: false
    });
    wx.showToast({ title: '已重抽', icon: 'none' });
  },

  /** 收藏当前 OC（含基础+背景+语言态度） */
  onFavorite() {
    if (this.data.saved) return;
    const result = this.data.result;
    if (!result) return;
    let list = wx.getStorageSync(STORAGE_FAVORITES) || [];
    if (!Array.isArray(list)) list = [];
    const workSnap = wx.getStorageSync(STORAGE_OC_WORK) || {};
    const item = {
      id: Date.now() + '' + Math.random().toString(36).slice(2),
      time: Date.now(),
      result: { ...result },
      background: this.data.background ? { ...this.data.background } : null,
      catchphrases: (this.data.catchphrases || []).slice(),
      attitudes: (this.data.attitudes || []).map(a => ({ ...a })),
      generatedBio: workSnap.generatedBio || ''
    };
    list.unshift(item);
    wx.setStorageSync(STORAGE_FAVORITES, list);
    this.syncWorkToStorage();
    this.setData({ saved: true });
    wx.showToast({ title: '已收藏', icon: 'success' });
  },

  /** 复制文案（含背景与态度若已生成） */
  onCopy() {
    if (!this.data.result) return;
    let text = gacha.toCopyText(this.data.result);
    const bg = this.data.background;
    if (bg) {
      text += '\n\n【背景故事】\n世界观：' + (bg.worldview || '') + '\n人生大事件：\n' + (bg.lifeEvents || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
    }
    if ((this.data.catchphrases || []).length) {
      text += '\n\n【常用语】\n' + this.data.catchphrases.join('\n');
    }
    if ((this.data.attitudes || []).length) {
      text += '\n\n【态度】\n' + this.data.attitudes.map(a => `${a.event} → ${a.attitude}`).join('\n');
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  },

  /** 保存图片到相册（有人设图则保存人设图，否则保存设定卡） */
  onSaveImage() {
    if (!this.data.result) return;
    wx.authorize({
      scope: 'scope.writePhotosAlbum',
      fail: () => {
        wx.showModal({
          title: '需要相册权限',
          content: '保存图片需要您授权相册写入权限',
          confirmText: '去设置',
          success: (res) => { if (res.confirm) wx.openSetting(); }
        });
      },
      success: () => {
        if (this.data.layer3Done && this.data.background) {
          this._drawMindMapToCanvas((path) => {
            if (!path) return;
            wx.saveImageToPhotosAlbum({
              filePath: path,
              success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
              fail: (e) => wx.showToast({ title: e.errMsg || '保存失败', icon: 'none' })
            });
          });
        } else {
          this._drawCardToCanvas();
        }
      }
    });
  },

  /** 生成人设图：绘制后弹出保存/分享 */
  /** 生成人设图：跳转到人设逻辑图页展示 */
  onGenerateMindMap() {
    if (!this.data.result || !this.data.layer3Done) return;
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.result = this.data.result;
    work.background = this.data.background || null;
    work.catchphrases = this.data.catchphrases || [];
    work.attitudes = this.data.attitudes || [];
    wx.setStorageSync(STORAGE_OC_WORK, work);
    wx.navigateTo({ url: '/pages/mindmap/mindmap' });
  },

  _drawCardToCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#card-canvas').fields({ node: true, size: true }).exec((res) => {
      if (!res?.[0]?.node) {
        wx.showToast({ title: '生成失败', icon: 'none' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      const width = res[0].width || 600;
      const height = res[0].height || 800;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const r = this.data.result;
      const padding = 24;
      let y = 80;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#e0ddd6';
      ctx.lineWidth = 1;
      ctx.strokeRect(2, 2, width - 4, height - 4);
      ctx.fillStyle = '#4a4540';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('【OC 设定】', padding, 40);
      ctx.font = '16px sans-serif';
      [['姓名', r.name], ['种族', r.race], ['发色', r.hairColor], ['瞳色', r.eyeColor], ['性格', r.personality], ['怪癖', r.quirk]].forEach(([label, value]) => {
        ctx.fillText(`${label}：${value}`, padding, y);
        y += 36;
      });

      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: (s) => {
            wx.saveImageToPhotosAlbum({
              filePath: s.tempFilePath,
              success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
              fail: (e) => wx.showToast({ title: e.errMsg || '保存失败', icon: 'none' })
            });
          },
          fail: () => wx.showToast({ title: '生成失败', icon: 'none' })
        }, this);
      }, 150);
    });
  },

  _drawMindMapToCanvas(callback) {
    const query = wx.createSelectorQuery().in(this);
    query.select('#mindmap-canvas').fields({ node: true, size: true }).exec((res) => {
      if (!res?.[0]?.node) {
        if (callback) callback(null);
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      const width = res[0].width || 750;
      const height = res[0].height || 1200;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      mindmap.drawMindMap(ctx, width, height, {
        result: this.data.result,
        background: this.data.background,
        catchphrases: this.data.catchphrases,
        attitudes: this.data.attitudes
      });
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: (s) => (callback ? callback(s.tempFilePath) : null),
          fail: () => (callback ? callback(null) : null)
        }, this);
      }, 200);
    });
  },

  onShareAppMessage() {
    const r = this.data.result;
    const title = r ? `我的 OC：${r.name}（${r.race}）` : '来抽一张 OC 设定卡吧';
    return { title, path: '/pages/index/index' };
  }
});
