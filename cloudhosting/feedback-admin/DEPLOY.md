# 意见与反馈 · 部署说明

## 一、接收反馈（小程序 → 云数据库）

1. 打开 **微信开发者工具** → **云开发** → 选择环境。
2. **数据库** → 新建集合 `feedback`。
   - 建议权限：**所有用户不可读写**（仅云函数可写，最安全）。
3. **云函数** → 右键 `submitFeedback` → **上传并部署：云端安装依赖**。
4. 确认云函数环境变量（可与其它 AI 函数共用）：
   - 若无需 AI，可不配 `DEEPSEEK_API_KEY`。
5. 小程序内「意见与反馈」页提交后，数据写入集合 `feedback`。

### 自检

云开发控制台 → 数据库 → `feedback` → 提交一条测试反馈后应出现新记录。

---

## 部署 feedbackApi 报错时

| 报错 | 处理 |
|------|------|
| `ResourceNotFound.Function` 未找到 Function | 先**只**部署云函数，不要点「上传触发器」；确认开发者工具云环境为 `cloud1-d3gkbz2nf0c84c381` |
| `上传触发器失败` system error **-202** | **不要**在开发者工具点「上传触发器」。改用管理页 **「从云数据库加载」**，或 [腾讯云 HTTP 访问](https://console.cloud.tencent.com/tcb/env/http-access) 手动绑定 |

### 管理页「从云数据库加载」前置条件

1. 云开发 → **设置** → **登录授权** → 开启 **匿名登录**
2. 数据库 → **feedback** → **权限** → 自定义安全规则，例如：
   ```json
   {
     "read": "auth != null",
     "write": false
   }
   ```
   （`submitFeedback` 云函数写库不受此限；用户小程序提交仍正常）
3. 重新上传 `cloudhosting/feedback-admin` 到静态站 `cloud-admin` 目录

**正确顺序：**

1. 右键 `feedbackApi` → **上传并部署：云端安装依赖**（等成功，不要先点「上传触发器」）
2. 若函数已存在，再右键 → **上传触发器**（此时 `config.json` 须含合法 `triggers`，项目已恢复）
3. 若触发器仍失败，改到 [腾讯云 HTTP 访问](https://console.cloud.tencent.com/tcb/env/http-access) 手动绑定 `/feedbackApi`

`config.json` 中 HTTP 触发器须使用字段 **`method`**（不是 `methods`）。

---

## 二、管理后台 HTTP API（浏览器拉取列表）

### 若浏览器出现 `INVALID_PATH`（微信云托管）

说明 **还没把路径 `/feedbackApi` 配到 HTTP 访问**，或用了错误域名（`service.tcloudbase.com` 常常是云托管，不是云函数触发地址）。

**正确做法：**

1. 微信开发者工具 → **云开发** → 左侧 **云函数** → 右键 **`feedbackApi`** → **上传并部署：云端安装依赖**（务必勾选上传 `config.json` 触发器）。
2. 云开发控制台（网页）→ 环境 **cloud1-d3gkbz2nf0c84c381** → 找 **HTTP 访问** / **HTTP 访问服务**（有的在「更多」或「设置」里）→ **开启**。
3. **新建路径**：路径 `/feedbackApi`，关联云函数 **`feedbackApi`**，方法 POST（可勾 OPTIONS）。
4. 保存后复制该路径对应的 **完整访问地址**（以控制台为准，常见带 `app.tcloudbase.com`）。
5. **不要**在浏览器地址栏直接打开 API 做测试；用本管理页「加载反馈」（POST）或下方 curl。

1. 右键云函数 **`feedbackApi`** → **上传并部署：云端安装依赖**。
2. 打开该函数 → **配置** → **HTTP 访问服务**（或「触发器」）→ 启用路径 `/feedbackApi`。
3. 复制控制台显示的 **完整 HTTP 地址**，形如：

```text
https://<环境ID>.service.tcloudbase.com/feedbackApi
```

4. （可选）云函数 **环境变量** `FEEDBACK_ADMIN_KEY` 修改管理密钥；默认与 `utils/feedbackConfig.js` 中 `oc-feedback-admin-2026` 一致。
5. 将地址填入：
   - `utils/feedbackConfig.js` 的 `FEEDBACK_API_URL`，或
   - 管理页 index.html`` 打开后输入并保存到浏览器本地。

### API 用法

```http
POST <FEEDBACK_API_URL>
Content-Type: application/json

{"action":"list","adminKey":"oc-feedback-admin-2026"}
```

成功返回：`{ "ok": true, "list": [ ... ] }`

---

## 三、静态管理页（查看反馈）

1. 云开发 → **静态网站** → 上传后线上目录须为（**不要多套一层** `feedback-admin`）：

```text
cloud-admin/
  index.html
  js/
    cloudbase.full.js
```

错误示例（会导致 SDK 404）：`cloud-admin/feedback-admin/index.html`
2. 访问地址一般为：

```text
https://<环境ID>.tcloudbaseapp.com/feedback-admin/index.html
```

3. 打开页面 → 填入 **HTTP API 地址** + **管理密钥** → **加载反馈**。

也可本地双击 `index.html` 使用（需 API 已开启跨域；`feedbackApi` 已设置 `Access-Control-Allow-Origin: *`）。

---

## 四、常见问题

| 现象 | 处理 |
|------|------|
| 提交失败：集合不存在 | 创建数据库集合 `feedback` |
| 管理页 403 | 检查 `adminKey` 与云函数 `FEEDBACK_ADMIN_KEY` 一致 |
| 管理页无法加载 | 确认 `feedbackApi` 已部署且 HTTP 路径为 `/feedbackApi` |
| `cloudbase is not defined` | 须上传 `js/cloudbase.full.js`；或直接用 **HTTP 加载**（无需 SDK） |
| 列表为空 | 先用小程序提交一条，再在管理页刷新 |

---

## 五、你需要记录的两个网址

部署完成后在云开发控制台复制，不要手写猜测：

1. **反馈 API**：`feedbackApi` 的 HTTP 访问地址  
2. **管理页面**：静态网站上的 `feedback-admin/index.html` 完整 URL  

将 API 地址写入 `utils/feedbackConfig.js` 的 `FEEDBACK_API_URL` 便于团队统一配置。
