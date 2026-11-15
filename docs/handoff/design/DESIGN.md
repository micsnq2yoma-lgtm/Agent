---
version: v0.6-seto
name: Agentself 办公室皮肤 · SETO 风格
description: Agentself v0.6 默认皮肤「办公室」的视觉规范。冷灰底、白色浮层、墨黑主操作、胶囊控件、衬线标题。所有数值直接对应 packages/skins 的 SkinTokens 与 styles.css 的 --as-* 变量。
canvas: https://claude.ai/artifact/QRQj7fpA5MyjfporeVFzXv

colors:
  # ---- 现有 SkinTokens（改值） ----
  bg: "#F5F5F5"            # --as-bg       页面、主区
  sidebar: "#F5F5F5"       # --as-sidebar  侧栏与主区同色，只靠 1px border 分隔
  surface: "#FFFFFF"       # --as-surface  卡片、面板、抽屉内卡、选中导航
  border: "#E1E1E1"        # --as-border
  text: "#0C151D"          # --as-text
  muted: "#5F6266"         # --as-muted    5.6:1 on bg
  accent: "#0C151D"        # --as-accent   主操作 = 墨黑（不再是橙色）
  accentStrong: "#26313B"  # --as-accent-strong  主按钮按下 / 链接悬停
  high: "#C8433A"          # --as-high     要你拍板、运行失败、返工超限、未通过
  medium: "#237A6C"        # --as-medium   交付结果、通过
  low: "#6B6E71"           # --as-low      即时回答、无法判断、次要说明
  success: "#3FA45B"       # --as-success  在线 / 空闲状态点（只做点，不做文字）
  # ---- 新增 SkinTokens（可选，缺省回退见 §3） ----
  brand: "#E3876A"         # --as-brand    字标中的 E、像素场景强调
  onAccent: "#FFFFFF"      # --as-on-accent 主按钮上的字
  surfaceSunken: "#F4F3F1" # --as-surface-sunken 工作台输入框
  surfaceSubtle: "#EDEFEF" # --as-surface-subtle 胶囊切换底、图标按钮、中性标签
  surfaceTile: "#F6F6F7"   # --as-surface-tile   面板内统计块、验收证据块
  borderWarm: "#E1DDDA"    # --as-border-warm    输入框描边
  borderSoft: "#EEEEEE"    # --as-border-soft    表格行线、列表分隔
  textTertiary: "#6B6E71"  # --as-text-tertiary  时间、编号、表头（4.7:1）
  placeholder: "#8F9295"   # --as-placeholder    占位文字、图标（非正文）
  track: "#E3E5E8"         # --as-track          进度条、阶段条未完成段
  avatarBg: "#EEF0F2"      # --as-avatar-bg      像素头像底块

colorsDark:
  bg: "#111316"
  sidebar: "#111316"
  surface: "#1C1F23"
  border: "#2A2E33"
  text: "#F1F2F4"
  muted: "#A7ABB1"
  accent: "#F1F2F4"        # 深色下主按钮反转：浅底深字
  accentStrong: "#FFFFFF"
  high: "#F08A7E"
  medium: "#5CC4AE"
  low: "#9A9FA6"
  success: "#4CC26C"
  brand: "#E3876A"
  onAccent: "#0C151D"
  surfaceSunken: "#171A1D"
  surfaceSubtle: "#262A2F"
  surfaceTile: "#22262A"
  borderWarm: "#2E3237"
  borderSoft: "#25292D"
  textTertiary: "#9A9FA6"
  placeholder: "#80858B"
  track: "#2E3238"
  avatarBg: "#2A2F35"

typography:
  fontBody: "'Inter', 'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', sans-serif"
  fontDisplay: "'Tiempos Headline', 'Cormorant Garamond', 'EB Garamond', 'Source Han Serif SC', 'Noto Serif SC', serif"
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  wordmark:     { family: display, size: 21px, weight: 500, letterSpacing: 0.02em }
  heroWordmark: { family: display, size: 56px, lineHeight: 60px, weight: 500, letterSpacing: 0.02em }
  pageTitle:    { family: display, size: 28px, lineHeight: 36px, weight: 500 }
  panelTitle:   { family: display, size: 22px, lineHeight: 30px, weight: 500 }
  sectionTitle: { family: display, size: 18px, lineHeight: 26px, weight: 500 }
  statNumber:   { family: display, size: 26px, lineHeight: 32px, weight: 500, numeric: "lining-nums tabular-nums" }
  cardTitle:    { family: body, size: 15px, lineHeight: 22px, weight: 600 }
  nav:          { family: body, size: 15px, lineHeight: 20px, weight: 400, activeWeight: 600 }
  body:         { family: body, size: 14px, lineHeight: 22px, weight: 400 }
  label:        { family: body, size: 13px, lineHeight: 20px, weight: 500 }
  caption:      { family: body, size: 12px, lineHeight: 18px, weight: 400 }
  code:         { family: mono, size: 12px, lineHeight: 18px, weight: 400 }

