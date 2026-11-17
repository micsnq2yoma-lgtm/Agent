// Storybook replaces this module at build time with its packaged-image resolver.
// Model-neutral fallback when a surface has no agent identity.
import type { AgentAppearance } from "@paperclipai/shared";
import { robotAvatarUrl } from "@/agenteam/lib/avatar";

export function agentAvatarUrl(appearance: AgentAppearance, _size?: unknown, _scale?: unknown, pose?: unknown, muted = false, _theme?: unknown, animated = false): string {
  return robotAvatarUrl(String(appearance.paletteId ?? appearance.characterVersion ?? "agent"), muted, typeof pose === "string" ? pose : undefined, animated);
}
