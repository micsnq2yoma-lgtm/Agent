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
}

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
  description: "默认皮肤",
  // Style: docs/design/DESIGN-claude.md — warm cream canvas, coral primary, serif display,
  // warm dark surfaces. Colours only; no logos or brand marks.
  tokens: {
    bg: "#faf9f5", // canvas
    sidebar: "#f5f0e8", // surface-soft
    surface: "#faf9f5", // canvas + hairline (cards are colour-blocked, not shadowed)
    border: "#e6dfd8", // hairline
    text: "#141413", // ink
    muted: "#6c6a64", // muted
    accent: "#cc785c", // primary (coral)
    accentStrong: "#a9583e", // primary-active
    high: "#c64545", // error
    medium: "#3f8f80", // accent-teal, darkened for text on cream
    low: "#8e8b82", // muted-soft
    success: "#5db872",
    radius: "12px", // rounded.lg (cards); buttons/inputs use 8px
    fontBody: "'Inter', 'Noto Sans SC', -apple-system, 'Segoe UI', sans-serif",
    fontDisplay: "'Tiempos Headline', 'Cormorant Garamond', 'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
  },
  darkTokens: {
    bg: "#181715", // surface-dark
    sidebar: "#1f1e1b", // surface-dark-soft
    surface: "#252320", // surface-dark-elevated
    border: "#34312c",
    text: "#faf9f5", // on-dark
    muted: "#a09d96", // on-dark-soft
    accent: "#cc785c",
    accentStrong: "#e8a55a", // accent-amber: readable links on dark
    medium: "#5db8a6",
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
  office: { floor: "#efe9de", wall: "#f5f0e8", desk: "#3d3d3a", accent: "#cc785c" },
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
  for (const k of Object.keys(office.tokens)) if (!s.tokens || typeof (s.tokens as never)[k] !== "string") errs.push(`tokens.${k}`);
  for (const k of Object.keys(office.terms)) if (!s.terms || typeof (s.terms as never)[k] !== "string") errs.push(`terms.${k}`);
  return errs;
}

/**
 * P9: map skin tokens onto the Paperclip admin UI's CSS variables (shadcn-style names),
 * so switching skins recolours the whole app, not just the Agentself views.
 */
export function paperclipVars(skin: Skin, dark = false): Record<string, string> {
  const t = dark ? { ...skin.tokens, ...skin.darkTokens } : skin.tokens;
  const onAccent = dark ? t.bg : "#ffffff";
  return {
    "--background": t.bg,
    "--foreground": t.text,
    "--card": t.surface,
    "--card-foreground": t.text,
    "--popover": t.surface,
    "--popover-foreground": t.text,
    "--primary": t.accent,
    "--primary-foreground": onAccent,
    "--secondary": t.sidebar,
    "--secondary-foreground": t.text,
    "--muted": t.sidebar,
    "--muted-foreground": t.muted,
    "--accent": `color-mix(in srgb, ${t.accent} 10%, ${t.surface})`,
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
