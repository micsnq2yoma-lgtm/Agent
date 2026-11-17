# 使用与开发手册

从 README 拆出来的细节：手动运行、各功能的配置位置、多机验收、测试脚本。

## 手动运行

```powershell
node scripts\start.mjs   # 对外只有 :3100；AgenTeam 本地服务只听本机 :3200，由 Paperclip 经 /agenteam/api 反向代理。崩溃自动重启，日志在 ~/.agenteam/logs
node scripts\stop.mjs    # 停止
node scripts\build.mjs   # 手动重新构建（--install 先装依赖，--ui 只构建界面）
node scripts\setup-department.mjs scripts\acceptance\fixtures\research.json   # 验收用的示例团队；日常在应用里用向导新建
```

Windows 上不要直接在 `vendor\paperclip` 里跑 `pnpm build`：Paperclip 的构建脚本要用 Git Bash，`build.mjs` / `install.mjs` / `update.mjs` 会自动找到并交给 pnpm。一定要手动跑时，先在 PowerShell 里设 `$env:npm_config_script_shell = "C:\Program Files\Git\bin\bash.exe"`（换成本机 Git 的位置）。

开机自启：`powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`（`-Remove` 卸载）。

飞书：在设置页填 App ID、白名单 open_id 并启用；App Secret 放在环境变量 `AGENTEAM_FEISHU_APP_SECRET`（不写进任何文件）。要你拍板的卡片、新建员工请求和通知都会推送，按钮直接生效。

邮箱：设置 → 邮箱，填地址和授权码（IMAP）。授权码存进 Paperclip 密钥库（和 API key 一样），员工运行时才拿到。员工只读邮件、存回复草稿，不会替你发送。

论文库：侧栏"论文库"，存放位置在 设置 → 论文库 里指定（任意文件夹）。员工和主管都能检索。

工具服务（MCP）：能力与工具 → 工具服务，从精选里装或自定义，选给哪些员工用。

模型：设置 → 模型与订阅。订阅用本机登录的 Claude Code 和 Codex；其余模型填 API key（存进 Paperclip 密钥库）。

## 多机验收

开发在云端会话里进行，验收在你自己的 Windows 电脑上做，两边通过 GitHub PR 自动协作：开发方在 PR 上发「验收请求」并打上「待验收」标签；验收机上的轮询脚本发现后切到 PR 版本、构建、重启，交给本机的 Codex 跑验收，把结果评论回 PR 并打上「已验收」或「需修改」；开发方据此修复，直到通过。一台电脑的准备步骤见 `docs/acceptance/MAINTAINER.md` 末尾（装 gh 和 Codex 并登录，然后 `node scripts\dev\acceptance-watch.mjs --install --machine <名称>`）。

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

