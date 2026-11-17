import type { SVGProps } from "react";
import { cn } from "../lib/utils";

/** Shared brand geometry; loading adds a staggered hop to the three agent heads. */
export function AgenteamLogo({ animated = false, className, ...props }: SVGProps<SVGSVGElement> & { animated?: boolean }) {
  const head = (x: number, y: number, index: number) => <g className={`agenteam-logo-head agenteam-logo-head-${index}`}>
    <rect x={x} y={y} width="10" height="10" rx="3" fill={index === 0 ? "var(--agenteam-logo-accent)" : "currentColor"} />
    <g fill="var(--agenteam-logo-eye)">
      <rect x={x + 2.6} y={y + 3.5} width="1.6" height="3" rx=".5" />
      <rect x={x + 5.8} y={y + 3.5} width="1.6" height="3" rx=".5" />
    </g>
  </g>;
  return <svg viewBox={animated ? "0 -2 32 36" : "0 0 32 32"} aria-hidden="true"
    className={cn("agenteam-logo", animated && "agenteam-logo-loading", className)} {...props}>
    <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="16" y1="9" x2="7.5" y2="23.5" />
      <line x1="16" y1="9" x2="24.5" y2="23.5" />
      <line x1="7.5" y1="23.5" x2="24.5" y2="23.5" />
    </g>
    {head(11, 3.5, 0)}{head(2.5, 18.5, 1)}{head(19.5, 18.5, 2)}
  </svg>;
}
