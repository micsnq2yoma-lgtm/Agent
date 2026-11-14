# Agentself · 项目方案 v0.4（Paperclip 基座，源码内置）

Nov 14, 2026 · @Jay Lu

## 1. 项目概述

项目名 Agentself，仓库名 `agentself`，核心理念是"把注意力放在真正有价值的事情上"（Put your attention on what truly matters）。v0.3 把基座从 MyAgents 换成 Paperclip（MIT）：底座提供组织、任务、调度、预算和审批，我们主要做"团队层"（以插件形式挂上去），并把 Paperclip 源码纳入仓库（`vendor/paperclip`），按需直接修改、复用、融合。像素办公室沿用 v0.1 演示，记忆机制和 IM 接入照 MyAgents 的思路用 MIT 自己重写，整个项目保持 MIT。

**灵魂不变：** 这是一支自动化团队，不是聊天工具。用户下达目标、处理少量卡片，其余时间团队自己干活；用户只在一个窗口里看消息。

**v0.4 相对 v0.3 的变化（2026-11-14，Phase 0 后）**

- Paperclip 从"npx 依赖、不改核心"改为"源码克隆进 `vendor/paperclip`、可直接修改"。基线为上游 commit `d69631b`（2026.1106.0），在 `agentself` 分支上改。
- Console 定为独立网页（`apps/console`），负责日常全部操作；Paperclip 自带界面作为后台，只做组织图、适配器、密钥等低频高级设置，设置页"高级设置"跳转过去。
- Paperclip 后台界面全部中文化：在其源码已有的 i18next 框架上抽取词条并补全 `zh-CN`。
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

系统分四层，只有第二层（团队层）和入口是我们写的：Paperclip 以源码形式内置（`vendor/paperclip`），优先通过插件扩展，插件做不到或代价过高时直接改源码，员工就是用户已登录的 Claude Code / Codex。

&#91;embedded content: 总体架构 · 四层\]

全部进程跑在那台常开的 Windows 电脑上：Paperclip 服务（含内嵌 PostgreSQL）、插件 worker（由 Paperclip 拉起）、Console 网页。用户的操作从 Console 或 IM 进入团队层，团队层调 Paperclip 建任务、派人、开卡片；Paperclip 唤醒员工运行，员工通过 API 和插件工具回报。

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

团队层是一个 Paperclip 插件 `team-layer`（worker + UI）加一组技能包，能用插件实现的不改 Paperclip 源码；需要改时在 `vendor/paperclip` 的 `agentself` 分支上改，并在 `docs/paperclip-changes.md` 记录。插件用到的宿主服务：`events`、`jobs`、`state`、`database`、`issues`、`issueRelations`、`agents`、`approvals`、`tools`。

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

