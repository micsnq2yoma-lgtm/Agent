# Agentself · 项目方案 v0.5（Paperclip 基座 · 单一应用）

Nov 14, 2026 · @Jay Lu

## 1. 项目概述

项目名 Agentself，仓库名 `agentself`，核心理念是"把注意力放在真正有价值的事情上"（Put your attention on what truly matters）。基座是 Paperclip（MIT），源码内置于 `vendor/paperclip`，可以直接修改；我们在它之上做"团队层"，并把工作台和 Paperclip 的管理页面合成**一个应用**：一个端口、一条侧栏、一套皮肤、一套术语。记忆机制和 IM 接入照 MyAgents 的思路用 MIT 自己写，整个项目保持 MIT。

**三个平台各取所长**：MyAgents 的壳（侧栏 + 工作区 + 首页输入框 + 抽屉 + 主题），Paperclip 的骨（组织、员工配置、任务详情、运行记录、预算、审批、审计，直接复用不重写），agent-autoloop 的神经（卡片、三档注意力、事件规则，决定首页只显示什么）。

**灵魂不变：** 这是一支自动化团队，不是聊天工具。用户下达目标、处理少量卡片，其余时间团队自己干活；用户只在一个窗口里看消息。

**v0.5 相对 v0.4 的变化（2026-11-14，P0–P7 完成后）**

- 工作台和 Paperclip 后台合并为一个应用：以 Paperclip 界面为宿主，工作台各视图迁入成为其路由，只用 3100 一个端口，:3200 前端下线。
- 一条侧栏：日常区（工作台、项目、部门）+"管理"区（默认折叠）。重复入口合并（见 7.0）。
- 隐藏 Paperclip 的智能体聊天、Cases、Goals、多公司切换：代码保留，界面不显示。
- 皮肤和术语覆盖整个应用，包括 Paperclip 的管理页。
- 新增 P8–P10（第 9 节）。

**v0.4 相对 v0.3 的变化（Phase 0 后）**

- Paperclip 从"npx 依赖、不改核心"改为"源码内置 `vendor/paperclip`、可直接修改"，基线为上游 commit `d69631b`（2026.1106.0），改动登记在 `docs/paperclip-changes.md`。
- Paperclip 后台界面全部中文化（P7）。
- `codex_local` 保持默认 `dangerouslyBypassApprovalsAndSandbox: true`。

**v0.3 相对 v0.2 的变化**

| 项 | v0.2 | v0.3 |
| --- | --- | --- |
| 基座 | agent-autoloop 内核（之后考虑 MyAgents） | Paperclip |
| 组织、任务、预算、审批 | 自己实现 | 用 Paperclip 现成的 |
| 卡片协议、跳数上限、事件规则 | 内核自带 | 从 agent-autoloop 移植到团队层 |
| 记忆、IM | 待定 | 参照 MyAgents 思路自研 |
| 许可 | MIT | MIT（不复制 MyAgents 代码） |

**目标**

- 部门、前台、主管、员工四种角色可配置，部门可自由新建（科研、公司、生活只是示例）。
- 所有任务经过主管，由主管向用户汇报；即时问答由前台直接回答。
- 一个统一消息流，按三档注意力分级。
- 用户不在场时团队能把活干完，只把真正需要人决定的事做成卡片。
- 能力包、工具包、数据源、部门、工作流模板、皮肤都可以打包分享。

**非目标（本期不做）**

- 远程访问与多设备同步（先做本地网页版，后续再议）。
- 同一会话中途换模型（一个员工始终用同一个模型）。
- 动画只做功能性的状态表达，不做装饰动画。
- 不做通用聊天界面，不做会话回退、分叉。

## 2. 总体架构

系统分四层，用户只看到一个应用：Paperclip 源码内置，优先用插件扩展，插件做不到时直接改源码；工作台视图作为 Paperclip 界面的路由运行，与管理页同源、同侧栏、同皮肤；员工就是用户已登录的 Claude Code / Codex。

&#91;embedded content: 总体架构 · 四层\]

全部进程跑在那台常开的 Windows 电脑上，对外只有 `http://127.0.0.1:3100` 一个地址：Paperclip 服务（含内嵌 PostgreSQL 和界面）、插件 worker（由 Paperclip 拉起）、Agentself 本地服务（前台、飞书、办公室快照、设置、记忆、部门向导）。本地服务的接口挂在同源 `/agentself/api/*` 下（P8 先由 Paperclip 服务反向代理，之后可逐步迁入 Paperclip 服务端）。用户的操作从应用或飞书进入团队层，团队层调 Paperclip 建任务、派人、开卡片；Paperclip 唤醒员工运行，员工通过 API 和插件工具回报。

## 3. 概念映射

