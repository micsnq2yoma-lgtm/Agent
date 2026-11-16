# AGENTS.md

AgenTeam（原名 Agentself）：建在 Paperclip（`vendor/paperclip`，它有自己的 AGENTS.md）上的自动化 AI 团队。用中文交流。

- **验收**：如果你是被 `scripts/dev/acceptance-watch.mjs` 启动来做验收的，先读 `docs/acceptance/MAINTAINER.md` 并严格照做：只验收、不改代码、不提交推送，结果按规定格式评论回 PR。
- 目录说明和安装、更新方法见 `README.md`；对 Paperclip 源码的改动记录在 `docs/paperclip-changes.md`。
- 单元测试：仓库根目录 `pnpm test`；验收脚本在 `scripts/acceptance/`。
