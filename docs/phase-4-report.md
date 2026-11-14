# Phase 4 报告 · 员工记忆

日期：2026-11-14

> 计划说明：未单独写 `phase-4-plan.md`；计划要点见下文。

## 做了什么
- **文件结构**（每个员工工作目录 `~/.agentself/workspaces/<部门>/<成员>/memory/`）：`identity.md`、`style.md`、`user.md`、`notes.md`、`topics/`、`log/YYYY-MM-DD.md`、`archive/`，整个目录是一个 git 仓库。
- **自动加载**：工作目录里放 `CLAUDE.md`（Claude Code 自动读取并用 `@memory/...` 引入四个核心文件）和 `AGENTS.md`（Codex 自动读取，写明先读哪些文件），外加 `skills/memory` 技能包说明何时写回。
- **运行结束**：插件订阅 `agent.run.finished / failed`，把任务编号、标题、结果追加到当天 log（自动隐去疑似密钥）。
- **空闲整理**：job 每 5 分钟检查；员工空闲满 30 分钟且有新日志时，用 Haiku 读最近日志，更新 `notes.md`（限 6000 字符）和 `user.md`，对 identity / style 只生成建议（低档消息），然后 git 提交"整理记忆"。
- **每周归档**：周一 03:00 把 14 天前的 log 并入 `archive/YYYY-MM.md`，60 天未改的 topics 移到 `archive/topics/`，再提交。
- 网页员工抽屉可直接编辑记忆文件，保存即提交。

## 怎么验收
| 验收项（PLAN 第 9 节 P4） | 结果 | 证据 |
| --- | --- | --- |
| 员工在两个不同项目里能用上前一个项目学到的经验 | 通过 | `scripts/acceptance/p4-memory.mjs`：项目 A（AGE-20）里告诉文献员"总结第一行写【科研部速递】"，他写进了 `user.md`；项目 B（AGE-22，新 issue、新会话、不提偏好）输出第一行就是"【科研部速递】"，并注明"按 memory/user.md 的长期偏好" |
| 空闲 30 分钟后自动整理并产生一个 git 提交 | 通过 | 验收时把阈值临时调为 1 分钟：记忆仓库出现提交 `整理记忆：提炼最近日志到 notes/user`，偏好保留；之后恢复为 30 |
| 单元测试 | 通过 | `plugins/team-layer/test/memory.test.ts` 11 项（触发条件、日志、截断、去密钥、git 提交、归档） |

## 过程中发现并修复的问题
1. 只挂记忆技能不够：Claude Code 只在判断相关时才加载技能，第一次 B 项目没读记忆。改为工作目录 `CLAUDE.md` / `AGENTS.md` 自动加载后通过。
2. 插件 job 没有 company 上下文，`companies.list` / `config.get` 被拒（之前 later-tick 也一直失败）。改为插件记住见过的 company（事件 + 建部门时注册），并为每个 company 建插件配置行；job 只访问这些 company。

## 与方案的偏差
- 整理用的"便宜模型"是本机 Claude Code 的 Haiku（`claude -p`），不另配 API 密钥。