我们的大部分概念在 Paperclip 里都有现成的实体，团队层只补"部门、前台、三档注意力、跳数上限、返工计数、记忆"六样。字段名来自 Paperclip 文档；文档有截断，实现时以运行实例的 `GET /api/openapi.json` 为准。

| 我们的概念 | Paperclip 实体 | 团队层要补的 |
| --- | --- | --- |
| 用户（我） | Board 用户 | 无 |
| 部门 | 同一 company 内以主管为根的一棵子树（`reportsTo`）+ 一个同名 project | 部门元数据（名称、图标、皮肤座位、默认模型）存在插件 `state` |
| 前台 | 一个普通 agent（`role: general`），不带下属 | 快速模型直答 + 分话路由（见第 4 节） |
| 主管 | 子树根节点 agent，`canCreateAgents: false` | 主管技能包：拆活、派活、汇总、汇报 |
| 员工 | `reportsTo` 指向主管的 agent，`adapterType` 为 `claude_local` / `codex_local` 等 | 员工记忆（第 5 节） |
| 能力包 / 工具包 | Skills（有安装、作用域、版本）+ Connectors | 无 |
| 项目 | 顶层 issue（可挂 `projectId` / `goalId`） | 无 |
| 子任务 | 子 issue（`parentId`）；agent 在运行中创建的 issue 默认挂在当前任务下 | 跳数上限、返工计数 |
| Studio 闸门（全部完成才叫醒主管） | 父 issue 的 `blockedByIssueIds` 指向各子 issue；阻塞解除会唤醒负责人 | 无（原生满足，Phase 0 验证） |
| 卡片：ask | Decision（选项 + effects，`continuationPolicy: wake_origin_agent`）或 `ask_user_questions` 互动 | 无 |
| 卡片：notice / resolve / later | Attention 条目 + 个人 dismiss / 全局 snooze（`decideBy`、`snoozedUntil`） | 三档归类规则 |
| 审批（对外动作先问我） | Approvals + 连接动作"Allowed / Ask first / Off" | 无 |
| 统一消息流 | Attention feed（`GET /api/companies/{id}/attention`）+ activity 日志 | 按部门和三档重新组织的界面 |
| 事件源（邮件、RSS、定时） | Routines：cron / webhook / API 触发，每次生成一个 issue | 事件规则模板 |
| 唤醒 | 分配、评审请求、评论、阻塞解除、定时心跳；`@` 提及不唤醒 | 无 |
| 预算 | `budgetMonthlyCents` + 硬停 | 无 |
| 按项目续会话 | 适配器的 session resume | 无 |
| 分享部门 / 套件 | 公司导出 / 导入 | 部门包格式（第 7 节） |

**部门用子树而不是单独 company 的原因：** 统一消息流要跨部门聚合，单个 company 的 Attention 一次就能拿全。需要硬隔离的部门（密钥、预算完全分开）作为可选项，放到单独 company，消息流再做多 company 合并。

## 4. 团队层模块设计

团队层是一个 Paperclip 插件 `team-layer`（worker + UI）加一组技能包，优先不改 Paperclip 核心代码（插件做不到时再改源码并登记）。插件用到的宿主服务：`events`、`jobs`、`state`、`database`、`issues`、`issueRelations`、`agents`、`approvals`、`tools`。

### 4.1 前台

前台是用户唯一的输入框，在统一消息流顶部。每条输入先用快速模型分类，再走三条路之一：

1. **即时问答**（天气、查个事实、问团队进度）：插件直接调快速模型回答，答案作为一条"低"档消息进消息流，不建 issue。
2. **任务**：判断归属部门，在该部门 project 下建顶层 issue，分配给主管。归属不清时生成一张 ask 卡片让用户选部门。
3. **对已有任务的补充**：按上下文匹配到已有 issue，作为评论发给负责人（评论会唤醒对方）。

路由结果在消息流里可一键改派。前台的模型和提示词在插件配置里。

### 4.2 主管编排

主管本身是一个普通 agent，编排逻辑写在「主管技能包」里，团队层用插件强制关键规则：

- **简单任务直做**：主管判断一个员工一次能完成的，直接把顶层 issue 改派给该员工，完成后仍由主管向用户汇报。
- **复杂任务拆活**：主管创建子 issue 并指派员工，把各子 issue 加到顶层 issue 的 `blockedByIssueIds`，然后结束本轮。
- **Studio 闸门**：子 issue 全部完成、阻塞解除时才唤醒主管做汇总。两个子任务同时完成也只唤醒一次。
- **验收与返工**：主管对不合格的子 issue 发评论并把状态打回 `in_progress`。插件记录每个子 issue 的返工次数，第 3 次返工时停止自动返工，生成一张 ask 卡片让用户决定（继续、换人、放弃）。
- **汇报**：主管在顶层 issue 写 `report` 文档（issue documents），并把状态置为 `in_review`。插件把它作为"中"档消息推到消息流，用户确认后置为 `done`。
- **多模型分工**：主管不指定模型，只按员工的能力标签派活；模型绑定在员工身上（一个员工始终一个模型）。

