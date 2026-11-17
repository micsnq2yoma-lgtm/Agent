# Phase 10 报告 · 页面整合

日期：2026-11-14　计划：`docs/phase-10-plan.md`

## 做了什么
- **部门页**（`views/Hubs.tsx` 的 `DepartmentPage`）有五个标签：概览 / 成员 / 例行任务 / 能力 / 预算。
  - 项目、例行任务、能力、用量四个组件都加了按部门过滤的参数，部门页和全局页复用同一套组件。
- **员工完整页**（`EmployeePage`）：标签栏 + 档案 / 记忆（我们渲染）+ Paperclip 员工详情的其余标签。
  - 员工抽屉拆成 `EmployeeProfile`、`EmployeeMemory`、`EmployeeHeader`，抽屉和完整页共用。
- **合并页**：
  - `CapabilitiesHub`：技能 / 连接器 / 权限
  - `UsageHub`：用量 / 预算规则 / 费用明细
  - `RecordsHub`：活动 / 运行审计 / 产物 / 审批历史
  - `OrgPage`：组织图

  嵌入的 Paperclip 页面套在 `[data-embedded-paperclip]` 里，不受 Agentself 样式影响，但仍会做术语替换。
- **侧栏"管理"区**都指向合并后的页面：组织图、全部员工、能力与工具、例行任务、用量与预算、记录。
- **其他列表页和设置**：
  - 项目：顶层任务按部门分组。
  - 例行任务：按部门分组，名称可以点进详情。
  - 设置：新增"通用"一节（团队名称）。
- **工作台**：
  - 像素团队有统计条，像素团队视图下也有输入框。
  - 输入框旁有"高级新建"，打开 Paperclip 的完整表单，预填负责人和项目，创建后跳到该任务。

## 怎么验收
| 验收项（PLAN 第 9 节 P10） | 结果 | 证据 |
| --- | --- | --- |
| 侧栏每一项都在同一应用内打开 | 通过 | `scripts/acceptance/p10-pages.mjs` 展开"管理"后逐个点击侧栏的全部链接。每一项都满足：<br>· 同源 3100<br>· 只有 1 条 Agentself 侧栏<br>· 背景色是当前皮肤<br>· 不是 404<br>· 没有"智能体" |
| 7.0 合并表里的重复入口全部消失 | 通过 | 侧栏没有指向收件箱、仪表盘、任务列表、费用、活动、技能、应用、审批、Goals、Cases、聊天、公司列表的链接（`duplicateEntries: []`）。这些功能都已并入合并页的标签里 |
| 管理区页面都用 Agentself 侧栏和皮肤 | 通过 | 同一脚本还逐页检查了下面这些页面，同样满足上面五条：<br>· 部门页 5 个标签<br>· 员工页（从抽屉进入的档案、记忆、Paperclip 概览）<br>· 能力与工具 3 个标签、用量与预算 3 个标签、记录 4 个标签<br>· 组织图、例行任务、设置 |
| （附）统计条、高级新建、像素团队视图下的输入框 | 通过 | `teamStats`、`advancedNewOpensForm`（弹出了 Paperclip 的新建表单）、`composerInTeamView` 三项都是 true |

## 回归
- Vitest 69 项通过。
- `p1-rules`、`p2-console`、`p3-console`、`p6-skin`、`p8-shell`、`p9-skin`、`p10-pages` 全部 PASS。
  - `p8-shell` 现在从员工完整页的"运行记录"标签进入那次运行，比 P8 时少绕一步。
- 验收过程中产生的测试任务已全部删除，系统里任务数为 0；皮肤已恢复为办公室。
- 没有重跑：`p1-research`、`p4-memory`（会消耗额度，只走 API，没受影响）；`p6-share`（需要另起实例）。

## 与方案的偏差
- **组织图**：上游新版界面把 `/org` 跳到员工列表，所以单独做了 `/agentself/org` 嵌入 Paperclip 组织图组件。"全部员工"仍是 Paperclip 的员工列表。
- **原页面仍可通过 URL 打开**：被合并的 Paperclip 页面（`/costs`、`/activity`、`/skills`、`/apps`、`/approvals` 等）没删，只是不出现在导航里，符合"代码保留"的约定。
- **手机端没有专门适配**，方案里写了暂不考虑。

## Paperclip 改动登记
- `ui/src/App.tsx`：员工详情路由外包一层 `EmployeeRoute`。
- 其余新增代码都在 `ui/src/agentself/` 下。
