// Storybook replaces this module at build time with its packaged-image resolver.
// Agentself (P9): avatars are the original pixel robot (seeded by the appearance palette when
// no agent id is at hand; AgentAvatar passes the agent id itself).
import type { AgentAppearance } from "@paperclipai/shared";
import { robotAvatarUrl } from "@/agentself/lib/avatar";

export function agentAvatarUrl(appearance: AgentAppearance, _size?: unknown, _scale?: unknown, _pose?: unknown, muted = false): string {
  return robotAvatarUrl(String(appearance.paletteId ?? appearance.characterVersion ?? "agent"), muted);
}
