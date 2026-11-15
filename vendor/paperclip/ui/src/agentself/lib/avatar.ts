// P9: every employee avatar in the app is the original pixel robot. Body colour comes from the
// agent id; eye colour from the adapter (Claude amber / Codex cyan), known once the Agentself
// context has loaded. Paperclip's AgentAvatar and agentAvatarUrl both route through here.
import { robotDataUrl } from "@agentself/pixel-office";

const adapters = new Map<string, string>();
const cache = new Map<string, string>();

export function registerAgentAdapters(agents: Array<{ id: string; adapterType?: string }>) {
  let changed = false;
  for (const a of agents) {
    if (a.adapterType && adapters.get(a.id) !== a.adapterType) {
      adapters.set(a.id, a.adapterType);
      changed = true;
    }
  }
  if (changed) cache.clear();
}

export function robotAvatarUrl(seed: string, muted = false): string {
  const key = `${seed}|${muted ? 1 : 0}`;
  let url = cache.get(key);
  if (!url) {
    const adapter = adapters.get(seed);
    const eye = adapter === "codex_local" ? "codex" : adapter && adapter !== "claude_local" ? "other" : "claude";
    url = robotDataUrl(seed, eye, muted);
    cache.set(key, url);
  }
  return url;
}
