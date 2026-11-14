# Paperclip 源码改动记录

- 源码位置：`vendor/paperclip`，已并入主仓库（上游 github.com/paperclipai/paperclip，不再保留独立 .git）
- 基线：上游 commit `d69631b`（npm 版本 2026.1106.0），工作分支 `agentself`
- 许可：MIT，保留其 LICENSE 与版权声明

每次修改 Paperclip 源码时在下面追加一行：日期 · 范围 · 原因 · 本仓库提交 / vendor 提交。

| 日期 | 范围 | 改动 | 原因 |
| --- | --- | --- | --- |
| 2026-11-14 | — | 克隆源码并入主仓库 | v0.4 决定源码内置 |
| 2026-11-14 | `scripts/link-plugin-dev-sdk.mjs`、`scripts/ensure-workspace-package-links.ts` | Windows 上用 junction 代替目录 symlink | 无管理员 / 开发者模式时 symlink 报 EPERM，install 和 build 失败 |
| 2026-11-14 | `.npmrc` | `script-shell=D:/Application/Git/bin/bash.exe` | 包脚本用 `mkdir -p`、`cp` 等 POSIX 命令，cmd 下失败。注意：路径是本机 Git 路径，换机器要改 |
| 2026-11-14 | 仓库根 `.gitattributes` | 全仓库 LF | autocrlf 把源码检出为 CRLF，runner 的生成物校验报 stale |
| 2026-11-14 | `packages/paperclip-runner/scripts/check-runner-workflow-traceability.mjs` | 动态 import 用 `pathToFileURL` | Windows 绝对路径不能直接 import |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-binary-optional.mjs`、`package.json` 的 `build:binary` | Windows 无 cargo 时跳过 runnerd 二进制 | 上游发布包本身也没有 Windows 二进制 |
| 2026-11-14 | `packages/paperclip-runner/scripts/build-inputs.mjs` | Windows 下不要求 runnerd 产物；`--finish` 找不到按 ppid 命名的记录时取最新的 pending 记录 | Git Bash 下 begin/finish 的父进程号不一致 |
| 2026-11-14 | `server/src/services/company-deletion.ts` | 删除运行记录前先删 `decisions`、`decision_bundles` | 外键 `decisions_origin_run_id_heartbeat_runs_id_fk` 导致删除 company 返回 500（已验证修复） |

## 待做
- 后台中文化：`ui/src/i18n` 已有 i18next 框架和 40 种语言文件，但每个文件只有几条词条；界面约 940 个 `.tsx` 文件，文字大多硬编码，需要分批抽取到 `en.json` / `zh-CN.json`，并把默认语言设为 `zh-CN`。

## 运行方式
- 构建：`cd vendor/paperclip && pnpm install && pnpm build`（pnpm 9.15+）
- 启动：`cd vendor/paperclip && pnpm paperclipai run`（数据目录 `~/.paperclip/instances/default`，与之前 npx 版相同）
