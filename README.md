# Agentself

把注意力放在真正有价值的事情上 · Put your attention on what truly matters.

Agentself 是一支自动化 AI 团队：你说一句话就可以离开。路由把它交给最合适的主管；主管理解你的意图、写好验收标准，大事先给你计划，再派一名员工（本机已登录的 Claude Code / Codex）从头做到尾；员工逐条附证据交付，主管验收后给你一页结论。主管和员工都由你命名，没有预设。基座是 [Paperclip](https://github.com/paperclipai/paperclip)（MIT，源码内置于 `vendor/paperclip`）。

方案：`docs/PLAN.md`（v0.5）；当前方向与需求清单：`docs/v0.6-direction.md`（与 PLAN 冲突时以它为准）；界面设计规范：`docs/handoff/design/DESIGN.md`（v0.6 SETO 风格）。各阶段计划与报告：`docs/phase-*-plan.md` / `docs/phase-*-report.md`（历史记录）。

## 目录

```
apps/console/        本地服务 :3200（路由、IM、设置、记忆、全局档案、团队向导、招人审批）+ 主管 / 员工用的团队 MCP 服务
vendor/paperclip/ui/src/agentself/  工作台等 Agentself 页面（挂在 Paperclip 界面里）
plugins/team-layer/  Paperclip 插件：返工上限、跳数上限、卡片与稍后提醒、结构化验收与独立核查、盯守、记忆整理
plugins/im-feishu/   飞书通道（长连接，无需公网地址）
packages/shared/     类型：卡片、消息、部门包、办公室快照
packages/skins/      皮肤：办公室（默认）、朝堂；共享皮肤校验与注册
packages/pixel-office/ 像素办公室 canvas 渲染（原创 8×8 像素机器人）
skills/              主管 / 员工 / 记忆技能包
packs/departments/   新建团队用的空白模板（主管和员工都由你命名）
scripts/             启动、建团队、开机自启、验收脚本、界面中文化工具；dev/ 下是截图和删除团队的小工具
vendor/paperclip/    Paperclip 源码（已为 Windows 与中文化修改，见 docs/paperclip-changes.md）
```

## 安装（每台电脑一套，Windows 11，Node 24.11+，pnpm 9.15+，Git）

三台电脑各装一套，互不依赖：各自登录自己的 Claude / Codex 订阅，各自配置 API key，数据各自保存在本机。

```powershell
git clone https://github.com/micsnq2yoma-lgtm/Agentself.git
cd Agentself
node scripts\install.mjs     # 检查环境 → 安装依赖并构建 → Paperclip 首次配置 → 启动 → 安装团队层插件 → 开机自启
```

装完打开 http://127.0.0.1:3100，在侧栏"主管"旁边的 + 新建第一位主管和员工。

先装好并登录：
- Claude Code：`npm i -g @anthropic-ai/claude-code`，运行 `claude` 登录这台电脑的订阅（主管、路由、核查员都用它）
- Codex（可选）：`npm i -g @openai/codex`，`codex login`

## 更新

设置 → 通用 → 版本与更新：检查更新、立即更新，或者打开"每天自动更新"（到点且没有员工在干活时更新）。命令行等价于：

```powershell
node scripts\update.mjs --check   # 有没有新版本
node scripts\update.mjs           # 备份数据库和 ~/.agentself → 停止 → 拉取 main → 只装 / 只构建改动的部分 → 启动 → 健康检查
```

新版本起不来时自动回退到上一个版本并重新启动；数据库不自动恢复（新版本可能已经迁移过），备份在 `~/.agentself/backups/`，最多留 5 份。日志在 `~/.agentself/logs/update.log`。

每个 PR 和 main 上的提交都会在 GitHub Actions 里跑单元测试（Linux 和 Windows）和完整构建（`.github/workflows/ci.yml`）。

## 手动运行

```powershell
node scripts\start.mjs   # 对外只有 :3100；Agentself 本地服务只听本机 :3200，由 Paperclip 经 /agentself/api 反向代理。崩溃自动重启，日志在 ~/.agentself/logs
node scripts\stop.mjs    # 停止
node scripts\build.mjs   # 手动重新构建（--install 先装依赖，--ui 只构建界面）
node scripts\setup-department.mjs scripts\acceptance\fixtures\research.json   # 验收用的示例团队；日常在应用里用向导新建
```

Windows 上不要直接在 `vendor\paperclip` 里跑 `pnpm build`：Paperclip 的构建脚本要用 Git Bash，`build.mjs` / `install.mjs` / `update.mjs` 会自动找到并交给 pnpm。一定要手动跑时，先在 PowerShell 里设 `$env:npm_config_script_shell = "C:\Program Files\Git\bin\bash.exe"`（换成本机 Git 的位置）。

开机自启：`powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`（`-Remove` 卸载）。

飞书：在设置页填 App ID、白名单 open_id 并启用；App Secret 放在环境变量 `AGENTSELF_FEISHU_APP_SECRET`（不写进任何文件）。要你拍板的卡片、新建员工请求和通知都会推送，按钮直接生效。

邮箱：设置 → 邮箱，填地址和授权码（IMAP）。授权码存进 Paperclip 密钥库（和 API key 一样），员工运行时才拿到。员工只读邮件、存回复草稿，不会替你发送。

论文库：侧栏"论文库"，存放位置在 设置 → 论文库 里指定（任意文件夹）。员工和主管都能检索。

工具服务（MCP）：能力与工具 → 工具服务，从精选里装或自定义，选给哪些员工用。

模型：设置 → 模型与订阅。订阅用本机登录的 Claude Code 和 Codex；其余模型填 API key（存进 Paperclip 密钥库）。

## 测试

```powershell
pnpm test                                   # 团队层规则、卡片、前台、办公室、记忆、IM、皮肤（Vitest）
node scripts\acceptance\p1-rules.mjs        # 第 2 次返工 / 第 9 层子任务生成卡片（不耗额度）
node scripts\acceptance\p1-research.mjs     # 主管写任务书和验收标准→派一名员工→证据→独立核查→汇报待确认（耗额度）
node scripts\acceptance\p2-console.mjs      # 只用工作台完成即时回答、答卡片、稍后、确认汇报、新建员工审批
node scripts\acceptance\p3-console.mjs      # 皮肤切换、向导建团队（跑完自动删除）、用量面板、像素办公室
node scripts\acceptance\p4-memory.mjs       # 跨项目记忆 + 空闲整理 git 提交（耗额度）
node scripts\acceptance\p6-skin.mjs         # 皮肤包导入导出
node scripts\acceptance\p8-shell.mjs        # 一个端口、一条侧栏、卡片→抽屉→任务页→运行记录、隐藏页可直达（耗少量额度）
node scripts\acceptance\p6-share.mjs        # 共享皮肤（需另起一个实例）
node scripts\acceptance\p9-skin.mjs         # 皮肤管到管理页：配色、称呼、像素头像；默认皮肤不出现"智能体"
node scripts\acceptance\p10-pages.mjs       # 侧栏结构、无重复入口、主管页 / 员工完整页 / 合并页 / 设置分标签 / 项目抽屉 / 高级
```

删除测试或不用的团队：`node scripts\dev\remove-team.mjs <团队名>`（先列出要删的内容，加 `--yes` 才执行）。预算因为中途取消的运行一直暂停：`node scripts\dev\budget-unstick.mjs`（同样加 `--yes` 才执行）。

## 许可

MIT。包含并修改了 Paperclip（MIT，© Paperclip AI），见 `NOTICE`。MyAgents（AGPL）只借鉴思路，未打开或复制其代码。
