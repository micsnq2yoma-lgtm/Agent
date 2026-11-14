# Paperclip 源码改动记录

- 源码位置：`vendor/paperclip`（独立 git 仓库，remote `origin` = github.com/paperclipai/paperclip）
- 基线：上游 commit `d69631b`（npm 版本 2026.1106.0），工作分支 `agentself`
- 许可：MIT，保留其 LICENSE 与版权声明

每次修改 Paperclip 源码时在下面追加一行：日期 · 范围 · 原因 · 本仓库提交 / vendor 提交。

| 日期 | 范围 | 改动 | 原因 |
| --- | --- | --- | --- |
| 2026-11-14 | — | 克隆源码，建 `agentself` 分支，尚无改动 | v0.4 决定源码内置 |

## 待做
- 后台中文化：`ui/src/i18n` 已有 i18next 框架和 40 种语言文件，但每个文件只有几条词条；界面约 940 个 `.tsx` 文件，文字大多硬编码，需要分批抽取到 `en.json` / `zh-CN.json`，并把默认语言设为 `zh-CN`。
- 修复：删除 company 时违反外键 `decisions_origin_run_id_heartbeat_runs_id_fk`（`server/src/services/company-deletion`），需先删 decisions。
