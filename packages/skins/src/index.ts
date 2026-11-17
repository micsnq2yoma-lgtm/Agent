// Skins (PLAN 7.2): theme tokens + terminology + layout knobs. UI text goes through `term()`.

export type TermKey =
  | "department"
  | "lead"
  | "employee"
  | "frontdesk"
  | "report"
  | "card"
  | "project"
  | "subtask"
  | "decide"
  | "deliverable"
  | "instantAnswer"
  | "rework"
  | "team"
  | "workbench"
  | "routine"
  | "user";

export interface SkinTokens {
  bg: string;
  sidebar: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentStrong: string;
  high: string;
  medium: string;
  low: string;
  success: string;
  radius: string;
  fontBody: string;
  fontDisplay: string;
  // v0.6 SETO (docs/handoff/design/DESIGN.md §3): optional; styles fall back when a skin omits them.
  brand?: string;
  onAccent?: string;
  surfaceSunken?: string;
  surfaceSubtle?: string;
  surfaceTile?: string;
  borderWarm?: string;
  borderSoft?: string;
  textTertiary?: string;
  placeholder?: string;
  track?: string;
  avatarBg?: string;
  radiusControl?: string;
  radiusPanel?: string;
  shadowCard?: string;
  shadowNav?: string;
  shadowPrimary?: string;
  shadowDrawer?: string;
  fontMono?: string;
}

/** Keys every skin must define; the rest of SkinTokens is optional (DESIGN §3.2). */
export const REQUIRED_TOKENS = [
  "bg",
  "sidebar",
  "surface",
  "border",
  "text",
  "muted",
  "accent",
  "accentStrong",
  "high",
  "medium",
  "low",
  "success",
  "radius",
  "fontBody",
  "fontDisplay",
] as const;

export interface Skin {
  id: string;
  name: string;
  description: string;
  tokens: SkinTokens;
  /** dark variant; falls back to tokens */
  darkTokens?: Partial<SkinTokens>;
  terms: Record<TermKey, string>;
  layout: { sidebar: "left" | "right"; cardColumns: "row" | "grid" };
  /** pixel office palette */
  office: { floor: string; wall: string; desk: string; accent: string };
}

