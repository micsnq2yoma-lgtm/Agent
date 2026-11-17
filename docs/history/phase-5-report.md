# Phase 5 报告 · IM（飞书）

日期：2026-11-14

> 计划说明：未单独写 `phase-5-plan.md`；计划要点见下文。

## 做了什么
- **飞书通道** `plugins/im-feishu`：官方 SDK `@larksuiteoapi/node-sdk@1.76.0`（MIT），**长连接模式**（`WSClient`），本机不用暴露公网地址。接口：`start({onText, onAction})`、`sendText`、`sendCard`、`updateCard`、`parseAction`、`verifyInbound`。
- **卡片**：高档 = 红色头，按钮带回调值（卡片 id、选项、issue / 互动 / 审批 id）；处理后变灰、去掉按钮、显示"已处理：xx"。
- **IM 主控**（`apps/console/server/im.mjs`）：每 15 秒从 Attention 取要推的卡片（默认只推高档，设置里可加中档），新卡片推给白名单第一个用户；
  - 飞书里点选项 → 调 Paperclip 对应接口（互动作答 / 确认 / 拒绝、审批）→ 卡片更新为已处理；
  - 网页上处理掉的卡片 → 下一轮同步时飞书卡片更新为"已在网页处理"；
  - 发给机器人的话 → 交给前台，回答 / 建任务结果回到同一会话。
- **安全**：只接受白名单 open_id 的消息和按钮；App Secret 只从环境变量 `AGENTSELF_FEISHU_APP_SECRET` 读，不写进任何文件。

## 怎么验收
| 验收项（PLAN 第 9 节 P5） | 结果 |
| --- | --- |
| 在飞书里收到高档卡片并点选项，网页同步变为已处理 | **代码完成、模拟验证通过；真机未验证**（需要你的飞书应用） |
| 在飞书里发一句话能建出任务 | 同上 |
| 网页与飞书两端状态一致 | 同上 |

模拟验证：`plugins/im-feishu/test/feishu.test.ts` 9 项，含一个用假通道跑通的端到端用例：推卡 → 飞书作答（调用了 Paperclip respond）→ 卡片标记已处理 → 入站文字交给前台并回复 → 另一张卡在网页处理后飞书侧被更新。

## 需要你做（真机验收）
1. 在飞书开放平台建企业自建应用，开通机器人；权限：`im:message`、`im:message:send_as_bot`、`im:message.p2p_msg:readonly`（单聊收消息）；事件订阅方式选**长连接**，订阅 `im.message.receive_v1`；回调订阅 `card.action.trigger`。
2. 把 App Secret 设为用户环境变量：`setx AGENTSELF_FEISHU_APP_SECRET <secret>`，然后重启 `node scripts/start.mjs`。
3. 在工作台 设置 → 飞书 填 App ID、你的 open_id（白名单）、勾选启用。
4. 状态显示"已连接 · 长连接模式"后，在网页触发一张拍板卡片（或等员工发卡），在飞书里点选项，确认网页卡片消失。

## 与方案的偏差
- `ImChannel` 增加了 `start()`：长连接模式下入站消息由 SDK 推送，不经过 webhook 请求，所以 `verifyInbound / parseAction` 接收事件对象而不是 HTTP 请求。
- 通道作为工作台服务内的模块运行（不是 Paperclip 插件），因为它需要调用前台。