radius:
  control: 9999px   # --as-radius-control 按钮、导航项、标签栏、筛选、输入、徽标
  card: 16px        # --as-radius         现有 token，卡片
  panel: 20px       # --as-radius-panel   右侧面板、输入框、主管页卡片
  drawer: 24px      # 抽屉、应用窗口
  tile: 12px        # 统计块、证据块、缩略图
  checkbox: 5px

spacing: [4, 8, 12, 16, 20, 24, 32, 48]

shadow:
  card: "0 1px 2px rgba(12,21,29,0.04), 0 4px 16px rgba(12,21,29,0.04)"
  nav: "0 1px 3px rgba(12,21,29,0.06)"
  primary: "0 6px 14px rgba(12,21,29,0.22)"
  drawer: "0 24px 60px rgba(12,21,29,0.18)"
  cardDark: "0 0 0 1px rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.32)"
---

# Agentself 设计规范 · v0.6 · SETO 风格

本文件放在 `docs/handoff/design/DESIGN.md`。设计稿画布：Agentself v0.6 界面 · SETO 风格（链接见文件头 `canvas`）。

- 画布里的 7 张图是视觉目标，本文件是实现依据。
- 两者冲突时以本文件为准。
- 文案、流程以 `docs/v0.6-direction.md` 为准。

## 1. 五条原则

1. **两层表面，不靠描边。**
   - 底是 `bg` #F5F5F5，卡片和面板是 `surface` #FFFFFF，靠 `shadow.card` 浮起。
   - 卡片不加边框，不加顶部彩条。
   - 全局唯一的实线是侧栏右侧 1px `border`。
2. **墨黑只给要做的事。**
   - `accent` 改为 #0C151D，用于主按钮、发送、选中的筛选和开关。
   - 橙色 #d9480f 退役。品牌暖色只留给字标的 E（`brand`）和像素场景。
3. **控件一律胶囊，容器圆角随层级变大。**
   - 控件：导航、按钮、标签栏、筛选、输入框都用 `radius.control`。
   - 容器：统计块 12 → 卡片 16 → 面板 20 → 抽屉 24。
4. **颜色只表示信号。**
   - `high` 表示要你决定或出错，`medium` 表示交付或通过，其余一律黑白灰。
   - 卡片类型靠文字加 6px 红点区分，不靠彩色色块。
5. **标题衬线，正文黑体。**
   - 衬线（500）用于字标、页面标题、18px 以上的区块标题和统计数字。
   - 15px 及以下的文字一律用黑体。

## 2. 版式

| 区域 | 规格 |
| --- | --- |
| 侧栏 | 宽 248。内边距 20 / 20 / 24 |
| 侧栏 · 顶部 | 字标（无像素头像），右侧放收起按钮 |
| 侧栏 · 搜索 | 40 高的胶囊，不显示 ⌘K |
| 侧栏 · 导航 | 一级四项：**工作台**（待处理数，红色徽标）、**项目**（数量）、**主管**（各主管 + 新建）、**管理**（默认折叠）。设置固定在底部 |
| 侧栏 · 移除项 | 「我 / 通知」模块。待处理数只在「工作台」项上显示 |
| 顶栏 | 高 64，**无底边线**。左边面包屑，中间（仅工作台）放「工作台 / 像素团队」切换，右边放页面级操作。不再放「N 件等你拍板」徽标 |
| 工作台主区 | 内容最宽 760、居中。从上到下：字标 56px → 英文理念 → 待你处理（筛选 + 卡片）→ 底部固定输入框（距底 24） |
| 工作台右侧 | 「任务进展」面板。宽 340，距窗口 24，圆角 20，按主管分组 |
| 管理页 | 内容最宽 1180。主列加 320 侧列，间距 20 |
| 抽屉 | 宽 560。从窗口右侧浮起，四周留 12，圆角 24。遮罩 `rgba(12,21,29,.18)` |
| 断点 | ≤ 1100：隐藏右侧面板，任务进展移到「项目」页。≤ 760：隐藏侧栏（现有规则），卡片单列 |

