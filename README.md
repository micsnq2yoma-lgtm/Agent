# Agentself

把注意力放在真正有价值的事情上 · Put your attention on what truly matters.

Agentself 是一支自动化 AI 团队：你对"总管"说一句话就可以离开；总管理解你的意图，小事直接派给合适的员工，大事让员工先出计划等你同意。员工（本机已登录的 Claude Code / Codex）各管一个领域，一个人从头做到尾，只在必须你拍板时发卡片，最后交付一页结论加证据。员工由你自己命名和分类，没有预设。基座是 [Paperclip](https://github.com/paperclipai/paperclip)（MIT，源码内置于 `vendor/paperclip`）。

方案：`docs/PLAN.md`（v0.5）；当前方向与需求清单：`docs/v0.6-direction.md`。各阶段计划与报告：`docs/phase-*-plan.md` / `docs/phase-*-report.md`。

## 目录

```
apps/console/        工作台网页（React）+ 本地服务（前台、IM、设置、记忆、部门向导、办公室快照）
plugins/team-layer/  Paperclip 插件：返工计数、跳数上限、卡片工具 team.ask/notice/resolve/later、记忆任务
plugins/im-feishu/   飞书通道（长连接，无需公网地址）
packages/shared/     类型：卡片、消息、部门包、办公室快照
packages/skins/      皮肤：办公室（默认）、朝堂；共享皮肤校验与注册
packages/pixel-office/ 像素办公室 canvas 渲染（原创 8×8 像素机器人）
skills/              员工 / 记忆技能包
packs/departments/   员工包示例（按分类）：科研、公司、生活；只是示例，可以不用
scripts/             启动、建部门、开机自启、验收脚本、界面中文化工具
vendor/paperclip/    Paperclip 源码（已为 Windows 与中文化修改，见 docs/paperclip-changes.md）
```

## 运行（Windows 11，Node 24.11+，pnpm 9.15+）

```powershell
# 1. 依赖与构建
cd vendor\paperclip; pnpm install; pnpm build; cd ..\..
pnpm install
cd vendor\paperclip\ui; pnpm exec vite build; cd ..\..\..   # 界面（Paperclip + Agentself 视图）
cd plugins\team-layer; node build.mjs; cd ..\..

# 2. 启动：对外只有一个应用 :3100；Agentself 本地服务只听本机 :3200，
#    由 Paperclip 经 /agentself/api 反向代理。崩溃自动重启，日志在 ~/.agentself/logs
node scripts\start.mjs

# 3. 首次：安装团队层插件并建一个示例部门
#    （插件：POST /api/plugins/install {packageName:"<repo>\\plugins\\team-layer", isLocalPath:true}）
node scripts\setup-department.mjs packs\departments\research.json

# 4. 打开 http://127.0.0.1:3100（默认首页就是工作台）
```

开机自启：`powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`（`-Remove` 卸载）。

飞书：在设置页填 App ID、白名单 open_id 并启用；App Secret 放在环境变量 `AGENTSELF_FEISHU_APP_SECRET`（不写进任何文件）。

## 测试

```powershell
pnpm test                                   # 团队层规则、卡片、前台、办公室、记忆、IM、皮肤（Vitest）
node scripts\acceptance\p1-rules.mjs        # 第 3 次返工 / 第 9 层子任务生成卡片（不耗额度）
node scripts\acceptance\p1-research.mjs     # 科研部真实拆活→并行→闸门→汇报（耗额度）
node scripts\acceptance\p2-console.mjs      # 只用工作台完成前台即答、答卡片、稍后、确认汇报
node scripts\acceptance\p3-console.mjs      # 皮肤切换、向导建部门、用量面板、像素办公室
node scripts\acceptance\p4-memory.mjs       # 跨项目记忆 + 空闲整理 git 提交（耗额度）
node scripts\acceptance\p6-skin.mjs         # 皮肤包导入导出
node scripts\acceptance\p8-shell.mjs        # 一个端口、一条侧栏、卡片→抽屉→任务页→运行记录、隐藏页可直达（耗少量额度）
node scripts\acceptance\p9-skin.mjs         # 皮肤管到管理页：配色、称呼、像素头像；默认皮肤不出现"智能体"
node scripts\acceptance\p10-pages.mjs       # 侧栏每项都在应用内、无重复入口、部门页 / 员工完整页 / 合并页 / 统计条 / 高级新建
```

## 许可

MIT。包含并修改了 Paperclip（MIT，© Paperclip AI），见 `NOTICE`。MyAgents（AGPL）只借鉴思路，未打开或复制其代码。
