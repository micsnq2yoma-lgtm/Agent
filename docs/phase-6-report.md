# Phase 6 报告 · 分享

日期：2026-11-14

> 计划说明：未单独写 `phase-6-plan.md`；计划要点见下文。

## 做了什么
- **部门包导出**（`scripts/lib/share.mjs`，`GET /agentself/departments/export?key=<部门>`）：从运行中的 Paperclip 读出部门的 project、主管、员工（适配器、模型、能力、预算、identity 正文）、技能和例行任务，生成 `agentself.department/1` JSON。
- **部门包导入**：与新建部门向导、配置脚本共用 `createDepartment`（校验 → 技能 → project → 主管 / 员工 → 例行任务 → 记忆目录 → 注册团队层插件）。
- **皮肤包**：任意皮肤可在设置页导出为 JSON；"导入皮肤包…"上传后校验（id、全部 token、全部术语），存到 `~/.agentself/skins/`，刷新后保留，立即可用。

## 怎么验收
| 验收项（PLAN 第 9 节 P6） | 结果 | 证据 |
| --- | --- | --- |
| 把科研部导出为部门包，在全新实例里导入后能直接工作 | 通过 | `scripts/acceptance/p6-share.mjs`：用 `PAPERCLIP_INSTANCE_ID=p6test` 起一个全新实例（:3101），装插件、导入导出的包，主管 + 2 名员工建成；派给导入的文献员的任务直接 `done`，回复里还注明用到了记忆 |
| 皮肤包同理 | 通过 | `scripts/acceptance/p6-skin.mjs`：导入"实验室"皮肤（组长 / 周报 / 实验台），术语和强调色生效，导出 JSON 正确，刷新后保留 |

## 说明
- 测试实例 `p6test` 已停止，数据在 `~/.paperclip/instances/p6test`，工作目录在 `~/.agentself-p6test`，可以删除。
- 部门包不含密钥和记忆中的用户数据（只带 identity 正文）。
