# 开工说明

## 阅读顺序
1. `docs/PLAN.md` 全文。重点：第 3 节概念映射、第 4 节团队层、第 7 节界面、第 9 节路线、第 10 节执行说明。
2. 本目录 `README.md` 和 `design/boards/` 的五张设计稿。

## 项目事实
- 名字 Agentself，仓库 / 包名 `agentself`，许可 MIT。
- 基座 Paperclip，作为依赖运行，锁定版本，不改核心。接口以运行实例的 `GET /api/openapi.json` 为准，PLAN 里的字段名与实例不一致时以实例为准并记录。
- 目标平台：一台常开的 Windows 11 电脑，本地网页访问；手机端不做。
- 员工 = 本机已登录的 Claude Code / Codex（适配器 `claude_local` / `codex_local`）。
- IM 本期只接飞书；皮肤本期只做默认"办公室"皮肤，但结构要允许皮肤改配色、字体、素材、术语和布局。

## 硬约束
- 不改 Paperclip 核心；锁定 `@paperclipai/plugin-sdk` 和 `@paperclipai/shared` 版本。
- 不打开、不复制、不改写 MyAgents（AGPL）的源码；只能按 PLAN 里描述的思路自己实现。
- 员工形象只用原创像素机器人，不使用任何官方吉祥物形象。
- 不提交密钥，不自动 push。
- 界面文案走皮肤术语表，不硬编码"主管""员工"等词。
- 团队层规则（等齐、返工计数、跳数上限、三档归类）都要有 Vitest 单元测试。

## 工作方式
- 一次只做一个 Phase。开始前写 `docs/phase-N-plan.md`，结束写 `docs/phase-N-report.md`（做了什么、怎么验收、与方案的偏差），然后停下等用户验收。
- 与方案冲突、或验证失败时，停下列出选项让用户决定，不自行改架构。

## 第一个任务：Phase 0 验证
按 PLAN 第 10 节"首个任务"的 8 项逐项验证（Windows 常驻、OpenAPI 字段核对、两个适配器跑通、Studio 闸门、Decision 唤醒、最小插件与整页界面、订阅额度可得性、报告），输出 `docs/phase-0-report.md`，每项写通过 / 不通过 / 替代方案。Phase 0 只做验证用的最小代码，不开始正式开发。