工作台三块对应 v0.6 的「输入框、待决定卡片、任务进展」：

- **输入框**：固定在底部。
- **待决定卡片**：放在中部，叫「待你处理」。
- **任务进展**：放在右侧面板。

## 3. Token 接入（packages/skins）

`cssVars()` 会自动把 camelCase 转成 `--as-kebab-case`，所以新增的键不用改函数。

### 3.1 office 皮肤

```ts
// packages/skins/src/index.ts
export const office: Skin = {
  id: "office",
  name: "办公室",
  description: "默认皮肤 · SETO",
  tokens: {
    bg: "#F5F5F5", sidebar: "#F5F5F5", surface: "#FFFFFF", border: "#E1E1E1",
    text: "#0C151D", muted: "#5F6266",
    accent: "#0C151D", accentStrong: "#26313B",
    high: "#C8433A", medium: "#237A6C", low: "#6B6E71", success: "#3FA45B",
    radius: "16px",
    fontBody: "'Inter', 'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontDisplay: "'Tiempos Headline', 'Cormorant Garamond', 'EB Garamond', 'Source Han Serif SC', 'Noto Serif SC', serif",
    // 新增（SkinTokens 里设为可选）
    brand: "#E3876A", onAccent: "#FFFFFF",
    surfaceSunken: "#F4F3F1", surfaceSubtle: "#EDEFEF", surfaceTile: "#F6F6F7",
    borderWarm: "#E1DDDA", borderSoft: "#EEEEEE",
    textTertiary: "#6B6E71", placeholder: "#8F9295", track: "#E3E5E8", avatarBg: "#EEF0F2",
    radiusControl: "9999px", radiusPanel: "20px",
    shadowCard: "0 1px 2px rgba(12,21,29,0.04), 0 4px 16px rgba(12,21,29,0.04)",
    shadowNav: "0 1px 3px rgba(12,21,29,0.06)",
    shadowPrimary: "0 6px 14px rgba(12,21,29,0.22)",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
  },
  darkTokens: {
    bg: "#111316", sidebar: "#111316", surface: "#1C1F23", border: "#2A2E33",
    text: "#F1F2F4", muted: "#A7ABB1", accent: "#F1F2F4", accentStrong: "#FFFFFF",
    high: "#F08A7E", medium: "#5CC4AE", low: "#9A9FA6", success: "#4CC26C",
    onAccent: "#0C151D", surfaceSunken: "#171A1D", surfaceSubtle: "#262A2F", surfaceTile: "#22262A",
    borderWarm: "#2E3237", borderSoft: "#25292D", textTertiary: "#9A9FA6", placeholder: "#80858B",
    track: "#2E3238", avatarBg: "#2A2F35",
    shadowCard: "0 0 0 1px rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.32)",
    shadowNav: "0 0 0 1px rgba(255,255,255,0.07)", shadowPrimary: "0 6px 16px rgba(0,0,0,0.45)",
  },
  // terms 不变
  layout: { sidebar: "left", cardColumns: "row" },
  office: { floor: "#EFEDE9", wall: "#F6F5F3", desk: "#3A3F45", accent: "#E3876A" },
};
```

### 3.2 新增键的回退规则

朝堂皮肤和第三方皮肤没有这些键，样式里统一写成带回退的形式，`validateSkin` 不必改：

```css
background: var(--as-surface-subtle, color-mix(in srgb, var(--as-text) 6%, var(--as-surface)));
color: var(--as-on-accent, #fff);
border-radius: var(--as-radius-control, 999px);
```

| 新键 | 缺省回退 |
| --- | --- |
| `brand` | `accent` |
| `onAccent` | 浅色 `#fff`，深色 `bg`（与 `paperclipVars` 现有逻辑一致） |
| `surfaceSunken` / `surfaceTile` | `bg` |
| `surfaceSubtle` / `track` / `avatarBg` | `color-mix(text 6–8%, surface)` |
| `borderWarm` / `borderSoft` | `border` |
| `textTertiary` / `placeholder` | `muted` |
| `radiusControl` | `999px` |
| `radiusPanel` | `radius` |
| `shadow*` | `none` |
| `fontMono` | `ui-monospace` |

### 3.3 Paperclip 页面（paperclipVars）

