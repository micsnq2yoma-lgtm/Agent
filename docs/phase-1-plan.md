# Phase 1 计划 · 团队骨架

日期：2026-11-14　依据：PLAN v0.4 第 4、9、10 节

## 范围
1. **Paperclip 从源码运行**：`vendor/paperclip` 用 pnpm 构建，`scripts/paperclip-start.ps1` 启动；替换掉 npx 版（数据目录沿用 `~/.paperclip/instances/default`）。开机自启用 Windows 计划任务（`scripts/install-autostart.ps1`，需要用户执行一次）。
2. **修复** Paperclip 删除 company 的外键错误（记入 `docs/paperclip-changes.md`）。
3. **monorepo 骨架**（pnpm workspace，不包含 `vendor/paperclip`，它是独立的 workspace）：`packages/shared`、`plugins/team-layer`、`skills/lead`、`skills/employee`、`packs/departments/research`。
4. **团队层规则**（纯函数 + Vitest）：
   - Studio 闸门：判断父 issue 的子任务是否全部完成，并按 wake 去重（Paperclip 原生已满足，插件只做兜底校验）。
   - 返工计数：子 issue 被主管从 `in_review`/`done` 打回 `in_progress` 计一次；第 3 次停止自动返工，生成 ask 卡片。
   - 跳数上限：`parentId` 链深度超过 8 → 新 issue 置 `blocked` 并生成高档卡片；同一运行 10 分钟内建超过 20 个 issue 同样处理（阈值可配）。
   - 三档归类：按 PLAN 4.3 的表把 attention / 事件归入 高 / 中 / 低。
5. **team-layer 插件**：订阅 `issue.created`、`issue.updated`，调用上述规则；状态存插件 `state`；暴露 `team.ask / team.notice / team.resolve / team.later` 四个工具。
6. **配置脚本** `scripts/setup-research.mjs`：用部门包建"科研部"（主管 + 2 名员工，Claude + Codex）。
7. **主管技能包**：拆活、派活、`blockedByIssueIds`、每轮结束必须有明确动作（Phase 0 发现）、写 `report` 文档并置 `in_review`。

## 验收（PLAN 第 9 节 P1）
- 配置脚本建出科研部；下达一个需拆成 2 个子任务的项目，主管拆活、两人并行完成后主管只被唤醒一次并写出汇报。
- 第 3 次返工、第 9 层子任务都会生成卡片。
- 单元测试覆盖闸门、返工、跳数（以及三档归类）。
