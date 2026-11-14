# Agentself

把注意力放在真正有价值的事情上 · Put your attention on what truly matters.

Agentself 是一支自动化 AI 团队：你下达目标，部门主管拆活、派给员工（本机已登录的 Claude Code / Codex），员工在你不在场时把活干完，只把需要你决定的事做成卡片。基座是 [Paperclip](https://github.com/paperclipai/paperclip)（MIT，源码内置于 `vendor/paperclip`）。

方案：`docs/PLAN.md`（v0.4）。各阶段计划与报告：`docs/phase-*-plan.md` / `docs/phase-*-report.md`。

## 目录

```
apps/console/        工作台网页（React）+ 本地服务（前台、IM、设置、记忆、部门向导、办公室快照）
plugins/team-layer/  Paperclip 插件：返工计数、跳数上限、卡片工具 team.ask/notice/resolve/later、记忆任务
plugins/im-feishu/   飞书通道（长连接，无需公网地址）
packages/shared/     类型：卡片、消息、部门包、办公室快照
packages/skins/      皮肤：办公室（默认）、朝堂；共享皮肤校验与注册
packages/pixel-office/ 像素办公室 canvas 渲染（原创 8×8 像素机器人）
skills/              主管 / 员工 / 记忆技能包
packs/departments/   部门包示例：科研部、公司部、生活部
scripts/             启动、建部门、开机自启、验收脚本、界面中文化工具
vendor/paperclip/    Paperclip 源码（已为 Windows 与中文化修改，见 docs/paperclip-changes.md）
```

## 运行（Windows 11，Node 24.11+，pnpm 9.15+）

```powershell
# 1. 依赖与构建
cd vendor\paperclip; pnpm install; pnpm build; cd ..\..
pnpm install
pnpm --filter @agentself/console build
cd plugins\team-layer; node build.mjs; cd ..\..

# 2. 启动（Paperclip :3100 + 工作台 :3200，崩溃自动重启，日志在 ~/.agentself/logs）
node scripts\start.mjs

# 3. 首次：安装团队层插件并建一个示例部门
#    （插件：POST /api/plugins/install {packageName:"<repo>\\plugins\\team-layer", isLocalPath:true}）
node scripts\setup-department.mjs packs\departments\research.json

# 4. 打开 http://127.0.0.1:3200
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
```

## 许可

MIT。包含并修改了 Paperclip（MIT，© Paperclip AI），见 `NOTICE`。MyAgents（AGPL）只借鉴思路，未打开或复制其代码。
