// AGENTEAM brand: the mark (three agents linked into one team, the lead in the brand colour) and the
// wordmark AGEN·T·EAM in the display serif, the T (the letter AGENT and TEAM share) in the brand colour.
// The original pixel robot avatar (employees only) is below.
import { BODY_COLORS, EYE_COLORS, ROBOT, hashColor } from "@agentself/pixel-office";

/** The mark. Ink follows the text colour (light / dark skins); the lead head takes the brand colour. */
export function LogoMark({ size = 24 }: { size?: number }) {
  const eyes = (x: number, y: number) => (
    <>
      <rect x={x} y={y} width="1.6" height="3" rx=".5" />
      <rect x={x + 3.2} y={y} width="1.6" height="3" rx=".5" />
    </>
  );
  return (
    <svg className="logomark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <line x1="16" y1="9" x2="7.5" y2="23.5" />
        <line x1="16" y1="9" x2="24.5" y2="23.5" />
        <line x1="7.5" y1="23.5" x2="24.5" y2="23.5" />
      </g>
      <rect x="11" y="3.5" width="10" height="10" rx="3" fill="var(--as-x-brand)" />
      <rect x="2.5" y="18.5" width="10" height="10" rx="3" fill="currentColor" />
      <rect x="19.5" y="18.5" width="10" height="10" rx="3" fill="currentColor" />
      <g fill="var(--as-surface, #fff)">
        {eyes(13.6, 7)}
        {eyes(5.1, 22)}
        {eyes(22.1, 22)}
      </g>
    </svg>
  );
}

export function Wordmark({ size = 21, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <span className="wordmark" role="img" aria-label="AGENTEAM" style={{ fontSize: size }}>
      {mark && (
        <span className="mark" aria-hidden="true">
          <LogoMark size={Math.round(size * 1.15)} />
        </span>
      )}
      <span aria-hidden="true">AGEN</span>
      <span aria-hidden="true" className="e">
        T
      </span>
      <span aria-hidden="true">EAM</span>
    </span>
  );
}

export function Robot({ id = "frontdesk", eye = "claude", size = 26, grey = false }: { id?: string; eye?: keyof typeof EYE_COLORS; size?: number; grey?: boolean }) {
  const body = id === "frontdesk" ? BODY_COLORS[0] : hashColor(id);
  const pal: Record<string, string> = {
    a: "#9aa3b5",
    f: grey ? "#5a5a5a" : "#2f2f3a",
    s: "#1b1722",
    e: grey ? "#6b6b6b" : EYE_COLORS[eye],
    b: grey ? "#8a8a8a" : body,
  };
  return (
    <svg width={size} height={size} viewBox="-1 -1 10 10" shapeRendering="crispEdges" aria-hidden="true" style={{ flex: "none", display: "block", background: "var(--as-x-avatar, var(--as-avatar-bg, #EEF0F2))", borderRadius: Math.round(size * 0.3) }}>
      {ROBOT.flatMap((row, y) => [...row].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={pal[ch]} />)))}
    </svg>
  );
}

export function eyeOf(adapterType: string | undefined): keyof typeof EYE_COLORS {
  return adapterType === "claude_local" ? "claude" : adapterType === "codex_local" ? "codex" : "other";
}

export function modelName(a: { adapterType?: string; adapterConfig?: { model?: string }; metadata?: { agentself?: { source?: string } } } | undefined): string {
  if (!a) return "";
  const src = a.metadata?.agentself?.source;
  // API models: "deepseek · deepseek-chat" (the provider matters more than the raw model id)
  if (src?.startsWith("api:")) return [src.slice(4), a.adapterConfig?.model].filter(Boolean).join(" · ");
  if (a.adapterConfig?.model) return a.adapterConfig.model;
  return a.adapterType === "claude_local" ? "Claude" : a.adapterType === "codex_local" ? "Codex" : (a.adapterType ?? "");
}

/** Paperclip agent status in plain words. */
export const AGENT_STATUS: Record<string, string> = { running: "运行中", active: "空闲", idle: "空闲", paused: "已暂停", error: "出错", terminated: "已停用", pending_approval: "待批准" };