### 4.3 统一消息流与三档注意力

消息流是主界面，数据来自 Attention feed、activity 日志和插件自己的汇报记录。插件把每条归到三档之一：

| 档 | 内容 | 提醒方式 |
| --- | --- | --- |
| 高：等你决定 | Decision、审批、agent 提问、预算告警、第 3 次返工、跳数超限 | 置顶 + 浏览器通知 + IM 推送 |
| 中：等你看 | 主管汇报（`in_review`）、运行失败 | 消息流内角标 |
| 低：知道就行 | 前台即答、任务进展、例行任务完成 | 折叠在"动态"里 |

每条消息都能就地处理（选选项、批准、确认汇报、稍后），不用点进某个员工。稍后 = 写 `snoozedUntil`；已读 = inbox dismissal。

### 4.4 卡片协议

沿用 agent-autoloop 的四种卡片语义，落到 Paperclip 实体上：

- **ask**：需要用户选择 → agent 创建 Decision，`continuationPolicy: wake_origin_agent`，用户作答后自动唤醒发起者继续干。
- **notice**：只通知不阻塞 → 插件记录一条低档消息。
- **resolve**：关掉之前的卡片 → 取消对应 Decision 或关闭互动。
- **later**：定时回来 → 写 `decideBy` / `snoozedUntil`，或建一个一次性 routine。

插件通过 `tools` 向 agent 暴露 `team.ask`、`team.notice`、`team.resolve`、`team.later` 四个工具，内部再调对应 API。

### 4.5 事件规则与跳数上限

- **事件入口**：外部事件（邮件、RSS、GitHub、定时）一律走 routine 的 cron / webhook / API 触发，每次生成一个归属某部门、指派给主管的 issue。
- **规则模板**：把 agent-autoloop `rules.json` 的字段（when / to / prompt / skill / maxActive）翻译成 routine 配置，放进部门包。
- **跳数上限**：插件订阅 `issue.created`，计算 `parentId` 链深度；超过 8 层时把新 issue 置为 `blocked` 并生成高档卡片。同一运行在 10 分钟内创建超过 20 个 issue 也触发同样处理（阈值可配）。
- **并发**：routine 自带并发和补跑策略；员工并发用待验证的 agent 级配置，不够时插件用 `state` 做计数闸门。

## 5. 员工记忆机制

记忆是 Paperclip 的短板（路线图上只完成一部分），我们参照 MyAgents 的分层文件思路自己实现，不复制其代码。记忆就是普通 Markdown 文件，放在员工的工作目录里，人和 agent 都能直接改。

**文件结构（每个员工一份）**

| 文件 | 内容 | 谁写 |
| --- | --- | --- |
| `memory/identity.md` | 角色、职责、所属部门、汇报对象 | 新建员工时由向导生成，之后用户改 |
| `memory/style.md` | 工作方式、语气、交付习惯 | 用户；整理任务可提建议 |
| `memory/user.md` | 关于用户的偏好和背景 | 整理任务 |
| `memory/notes.md` | 长期有用的经验和事实（索引性，限长） | 员工自己 + 整理任务 |
| `memory/topics/*.md` | 按主题展开的详细记忆（如某篇论文、某个仓库） | 员工自己 |
| `memory/log/YYYY-MM-DD.md` | 当天做过什么的流水账 | 插件在每次运行结束后追加 |

部门级共享记忆放在部门目录 `departments/<id>/memory/`，只有主管写，员工只读。

**注入方式**

- 一个「记忆技能包」装给所有员工：开工先读 identity / style / user / notes，按任务关键词再读相关 topics；收工前把新学到的写进 notes 或 topics。
- 跨项目靠记忆文件接续；同一项目内靠适配器的 session resume 续上会话。

**写入和整理时机**

1. **运行结束**：插件订阅 `agent.run.completed`，把本次任务标题、结果、花费追加到当天 log。
2. **空闲整理**：员工连续 30 分钟没有运行时，插件用 `jobs` 调度一次整理：用便宜模型读最近的 log，提炼进 notes / user，并保持 notes 在长度上限内。
3. **每周归档**：每周一次把过旧的 log 压缩归档，把长期不用的 topics 移到 `archive/`。

整理任务对 identity / style 只提建议（生成低档消息），不直接改。记忆目录纳入 git，每次整理一个提交，可回滚。

## 6. IM 接入

IM 只是统一消息流的另一个出口：高档消息推到手机，卡片能在 IM 里直接点选项，发给机器人的话一律交给前台。参照 MyAgents 的通道适配思路自己写，不复制代码。

