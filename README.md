<div align="center">

<img src="docs/brand/agenteam-mark.svg" width="72" alt="AgenTeam">

# AgenTeam

**把注意力放在真正有价值的事情上 · Focus your attention on valuable things.**

你说一句话就可以离开。一支由你命名的 AI 团队替你从头做到尾，带着证据交付。

**中文** · [English](README.en.md)

[快速开始](#快速开始) · [它怎么工作](#它怎么工作) · [功能](#功能) · [使用手册](docs/guide.md) · [路线](docs/v0.6-direction.md)

[![stars](https://img.shields.io/github/stars/micsnq2yoma-lgtm/Agentself?style=flat&logo=github)](https://github.com/micsnq2yoma-lgtm/Agentself/stargazers) [![CI](https://img.shields.io/github/actions/workflow/status/micsnq2yoma-lgtm/Agentself/ci.yml?branch=main&label=CI)](https://github.com/micsnq2yoma-lgtm/Agentself/actions/workflows/ci.yml) ![license](https://img.shields.io/badge/license-MIT-blue) ![platform](https://img.shields.io/badge/platform-Windows%2011-informational) ![node](https://img.shields.io/badge/node-%E2%89%A524.11-339933) ![built on](https://img.shields.io/badge/built%20on-Paperclip-orange)

<img src="docs/assets/pixel-office-1440x900.png" width="860" alt="AgenTeam 像素办公室">

</div>

## 它怎么工作

| ① 说一句话 | ② 主管接手 | ③ 员工去做 | ④ 一页结论 |
| --- | --- | --- | --- |
| 路由把事交给最合适的主管 | 理解意图、写验收标准；大事先给你计划 | 本机已登录的 Claude Code / Codex 从头做到尾 | 逐条附证据，主管验收后只给你一页 |

主管和员工都由你命名，没有预设。需要你拍板的事会变成卡片，你不在时可以推送到飞书。

## 适合谁

- ✅ 想把调研、写作、整理这类整件事交出去，而不是一句句盯着对话
- ✅ 已经有 Claude / Codex 订阅，想让它们分工协作
- ✅ 希望每个结论都带证据、有人独立核查
- ❌ 不是多人协作的 SaaS：每台电脑一套，数据只在本机

## 功能

| | |
| --- | --- |
| 🧭 **路由与主管** 一句话派给合适的主管，大事先出计划，你点头再动手 | ✅ **证据与核查** 结构化验收、独立核查员、返工和层数上限，防止跑偏 |
| 👀 **盯守** 长任务自己盯着，到点或出事再叫你 | 🧠 **记忆** 跨项目记忆，空闲时自动整理并提交 |
| 🤖 **多模型** 订阅（Claude / Codex）和任意 API 模型，按员工单独指定，显示价格估算 | 🔌 **工具服务（MCP）** 精选一键安装或自定义，按员工授权 |
| ✉️ **邮箱** 只读邮件、存回复草稿，不替你发送 | 📚 **论文库** arXiv / DOI / PDF 入库，全文检索，员工可用 |
| 💬 **飞书** 长连接，无需公网地址；卡片按钮直接生效 | 🎨 **像素办公室** 每个模型一种像素员工，办公室 / 朝堂皮肤可换 |

## 快速开始

Windows 11，Node 24.11+，pnpm 9.15+，Git。先装好并登录：

- Claude Code：`npm i -g @anthropic-ai/claude-code`，运行 `claude` 登录（主管、路由、核查员都用它）
- Codex（可选）：`npm i -g @openai/codex`，`codex login`

```powershell
git clone https://github.com/micsnq2yoma-lgtm/Agentself.git
cd Agentself
node scripts\install.mjs
```

脚本会检查环境、安装依赖并构建、做 Paperclip 首次配置、启动、安装团队层插件、设置开机自启（十几分钟）。装完打开 <http://127.0.0.1:3100>，在侧栏“主管”旁边点 **+** 新建第一位主管和员工。

多台电脑各装一套，互不依赖：各自登录订阅、配置 API key，数据存在各自本机。

## 更新

设置 → 通用 → 版本与更新，可检查、立即更新或每天自动更新（没有员工在干活时才更新）。命令行：

```powershell
node scripts\update.mjs --check   # 有没有新版本
node scripts\update.mjs           # 备份 → 停止 → 拉取 main → 增量构建 → 启动 → 健康检查
```

新版本起不来会自动回退；数据库不自动恢复，备份在 `~/.agentself/backups/`（留 5 份）。每个 PR 和 main 都在 GitHub Actions 跑单测和完整构建（Linux + Windows）。

## 架构

```
              ┌────────────── 对外只有 :3100 ──────────────┐
   你 / 飞书 ─▶│  Paperclip（任务、运行、界面，vendor/paperclip）│
              │   ├─ team-layer 插件：验收 / 核查 / 盯守 / 记忆整理 │
              │   └─ /agentself/api ─▶ 本地服务 :3200（仅本机）   │
              └──────────────────────────────────────────────┘
                     路由 · 设置 · 团队 MCP · 邮箱 · 论文库 · 飞书
                              │
                 员工：本机 Claude Code / Codex / API 模型
```

| 目录 | 内容 |
| --- | --- |
| `apps/console/` | 本地服务：路由、IM、设置、记忆、团队向导、招人审批，以及主管 / 员工用的团队 MCP |
| `plugins/team-layer/` | Paperclip 插件：返工与跳数上限、卡片、结构化验收、独立核查、盯守、记忆整理 |
| `plugins/im-feishu/` | 飞书通道 |
| `vendor/paperclip/ui/src/agentself/` | 工作台等页面，挂在 Paperclip 界面里 |
| `packages/` | `shared` 类型 · `skins` 皮肤 · `pixel-office` 像素员工与办公室渲染 |
| `skills/` `packs/` | 主管 / 员工 / 记忆技能包；新建团队的空白模板 |
| `scripts/` | 启动、安装、更新、验收脚本、中文化工具 |

代码里的目录、接口路径、环境变量和数据目录仍叫 `agentself`（`~/.agentself`、`/agentself/api`、`AGENTSELF_*`），改名不影响已有安装。

## 文档

- [使用与开发手册](docs/guide.md)：手动运行、邮箱 / 论文库 / MCP / 模型 / 飞书的配置位置、多机验收、测试
- [当前方向与需求清单](docs/v0.6-direction.md)（与历史方案冲突时以它为准）
- [界面设计规范](docs/handoff/design/DESIGN.md) · [像素员工](docs/pixel-employees.md)
- [对 Paperclip 源码的改动](docs/paperclip-changes.md)
- [历史方案与各阶段报告](docs/history/)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=micsnq2yoma-lgtm/Agentself&type=Date)](https://star-history.com/#micsnq2yoma-lgtm/Agentself&Date)

## 许可

MIT。基于并修改了 [Paperclip](https://github.com/paperclipai/paperclip)（MIT，© Paperclip AI），见 `NOTICE`。MyAgents（AGPL）只借鉴思路，未打开或复制其代码。
