# Paperclip 源码改动记录

- 源码位置：`vendor/paperclip`，已并入主仓库（上游 github.com/paperclipai/paperclip，不再保留独立 .git）
- 基线：上游 commit `d69631b`（npm 版本 2026.1106.0），工作分支 `agentself`
- 许可：MIT，保留其 LICENSE 与版权声明

每次修改 Paperclip 源码时在下面追加一行：日期 · 范围 · 原因 · 本仓库提交 / vendor 提交。

| 日期 | 范围 | 改动 | 原因 |
| --- | --- | --- | --- |
| 2026-11-14 | — | 克隆源码并入主仓库 | v0.4 决定源码内置 |
| 2026-11-14 | `scripts/link-plugin-dev-sdk.mjs`、`scripts/ensure-workspace-package-links.ts` | Windows 上用 junction 代替目录 symlink | 无管理员 / 开发者模式时 symlink 报 EPERM，install 和 build 失败 |
| 2026-11-14 | `.npmrc` | `script-shell=D:/Application/Git/bin/bash.exe` | 包脚本用 `mkdir -p`、`cp` 等 POSIX 命令，cmd 下失败。注意：路径是本机 Git 路径，换机器要改 |
| 2026-11-14 | 仓库根 `.gitattributes` | 全仓库 LF | autocrlf 把源码检出为 CRLF，runner 的生成物校验报 stale |
| 2026-11-14 | `packages/paperclip-runner/scripts/check-runner-workflow-traceability.mjs` | 动态 import 用 `pathToFileURL` | Windows 绝对路径不能直接 import |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-binary-optional.mjs`、`package.json` 的 `build:binary` | Windows 无 cargo 时跳过 runnerd 二进制 | 上游发布包本身也没有 Windows 二进制 |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-inputs.mjs` | Windows 下不要求 runnerd 产物；`--finish` 找不到按 ppid 命名的记录时取最新的 pending 记录 | Git Bash 下 begin/finish 的父进程号不一致 |
| 2026-11-14 | `server/src/services/company-deletion.ts` | 删除运行记录前先删 `decisions`、`decision_bundles` | 外键 `decisions_origin_run_id_heartbeat_runs_id_fk` 导致删除 company 返回 500（已验证修复） |
| 2026-11-14 | `server/src/services/plugin-loader.ts` | 插件 worker 的 `--import` 用 file:// URL | Windows 上本地路径插件无法启动 |
| 2026-11-14 | `ui/src/i18n/dom-translate.ts`、`zh-CN-dom.json`、`ui/src/main.tsx`、`ui/src/i18n/index.ts`、`ui/index.html` | 后台中文化（词典 + DOM 翻译层），默认 zh-CN | 用户要求 Paperclip 界面全部中文 |
| 2026-11-14 | 新增 `ui/src/agentself/`（P8） | 工作台视图、Agentself 侧栏、路由表、状态根组件 | v0.5 合成一个应用；我们的代码全部在此目录，不改上游文件 |
| 2026-11-14 | `ui/src/App.tsx`（路由挂载点，P8） | 引入 `agentselfRoutes()`；公司首页 `index` 与公司根跳转从 `dashboard` 改为 `agentself`；`/:companyPrefix` 外包 `<AgentselfRoot>`；无前缀 `/agentself*` 跳转 | 默认首页 = 工作台；侧栏与各页共享 Agentself 数据 |
| 2026-11-14 | `ui/src/components/Layout.tsx`（侧栏挂载点，P8） | 常量 `AGENTSELF_SINGLE_SIDEBAR`：主侧栏换成 `AgentselfSidebar`，不渲染上下文二级侧栏和底部账号 / 公司菜单 | 全应用只有一条侧栏；收件箱、仪表盘、新建任务、聊天、Cases、Goals、多公司切换随原侧栏一起从导航消失，路由和代码都保留。改回 `false` 即恢复原样 |
| 2026-11-14 | `ui/src/lib/company-routes.ts`（路由挂载点，P8） | `BOARD_ROUTE_ROOTS` 加 `agentself` | 让 `Link`/`navigate` 给 `/agentself/...` 自动加公司前缀 |
| 2026-11-14 | `ui/vite.config.ts`、`ui/tsconfig.json`（P8） | 别名 `@agentself/skins`、`shared`、`pixel-office` 指向仓库 `packages/*/src` | Agentself 视图复用外层 monorepo 的包 |
| 2026-11-14 | 新增 `server/src/agentself/proxy.ts`；`server/src/app.ts` 挂载一行（P8） | `/agentself/api/*` 在 JSON 解析之前反向代理到 Agentself 本地服务（默认 `127.0.0.1:3200`，`AGENTSELF_LOCAL_URL` 可改），不转发 cookie / authorization | 本地服务接口与界面同源，对外只留 3100 |

## 待做
- 后台中文化：已完成（见 docs/phase-7-report.md）；上游更新后重跑 scripts/i18n。

## 运行方式
- 构建：`cd vendor/paperclip && pnpm install && pnpm build`（pnpm 9.15+）；只改界面时 `cd vendor/paperclip/ui && pnpm exec vite build`（构建失败时上游 sw 插件会掩盖真实错误，先删 `ui/dist` 再看）
- 启动：`cd vendor/paperclip && pnpm paperclipai run`（数据目录 `~/.paperclip/instances/default`，与之前 npx 版相同）
