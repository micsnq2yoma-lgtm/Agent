import type { SVGProps } from "react";
import { cn } from "../lib/utils";
import { AgenteamLogo } from "./AgenteamLogo";

export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <AgenteamLogo animated className={className} {...props} />;
}

/** Keep the compatibility export used by route gates; the loading identity is AgenTeam. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedPaperclipIcon className="h-24 w-24 text-foreground" />
      <span className="sr-only">AgenTeam 正在加载…</span>
    </div>
  );
}
