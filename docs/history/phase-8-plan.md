# Phase 8 计划 · 合并外壳（一个端口、一条侧栏）

日期：2026-11-14　依据：`docs/PLAN.md` v0.5 第 1、2、7.0、9（P8）、10 节，设计稿 `docs/handoff/v0.5/design/boards/`。

## 目标
只打开 `http://127.0.0.1:3100` 就能完成全部日常操作：工作台、像素团队、项目、部门、设置都是 Paperclip 界面里的路由，全应用只有一条 Agentself 侧栏。

## 做法
1. **视图迁移**：`apps/console/src` 的视图（Home、Team、项目、项目抽屉、员工抽屉、设置、部门向导等）连同 lib 移到 `vendor/paperclip/ui/src/agentself/`。
   - 页面状态切换改为 react-router 路由，挂在公司前缀下：`/:prefix/agentself`（工作台 / 像素团队）、`/agentself/projects`、`/agentself/departments/:key`、`/agentself/departments/new`、`/agentself/settings` 等。
   - 抽屉里的"完整页"、"高级设置"改为应用内链接（`/:prefix/issues/:id`、`/:prefix/agents/:id/runs/:runId`），不再开新标签页。
   - `@agentself/skins`、`shared`、`pixel-office` 通过 UI 的 Vite 别名和 tsconfig paths 直接引用 `packages/*/src`。
   - 样式限定在 `.agentself` 根类下，避免和 Paperclip 的 Tailwind 冲突。
2. **路由挂载点**（改上游 `ui/src/App.tsx`）：注册 Agentself 路由；公司首页 `index` 和公司根跳转从 `dashboard` 改为 `agentself`。
3. **侧栏挂载点**（改上游 `ui/src/components/Layout.tsx`）：主侧栏换成 `agentself/AgentselfSidebar`，不再渲染上下文二级侧栏和底部账号 / 公司菜单，保证全应用只有一条侧栏。
   - 侧栏结构：工作台 · 项目 · 部门（各部门 + 新建）· 管理（默认折叠：组织图、全部员工、能力与工具、例行任务、用量与预算、记录）· 设置 · 我 / 通知。
   - 设置页"高级"区列出 Paperclip 的公司 / 实例设置、适配器、插件、实验功能、密钥等链接，替代原来的二级侧栏入口。
4. **隐藏入口**：收件箱、仪表盘、新建任务、智能体聊天、Cases、Goals、多公司切换只是不出现在新侧栏里，代码和路由保留，URL 仍可打开。
5. **接口统一**：本地服务（`apps/console/server`）接口改为 `/agentself/api/*`。
   - Paperclip 服务新增 `server/src/agentself/proxy.ts`，在 JSON 解析之前把 `/agentself/api/*` 反向代理到本地服务（默认 `127.0.0.1:3200`，仅回环地址，对外不暴露）。
   - 本地服务去掉静态页面和 `/api` 代理，:3200 的前端下线。
   - `scripts/start.mjs` 的健康检查改为经过 3100。
6. **测试与验收**：
   - 现有 Vitest 全部通过（cards / frontdesk 测试随 lib 迁移改路径）。
   - P2、P3、P6 验收脚本改为只访问 3100，重新跑通。
   - 新增 `scripts/acceptance/p8-shell.mjs`：检查只有一条侧栏、卡片 → 项目抽屉 → 任务完整页 → 运行记录不离开应用、隐藏页 URL 可打开。

## 改动登记
每处 Paperclip 上游文件的改动记入 `docs/paperclip-changes.md`；我们自己的代码只放在 `ui/src/agentself/` 和 `server/src/agentself/`。

## 不做
P9（皮肤映射到 Paperclip 变量、像素头像、术语进汉化层）和 P10（部门页五标签、员工完整页、页面合并、统计条、高级新建）。
