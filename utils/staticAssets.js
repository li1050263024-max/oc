/**
 * 静态资源地址（卡背等大图建议放 CDN，减小主包体积）
 *
 * 紫/灰两套卡背均为 2:3，与卡槽比例一致，直接使用原图不裁剪。
 * 上传 CDN 后把下方路径改为 HTTPS 即可。
 */
const { THEME_MONO, getUiTheme } = require('./uiTheme.js');

module.exports = {
  /** 紫色主题卡背 */
  CARD_BACK_SRC: '/images/card-back.png',
  /** 灰白色主题卡背 */
  CARD_BACK_SRC_MONO: '/images/card-back-mono.png',

  CARD_BACK_CLOUD_ID: '',

  getCardBackSrc(theme) {
    const t = theme || getUiTheme();
    return t === THEME_MONO ? this.CARD_BACK_SRC_MONO : this.CARD_BACK_SRC;
  },

  /** 设定本 / 小传卡片无立绘时的默认占位图 */
  OC_PORTRAIT_PLACEHOLDER: '/images/oc-portrait-placeholder.png',

  getOcPortraitPlaceholder() {
    return this.OC_PORTRAIT_PLACEHOLDER;
  }
};