Paperclip 自带的聊天通道（Slack、Telegram、Discord、Teams 等）属于实验功能，且每个连接只绑一个 agent、没有飞书和钉钉。所以我们不依赖它，自己做一层通道适配。

**适配器接口（每个通道一个小插件，如 `im-feishu`）**

```ts
interface ImChannel {
  id: string;                       // 'feishu' | 'dingtalk' | 'telegram' ...
  verifyInbound(req): InboundMsg | null;   // 校验并解析 webhook
  sendText(to: Recipient, text: string): Promise<MsgRef>;
  sendCard(to: Recipient, card: TeamCard): Promise<MsgRef>;  // 带按钮的卡片
  updateCard(ref: MsgRef, state: CardState): Promise<void>;   // 已处理 / 已过期
  parseAction(req): CardAction | null;     // 按钮回调 -> 选了哪个选项
}
```

**消息走向**

- **出站**：`team-layer` 产生高档消息 → 按用户设置的通道调 `sendCard`。中档可选推送，低档不推。
- **卡片回传**：用户在 IM 里点选项 → `parseAction` → 调 `POST /api/decisions/{id}/decide`（或审批接口）→ `updateCard` 把卡片置为已处理。网页和 IM 任一端处理后，另一端同步状态。
- **入站**：用户发给机器人的话 → 交给前台路由（见 4.1），前台的即答结果回在同一个会话里。
- **安全**：每个通道只接受白名单里的用户 ID；通道密钥存在 Paperclip secrets。

**首批通道**：本期只接飞书；钉钉、Telegram 用同一接口后续再加。接入方式优先用各平台的长连接 / Stream 模式，这样本地 Windows 机器不用暴露公网 webhook；不支持长连接的通道再考虑中继。各平台长连接的可用性在 Phase 5 开始时核对。

## 7. 像素办公室、皮肤与周边界面

