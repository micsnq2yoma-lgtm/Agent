# Paperclip 源码改动记录

- 源码位置：`vendor/paperclip`，已并入主仓库（上游 github.com/paperclipai/paperclip，不再保留独立 .git）
- 基线：上游 commit `d69631b`（npm 版本 2026.1106.0），工作分支 `agenteam`
- 许可：MIT，保留其 LICENSE 与版权声明

每次修改 Paperclip 源码时在下面追加一行：日期 · 范围 · 原因 · 本仓库提交 / vendor 提交。

| 日期 | 范围 | 改动 | 原因 |
| --- | --- | --- | --- |
| 2026-11-14 | — | 克隆源码并入主仓库 | v0.4 决定源码内置 |
| 2026-11-14 | `scripts/link-plugin-dev-sdk.mjs`、`scripts/ensure-workspace-package-links.ts` | Windows 上用 junction 代替目录 symlink | 无管理员 / 开发者模式时 symlink 报 EPERM，install 和 build 失败 |
| 2026-11-14 → 11-16 | `.npmrc` | 原先写死 `script-shell=D:/Application/Git/bin/bash.exe`；现已去掉，改由 `scripts/install.mjs` / `scripts/update.mjs` 在每台 Windows 电脑上找 Git Bash，以 `npm_config_script_shell` 传给 pnpm（`scripts/lib/shell.mjs`，也可用环境变量 `AGENTEAM_BASH` 指定） | 包脚本用 `mkdir -p`、`cp` 等 POSIX 命令，cmd 下失败；写死的路径在别的电脑和 CI 上不存在 |
| 2026-11-14 | 仓库根 `.gitattributes` | 全仓库 LF | autocrlf 把源码检出为 CRLF，runner 的生成物校验报 stale |
| 2026-11-14 | `packages/paperclip-runner/scripts/check-runner-workflow-traceability.mjs` | 动态 import 用 `pathToFileURL` | Windows 绝对路径不能直接 import |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-binary-optional.mjs`、`package.json` 的 `build:binary` | Windows 无 cargo 时跳过 runnerd 二进制 | 上游发布包本身也没有 Windows 二进制 |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-inputs.mjs` | Windows 下不要求 runnerd 产物；`--finish` 找不到按 ppid 命名的记录时取最新的 pending 记录 | Git Bash 下 begin/finish 的父进程号不一致 |
| 2026-11-14 | `server/src/services/company-deletion.ts` | 删除运行记录前先删 `decisions`、`decision_bundles` | 外键 `decisions_origin_run_id_heartbeat_runs_id_fk` 导致删除 company 返回 500（已验证修复） |
| 2026-11-14 | `server/src/services/plugin-loader.ts` | 插件 worker 的 `--import` 用 file:// URL | Windows 上本地路径插件无法启动 |
| 2026-11-14 | `ui/src/i18n/dom-translate.ts`、`zh-CN-dom.json`、`ui/src/main.tsx`、`ui/src/i18n/index.ts`、`ui/index.html` | 后台中文化（词典 + DOM 翻译层），默认 zh-CN | 用户要求 Paperclip 界面全部中文 |
| 2026-11-14 | 新增 `ui/src/agenteam/`（P8） | 工作台视图、AgenTeam 侧栏、路由表、状态根组件 | v0.5 合成一个应用；我们的代码全部在此目录，不改上游文件 |
| 2026-11-14 | `ui/src/App.tsx`（路由挂载点，P8） | 引入 `agenteamRoutes()`；公司首页 `index` 与公司根跳转从 `dashboard` 改为 `agenteam`；`/:companyPrefix` 外包 `<AgenteamRoot>`；无前缀 `/agenteam*` 跳转 | 默认首页 = 工作台；侧栏与各页共享 AgenTeam 数据 |
| 2026-11-14 | `ui/src/components/Layout.tsx`（侧栏挂载点，P8） | 常量 `AGENTEAM_SINGLE_SIDEBAR`：主侧栏换成 `AgenteamSidebar`，不渲染上下文二级侧栏和底部账号 / 公司菜单 | 全应用只有一条侧栏；收件箱、仪表盘、新建任务、聊天、Cases、Goals、多公司切换随原侧栏一起从导航消失，路由和代码都保留。改回 `false` 即恢复原样 |
| 2026-11-14 | `ui/src/lib/company-routes.ts`（路由挂载点，P8） | `BOARD_ROUTE_ROOTS` 加 `agenteam` | 让 `Link`/`navigate` 给 `/agenteam/...` 自动加公司前缀 |
| 2026-11-14 | `ui/vite.config.ts`、`ui/tsconfig.json`（P8） | 别名 `@agenteam/skins`、`shared`、`pixel-office` 指向仓库 `packages/*/src` | AgenTeam 视图复用外层 monorepo 的包 |
| 2026-11-14 | 新增 `server/src/agenteam/proxy.ts`；`server/src/app.ts` 挂载一行（P8） | `/agenteam/api/*` 在 JSON 解析之前反向代理到 AgenTeam 本地服务（默认 `127.0.0.1:3200`，`AGENTEAM_LOCAL_URL` 可改），不转发 cookie / authorization | 本地服务接口与界面同源，对外只留 3100 |
| 2026-11-14 | `ui/src/components/AgentAvatar.tsx`（P9） | 有员工 id 时头像用像素机器人（`agenteam/lib/avatar`），去掉 2x srcSet | 员工形象只用原创像素机器人 |
| 2026-11-14 | `ui/src/components/AgentCharacter.tsx`（P9） | `AgentCharacter` 改为渲染静态机器人头像；原动画组件改名 `PaperclipAgentCharacter` 保留 | 员工详情页大头像也换成机器人 |
| 2026-11-14 | `ui/src/lib/agent-avatar-url.ts`（P9） | `agentAvatarUrl` 返回机器人 SVG（按外观 palette 取种子） | 兜底：拿不到员工 id 的头像也是机器人。该模块本来就是 storybook 可替换的入口 |
| 2026-11-14 | `ui/src/components/Layout.tsx`（P9） | 主行加 `data-agenteam-row`（朝堂皮肤侧栏放右侧）；AgenTeam 页面隐藏面包屑栏、去掉外层内边距 | 皮肤布局、去掉空白栏 |
| 2026-11-14 | `ui/src/i18n/dom-translate.ts`（P9） | `setTermOverrides()`：词典翻译之后按皮肤替换术语（智能体→员工、管理台→我、例行任务、子任务），已是中文的文本也替换；切换皮肤时从原文重算 | 一套叫法 |
| 2026-11-14 | `ui/src/App.tsx`（P10） | `agents/:agentId`、`agents/:agentId/:tab`、`agents/:agentId/runs/:runId` 外包 `EmployeeRoute` | 员工完整页 = Paperclip 详情 + 档案 / 记忆标签，并补回 P8 去掉二级侧栏后缺的子导航 |
| 2026-11-15 | `ui/src/i18n/dom-translate.ts`、`ui/src/i18n/zh-CN-dom.json`（v0.6 界面） | 新增 "Enabled for N agents" 模式和 Assign Task、Search installed skills… 的译文 | SETO 设计规范 §6 的残留英文 |
| 2026-11-15 | 新增 `ui/public/fonts/CormorantGaramond-Variable-*.woff2`、`JetBrainsMono-Variable-latin.woff2` 及 OFL 文本，`NOTICE.md` 追加两节 | 打包开源的衬线标题字体和等宽字体 | SETO 设计规范 §9.11：不依赖网络；Tiempos Headline 为商业字体，只在本机已安装时使用 |
| 2026-11-16 | `server/src/services/accounting-integrity.ts`、`server/src/routes/costs.ts`（PR #4 验收） | 新增 `POST /api/companies/:id/accounting/runs/:runId/write-off {reason, costUsd?}`：把一条一直"待记账"的已结束运行，按已采集的用量（或给定金额，默认 0）记为**估算**费用，原因写进运行的 `usageJson.accountingWriteOff` 和活动记录，再走正常记账 | 运行被中途取消后用量回执永远不到，Paperclip 不肯"凭空记 0"，于是这位智能体的预算一直硬暂停、提高预算也恢复不了。上游没有人工出口；这里只加一个需要写原因的人工入口，不改自动逻辑。配套脚本 `scripts/dev/budget-unstick.mjs` |
| 2026-11-16 | `packages/adapters/codex-local/src/server/codex-home.ts`（p18 · codex 验收） | Windows 上给员工的 Codex 运行目录建 `auth.json` 软链接被拒（EPERM）时，退回硬链接（同盘，同一个文件），再不行就复制一份；硬链接视为已链好，复制件比源文件新时（Codex 刷新过令牌）先拷回源文件再重建 | 没有管理员 / 开发者模式时 Windows 不能建文件软链接，Codex 员工第一次运行就 `adapter_failed`。目录软链接不受影响（仍按原逻辑） |
| 2026-11-16 | `ui/src/agenteam/lib/models.ts`、`lib/model-context.ts`、`views/Pages.tsx`、`views/EmployeeDrawer.tsx` | 模型价格表增加可选上下文长度（token）并在员工模型选择旁显示；服务商返回的长度自动带入，缺失可手填 | 模型选择需要同时比较价格和上下文容量，不预置未经确认的长度 |