| Paperclip 变量 | 取值 | 现状 |
| --- | --- | --- |
| `--primary` | `accent` | 自动变墨黑，不用改 |
| `--primary-foreground` | `onAccent ?? (dark ? bg : #fff)` | 需按新键调整 |
| `--muted` / `--secondary` | `surfaceSubtle ?? sidebar` | 侧栏现在与 bg 同色，不能再拿 sidebar 当 muted |
| `--accent` | `surfaceSubtle` | 替换现在的 `color-mix(accent 10%)` |
| `--input` | `border` | 不变 |
| `--radius` | `radius`（16px） | 卡片圆角 |
| `--font-heading`（新增） | `fontDisplay` | Paperclip 的页标题统一用衬线 500 |

另外在 Paperclip 侧加一条覆盖：`button`、`[role=tab]`、`input`、`.badge` 用 `--as-radius-control`。卡片保持 `--radius`。

## 4. 组件（对应 styles.css 现有类名）

下面只写要改的属性。没提到的属性保持现状。

### 4.1 侧栏 `.sidebar` `.nav-item` `.nav-section` `.count`

```css
.agentself .sidebar { padding: 20px 20px 24px; background: var(--as-sidebar); border-right: 1px solid var(--as-border); }
.agentself .nav-item { height: 44px; padding: 0 14px; gap: 14px; border-radius: var(--as-radius-control, 999px); font-size: 15px; color: var(--as-muted); }
.agentself .nav-item svg { width: 18px; height: 18px; stroke: var(--as-placeholder); stroke-width: 1.8; }
.agentself .nav-item.active { background: var(--as-surface); color: var(--as-text); font-weight: 600; box-shadow: var(--as-shadow-nav); }
.agentself .nav-item.active svg { stroke: var(--as-text); }
.agentself .nav-item .count.hot { min-width: 22px; height: 22px; display: grid; place-items: center; padding: 0 6px; font-size: 11px; font-weight: 700; background: var(--as-high); color: #fff; border-radius: 999px; }
.agentself .nav-section { margin: 20px 6px 4px 14px; font-size: 13px; font-weight: 600; color: var(--as-text); }
```

- **图标：** 全部用 `lucide-react` 线性图标（stroke 1.8，18px），删掉文字符号「⌕ ▾ ▸ ＋」。
- **对应关系：** 工作台 `House`，项目 `Folder`，管理 `ChevronRight` / `ChevronDown`，设置 `Settings`，搜索 `Search`，新建 `Plus`。
- **主管行的图标：** 用部门包里的 `icon` 字段（microscope / rocket / heart / code / globe / mail / sparkles / target，对应 lucide 同名图标），不再用像素机器人。
- **像素机器人：** 只用于员工。

### 4.2 顶栏 `.topbar` `.toggle`

- `.topbar`：高 64，去掉 `border-bottom`，`justify-content: space-between`，左右 padding 32。删掉 `.pending-badge`。
- `.toggle`：底色 `surface-subtle`，无边框，padding 4。
- `.toggle button`：高 32、padding 0 18，选中时 `surface` + `shadow-nav` + 600。

### 4.3 按钮 `.btn`

| 变体 | 规格 |
| --- | --- |
| `.btn`（次要） | 高 44 / 小号 36。`border: 0`，`background: var(--as-surface-sunken)`，`box-shadow: inset 0 0 0 1px var(--as-border)`，圆角 control，14px / 500 |
| `.btn.primary` | `background: var(--as-accent)`，`color: var(--as-on-accent)`，`box-shadow: var(--as-shadow-primary)`。按下用 `accent-strong`。每个区域最多一个 |
| `.btn.ghost` | 透明底、`muted` 字，悬停时 `surface-subtle` |
| `.btn.danger` | 透明底，字色 `high`。不做实心红 |
| `.btn:disabled` | `surface-subtle` 底、`placeholder` 字，不用 `opacity` |
| 图标按钮（新增 `.icon-btn`） | 40 / 36 / 32 正圆，`surface-subtle` 底。发送按钮 44 正圆，用 primary 色 |

### 4.4 输入框 `.composer` `.chip-select` `.input`

- **`.composer`**
  - 宽 ≤ 760，min-height 144，padding 20，圆角 panel（20）。
  - `background: var(--as-surface-sunken)`，`border: 1px solid var(--as-border-warm)`，无阴影。
  - 第一行：16px 闪电图标加单行输入，回车或 Ctrl+Enter 发送。
  - 第二行：交给 / 对外动作 / 高级，然后是弹性空白，最后是发送圆钮。