export const office: Skin = {
  id: "office",
  name: "办公室",
  description: "默认皮肤 · SETO",
  tokens: {
    bg: "#F5F5F5",
    sidebar: "#F5F5F5",
    surface: "#FFFFFF",
    border: "#E1E1E1",
    text: "#0C151D",
    muted: "#5F6266",
    accent: "#0C151D",
    accentStrong: "#26313B",
    high: "#C8433A",
    medium: "#237A6C",
    low: "#6B6E71",
    success: "#3FA45B",
    radius: "16px",
    fontBody: "'InterVariable', 'Inter', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Source Han Sans SC', 'Noto Sans SC', sans-serif",
    fontDisplay: "'Tiempos Headline', 'Cormorant Garamond', 'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', serif",
    brand: "#E3876A",
    onAccent: "#FFFFFF",
    surfaceSunken: "#F4F3F1",
    surfaceSubtle: "#EDEFEF",
    surfaceTile: "#F6F6F7",
    borderWarm: "#E1DDDA",
    borderSoft: "#EEEEEE",
    textTertiary: "#6B6E71",
    placeholder: "#8F9295",
    track: "#E3E5E8",
    avatarBg: "#EEF0F2",
    radiusControl: "9999px",
    radiusPanel: "20px",
    shadowCard: "0 1px 2px rgba(12,21,29,0.04), 0 4px 16px rgba(12,21,29,0.04)",
    shadowNav: "0 1px 3px rgba(12,21,29,0.06)",
    shadowPrimary: "0 6px 14px rgba(12,21,29,0.22)",
    shadowDrawer: "0 24px 60px rgba(12,21,29,0.18)",
    fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  darkTokens: {
    bg: "#111316",
    sidebar: "#111316",
    surface: "#1C1F23",
    border: "#2A2E33",
    text: "#F1F2F4",
    muted: "#A7ABB1",
    accent: "#F1F2F4",
    accentStrong: "#FFFFFF",
    high: "#F08A7E",
    medium: "#5CC4AE",
    low: "#9A9FA6",
    success: "#4CC26C",
    onAccent: "#0C151D",
    surfaceSunken: "#171A1D",
    surfaceSubtle: "#262A2F",
    surfaceTile: "#22262A",
    borderWarm: "#2E3237",
    borderSoft: "#25292D",
    textTertiary: "#9A9FA6",
    placeholder: "#80858B",
    track: "#2E3238",
    avatarBg: "#2A2F35",
    shadowCard: "0 0 0 1px rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.32)",
    shadowNav: "0 0 0 1px rgba(255,255,255,0.07)",
    shadowPrimary: "0 6px 16px rgba(0,0,0,0.45)",
    shadowDrawer: "0 24px 60px rgba(0,0,0,0.5)",
  },
  terms: {
    department: "团队",
    lead: "主管",
    employee: "员工",
    frontdesk: "路由",
    report: "汇报",
    card: "卡片",
    project: "项目",
    subtask: "子任务",
    decide: "要你拍板",
    deliverable: "交付结果",
    instantAnswer: "即时回答",
    rework: "返工",
    team: "像素团队",
    workbench: "工作台",
    routine: "例行任务",
    user: "我",
  },
  layout: { sidebar: "left", cardColumns: "row" },
  office: { floor: "#EFEDE9", wall: "#F6F5F3", desk: "#3A3F45", accent: "#E3876A" },
};

export const court: Skin = {
  id: "court",
  name: "朝堂",
  description: "配色、字体、称呼和布局都换",
  tokens: {
    bg: "#f6efe2",
    sidebar: "#efe3cc",
    surface: "#fffaf0",
    border: "#d9c39a",
    text: "#2a1d12",
    muted: "#6b5640",
    accent: "#a3201b",
    accentStrong: "#7d1410",
    high: "#a3201b",
    medium: "#2f5d50",
    low: "#8c7a63",
    success: "#3f6b2a",
    radius: "2px",
    fontBody: "'Noto Serif SC', 'Songti SC', serif",
    fontDisplay: "'Noto Serif SC', 'Songti SC', serif",
  },
  darkTokens: { bg: "#1f160f", sidebar: "#2a1d12", surface: "#33241a", border: "#5a4430", text: "#f6efe2", muted: "#c9b48f" },
  terms: {
    department: "部",
    lead: "尚书",
    employee: "侍郎",
    frontdesk: "通政司",
    report: "奏折",
    card: "折子",
    project: "差事",
    subtask: "分差",
    decide: "待朱批",
    deliverable: "已复命",
    instantAnswer: "通政司回话",
    rework: "驳回",
    team: "朝堂",
    workbench: "御书房",
    routine: "常例",
    user: "朕",
  },
  layout: { sidebar: "right", cardColumns: "grid" },
  office: { floor: "#d9c39a", wall: "#efe3cc", desk: "#7d1410", accent: "#a3201b" },
};

export const skins: Record<string, Skin> = { office, court };
export const BUILTIN_SKINS = ["office", "court"];

/** Add a shared / imported skin to the registry (validated first). */
export function registerSkin(skin: Skin): string[] {
  const errs = validateSkin(skin);
  if (errs.length === 0) skins[skin.id] = { ...office, ...skin, layout: { ...office.layout, ...(skin.layout ?? {}) }, office: { ...office.office, ...(skin.office ?? {}) } };
  return errs;
}

export function getSkin(id: string | null | undefined): Skin {
  return (id && skins[id]) || office;
}

/** Terminology lookup; unknown keys fall back to the default skin. */
export function term(skin: Skin, key: TermKey): string {
  return skin.terms[key] ?? office.terms[key];
}

/** CSS custom properties for a skin. */
export function cssVars(skin: Skin, dark = false): Record<string, string> {
  const t = dark ? { ...skin.tokens, ...skin.darkTokens } : skin.tokens;
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [`--as-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, v]));
}

/** Validate a third-party skin JSON (for sharing, PLAN 7.2). */
export function validateSkin(x: unknown): string[] {
  const errs: string[] = [];
  const s = x as Partial<Skin>;
  if (!s || typeof s !== "object") return ["not an object"];
  if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) errs.push("id");
  if (!s.name) errs.push("name");
  for (const k of REQUIRED_TOKENS) if (!s.tokens || typeof (s.tokens as never)[k] !== "string") errs.push(`tokens.${k}`);
  for (const k of Object.keys(office.terms)) if (!s.terms || typeof (s.terms as never)[k] !== "string") errs.push(`terms.${k}`);
  return errs;
}

/**
 * P9: map skin tokens onto the Paperclip admin UI's CSS variables (shadcn-style names),
 * so switching skins recolours the whole app, not just the AgenTeam views.
 */
export function paperclipVars(skin: Skin, dark = false): Record<string, string> {
  const t = dark ? { ...skin.tokens, ...skin.darkTokens } : skin.tokens;
  const onAccent = t.onAccent ?? (dark ? t.bg : "#ffffff");
  // The sidebar now shares the page colour, so it can no longer stand in for "muted" (DESIGN §3.3).
  const subtle = t.surfaceSubtle ?? `color-mix(in srgb, ${t.text} 6%, ${t.surface})`;
  return {
    "--background": t.bg,
    "--foreground": t.text,
    "--card": t.surface,
    "--card-foreground": t.text,
    "--popover": t.surface,
    "--popover-foreground": t.text,
    "--primary": t.accent,
    "--primary-foreground": onAccent,
    "--secondary": subtle,
    "--secondary-foreground": t.text,
    "--muted": subtle,
    "--muted-foreground": t.muted,
    "--accent": subtle,
    "--accent-foreground": t.text,
    "--border": t.border,
    "--input": t.border,
    "--ring": t.accent,
    "--sidebar": t.sidebar,
    "--sidebar-foreground": t.text,
    "--sidebar-primary": t.accent,
    "--sidebar-primary-foreground": onAccent,
    "--sidebar-accent": `color-mix(in srgb, ${t.text} 8%, ${t.sidebar})`,
    "--sidebar-accent-foreground": t.text,
    "--sidebar-border": t.border,
    "--sidebar-ring": t.accent,
    "--radius": t.radius,
    "--font-sans": t.fontBody,
    "--font-heading": t.fontDisplay,
  };
}

/**
 * P9: terminology overrides for the Paperclip zh-CN translation layer. The left side is the
 * word the dictionary produces; the right side is the current skin's term.
 */
export function termOverrides(skin: Skin): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ["智能体", term(skin, "employee")],
    ["管理台", term(skin, "user")],
    ["例行任务", term(skin, "routine")],
    ["子任务", term(skin, "subtask")],
  ];
  return pairs.filter(([from, to]) => from !== to);
}