像素办公室直接沿用 v0.1 演示的 canvas 绘制代码（[v0.1 演示](https://claude.ai/artifact/AoYZMkE8neVRdoqbyviA8W)），只把"模拟内核"换成真实数据。界面风格沿用已选定的 B 风格（[设计画布](https://claude.ai/artifact/J4Z2hYuX1yKTCuhCEJP2Qx)）。

### 7.0 界面布局

整个产品是**一个应用**：工作台和 Paperclip 的管理页面共用一条侧栏、一套皮肤、一套术语。日常层和管理层是同一个应用里的两层深度：日常只用工作台、项目和部门，管理功能收在侧栏下方的"管理"区。主区顶部仍用切换按钮在「工作台」和「像素团队」之间切换。设计稿见[设计画布](https://claude.ai/artifact/J4Z2hYuX1yKTCuhCEJP2Qx)最下面三行。手机端暂不考虑。

**品牌与首页格式**：工作台顶部居中放 AGENTSELF 字标（宽字距，SELF 中的 E 用一个像素字形、用强调色），下面一行是核心理念"把注意力放在真正有价值的事情上"，再下一行小字英文 Put your attention on what truly matters.。接着是输入框，输入框下方是横排的结果卡片。侧栏顶部用小号字标加前台机器人头像作为 Logo。

**侧栏**

```
AGENTSELF                         搜索
  工作台        首页：字标 + 输入框 + 结果卡片（顶部切换 → 像素团队）
  项目          进行中的任务树；点开是抽屉，再点"完整页"进任务详情
  部门
    科研部      部门页：概览 / 成员 / 例行任务 / 能力 / 预算
    公司部
    ＋ 新建部门
  ── 管理（默认折叠）──
    组织图 · 全部员工 · 能力与工具 · 例行任务 · 用量与预算 · 记录
  设置          通用 / 前台 / 飞书 / 预算 / 对外动作 / 皮肤 / 高级
  我 · 通知
```

**重复入口合并为一份**

| 原来两边都有 | 合并后 |
| --- | --- |
| Paperclip 收件箱 / 审批 vs 工作台卡片 | 只留工作台卡片（同一份 Attention 数据）；审批历史进"记录" |
| Paperclip 仪表盘 vs 像素团队 | 只留像素团队，顶部加一条统计：运行中 / 阻塞 / 本月花费 / 待拍板 |
| 新建任务 vs 输入框 | 只留输入框，旁边"高级新建"打开 Paperclip 原表单 |
| 任务 / 项目列表 vs 项目 | 侧栏"项目"：按部门分组的顶层任务；完整页沿用 Paperclip 任务详情 |
| 智能体详情 vs 员工抽屉 | 抽屉 = 快速查看；完整页沿用 Paperclip 员工详情，加"档案""记忆"标签 |
| 组织图 / 智能体列表 vs 部门 | 部门页是日常入口；全公司组织图和全部员工在"管理" |
| 技能、连接器 vs 能力与工具 | 一个页面，分技能 / 连接器 / 权限三个标签 |
| 费用 vs 用量 | 用量与预算：我们的用量面板 + Paperclip 预算规则 |
| 例行任务（两边） | 一个页面，按部门分组；部门页里只显示本部门 |
| 活动、审计、产物 | 合并为"记录" |
| 两边的设置 | 一个设置页；公司 / 实例设置、适配器、插件、实验功能归入"高级" |
| 智能体聊天、Cases、Goals、多公司切换 | 隐藏（代码保留，URL 仍可访问） |

**三条规则**

1. **每个对象只有一个完整页**，抽屉只是快速查看。卡片 → 项目抽屉 → 任务完整页 → 运行记录，全程在同一个应用里。
2. **一套皮肤管到底**：皮肤的样式变量映射到 Paperclip 的样式变量，管理页跟着换；像素机器人头像替换 Paperclip 原有头像。
3. **一套叫法**：皮肤术语表接进汉化层，"智能体"显示为"员工"，"管理台"显示为"我"。

**各区域交互**

| 区域 | 内容 | 交互 |
| --- | --- | --- |
| 工作台·卡片 | 横排小卡片：要你拍板、交付结果、前台即答；上方筛选条 | 点"展开"整行显示详情；要你拍板排最前；处理完收起 |
| 工作台·输入框 | 文本框 + 附件 + 交给 + 对外动作 + 高级新建 | 两个视图都保留输入框 |
| 像素团队 | 办公室铺满主区 + 顶部统计条 | 点人物弹出小卡，可进员工抽屉 / 完整页 |
| 部门页 | 概览（本部门像素分区 + 进行中项目 + 待拍板）/ 成员 / 例行任务 / 能力 / 预算 | 成员列表来自组织子树；各标签复用 Paperclip 页面组件 |
| 员工完整页 | Paperclip 员工详情 + 档案 / 记忆标签 | 换模型、暂停、调预算都在这里 |

**卡片结构**：标签 · 谁发的 · 部门和项目 → 标题（一句话结论）→ 说明 → 操作按钮。要你拍板的卡片底部再写"不回复会怎样"和"以后同类直接做"；交付结果的操作是打开产物、确认完成、返工。任务进展、例行任务完成这类低档消息不进工作台，放在项目页和通知里。

**没有对话页**：界面上不存在"和某个员工聊天"的入口。给某个任务补充要求，在项目抽屉里"插一句话"；新的事一律走底部输入框。

### 7.1 像素办公室

- 拆成独立包 `packages/pixel-office`：输入是一份"办公室快照"（部门、座位、每个人的动画状态、头顶气泡），输出是 canvas 画面。不关心数据从哪里来。
- 快照由 `team-layer` 从 agent 状态、运行事件和 Attention 计算，通过插件的 stream 推给前端。
- 动画只表达状态（功能性动画），点人物只弹出卡片摘要，不打开对话。

**员工形象**：原创像素小机器人（8×8 像素，屏幕脸 + 天线）。机身颜色区分员工，眼睛颜色表示模型：暖黄 = Claude，青色 = Codex；名牌上写角色和模型名。不使用任何官方吉祥物形象。

**状态映射**

| 像素动画 | 来源（优先级从上到下） |
| --- | --- |
| 失败（红色 !） | agent `status: error`，或最近一次运行失败 |
| 等你（举牌） | 该 agent 发起的 Decision / 提问未处理，或 `pending_approval` |
| 工作中（打字） | `status: running` |
| 交付待验收 | 有 issue 处于 `in_review` |
| 暂停（灰色） | `paused` / 预算硬停 |
| 空闲 | `idle` / `active` 且无运行 |
| 走向主管（交付动画） | 子 issue 刚变为 `done` 的一次性事件 |

### 7.2 皮肤

皮肤 = 主题 token（颜色、字体、圆角、像素素材集）+ 术语表（部门 / 主管 / 员工 / 前台 / 汇报 / 卡片等词的显示名）。例如"朝堂"皮肤把主管称为"尚书"、汇报称为"奏折"。皮肤是一个 JSON 加一组图片，可打包分享。皮肤可以改全部配色、字体、像素素材和术语，也可以改布局。本期只做默认的「办公室」皮肤，朝堂等其他皮肤以后再做。

### 7.3 用量面板

- **API 消耗**：直接读 Paperclip costs 接口，按部门 / 员工 / 模型聚合，展示今日、本周、本月和各自预算进度。
- **订阅额度**（Claude / Codex 套餐的窗口用量）：从适配器返回的用量元数据累计，按套餐窗口估算剩余；是否能拿到官方剩余值在 Phase 0 验证，拿不到就标注"估算"。

### 7.4 新建部门向导

向导生成一份"部门包"，再调 Paperclip API 一次性建好：

1. 基本信息：名称、图标、职责说明。
2. 人员：是否要主管；员工列表（从能力包模板选）、各自的适配器和模型（一键"全部用同一个"）。
3. 工具和数据源：要装的技能、连接器及其权限（Allowed / Ask first / Off）、例行任务（定时 / webhook）。
4. 预算：部门和每个员工的月预算。
5. 预览并创建：在像素办公室里预览新部门的座位，确认后创建 project、agents、routines，并写入各员工的 `memory/identity.md`。

部门包以 JSON 保存在 `packs/departments/`，可导出分享；内置科研、公司、生活三个示例。

## 8. 安全、对外动作与许可

**对外动作**

- 发邮件、发公众号、推代码、付款等不可撤回的动作，连接器权限一律设为 Ask first 或 Off，由审批卡片放行。
- 最后一步留给用户：需要个人凭证的发布类动作，员工只做到"草稿就绪"，生成一张带链接的高档卡片。

**权限收紧**

- 所有 agent `canCreateAgents: false`，只有新建部门向导（用户操作）能招人。
- 只有主管有任务分配权；员工只能给自己的任务建子 issue，受跳数上限约束。
- 每个员工有月预算，到线硬停；部门和全局各有一个总预算。
- 密钥用 Paperclip secrets 引用注入，不写进配置文件和记忆文件。
- 每个员工一个独立工作目录（`cwd`）。部门之间需要硬隔离时（如公司代码与个人邮件），可选用独立 Windows 账户运行该部门的员工，或放到单独 company。

**许可与合规**

- 本项目 MIT。Paperclip 是 MIT，源码内置于 vendor/paperclip 并可修改，保留其 LICENSE 和版权声明，每处改动登记在 docs/paperclip-changes.md。
- MyAgents（AGPL）只借思路：可以读其设计文档归纳机制，实现时不打开、不复制、不改写其源码；不使用 MyAgents 名称和 logo。
- agent-autoloop（MIT）的协议设计可以直接移植，在 NOTICE 里注明来源。
- v0.1 像素演示和设计稿是我们自己的产出，可直接用。

## 9. 实施路线

P0–P6 已按 v0.3 / v0.4 完成，P7（Paperclip 后台汉化）也已完成，报告见仓库 `docs/phase-N-report.md`。v0.5 新增 P8–P10，把工作台和后台合成一个应用。下图是 P0–P6 的原始路线。

&#91;embedded content: 实施路线 · 7 个阶段\]

P1 之后，P2、P3、P4 互不依赖，可以并行或按任意顺序做；P5 依赖 P2 的卡片；P6 在其余全部完成后做。

**各阶段验收标准**

- **P0 验证**：第 10 节的 8 项全部有结论；任何一项不通过都已列出替代方案。
- **P1 团队骨架**：用配置脚本建出"科研部"（主管 + 2 名员工）；下达一个要拆成 2 个子任务的项目，主管拆活、两人并行完成后主管只被唤醒一次并写出汇报；第 3 次返工和第 9 层子任务都会生成卡片；单元测试覆盖闸门、返工、跳数。
- **P2 消息流**：只用 Console 一个页面就能完成 P1 的全部操作（下任务、答卡片、确认汇报、稍后）；前台能即答"今天天气"而不建任务；三档归类符合 4.3 的表。
- **P3 像素与面板**：像素办公室随真实状态变化（按 7.1 的映射）；B 和朝堂皮肤可切换且术语跟着变；用量面板按部门显示花费与预算；向导能建出一个可用的新部门。
- **P4 记忆**：员工在两个不同项目里能用上前一个项目学到的经验；空闲 30 分钟后自动整理并产生一个 git 提交。
- **P5 IM**：在飞书里收到高档卡片并点选项，网页同步变为已处理；在飞书里发一句话能建出任务。网页与飞书两端状态一致。
- **P6 分享**：把"科研部"导出为部门包，在一个全新实例里导入后能直接工作；皮肤包同理。

### v0.5：合成一个应用（P8–P10）

P8 → P9 → P10 依次做，每个阶段结束都能跑起来验收。

**P8 合并外壳：一个端口、一条侧栏**

- 工作台的视图（Home、Team、项目、项目抽屉、员工抽屉、设置、部门向导）迁入 `vendor/paperclip/ui/src/agentself/`，注册为 Paperclip 界面的路由；默认首页改为工作台。
- Paperclip 的布局侧栏换成 7.0 的 Agentself 侧栏；隐藏收件箱、仪表盘、新建任务入口、智能体聊天、Cases、Goals、多公司切换（不删代码）。
- Agentself 本地服务的接口统一为 `/agentself/api/*`，由 Paperclip 服务反向代理，前端同源调用；`scripts/start.mjs` 只对外暴露 3100，:3200 前端下线。
- 验收：只打开 `http://127.0.0.1:3100` 跑通 P2 / P3 验收脚本的全部操作；全应用只有一条侧栏；卡片 → 项目抽屉 → 任务完整页 → 运行记录全程不离开应用；被隐藏的页面用 URL 仍能打开。

**P9 统一视觉与叫法**

- 皮肤 token 映射到 Paperclip 的 CSS 变量（背景、前景、主色、边框、圆角、字体），切换皮肤时管理页同步变化。
- 像素机器人头像替换 Paperclip 全部员工头像组件。
- 皮肤术语表接入 P7 的汉化层：术语词条由当前皮肤覆盖（智能体 → 员工、管理台 → 我 等）。
- 验收：办公室 / 朝堂皮肤切换后，工作台、组织图、员工详情、费用页的颜色和称呼一致；默认皮肤下全应用不出现"智能体"三个字。

**P10 页面整合**

- 部门页：概览 / 成员 / 例行任务 / 能力 / 预算五个标签。
- 员工完整页：Paperclip 员工详情 + "档案""记忆"标签；员工抽屉加"完整页"入口。
- 能力与工具（技能 / 连接器 / 权限）、用量与预算、记录（活动 / 审计 / 产物 / 审批历史）、设置（含"高级"）按 7.0 合并。
- 像素团队顶部统计条；输入框旁加"高级新建"。
- 验收：侧栏每一项都在同一应用内打开；7.0 合并表里的重复入口全部消失；管理区页面都用 Agentself 侧栏和皮肤。

## 10. 交给 Claude Code 的执行说明

仓库已完成 P0–P7。把本文档（导出为 Markdown）覆盖仓库的 `docs/PLAN.md`，从 P8 开始，每个 Phase 结束停下来等用户验收。第 12 节是 v0.4 的实现记录，与上文设计不同的地方以实现为准。

**仓库结构（pnpm monorepo）**

```
agentself/
  vendor/paperclip/      # Paperclip 源码（可修改，改动登记在 docs/paperclip-changes.md）
    ui/src/agentself/    # P8 起：工作台、像素团队、部门页等 Agentself 视图和侧栏
  apps/console/          # P8 起只保留 server/（前台、飞书、办公室快照、设置、记忆、向导），前端下线
  plugins/
    team-layer/          # 返工计数、跳数上限、卡片工具 team.*、记忆任务
    im-feishu/           # 飞书通道（长连接）
  packages/
    pixel-office/        # 像素办公室 canvas（原创像素机器人）
    skins/               # 办公室（默认）、朝堂；P9 增加到 Paperclip CSS 变量的映射
    shared/              # 类型：卡片、消息、部门包、快照
  skills/                # 主管 / 员工 / 记忆技能包
  packs/departments/     # 部门包示例
  scripts/               # 启动、建部门、开机自启、验收、汉化工具
  docs/                  # 本方案、Phase 计划与报告
```

**硬约束**

- Paperclip 源码可以改，但优先用插件或新增文件；必须改上游文件时把改动集中在少数入口（布局、侧栏、路由、主题变量），每处登记在 `docs/paperclip-changes.md`。隐藏的功能只从导航去掉，不删代码。
- 接口以运行实例的 `GET /api/openapi.json` 为准。
- 不打开、不复制 MyAgents 源码。
- 目标平台 Windows 11（常开机），Node.js 24.11+、pnpm 9.15+；路径、进程、换行都要兼容 Windows。
- 界面文案走皮肤术语表，不硬编码"主管""员工"等词；员工形象只用原创像素机器人。
- 测试用 Vitest；团队层规则和已有验收脚本在每个 Phase 结束时都要继续通过。
- 不提交密钥；不自动 push。

**工作方式**

- 每个 Phase 开始前写一页计划到 `docs/phase-N-plan.md`，结束写 `docs/phase-N-report.md`（做了什么、怎么验收、与方案的偏差）。
- 与方案冲突或 Phase 0 验证失败时，停下来列出选项，不自行改架构。

**当前任务：P8 合并外壳（见第 9 节）。下面是已完成的 Phase 0 清单，留作记录**

- [ ] 在 Windows 上用 `npx paperclipai onboard --yes` 装好并常驻 24 小时，记录问题。
- [ ] 导出 `openapi.json`，核对第 3 节映射表里的每个字段。
- [ ] 用 `claude_local` 和 `codex_local` 各建一个员工跑通一个任务，确认 session resume。
- [ ] 验证 Studio 闸门：父 issue 被两个子 issue 阻塞，两个同时完成时主管只被唤醒一次。
- [ ] 验证 Decision 的 `wake_origin_agent`：作答后发起者自动继续。
- [ ] 写一个最小插件：订阅 `issue.created`、注册一个 job、暴露一个工具、加一个界面入口，确认插件能否提供整页界面（决定 console 做成插件页还是独立网页）。
- [ ] 确认能否拿到 Claude / Codex 订阅额度的官方剩余值。
- [ ] 输出 `docs/phase-0-report.md`，每项给出通过 / 不通过 / 替代方案。

## 11. 风险与待验证项

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 插件 SDK 是 alpha，版本间有破坏性改动 | 升级 Paperclip 可能弄坏团队层 | 锁定版本；升级单独作为任务，跑完测试再合入 |
| 插件能否提供整页界面未确认 | console 的落地方式 | Phase 0 验证；不行就做独立网页，经 Paperclip API + 插件 API 路由取数 |
| Windows 官方未声明支持 | 常驻不稳 | Phase 0 常驻 24 小时；备选 Docker / WSL |
| 心跳默认关闭，唤醒策略细节文档不全 | 任务可能没人接 | 以分配 / 阻塞解除唤醒为主，主管开低频心跳兜底 |
| 内置聊天通道是实验功能且无飞书 / 钉钉 | IM 要自己做 | 已按自研通道规划（第 6 节） |
| 订阅额度可能拿不到官方剩余值 | 用量面板不准 | 显示为"估算" |
| Paperclip 更新很快，可能自己做出重叠功能 | 重复建设 | 每个 Phase 开始前看一遍 changelog，有现成就改用 |

v0.5 新增风险：**改动 Paperclip 布局、侧栏、路由后，合并上游更新会在这几个文件上冲突。** 应对：Agentself 代码放在新增目录 `ui/src/agentself/`，上游文件只改挂载点；每处改动登记在 `docs/paperclip-changes.md`；升级上游作为单独任务，跑完验收脚本再合入。

**仍待用户决定**

- 已定：项目名 Agentself，仓库名 `agentself`。
- 已定：IM 本期只接飞书。
- 已定（v0.5）：以 Paperclip 界面为宿主合成一个应用，只用 3100 一个端口。
- 已定（v0.5）：侧栏"管理"区默认折叠。
- 已定（v0.5）：隐藏智能体聊天、Cases、Goals、多公司切换（代码保留）。
- 是否保留"插一句话"：默认保留，实现为 issue 评论。

**Sources**

- [paperclipai/paperclip（GitHub）](https://github.com/paperclipai/paperclip)
- [Paperclip 文档首页](https://docs.paperclip.ing/)
- [Plugin SDK](https://docs.paperclip.ing/reference/plugins/sdk/)
- [Issues API](https://docs.paperclip.ing/reference/api/issues/)
- [Agents API](https://docs.paperclip.ing/reference/api/agents/)
- [Attention API](https://docs.paperclip.ing/reference/api/attention/)
- [Decisions API](https://docs.paperclip.ing/reference/api/decisions/)
- [Adapters](https://docs.paperclip.ing/reference/adapters/overview/)
- [Connectors](https://docs.paperclip.ing/connectors/)
- [Windows 安装教程（DataCamp）](https://www.datacamp.com/tutorial/paperclip-tutorial)

## 12. 实施记录（v0.4，2026-11-14）

P0–P7 已实现，各阶段报告见仓库 `docs/phase-N-report.md`。与上文设计不同、以实现为准的地方：

| 项 | 方案原文 | 实现 |
| --- | --- | --- |
| ask 卡片 | Decision + `wake_origin_agent` | 主要用 issue 线程互动 `ask_user_questions`（插件以员工身份创建，作答 `wake_assignee` 唤醒负责人）；Decision 仍可用 |
| 返工 / 跳数卡片 | 生成 ask 卡片 | 挂在父 issue 上，作答唤醒主管，由主管技能包执行对应动作 |
| 主管汇报确认 | 用户确认后置 done | Paperclip 自带技能对 report 文档发"请求确认"互动，工作台当作"交付结果"卡片 |
| 前台模型 | 插件调快速模型 | 本地服务调用本机 Claude Code（`claude -p --model haiku`，可联网），不另配密钥 |
| 记忆注入 | 记忆技能包 | 技能包 + 工作目录 `CLAUDE.md`（@ 引入记忆）/ `AGENTS.md`（Codex） |
| 插件 job | 直接遍历 company | job 无 company 上下文；插件记录见过的 company，建部门时注册 |
| ImChannel | webhook 风格接口 | 增加 `start()`；长连接入站来自 SDK 推送；通道运行在本地服务里 |
| 后台中文化 | 在 i18next 上抽词条 | 词典 + DOM 翻译层（`ui/src/i18n/dom-translate.ts`），词典由 `scripts/i18n` 抽取并翻译 |
| 用户数据 | — | 工作区、记忆、设置、皮肤在 `~/.agentself/`；Paperclip 数据在 `~/.paperclip/instances/default` |