- **`.chip-select`：** 高 44，圆角 control，`surface-sunken` 底，内描边 `border`，左侧 16px 图标（`Route` / `Shield`），右侧 `ChevronDown`。
- **`.hint`：** 放到输入框下方居中，12px，`text-tertiary`。
- **`.input`：** 高 46（侧栏搜索 40），圆角 control。多行文本（设置里的档案）用圆角 16、`surface-sunken` 底、等宽字体。
- **焦点：** 统一 `outline: 2px solid var(--as-text); outline-offset: 2px`。

### 4.5 筛选 `.filters` `.filter`

把一排边框胶囊改成一个分段控件：

```css
.agentself .filters { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--as-surface-subtle); }
.agentself .filter { height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: none; color: var(--as-muted); font-size: 13px; font-weight: 500; }
.agentself .filter.on { background: var(--as-surface); color: var(--as-text); font-weight: 600; box-shadow: var(--as-shadow-nav); }
.agentself .filter .n { color: var(--as-text-tertiary); }
```

- 「结果」标题去掉，筛选器放在左边。
- 右边放「已处理 N >」链接，替代现在的 `<details class="handled">`。

### 4.6 待你处理卡片 `.cards` `.card`

```css
.agentself .cards { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.agentself .card { min-height: 124px; padding: 18px; gap: 6px; border: 0; border-radius: var(--as-radius); background: var(--as-surface); box-shadow: var(--as-shadow-card); cursor: pointer; }
.agentself .card.decide, .agentself .card.deliver, .agentself .card.failed, .agentself .card.answer { border-top: 0; }   /* 删除彩色顶边 */
.agentself .card-head { display: flex; justify-content: space-between; font-size: 12px; line-height: 18px; }
.agentself .card-kind { display: inline-flex; align-items: center; gap: 6px; color: var(--as-muted); font-weight: 500; }
.agentself .card-kind::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--as-high); display: none; }
.agentself .card.decide .card-kind::before, .agentself .card.failed .card-kind::before, .agentself .card.hire .card-kind::before { display: block; }
.agentself .card-time { color: var(--as-text-tertiary); }
.agentself .card-title { margin-top: auto; font-size: 15px; line-height: 22px; -webkit-line-clamp: 2; }
.agentself .card-sub { font-size: 13px; line-height: 20px; color: var(--as-muted); }
```

卡片里只放四样东西：

```
card-head  = 类型名 + 时间
card-title = 标题，最多 2 行
card-sub   = 谁 · 编号（交付卡加 "3/3 通过"）
```

- **删掉：** `.tag` 彩色标签、`.model` 和 `.card-actions`。
- **操作入口：** 全部进展开详情，点整张卡展开。
- **模型名：** 放到详情的 who 行。

| CardType | 类型名（skin term） | 红点 | card-sub |
| --- | --- | --- | --- |
| `decide` | `t("decide")` 要你拍板 | 有 | 主管 · 编号 |
| `deliver` | `t("deliverable")` 交付结果 | 无 | 主管 · 编号 · `通过数/总数` 通过 |
| `failed` | 运行失败 | 有 | 主管 · 编号 |
| `answer` | `t("instantAnswer")` 即时回答 | 无 | 路由直接回答 |
| `hire`（新增，来自 hire-requests） | 新建员工 | 有 | 负责什么 · Claude / Codex |

新建员工请求不再单独占一个 `.section`，而是作为 `hire` 卡片放进同一个网格，计入「要你拍板」。展开后才显示改名输入框和「同意 / 拒绝」。

### 4.7 卡片展开 `.detail`

- **容器：** 横跨整行（`grid-column: 1 / -1`），圆角 panel（20），padding 22 / 24，`surface` + `shadow-card`。
- **第 1 行 `.who`：** 红点 + 类型名 + `主管 · 模型 · 编号 · 时间`（tertiary），右边是「打开项目 >」和收起按钮（X）。
- **标题：** 20 / 28 · 600。
- **`.explain`：** 14 / 22，`muted`，最宽 640。
- **验收摘要（新增）：** 3 列的 `surface-tile` 小块，每块是编号 + 标准 + 判定标签。来自「独立核查」文档。
- **`.opts`：** 第一项用 `.btn.primary`，其余用 `.btn`。然后是 `返工`（ghost，铅笔图标），弹性空白，最右边 `稍后提醒`（ghost，时钟图标）。
- **`.report`：** 交付卡用，`surface-tile` 底、圆角 12。
- **页脚：** 上方 1px `border-soft`。左边 `不回复：…`（tertiary 12px），右边复选框「以后同类直接这样做」，勾选后走 `POST /agentself/api/profile/decisions`。

### 4.8 任务进展面板（新增 `.progress`）

