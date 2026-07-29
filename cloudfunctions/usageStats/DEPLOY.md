# 用量统计 · 部署说明

## 功能

- 小程序上报：对话轮次、模型云函数调用、广告/分享/失败续期
- 云数据库集合 `usage_daily`：按日汇总全体用户
- 云数据库集合 `share_logs`：用户分享获额明细（管理后台「刷新明细」可见）
- 管理后台「用量统计」页：查看每日与区间合计

## 部署步骤

1. **数据库** → 新建集合 `usage_daily`  
   - 权限建议：**所有用户不可读写**（仅云函数读写）

2. **数据库** → 新建集合 `share_logs`（分享获额明细，必备）  
   - 权限建议：**所有用户不可读写**  
   - 可选索引：`createTimeMs` 降序

3. **云函数** → 右键 `usageStats` → **上传并部署：云端安装依赖**  
   （含 `action=logShare`：用户分享成功后写入 `share_logs`）

4. （可选，管理页 HTTP）在 [腾讯云 HTTP 访问](https://console.cloud.tencent.com/tcb/env/http-access) 绑定路径 `/usageStats` 到云函数 `usageStats`  
   - 地址示例：  
     `https://cloud1-d3gkbz2nf0c84c381-1433404171.ap-shanghai.app.tcloudbase.com/usageStats`

5. 管理页可直接用已测通的 **`feedbackApi` HTTP 地址**（不必再绑 `/usageStats`）  
   - 右键云函数 `feedbackApi` → **上传并部署：云端安装依赖**（需支持 `action=shareLogs`）  
   - 重新上传静态站 `cloudhosting/feedback-admin`  
   - 「刷新明细」页可查看分享获额记录  

   （可选）仍可单独绑定 `/usageStats`；小程序上报必须部署 `usageStats`。

## 指标说明

| 字段 | 含义 |
|------|------|
| chatRounds | 用户发出并计入配额的对话轮次（单聊+群聊） |
| apiCalls | 成功调用模型相关云函数次数（ocChat、generateOcBio 等） |
| unlockAd / unlockRoundsAd | 观看广告续期次数 / 解锁轮次 |
| unlockShare / unlockRoundsShare | 分享续期次数 / 解锁轮次 |
| unlockFailOpen / unlockRoundsFailOpen | 广告失败自动续期次数 / 轮次 |

> 数据自部署后开始累计；历史无法回溯。分享明细见集合 `share_logs`（openid / 轮次 / 渠道 / 时间）。
