const mindmap = require('../../utils/mindmap.js');
const { normalizeResult, normalizeBackground } = require('../../utils/ocResult.js');

const STORAGE_OC_WORK = 'oc_work_in_progress';

Page({
  data: {
    result: null,
    background: null,
    catchphrases: [],
    attitudes: []
  },

  onLoad() {
    const work = wx.getStorageSync(STORAGE_OC_WORK) || {};
    if (work.result) {
      this.setData({
        result: normalizeResult(work.result),
        background: work.background ? normalizeBackground(work.background) : null,
        catchphrases: work.catchphrases || [],
        attitudes: work.attitudes || []
      });
    } else {
      wx.showToast({ title: '请先完成设定', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

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
      success: () => this._drawToCanvas((path) => {
        if (!path) {
          wx.showToast({ title: '生成失败', icon: 'none' });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: (e) => wx.showToast({ title: e.errMsg || '保存失败', icon: 'none' })
        });
      })
    });
  },

  onShareImage() {
    if (!this.data.result) return;
    this._drawToCanvas((path) => {
      if (!path) {
        wx.showToast({ title: '生成失败', icon: 'none' });
        return;
      }
      if (wx.shareFileMessage) {
        wx.shareFileMessage({ filePath: path });
      } else {
        wx.showToast({ title: '请先保存后从相册分享', icon: 'none' });
      }
    });
  },

  _drawToCanvas(callback) {
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

  onBack() {
    wx.navigateBack();
  }
});
