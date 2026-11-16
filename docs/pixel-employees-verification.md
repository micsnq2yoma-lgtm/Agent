# 像素员工验证记录

验证环境：Windows，Node 24.16.0，pnpm 9.15.9；基于 main `5bd457dfb7b781d671c4feb20017dd88f82b2c7a`。

| 检查 | 结果 |
| --- | --- |
| 根工作区 `pnpm exec vitest run` | 18 个文件、166 项测试通过，包括模型识别、全部帧边界、暂停静止、办公室布局/行走中断和快照标题 |
| UI `vitest run src/agentself/lib/avatar.test.ts src/components/AgentAvatar.test.tsx` | 2 个文件、6 项通过；覆盖挂载后的身份更新、兼容接口模型、公司切换、状态及动态效果 |
| UI `node ../scripts/storybook-catalog.mjs` 后 `tsc --noEmit -p tsconfig.json` | 通过 |
| UI `vite build` | 通过 |
| Paperclip `pnpm build` | 完整工作区构建通过，保留上游 chunk 大小和 Windows Copilot runtime unsupported-platform 提示 |
| `check-token-gates.mjs`、`sync-agent-palette-tokens.mjs --check`、`sync-cliplab-character.mjs --check` | 通过 |
| 全帧图鉴 | 10 个模型 × 11 个动作 × 4 帧；检查整数像素、边界、不同轮廓，图鉴附于说明文档 |
| 浏览器视觉验证 | Chrome 中用实际 OfficeRenderer 和办公室 CSS 加载七种演示状态；检查 Codex、鲸鱼、道具、气泡、长标题省略及两排工位 |

## 2026-11-16：LOGO 灵感重设计复核

- Gemini、Kimi、GLM、Qwen、MiniMax、Grok 按官方标志的几何结构重新绘制；官方参考链接见实现说明。检查浅色、深色背景，以及 10 × 11 状态图鉴。
- 根工作区完整 Vitest：19 个文件、169 项通过。新增三家已确认形象的 RGBA 回归基线，每家覆盖 11 动作 × 4 帧 × 普通/去色两种模式，同时锁定尺寸和帧时长。
- 专项测试：6 个文件、54 项通过，覆盖模型识别、全部帧边界、暂停、布局和绘制。逐格边界检查改为批量报告异常，保留所有条件，避免密集像素引起断言开销超时。
- UI 完整 TypeScript 检查和 Vite 生产构建通过；原有 chunk 大小提示保留。
- 同色相邻矩形合并前后的 880 帧像素一致性另经只读审查确认；Claude、DeepSeek、Codex 的批准基线全部通过。
- 更新静态总览、六家造型近景和离线动画图鉴；没有增加交互功能、工作状态推测或改变对话框逻辑。
- 根 `tsc -b` 因仓库没有根 `tsconfig.json` 无法执行，改用实际消费共享像素库的 UI 配置完成类型检查。本次未重复此前受环境阻断的 Rust/server 全仓检查，下列限制仍然有效。

## 保留的失败与限制

- 首次根测试在沙箱中出现回环请求、Git 临时仓库及文件移动权限失败；相同测试在正常进程中完整通过，没有跳过失败测试。
- 最初仍按旧的“随机身体色机器人”断言头像；已更新为新的模型形象契约。UI 类型检查发现的模板 `PackMember.model` 不存在引用已移除，并保留原有头像 URL 调用的主题参数兼容。
- 依赖安装先遇到根锁文件与 console 清单不一致；仅同步对应 importer，保留其余依赖锁定。Paperclip 原 `.npmrc` 指向本机不存在的 Bash，验证时使用本进程环境覆盖为已安装 Git Bash，并加入临时 pnpm PATH；未修改全局配置。
- 全仓 `pnpm -r typecheck` 在 runner 的 Rust 检查处因 `cargo: command not found` 停止；UI 的独立完整类型检查已通过。未安装或修改 Rust 工具链。
- 全仓 `pnpm test:run` 的 workspace-link preflight 通过，随后 Windows stable runner 报 `spawn pnpm ENOENT`，未执行其全套 server suites。该结果没有被局部通过替代。
- 浏览器使用演示快照，不连接真实员工任务；尚未执行完整后端任务生命周期端到端测试。窄屏布局边界通过自动化检查，未进行移动设备真机验收。
- GitHub CI 和外部审查在 PR 创建后另行确认，本记录不声称这些检查已经通过。
