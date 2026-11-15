// AGENTSELF wordmark, set in the display serif with the E in the brand colour (DESIGN §5), and the
// original pixel robot avatar (employees only).
import { BODY_COLORS, EYE_COLORS, ROBOT, hashColor } from "@agentself/pixel-office";

export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className="wordmark" role="img" aria-label="AGENTSELF" style={{ fontSize: size }}>
      <span aria-hidden="true">AGENTS</span>
      <span aria-hidden="true" className="e">
        E
      </span>
      <span aria-hidden="true">LF</span>
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

export function modelName(a: { adapterType?: string; adapterConfig?: { model?: string } } | undefined): string {
  if (!a) return "";
  if (a.adapterConfig?.model) return a.adapterConfig.model;
  return a.adapterType === "claude_local" ? "Claude" : a.adapterType === "codex_local" ? "Codex" : (a.adapterType ?? "");
}
