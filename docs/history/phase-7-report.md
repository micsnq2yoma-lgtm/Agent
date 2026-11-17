# Phase 7 报告 · Paperclip 后台中文化

日期：2026-11-14（用户在 v0.4 决定中提出；不在原 P0–P6 路线里）

## 做了什么
- 翻译层 `vendor/paperclip/ui/src/i18n/dom-translate.ts`：按词典精确匹配替换界面文字和 placeholder / title / aria-label / alt；带数字的动态文字用规则处理（"5m ago"→"5 分钟前"、"3 issues"→"3 个任务"、"Finished …"→"…完成" 等）；跳过编辑器、代码块、输入框和 Markdown 正文，不改用户内容。MutationObserver 跟随页面变化。
- 词典 `vendor/paperclip/ui/src/i18n/zh-CN-dom.json`：7532 条。由 `scripts/i18n/extract.mjs` 从 1489 个界面源文件抽取，`scripts/i18n/translate.mjs` 用本机 Haiku 按统一术语表翻译（任务 / 智能体 / 例行任务 / 管理台 …），`scripts/i18n/check-ui.mjs` 逐页找漏译再补。
- 默认中文：`main.tsx` 启动翻译层，i18next 默认 `zh-CN`，`index.html` `lang="zh-CN"`。切回英文：浏览器控制台 `localStorage.setItem("paperclip.locale","en")` 后刷新。
- Paperclip 改为托管构建好的静态界面（`PAPERCLIP_UI_DEV_MIDDLEWARE=false`，`scripts/start.mjs` 已设置），首屏不再等 Vite 编译。

## 怎么验收
- 11 个主要页面（仪表盘、任务、智能体、项目、组织图、例行任务、技能、费用、审批、设置、收件箱）巡检：剩余英文 39 处，全部是专有名称（Claude Code、Codex、技能 slug、任务编号）。截图 `spikes/shots/paperclip/`。
- `vendor/paperclip/ui/src/i18n/dom-translate.test.ts` 4 项通过；页面无 JS 错误。

## 已知限制
- 机器翻译，少数措辞可能不地道；改 `zh-CN-dom.json` 后需 `pnpm --filter @paperclipai/ui build`。
- 由多个文字节点拼成的句子（如动态生成的活动描述"xx changed status from …"）可能半中半英。
- 上游新增的界面文字需要重新运行 extract → translate。
