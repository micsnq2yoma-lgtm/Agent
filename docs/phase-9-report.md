# Phase 9 报告 · 统一视觉与叫法

日期：2026-11-14　计划：`docs/phase-9-plan.md`

## 做了什么
- **皮肤管到整个应用**：
  - `paperclipVars()` 把皮肤 token 映射到 Paperclip 的 27 个样式变量（`--background`、`--primary`、`--border`、`--sidebar*`、`--radius`、`--font-sans` 等）。
  - `SkinProvider` 写到 `<html>` 的内联样式上，所以会盖过 Paperclip 浅色和深色两套默认值。
  - 深浅色跟随 Paperclip 自己的主题切换。
- **像素机器人头像**：
  - `AgentAvatar` 有员工 id 时直接用 `robotAvatarUrl(id)`。
  - `AgentCharacter`（员工详情页的大头像，原来是动画形象）改为渲染同一个静态机器人；原组件改名 `PaperclipAgentCharacter` 保留，不再使用。
  - `lib/agent-avatar-url.ts`（Paperclip 本来就允许替换的模块）兜底：拿不到员工 id 的地方也画机器人。
  - 眼睛颜色在加载 Agentself 上下文时按适配器登记。
- **一套叫法**：
  - 汉化层增加 `setTermOverrides()`，皮肤变化时由 `SkinProvider` 调用，替换的是可见文字和 placeholder / title / aria-label 属性。
  - 用户内容不替换：编辑器、markdown 正文、代码。
  - 原文按节点保存，切换皮肤时从原文重算，所以朝堂和办公室来回切不会叠加替换。
- **朝堂皮肤侧栏在右侧**：`Layout.tsx` 的主行加 `data-agentself-row`，皮肤布局为 `right` 时整行反向排列。
- **顺手修的问题**：Agentself 页面隐藏 Paperclip 的空面包屑栏和外层内边距（P8 报告偏差 5 里提到的空白栏）。

## 怎么验收
| 验收项（PLAN 第 9 节 P9） | 结果 | 证据 |
| --- | --- | --- |
| 办公室 / 朝堂切换后，工作台、组织图、员工详情、费用页的颜色和称呼一致 | 通过 | 见下方说明 |
| 默认皮肤下全应用不出现"智能体"三个字 | 通过 | 见下方说明 |
| （附）员工头像全是像素机器人 | 通过 | `p9-skin.mjs`：页面上没有任何对 `/api/agent-avatars/` 的图片请求，只有像素机器人的 SVG 头像 |

**颜色和称呼一致。** `scripts/acceptance/p9-skin.mjs` 在两个皮肤下各走一遍 5 个页面：工作台、组织图、全部员工、员工详情、费用。每页检查四件事：
- `--background` 等于该皮肤的背景色；
- 出现该皮肤的"工作台"和"我"的叫法（御书房 / 朕）；
- 员工类页面出现"员工"或"侍郎"；
- 朝堂皮肤下侧栏在右侧。

脚本结论 PASS，跑完后恢复原来的皮肤。截图在 `spikes/shots/p9-*.png`，不入库。

**不出现"智能体"。** 有两层证据：
- `p9-skin.mjs` 在默认皮肤下的 5 个页面统计"智能体"，可见文字和属性里都是 0。
- `p10-pages.mjs` 把检查扩大到侧栏全部入口、部门页 5 个标签、员工页、各合并页及其标签，同样是 0。

**单元测试：**
- `packages/skins` 加了样式变量映射和术语替换的测试；
- `packages/pixel-office` 加了机器人 SVG 的测试；
- `ui/src/i18n/dom-translate.test.ts` 加了术语替换和切换皮肤的测试。

全部 Vitest 69 项通过。

## 与方案的偏差
- **一处术语替换来源扩大了**：Paperclip 自带的技能描述是数据，经词典翻译后会出现"智能体"，也一并替换。原本打算只在 Paperclip 页面替换，后来改为全应用都替换，因为 Agentself 自己的文案本来就用皮肤术语，不受影响。
- **"智能体"只统计看得见的地方**：编辑器、代码块、markdown 正文属于用户和员工写的内容，不做替换，也不计入统计。
- **字体**：朝堂皮肤的字体是 Noto Serif SC，本机没装时会回退到宋体。

## Paperclip 改动登记
都记在 `docs/paperclip-changes.md`：
- `components/AgentAvatar.tsx`
- `components/AgentCharacter.tsx`
- `lib/agent-avatar-url.ts`
- `components/Layout.tsx`（侧栏方向、面包屑）
- `i18n/dom-translate.ts`
