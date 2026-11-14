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
  tokens: {
    bg: "#faf9f7",
    sidebar: "#f3f1ed",
    surface: "#ffffff",
    border: "#e6e2db",
    text: "#26241f",
    muted: "#625d55",
    accent: "#d9480f",
    accentStrong: "#b4410c",
    high: "#c23b3b",
    medium: "#3a5a8c",
    low: "#8a847a",
    success: "#2b7a3b",
    radius: "10px",
    fontBody: "'Inter', 'Noto Sans SC', sans-serif",
    fontDisplay: "'Space Grotesk', 'Inter', 'Noto Sans SC', sans-serif",
  },
  darkTokens: {
    bg: "#1d1a24",
    sidebar: "#1b1722",
    surface: "#2b2230",
    border: "#3a3542",
    text: "#f1eee8",
    muted: "#9aa3b5",
    accent: "#ff7a3d",
    accentStrong: "#ffc56b",
  },
  terms: {
    department: "部门",
    lead: "主管",
    employee: "员工",
    frontdesk: "前台",
    report: "汇报",
    card: "卡片",
    project: "项目",
    subtask: "子任务",
    decide: "要你拍板",
    deliverable: "交付结果",
    instantAnswer: "前台即答",
    rework: "返工",
    team: "像素团队",
    workbench: "工作台",
    routine: "例行任务",
    user: "我",
  },
  layout: { sidebar: "left", cardColumns: "row" },
  office: { floor: "#e9e5de", wall: "#f1eee8", desk: "#8a6bd6", accent: "#d9480f" },
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
