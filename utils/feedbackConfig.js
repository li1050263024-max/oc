/**
 * 意见反馈后台配置
 *
 * 管理后台（GitHub Pages，以后只用这个）：
 *   https://li1050263024-max.github.io/oc/
 *
 * HTTP API（云开发，管理页里填写，不是后台页面地址）：
 *   https://cloud1-d3gkbz2nf0c84c381-1433404171.ap-shanghai.app.tcloudbase.com/feedbackApi
 */
const FEEDBACK_ADMIN_KEY = 'oc-feedback-admin-2026';

/**
 * 反馈列表 HTTP API（环境 cloud1-d3gkbz2nf0c84c381）
 * 必须在控制台「HTTP 访问服务」里创建路径 /feedbackApi。
 * 不要用浏览器直接打开 API 地址；用管理页操作。
 */
const FEEDBACK_API_URL =
  'https://cloud1-d3gkbz2nf0c84c381-1433404171.ap-shanghai.app.tcloudbase.com/feedbackApi';

/** 管理后台 GitHub Pages 完整地址（以后只用这个） */
const FEEDBACK_ADMIN_URL = 'https://li1050263024-max.github.io/oc/';

/** 静态后台页路径（仓库 docs/，供 Pages /docs 部署） */
const FEEDBACK_ADMIN_PATH = '/';

module.exports = {
  FEEDBACK_ADMIN_KEY,
  FEEDBACK_API_URL,
  FEEDBACK_ADMIN_URL,
  FEEDBACK_ADMIN_PATH
};