## 待做
像素员工（2026-11-16）：`AgentAvatar` / `AgentCharacter` / AgenTeam `Robot` 共用外层 `@agenteam/pixel-office` 的模型形象与状态动画；员工注册表支持模型更新和公司切换；Team 展示被动任务气泡。无新增宠物交互、状态采集或执行控制。实现及验证见 [pixel-employees.md](pixel-employees.md) 和 [pixel-employees-verification.md](pixel-employees-verification.md)。

- 后台中文化：已完成（见 docs/history/phase-7-report.md）；上游更新后重跑 scripts/i18n。

## 运行方式
- 构建：`node scripts/build.mjs --install`（pnpm 9.15+；Windows 上它负责把 Git Bash 交给 pnpm，直接 `pnpm build` 会报"命令语法不正确"）；只改界面时 `node scripts/build.mjs --ui`（构建失败时上游 sw 插件会掩盖真实错误，先删 `ui/dist` 再看）
- 启动：`cd vendor/paperclip && pnpm paperclipai run`（数据目录 `~/.paperclip/instances/default`，与之前 npx 版相同）

改名（2026-11-17）：Agentself → AgenTeam。`ui/src/agentself/` → `ui/src/agenteam/`，`server/src/agentself/` → `server/src/agenteam/`；别名 `@agentself/*` → `@agenteam/*`；`/agentself/api` → `/agenteam/api`；`data-agentself-*` → `data-agenteam-*`；环境变量 `AGENTSELF_*` → `AGENTEAM_*`（旧名仍认）。团队层插件的内部标识 `agentself.team-layer` 不改（改了会丢插件状态）。迁移逻辑在 `scripts/lib/legacy.mjs`。