整体布局参考 MyAgents：左侧栏加主区，主区顶部用一个切换按钮在「工作台」和「像素团队」之间切换（取代 MyAgents 的"对话 | 记录"）。工作台的核心只有两部分：结果卡片和输入框。设计稿见[设计画布](https://claude.ai/artifact/J4Z2hYuX1yKTCuhCEJP2Qx)最下面两行的五张画板。手机端暂不考虑。

**品牌与首页格式**：工作台顶部居中放 AGENTSELF 字标（宽字距，SELF 中的 E 用一个像素字形、用强调色），下面一行是核心理念"把注意力放在真正有价值的事情上"，再下一行小字英文 Put your attention on what truly matters.。接着是输入框，输入框下方是横排的结果卡片。侧栏顶部用小号字标加前台机器人头像作为 Logo。

| 区域 | 内容 | 交互 |
| --- | --- | --- |
| 侧栏·顶部 | SAAT 标志、搜索 | 搜索项目、卡片、员工 |
| 侧栏·导航 | 工作台、项目、例行任务、能力与工具、用量 | 项目 = 进行中项目列表，点开是项目抽屉；例行任务 = routines；能力与工具 = 技能包与连接器权限；用量 = 7.3 的面板 |
| 侧栏·部门 | 各部门（主管像素头像 + 待拍板数）、已归档 | 点部门 = 把工作台和像素团队都筛到该部门；＋ = 新建部门向导 |
| 侧栏·底部 | 设置、用户、通知 | 设置里有飞书绑定、前台模型、预算、皮肤，以及跳到 Paperclip 后台的"高级设置" |
| 主区·顶部 | 切换按钮：工作台 / 像素团队；右上角"N 件等你拍板" | 点角标回到工作台并只看要你拍板的卡片 |
| 工作台·卡片 | 横排小卡片（每张只有标签、谁、一句话结论、主操作），分要你拍板、交付结果、前台即答三种；上方筛选条 | 点"展开"在该行下方整行显示详情和全部选项；要你拍板排在最前，其余按时间倒序；处理完的卡片收起到"已处理" |
| 工作台·输入框 | 文本框 + 附件 +"交给"+"对外动作"+ 发送 | 交给：前台自动分派 / 指定部门 / 指定员工；对外动作：先问我 / 直接做。两个视图都保留输入框 |
| 像素团队 | 像素办公室占满主区，按部门分区，每人一个名牌和状态点 | 点人物弹出小卡：在做什么、待处理卡片的快捷按钮、看项目；举牌 = 有卡片等你 |
| 抽屉 / 弹窗 | 项目抽屉、员工抽屉、新建部门向导 | 项目抽屉：子任务树、报告、时间线、插一句话；员工抽屉：档案、模型、技能、记忆文件、花费 |

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

- 本项目 MIT。Paperclip 是 MIT，源码内置并修改，保留其 LICENSE 与版权声明，在 NOTICE 注明。
- MyAgents（AGPL）只借思路：可以读其设计文档归纳机制，实现时不打开、不复制、不改写其源码；不使用 MyAgents 名称和 logo。
- agent-autoloop（MIT）的协议设计可以直接移植，在 NOTICE 里注明来源。
- v0.1 像素演示和设计稿是我们自己的产出，可直接用。

## 9. 实施路线

共 7 个阶段，每个阶段结束都能跑起来给用户验收。P0 不通过就不进入 P1，而是回到方案重议。

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

## 10. 交给 Claude Code 的执行说明

把本文档（导出为 Markdown）和 v0.1 演示、设计稿一起交给 Claude Code，先做 Phase 0，每个 Phase 结束停下来等用户验收。

**仓库结构（pnpm monorepo）**

```
agentself/
  plugins/
    team-layer/        # 部门、前台、闸门、返工计数、跳数上限、卡片工具、记忆任务、消息流 API
    im-feishu/         # 本期只接飞书；钉钉、Telegram 后续按同一接口加
  apps/
    console/           # 统一消息流、像素办公室、用量面板、新建部门向导（React）
  packages/
    pixel-office/      # 从 v0.1 演示拆出的 canvas 绘制包
    skins/             # B（默认）、朝堂
    shared/            # 类型：卡片、消息、部门包、快照
  skills/
    lead/              # 主管技能包
    employee/          # 员工通用技能（汇报格式、卡片工具用法）
    memory/            # 记忆技能包
  packs/departments/   # research / company / life 示例
  docs/                # 本方案、Phase 报告
```

**硬约束**

- Paperclip 源码在 `vendor/paperclip`（`agentself` 分支，基线 `d69631b`），可直接修改；每处修改记入 `docs/paperclip-changes.md`，便于以后合并上游。不再从 npm 安装 Paperclip，从源码构建运行。
- 接口以运行实例的 `GET /api/openapi.json` 为准；与本文档字段名不一致时以实例为准并在 Phase 报告里列出。
- 不打开、不复制 MyAgents 源码。
- 目标平台 Windows 11（常开机），Node.js 24.11+、pnpm 9.15+；路径、进程、换行都要兼容 Windows。
- 界面文案走皮肤术语表，不硬编码"主管""员工"等词。
- 测试用 Vitest；每个团队层规则（闸门、返工、跳数、三档归类）都要有单元测试。
- 不提交密钥；不自动 push。

**工作方式**

- 每个 Phase 开始前写一页计划到 `docs/phase-N-plan.md`，结束写 `docs/phase-N-report.md`（做了什么、怎么验收、与方案的偏差）。
- 与方案冲突或 Phase 0 验证失败时，停下来列出选项，不自行改架构。

**首个任务：Phase 0 验证**

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
| 插件 SDK 是 alpha，版本间有破坏性改动 | 合并上游可能弄坏团队层 | 固定基线 commit；合并上游单独作为任务，跑完测试再合入 |
| 直接改 Paperclip 源码 | 与上游分叉越来越大，合并困难 | 改动集中、记录在 `docs/paperclip-changes.md`；中文化词条尽量回馈上游 |
| 后台中文化工作量大（UI 约 940 个组件文件，文字多为硬编码） | 进度 | 先做高频页面，按页面分批抽取词条 |
| 插件能否提供整页界面未确认 | console 的落地方式 | Phase 0 验证；不行就做独立网页，经 Paperclip API + 插件 API 路由取数 |
| Windows 官方未声明支持 | 常驻不稳 | Phase 0 常驻 24 小时；备选 Docker / WSL |
| 心跳默认关闭，唤醒策略细节文档不全 | 任务可能没人接 | 以分配 / 阻塞解除唤醒为主，主管开低频心跳兜底 |
| 内置聊天通道是实验功能且无飞书 / 钉钉 | IM 要自己做 | 已按自研通道规划（第 6 节） |
| 订阅额度可能拿不到官方剩余值 | 用量面板不准 | 显示为"估算" |
| Paperclip 更新很快，可能自己做出重叠功能 | 重复建设 | 每个 Phase 开始前看一遍 changelog，有现成就改用 |

**仍待用户决定**

- 已定：项目名 Agentself，仓库名 `agentself`。
- 已定：IM 本期只接飞书。
- 是否保留"插一句话"：在某个任务里直接给员工留言（本方案默认保留，实现为 issue 评论）。
- 前端：工作台、像素团队、设置页、项目抽屉、员工抽屉五张画板已出，待确认。

## 12. 实施记录（v0.4，2026-11-14）

P0–P6 已按本方案实现，各阶段报告见 `docs/phase-N-report.md`。与上文设计不同、以实现为准的地方：

| 项 | 方案原文 | 实现 |
| --- | --- | --- |
| ask 卡片 | Decision + `wake_origin_agent` | 主要用 issue 线程互动 `ask_user_questions`（插件以员工身份创建，作答 `wake_assignee` 唤醒负责人）；Decision 仍可用，工作台和飞书都能处理 |
| 返工 / 跳数卡片 | 生成 ask 卡片 | 挂在**父 issue** 上，作答唤醒主管，由主管技能包执行"继续 / 换人 / 放弃"或"放行 / 取消 / 停止拆分" |
| 主管汇报确认 | 用户确认后置 done | Paperclip 自带技能会对 report 文档发"请求确认"互动；工作台把它当作"交付结果"卡片 |
| 前台模型 | 插件调快速模型 | 工作台服务调用本机 Claude Code（`claude -p --model haiku`，可联网），不另配密钥 |
| 记忆注入 | 记忆技能包 | 技能包 + 工作目录 `CLAUDE.md`（@ 引入记忆）/ `AGENTS.md`（Codex）。只靠技能时 Claude Code 不一定加载 |
| 插件 job | 直接遍历 company | job 无 company 上下文；插件记录见过的 company，建部门时为该 company 建插件配置并注册 |
| ImChannel | webhook 风格接口 | 增加 `start()`；长连接下入站来自 SDK 推送。通道运行在工作台服务里 |
| Paperclip 后台中文化 | 在 i18next 上抽词条 | 词典 + DOM 翻译层（`vendor/paperclip/ui/src/i18n/dom-translate.ts`），词典由 `scripts/i18n` 从源码抽取、Haiku 翻译；可用 localStorage 切回英文 |
| 用户相关数据 | — | 工作区、记忆、设置、皮肤都在 `~/.agentself/`；Paperclip 数据在 `~/.paperclip/instances/default` |

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
