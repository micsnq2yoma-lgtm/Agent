# Agentself · 交接包 v0.3（全新开始）

Agentself 是一支自动化 AI 团队：用户下达目标，部门主管拆活、派给员工（Claude Code / Codex），员工在用户不在场时把活干完，只把需要人决定的事做成卡片。基座是 Paperclip（MIT，作为依赖使用），我们只写"团队层"插件和前端。

## 目录
- `docs/PLAN.md`：v0.3 项目方案（由用户从方案文档导出放入）。**唯一的需求来源。**
- `docs/handoff/START.md`：开工说明（先读）。
- `docs/handoff/design/boards/`：五张设计稿（`.dc.html` 源文件，读标记即可；在线画布 https://claude.ai/artifact/J4Z2hYuX1yKTCuhCEJP2Qx 最下面两行）。
  - `Home.dc.html` 工作台：AGENTSELF 字标 + 理念 + 输入框，下方横排结果卡片，点"展开"整行显示详情。
  - `Team.dc.html` 像素团队：顶部切换进入，办公室铺满主区，名牌带模型名。
  - `Settings.dc.html` 设置页；`ProjectDrawer.dc.html` 项目抽屉；`EmployeeDrawer.dc.html` 员工抽屉。
- `docs/handoff/design/v0.1-pixel-office.html`：像素办公室 v0.1 的 canvas 代码，P3 拆成 `packages/pixel-office`，人物换成设计稿里的原创像素机器人（眼睛：暖黄 = Claude，青色 = Codex）。
