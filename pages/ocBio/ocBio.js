const { buildOcPromptFromWork } = require('../../utils/ocContext.js');
const { loadFavoriteToWork, syncBioToFavorite } = require('../../utils/favorite.js');
const { getModalConfirmColor, syncPageTheme } = require('../../utils/uiTheme.js');
const { applyPageGradientBg } = require('../../utils/tabPage.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

Page({
  data: {
    ocName: '',
    fromFavorite: false,
    hints: '',
    extraDetails: '',
    bio: '',
    existingBio: '',
    bioSaved: true,
    loading: false,
    uiThemeClass: ''
  },

  onLoad(options) {
    applyPageGradientBg();
    this._favoriteId = options && options.ocId ? decodeURIComponent(options.ocId) : '';
    this._hintsTouched = false;
    this._extraTouched = false;
    if (this._favoriteId) {
      loadFavoriteToWork(this._favoriteId);
    }
    this._applyWorkToPage(true);
  },

  onShow() {
    syncPageTheme(this);
    applyPageGradientBg();
    if (this._favoriteId) {
      loadFavoriteToWork(this._favoriteId);
    }
    this._applyWorkToPage(false);
  },

  _applyWorkToPage(resetHints) {
    let work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (this._favoriteId) {
      const loaded = loadFavoriteToWork(this._favoriteId);
      if (loaded) work = loaded;
    }

    const existingBio = String(work.generatedBio || '').trim();
    const patch = {
      fromFavorite: !!this._favoriteId,
      ocName: (work.result && work.result.name) || '',
      existingBio
    };

    if (resetHints || !this._hintsTouched) {
      const built = buildOcPromptFromWork(work);
      if (built) patch.hints = built;
    }

    if (resetHints || !this._extraTouched) {
      patch.extraDetails = work.bioExtraDetails || '';
    }

    if (resetHints) {
      patch.bio = existingBio;
      patch.bioSaved = true;
    } else if (!this.data.bio && existingBio) {
      patch.bio = existingBio;
      patch.bioSaved = true;
    }

    this.setData(patch);
  },

  _buildGeneratePrompt() {
    const hints = (this.data.hints || '').trim();
    const extra = (this.data.extraDetails || '').trim();
    if (!hints && !extra) return '';
    if (!extra) return hints;
    if (!hints) return extra;
    return hints + '\n\n【用户补充细节】\n' + extra;
  },

  _persistBio(bio) {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.generatedBio = bio;
    if (this._hintsTouched) work.bioHintsOverride = this.data.hints || '';
    if (this._extraTouched) work.bioExtraDetails = this.data.extraDetails || '';
    wx.setStorageSync(STORAGE_OC_WORK, work);
    if (this._favoriteId) {
      syncBioToFavorite(this._favoriteId, bio);
    }
  },

  _persistHintsDraft() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    work.bioHintsOverride = this.data.hints || '';
    work.bioExtraDetails = this.data.extraDetails || '';
    wx.setStorageSync(STORAGE_OC_WORK, work);
  },

  onHintsInput(e) {
    this._hintsTouched = true;
    this.setData({ hints: e.detail.value || '' });
    this._persistHintsDraft();
  },

  onExtraInput(e) {
    this._extraTouched = true;
    this.setData({ extraDetails: e.detail.value || '' });
    this._persistHintsDraft();
  },

  onBioInput(e) {
    const bio = e.detail.value || '';
    const saved = bio.trim() === String(this.data.existingBio || '').trim();
    this.setData({ bio, bioSaved: saved });
  },

  onImportBioFile() {
    if (typeof wx.chooseMessageFile !== 'function') {
      wx.showToast({ title: '当前基础库不支持选文件，请直接粘贴', icon: 'none' });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'md', 'text'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.path) {
          wx.showToast({ title: '未选择文件', icon: 'none' });
          return;
        }
        if (file.size > 200 * 1024) {
          wx.showToast({ title: '文件过大，请控制在 200KB 内', icon: 'none' });
          return;
        }
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => {
            const text = String(r.data || '').trim();
            if (!text) {
              wx.showToast({ title: '文件内容为空', icon: 'none' });
              return;
            }
            const bio = text.slice(0, 8000);
            this.setData({
              bio,
              bioSaved: bio === String(this.data.existingBio || '').trim()
            });
            wx.showToast({ title: '已导入，请保存', icon: 'none' });
          },
          fail: () => {
            wx.showToast({ title: '读取失败，请改用粘贴', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return;
        wx.showToast({ title: '选择文件失败', icon: 'none' });
      }
    });
  },

  onGenerate() {
    if (this.data.loading) return;
    const prompt = this._buildGeneratePrompt();
    if (!prompt) {
      wx.showToast({ title: '请先填写设定或补充细节', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '请使用支持云开发的基础库', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '生成中…', mask: true });
    wx.cloud
      .callFunction({
        name: 'generateOcBio',
        data: { hints: prompt },
        timeout: 60000
      })
      .then((res) => {
        const r = res.result || {};
        if (r.ok && r.bio) {
          this.setData({ bio: r.bio, bioSaved: false });
        } else {
          wx.showToast({ title: r.errMsg || '生成失败', icon: 'none', duration: 3000 });
        }
      })
      .catch((err) => {
        let msg = '';
        if (typeof err === 'string') msg = err;
        else if (err) {
          msg = err.errMsg || err.message || '';
          if (!msg && typeof err.toString === 'function') msg = err.toString();
        }
        const isTimeout = /timeout|超时/i.test(msg);
        wx.showToast({
          title: isTimeout
            ? '请求超时，请缩短设定后重试，或稍后再试'
            : msg || '云函数调用失败，请检查是否已上传云函数',
          icon: 'none',
          duration: isTimeout ? 3500 : 3000
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ loading: false });
      });
  },

  onSaveBio() {
    const bio = (this.data.bio || '').trim();
    if (!bio) {
      wx.showToast({ title: '请先填写、粘贴或生成小传', icon: 'none' });
      return;
    }
    if (this.data.bioSaved && bio === this.data.existingBio) {
      wx.showToast({ title: '已保存', icon: 'none' });
      return;
    }

    const doSave = () => {
      this._persistBio(bio);
      this.setData({ existingBio: bio, bioSaved: true });
      wx.showToast({ title: '已保存', icon: 'success' });
    };

    const existing = (this.data.existingBio || '').trim();
    if (existing && existing !== bio) {
      wx.showModal({
        title: '替换小传',
        content: '该 OC 已有人物小传，保存后将替换原有内容，是否继续？',
        confirmText: '确认替换',
        cancelText: '取消',
        confirmColor: getModalConfirmColor(),
        success: (res) => {
          if (res.confirm) doSave();
        }
      });
      return;
    }
    doSave();
  },

  onCopyBio() {
    const bio = (this.data.bio || '').trim();
    if (!bio) {
      wx.showToast({ title: '暂无小传可复制', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: bio,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  }
});
