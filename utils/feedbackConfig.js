/**
 * 意见反馈后台配置
 *
 * ═══ 部署后请把 FEEDBACK_API_URL 改成你的真实地址 ═══
 * 格式示例（以云开发控制台「HTTP 访问服务」里显示的为准）：
 *   https://你的环境ID.service.tcloudbase.com/feedbackApi
 * 或：
 *   https://你的环境ID-随机后缀.ap-shanghai.app.tcloudbase.com/feedbackApi
 *
 * 管理后台静态页（你已部署示例）：
 *   https://cloud1-d3gkbz2nf0c84c381-1433404171.tcloudbaseapp.com/cloud-admin/index.html
 * （将 cloudhosting/feedback-admin 上传到静态网站目录 cloud-admin）
 */
const FEEDBACK_ADMIN_KEY = 'oc-feedback-admin-2026';

/**
 * 反馈列表 HTTP API（环境 cloud1-d3gkbz2nf0c84c381）
 * 必须在控制台「HTTP 访问」里创建路径 /feedbackApi 后，复制显示的完整地址填到下方。
 * 不要用浏览器直接打开 API 地址（会报 INVALID_PATH）；用管理页「加载反馈」或 curl POST。
 * service.tcloudbase.com 多为云托管域名，未配置路径时会 INVALID_PATH。
 */
/**
 * 在管理页「HTTP API 地址」填写（须先在控制台 HTTP 访问 绑定 /feedbackApi）
 * 须与路由管理里域名一致（含 -1433404171），勿用无后缀的短域名。
 */
const FEEDBACK_API_URL =
  'https://cloud1-d3gkbz2nf0c84c381-1433404171.ap-shanghai.app.tcloudbase.com/feedbackApi';

/** 静态后台页路径（相对静态网站根目录） */
const FEEDBACK_ADMIN_PATH = '/cloud-admin/index.html';

module.exports = {
  FEEDBACK_ADMIN_KEY,
  FEEDBACK_API_URL,
  FEEDBACK_ADMIN_PATH
};
