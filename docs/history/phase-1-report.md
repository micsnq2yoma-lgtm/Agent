# Phase 1 报告 · 团队骨架

日期：2026-11-14　计划：`docs/phase-1-plan.md`

## 做了什么
- **Paperclip 改为源码运行**：`vendor/paperclip`（基线 `d69631b`）并入主仓库，`pnpm paperclipai run` 启动，沿用原数据目录。为 Windows 修了 6 处构建 / 运行问题和 1 个删除 company 的外键 bug，详见 `docs/paperclip-changes.md`。
- **monorepo**：pnpm workspace（`packages/*`、`plugins/*`、`apps/*`，不含 vendor），根 `vitest`、`tsconfig.base.json`、MIT `LICENSE`、`NOTICE`、`.gitattributes`（全仓库 LF）。
- **团队层规则**（`plugins/team-layer/src/rules`，纯函数 + 单测）：Studio 闸门兜底判断、返工计数（第 3 次升级）、跳数上限（深度 > 8 / 同一员工 10 分钟 > 20 个）、三档归类与排序。
- **team-layer 插件**：订阅 `issue.created` / `issue.updated`，超限时把 issue 置 `blocked` 并在父 issue 上发 ask 卡片（作答唤醒主管）；工具 `team.ask / notice / resolve / later`；`later` 由每分钟的 job 唤醒。
- **技能包**：`skills/lead`（拆活、`blockedByIssueIds`、每轮必须留动作、返工与卡片答复处理、report 文档格式）、`skills/employee`（交付规范、卡片工具调用方式、对外动作先问）。
- **部门包 + 配置脚本**：`packs/departments/research.json`、`scripts/setup-department.mjs`（幂等，重复运行只补缺）。

## 怎么验收
| 验收项（PLAN 第 9 节 P1） | 结果 | 证据 |
| --- | --- | --- |
| 配置脚本建出科研部（主管 + 2 名员工） | 通过 | 科研主管（Claude）、文献员（Claude）、实验员（Codex）；`reportsTo` 正确，`canCreateAgents: false` |
| 拆成 2 个子任务、两人并行完成、主管只被唤醒一次并写出汇报 | 通过 | `scripts/acceptance/p1-research.mjs`：主管在顶层 issue 上只有两次运行——`issue_assigned` 和 1 次 `issue_children_completed`；写出 `report` 文档并置 `in_review` |
| 第 3 次返工生成卡片 | 通过 | `scripts/acceptance/p1-rules.mjs`：前两次 0 张，第 3 次在父 issue 上 1 张，子任务置 `blocked` |
| 第 9 层子任务生成卡片 | 通过 | 同上：L9 置 `blocked`，卡片挂在 L8，L8 不受影响 |
| 单元测试覆盖闸门、返工、跳数（及三档） | 通过 | `plugins/team-layer/test/rules.test.ts` 21 项 |

## 与方案的偏差
- 闸门：Paperclip 原生已满足"只唤醒一次"，插件只保留纯函数判断（单测覆盖），没有再发第二个唤醒。
- 卡片 ask 用 Paperclip 的 issue 线程互动（`ask_user_questions`，作答后 `wake_assignee`）而不是 Decision：插件 SDK 能以员工身份创建互动，作答会唤醒该 issue 的负责人，正好对应"作答后发起者继续"。
- `in_progress` 必须有负责人，因此返工也接受 `in_review/done → todo`。
- 主管每轮结束必须有明确动作（Phase 0 发现），写进了主管技能包。
