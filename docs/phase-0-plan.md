# Phase 0 计划 · 验证

日期：2026-11-14　依据：docs/PLAN.md v0.3 第 10 节"首个任务"，docs/handoff/START.md

## 目标
逐项验证 Paperclip 能否承载团队层方案。每项给出 通过 / 不通过 / 替代方案。只写验证用的最小代码，放在 `spikes/`（不进正式目录结构）。

## 环境基线（已核对）
| 项 | 要求 | 本机 |
| --- | --- | --- |
| Node.js | 24.11+ | 24.12.0 ✓ |
| pnpm | 9.15+ | 9.12.0 ✗ → 需升级（`corepack` 或 `npm i -g pnpm@9.15`，征得同意后做） |
| Claude Code | 已登录 | 2.1.325 |
| Codex CLI | 已登录 | 0.128.0 |
| Docker / WSL | 备选 | Docker 29.4.3、WSL docker-desktop |

## 参考项目使用边界
- paperclipai/paperclip（MIT）：可读源码与文档，核对接口、插件 SDK。
- KKKKhazix/agent-autoloop（MIT）：Phase 0 只需读协议设计，不移植代码。
- hAcKlyc/MyAgents（AGPL）：**不打开、不克隆**（硬约束）。Phase 0 不需要它。

## 8 项验证步骤
1. **Windows 常驻**：`npx paperclipai onboard --yes`，锁定并记录版本号；用后台进程常驻 24 小时，每小时探测 `/api/health`（或等价接口）并写日志到 `spikes/soak/`；记录安装与运行问题。24 小时到期前，报告中此项标"进行中"。
2. **OpenAPI 核对**：导出 `GET /api/openapi.json` 到 `spikes/openapi/openapi.json`，脚本逐项检查第 3 节字段（`reportsTo`、`role`、`canCreateAgents`、`adapterType`、`parentId`、`projectId`、`goalId`、`blockedByIssueIds`、`continuationPolicy`、`decideBy`、`snoozedUntil`、`budgetMonthlyCents`、attention 接口、decisions decide 接口、routines、costs、issue documents 等），输出差异表。
3. **两个适配器**：分别用 `claude_local`、`codex_local` 建员工，派一个极小任务（如在工作目录写一个文件）；同一 issue 追加评论再跑一轮，检查 session id 是否沿用。
4. **Studio 闸门**：建主管 + 父 issue，父 issue `blockedByIssueIds` 指向两个子 issue，通过 API 几乎同时把两个子 issue 置 `done`，统计主管被唤醒的运行次数（期望 1）。
5. **Decision 唤醒**：让 agent（或用 API 代表 agent）创建 `continuationPolicy: wake_origin_agent` 的 Decision，作答后确认发起者产生新运行。
6. **最小插件**：`spikes/plugin-min/`，锁定 `@paperclipai/plugin-sdk` / `@paperclipai/shared` 版本；订阅 `issue.created`、注册一个 job、暴露一个工具、加一个 UI 入口；确认能否提供整页界面，决定 console 用插件页还是独立网页。
7. **订阅额度**：查看适配器运行结果中的用量元数据，以及 Claude Code / Codex 是否有官方剩余额度接口；拿不到就标"估算"。
8. **报告**：写 `docs/phase-0-report.md`。

## 成本与风险控制
- 适配器任务尽量小，会消耗少量订阅额度。
- Paperclip 数据和员工工作目录放在 `spikes/` 或 Paperclip 默认数据目录，不碰其他目录。
- 不提交密钥（`.gitignore` 排除 `.env`、Paperclip 数据目录、日志里的 token）；只做本地 commit，不 push。
- 任何一项失败：停下，在报告里列出选项等用户决定。