- **数据：** 顶层 issue 按主管分组，主管 = issue 的 assignee lead。
- **分组头：** 28px 方块（`surface-subtle`，圆角 9），里面放主管的 lucide 图标；然后是主管名（14 / 600）和右侧的「N 项」（tertiary）。
- **行：** 是一个链接，点了打开项目抽屉。上下 padding 12，下方 1px `border-soft`。
  - 第 1 行：编号（mono 11，tertiary）和右侧阶段条。
  - 第 2 行：标题（14 / 600，单行省略）。
  - 第 3 行：员工像素头像（22）、员工名，右侧是状态文字。
- **阶段条 `.stages`：** 4 段，宽 72，段高 4，段间距 3，圆角 999。
  - 已完成段用 `accent`，出问题的当前段用 `high`，其余用 `track`。
  - 面板头下方列出 4 段的名字：写任务书 · 员工在做 · 验收 · 你确认。

| 阶段 | 判定依据 | 状态文字 |
| --- | --- | --- |
| 0 写任务书 | 主管还没有建子任务 | 写任务书 |
| 1 员工在做 | 子任务 `in_progress`，或有活跃看守 | 员工在做 / 看守中 · 每 N 分（时钟图标） |
| 2 验收 | 子任务 `done`，主管 verify 中 | 验收中 · 通过数/总数 |
| 2（红） | 返工达到上限，有 decide 卡 | 返工 2/2 · 等你决定（`high`，警示图标） |
| 3 你确认 | 父任务 `in_review` | 待你确认 |

面板底部放一个全宽主按钮「查看全部项目」。

### 4.9 项目抽屉 `.drawer`

- **容器：** `top/right/bottom: 12px`，宽 560，圆角 24，`bg` 底，`shadow.drawer`。遮罩 `rgba(12,21,29,.18)`，深色下用 `.5`。
- **header**
  - 第 1 行：`主管 · 编号`（mono，tertiary）+ 状态标签，右边是关闭按钮（36 圆形，`surface` 底）。
  - 标题：衬线 24 / 32 · 500。
  - 链接行：任务书 · 汇报 · 文件 N · 完整任务页。
- **body 区块：** 每块的 `h3` 是 13px、600、`muted`，区块之间间距 24。
  1. **进度：** 4 段阶段条，加大版，每段下方写阶段名。
  2. **验收标准：** 每行是一个 28 / 1fr / auto 的网格。
     - 第 1 列：c 编号（mono）。
     - 第 2 列：标准（14 / 500）和证据（12px，文件图标加一句话；员工的异议也写在这里）。
     - 第 3 列：判定标签，通过 = `medium`，未通过 = `high`，无法判断 = 中性。
     - 区块标题右侧写「通过数 / 总数 通过」，区块底部写「独立核查员 · 模型 · 时间」。
  3. **看守（有 watch 时）：** `surface-tile` 圆角 14 的块，内容是时钟图标、「每 N 分钟检查一次 · 已运行 X」、探测命令（mono）和「运行中」标签。
  4. **员工：** 像素头像 34 + 名字 + 底座，右边链到运行记录。
  5. **时间线：** 时间列宽 44（tabular-nums），每行 13 / 20。去掉现在的虚线。
- **footer：** 一个 48 高的胶囊，左边是「插一句话」输入，右边依次是「发给：主管」的 chip 和 36 圆形发送按钮。下面一行 ghost 按钮：暂停，取消项目（`high` 字）。

### 4.10 主管页（原部门页 `DepartmentRoutePage`）

- **面包屑：** 主管 / 主管名。
- **页头：** 60px 白色方块（圆角 18，`shadow-card`）里放 lucide 图标；名字用衬线 28；chips：模型（mono）、只用管理工具、N 名员工、职责一句话。
- **标签栏：** 概览 · 员工 N · 例行任务 · 能力 · 预算。
- **主列：**
  - 统计条：进行中 / 等你决定（`high`）/ 看守中 / 本月 / 预算。
  - 项目表：项目、员工、阶段条、状态四列。
- **侧列，三张卡：**
  - 员工：像素头像列表，有待批的新建员工时显示浅红块和「去工作台处理」。
  - 盯守：新论文 / 邮件 / 新闻三个模板，每个带开关。
  - 记忆：memory 文件列表和更新时间。

### 4.11 标签栏 `.tabbar`

把下划线标签改成胶囊标签。我们的页面和 Paperclip 嵌入页统一用这一种。

