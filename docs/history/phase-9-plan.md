# Phase 9 计划 · 统一视觉与叫法

日期：2026-11-14　依据：`docs/PLAN.md` v0.5 第 7.0（三条规则之 2、3）、第 9 节 P9。

> 说明：P8 验收通过后，用户要求把剩下的阶段一次做完再推送。本计划在开工时写好，和 P10 计划同一天连续执行，中间没有停下来等验收。

## 目标
一套皮肤管住整个应用，包括 Paperclip 的管理页；全应用一套叫法；员工形象只用原创像素机器人。

## 做法
1. **皮肤 → Paperclip 样式变量**：`packages/skins` 新增 `paperclipVars(skin, dark)`，把皮肤 token 映射到 Paperclip 的变量。
   - 覆盖背景、前景、卡片、主色、次色、静音、强调、边框、输入框、焦点环、侧栏、圆角、字体。
   - `SkinProvider` 同时写入我们的 `--as-*` 变量和这批 Paperclip 变量。
   - 深浅色跟随 Paperclip 自己的主题（`html.dark`），不再看系统设置。
2. **像素头像**：`packages/pixel-office` 新增 `robotSvg` / `robotDataUrl`。
   - 员工头像统一改走这里：头像组件 `AgentAvatar`、大头像 `AgentCharacter`、头像地址函数 `agentAvatarUrl`。
   - 身体颜色由员工 id 决定，眼睛颜色由适配器决定（Claude 琥珀色、Codex 青色）。
3. **术语进汉化层**：`packages/skins` 新增 `termOverrides(skin)`，给出"智能体→员工、管理台→我、例行任务、子任务"四组替换。
   - `dom-translate.ts` 在词典翻译之后再按当前皮肤替换术语，已经是中文的文本也会替换。
   - 切换皮肤时，从保存的原文重新翻译一遍，避免在已替换过的结果上反复叠加。
4. **皮肤布局**：朝堂皮肤要求侧栏在右侧，在 Paperclip 外壳上通过 `data-layout-sidebar` 实现。
5. **测试**：
   - 单元测试：样式变量映射、术语替换、机器人 SVG。
   - 新增验收脚本 `scripts/acceptance/p9-skin.mjs`。

## 不做
- 不逐个翻改 Paperclip 组件里的颜色，统一通过样式变量换色。
- 不改服务端生成的 PNG 头像。界面不再请求这些图片。
