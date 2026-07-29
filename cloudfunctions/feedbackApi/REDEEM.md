# 兑换码管理 · 后台框架

> 本阶段**只搭后台**：生成码、设额度、查明细。  
> 用户续期：**分享 + 兑换码**（激励广告已下线）。

## 1. 数据库

新建集合（权限建议：**所有用户不可读写**，仅云函数访问）：

| 集合 | 用途 |
|------|------|
| `redeem_codes` | 兑换码主表 |
| `redeem_logs` | 用户核销记录（**必须新建**，否则兑换成功也看不到记录） |
| `user_quota` | 用户额外额度：`extraRounds` 剩余、`redeemedTotal` 累计兑入、`extraConsumed` 已用 |

## 兑换记录不显示常见原因

1. 未建集合 `redeem_logs`（`redeemCode` 写入失败会被吞掉，码仍会核销）
2. 未重新部署 `feedbackApi` / `redeemCode`
3. 只点了「刷新明细」没点「刷新记录」（现已改为进入兑换码页签自动加载）

后台记录会附带该用户：**已用 / 剩余 / 累计兑入**（消耗额外额度时会回写云端）。

`redeem_codes` 字段示例：

| 字段 | 说明 |
|------|------|
| `code` | 兑换码字符串 |
| `rounds` | 可兑换通用对话轮次 |
| `maxUses` | 每码可用次数（默认 1） |
| `usedCount` | 已使用次数 |
| `enabled` | 是否启用 |
| `note` | 备注（如打赏档位） |
| `createTimeMs` | 创建时间 |

可选：为 `code` 建唯一索引，避免重复。

## 2. 部署

1. 右键云函数 `feedbackApi` → **上传并部署：云端安装依赖**
2. 重新上传静态站 `cloudhosting/feedback-admin` 到 `cloud-admin/`
3. 管理页打开「**兑换码**」页签，API 填与反馈相同的 `feedbackApi` 地址

## 3. 管理接口（HTTP POST，需管理密钥）

| action | 说明 |
|--------|------|
| `redeemCreate` | 生成码：`rounds` / `count` / `maxUses` / `note` |
| `redeemList` | 明细列表 |
| `redeemDisable` / `redeemEnable` | 停用 / 启用（body: `id`） |
| `redeemLogs` | 核销记录列表 |

## 4. 小程序端（已接入）

1. 右键云函数 `redeemCode` → **上传并部署：云端安装依赖**
2. 再建集合 **`user_quota`**（所有用户不可读写）
3. 入口：
   - 独立页 `pages/redeemCode/redeemCode`
   - 首页菜单 / 导航 → 兑换码
   - 对话额度用尽弹窗 →「输入兑换码」
4. 兑换成功后写入通用池 `extraRounds`（单聊群聊共用、无有效期限制）；续期方式为**分享 / 兑换码**（无广告）

### 打赏金额 → 额度（后台点选）

| 金额 | 额度（轮） |
|------|------------|
| ¥1   | 30         |
| ¥3   | 150        |
| ¥6   | 350        |
| ¥10  | 800        |