```css
.agentself .tabbar { border-bottom: 0; gap: 4px; margin: 20px 0; }
.agentself .tabbar a { height: 40px; display: inline-flex; align-items: center; gap: 6px; padding: 0 18px; border: 0; border-radius: 999px; color: var(--as-muted); font-weight: 500; margin: 0; }
.agentself .tabbar a.on { background: var(--as-surface); color: var(--as-text); font-weight: 600; box-shadow: var(--as-shadow-nav); }
```

### 4.12 统计条 `.stats` 与面板内统计块

- **`.stats > div`：** `surface` + `shadow-card`，无边框，圆角 16，padding 16。
- **数字 `b`：** 衬线 26 / 500，lining 等宽数字。「等你决定」这项的数字用 `high`。
- **面板内统计块：** `surface-tile`，圆角 12，padding 14。

### 4.13 设置 · 关于我 `SettingsRoutePage`

- **页面结构：** 页标题「设置」用衬线 28。标签栏：通用 · 路由 · 飞书 · 预算 · 对外动作 · 皮肤 · 关于我 · 高级。
- **关于我：** 左列宽 260，是 4 份档案的列表（关于我 / 我定过的事 / 我拒绝过的事 / 先问清单），每项是名字（14 / 600）加说明（12px）；选中项用 `surface` + `shadow-card`、圆角 16。
- **右列，两张卡：**
  - **待确认的记忆提议**（数量用 `high` 标签）：每条是提议内容、来源说明，以及「写入」（primary 32）和「忽略」（ghost）。数据来自 `profile/proposals.json`。
  - **编辑器：** 标题加「编辑 / 预览」分段控件和「保存」；下面是 Markdown 文本框（等宽 13 / 22）；底部注明文件路径。
- **`.section`：** 改为 `surface` + `shadow-card`，无边框，圆角 20，padding 20 / 22。`.row` 的分隔线改用 `border-soft`。

### 4.14 表格、进度条、空状态、提示

- **`table.data`：**
  - 表头 12 / 600，`text-tertiary`，下边线 `border`。
  - 行高 54，行线 `border-soft`，无竖线。
  - 操作收进行尾的「更多」图标按钮。
- **`.bar`：** 高 8，轨道 `track`，填充 `accent`，超过 90% 改成 `high`。
- **`.empty`：** 去掉虚线框，改成居中的一句话（15 / 600）、一行说明和一个 `.btn`。加载状态用骨架条（`surface-subtle`，圆角 999），不用「加载中…」文字。
- **`.toast`：** 背景 `accent`，字色 `on-accent`，圆角 999，padding 10 18，`shadow-primary`。
- **`.popover` / `.nameplate`：**
  - `.popover`：圆角 16，`shadow.drawer`，无边框。
  - `.nameplate`：圆角 999，无边框，`surface` 底。

## 5. 像素形象与办公室

- **用途：** 像素机器人只代表员工（以及主管工位上的主管）。部门、主管入口、技能、连接器一律用线性图标。
- **`Robot` 组件：** 把内联的 `background: #26241f; borderRadius: 4` 改成 `var(--as-avatar-bg)` 和 `round(size * 0.3)` 的圆角。机器人本体不变，外面套一个底块。
- **字标 `Wordmark`：** E 的填充色从 `var(--as-accent)` 改成 `var(--as-brand, var(--as-accent))`。如果不保留像素 E，就用衬线字体渲染整个字标，E 着 `brand` 色（设计稿是这样画的）。
- **办公室调色板：** `OfficePalette` 的 office 皮肤值（浅 / 深）如下。

| key | 浅色 | 深色 |
| --- | --- | --- |
| floorA / floorB | #EFEDE9 / #E8E5E1 | #191C20 / #1D2125 |
| wall / wallDark | #F6F5F3 / #E4E1DD | #1E2226 / #2A2F34 |
| trim | #D8D2CB | #3A3F45 |
| sky | #F7E4D6 | #3B3240 |
| desk / deskTop / deskLeg | #3A3F45 / #CDBBA8 / #3A3F45 | #2B3035 / #8C7C6C / #2B3035 |
| monitor / screenIdle / screenOn | #2B3138 / #46566B / #9FC4BA | #14181C / #33465E / #5CC4AE |
| plant / plantDark / pot | #8FA58A / #7A9475 / #E3876A | #6E8A6A / #5D7859 / #C9765D |
| shelf / books | #8E7F73 / [#E3876A, #C6BCC4, #EBC3A0, #A9B79B, #9AA7B5] | #5B5048 / 同左 |
| rug / rugB / chair | #EDEAE6 / #E3876A / #5F6266 | #22262A / #C9765D / #3A4047 |
| accent | #E3876A | #E3876A |

