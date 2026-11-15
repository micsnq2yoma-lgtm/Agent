# Agentself · v0.5 交接（合成一个应用）

放到仓库 `docs/handoff/v0.5/`。方案正文：用户导出的 v0.5 方案覆盖 `docs/PLAN.md`。

## v0.5 要做什么
把工作台（apps/console，:3200）和 Paperclip 后台（:3100）合成**一个应用**：以 Paperclip 界面为宿主，一个端口、一条侧栏、一套皮肤、一套叫法。分三期，见 PLAN 第 9 节：
- **P8 合并外壳**：工作台视图迁入 `vendor/paperclip/ui/src/agentself/` 作为路由，默认首页 = 工作台；Paperclip 侧栏换成 Agentself 侧栏；隐藏收件箱、仪表盘、新建任务入口、智能体聊天、Cases、Goals、多公司切换（不删代码）；本地服务接口统一为 `/agentself/api/*`，由 Paperclip 服务反向代理；:3200 前端下线。
- **P9 统一视觉与叫法**：皮肤 token → Paperclip CSS 变量；像素机器人替换员工头像；皮肤术语表接入汉化层（智能体 → 员工，管理台 → 我）。
- **P10 页面整合**：部门页、员工完整页（Paperclip 员工详情 + 档案 / 记忆标签）、能力与工具、用量与预算、记录、设置合并。

## 设计稿（`design/boards/`，都已换成合并后的侧栏）
在线画布：https://claude.ai/artifact/J4Z2hYuX1yKTCuhCEJP2Qx
- `Home.dc.html` 工作台（输入框旁新增"高级新建"）
- `Team.dc.html` 像素团队（顶部新增统计条：运行中 / 阻塞 / 等你拍板 / 本月花费）
- `Dept.dc.html` 部门页（新）
- `Employee.dc.html` 员工完整页（新，侧栏"管理"区展开的样子）
- `ProjectDrawer.dc.html`、`EmployeeDrawer.dc.html`、`Settings.dc.html`

侧栏结构：工作台 · 项目 · 部门（各部门 + 新建）· 管理（默认折叠：组织图、全部员工、能力与工具、例行任务、用量与预算、记录）· 设置 · 我 / 通知。