- **主管工位：** 加一圈桃色 #F2BC94 到淡紫 #BFB6D6 的 3px 描边（主管工位之外不用渐变）。
- **眼睛色（`EYE_COLORS`）：** 不变，Claude 是琥珀色，Codex 是青色。
- **身体色：** 建议把 `BODY_COLORS` 收敛为 #5B7FD6、#7D8794、#9C8CC9、#3E9C8C、#B07CC9、#C9956A，降低饱和度，和灰底更协调。

## 6. 文案

- **工作台：** 字标下方只放英文一行「Put your attention on what truly matters.」，去掉中文理念和问候语。
- **输入框占位：** 交给团队一件事，说完就可以离开。
- **待你处理的空状态：** 没有要你处理的事，团队在干活。
- **Paperclip 页面残留英文：** 继续走 `scripts/i18n` 翻译。Assign Task → 派任务；Enabled for N agents → 已为 N 名员工启用；Search installed skills… → 搜索已安装技能。

## 7. 无障碍与对比度

| 组合 | 对比度 |
| --- | --- |
| text #0C151D / bg | 16.9:1 |
| muted #5F6266 / bg | 5.6:1 |
| textTertiary #6B6E71 / bg | 4.7:1 |
| high #C8433A / surface | 4.9:1 |
| medium #237A6C / surface | 5.2:1 |
| 深色 muted #A7ABB1 / bg | 8.1:1 |
| 深色 high #F08A7E / surface | 6.8:1 |

- `placeholder` #8F9295 只用于占位文字和图标，不用于正文。
- 卡片类型同时用文字和红点表达，不只靠颜色。
- 所有图标按钮都要有 `aria-label`。卡片整卡用 `<a>` 或 `<button>`，不要把 onClick 挂在 div 上。

## 8. 不要做

- 不要给卡片加边框或彩色顶边，不要用实心红按钮，不要在按钮上用橙色。
- 不要用 emoji 或文字符号当图标（⌕ ▾ ▸ ＋），统一用 lucide。
- 不要把像素机器人用在部门、主管入口或品牌位上。
- 15px 及以下的文字不要用衬线，衬线标题不要加粗到 600 以上。
- 不要在顶栏或侧栏底部重复显示待处理数量，只在「工作台」项上显示。

## 9. 改动清单（给开发排期）

| # | 文件 | 改什么 |
| --- | --- | --- |
| 1 | `packages/skins/src/index.ts` | office 皮肤改值；`SkinTokens` 加可选新键；`paperclipVars` 改 `--muted` / `--accent` / `--primary-foreground`，加 `--font-heading` |
| 2 | `ui/src/agentself/styles.css` | 按 §4 改 `.sidebar` `.nav-item` `.topbar` `.toggle` `.btn` `.composer` `.chip-select` `.filters` `.cards` `.card` `.detail` `.drawer` `.tabbar` `.stats` `.section` `table.data` `.bar` `.empty` `.toast`；新增 `.progress` `.stages` `.icon-btn` `.criteria` |
| 3 | `components/Sidebar.tsx` | 四项导航；lucide 图标；主管行用 pack icon；删除 `.nav-me`（我 / 通知） |
| 4 | `components/Brand.tsx` | 字标 E 用 `--as-brand`；Robot 底块改 `--as-avatar-bg` 加圆角 |
| 5 | `App.tsx`（topbar） | 去掉 `.pending-badge`，顶栏 64，无底线 |
| 6 | `views/Home.tsx` | 字标 + 英文理念；筛选分段控件 + 「已处理 N >」；卡片四要素；hire 合入卡片网格；输入框移到底部；右侧加任务进展面板 |
| 7 | `views/ProjectDrawer.tsx` | 浮动抽屉；进度、验收标准（读「验收标准」和「独立核查」文档）、看守、员工、时间线；footer 胶囊输入 |
| 8 | `views/Hubs.tsx` / 部门页 | 主管页结构（§4.10）；tabbar 改胶囊 |
| 9 | `views/Pages.tsx` | 设置 · 关于我两栏（§4.13）；记忆提议卡；`.section` 新样式 |
| 10 | `packages/pixel-office/src/index.ts` | 新的 office 调色板与身体色；主管工位描边 |
| 11 | 字体 | 打包 Inter、思源黑体、Tiempos Headline（或 Cormorant Garamond / EB Garamond）、思源宋体、JetBrains Mono，不依赖网络 |
