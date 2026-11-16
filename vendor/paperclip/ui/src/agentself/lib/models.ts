// Model sources (scripts/lib/providers.mjs): the Claude / Codex subscriptions of this machine, or an
// API model through a provider's Anthropic-compatible endpoint.
import { useEffect, useState } from "react";
import { as } from "./api";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  smallModel: string;
  keyUrl?: string;
  blurb?: string;
  preset: boolean;
  hasKey: boolean;
  models?: string[];
  modelsFetchedAt?: string;
}
export interface ModelsInfo {
  providers: Provider[];
  subscriptions: { claude: string | null; codex: string | null };
  subscriptionModels?: { claude: string[]; codex: string[] };
}

/** Model names to suggest for a source (provider's fetched list, or the subscription aliases). */
export function modelChoices(source: string, m: ModelsInfo | null): string[] {
  if (source.startsWith("api:")) {
    const p = m?.providers.find((x) => x.id === source.slice(4));
    return [...new Set([p?.model, p?.smallModel, ...(p?.models ?? [])].filter((x): x is string => !!x))];
  }
  return m?.subscriptionModels?.[source === "codex" ? "codex" : "claude"] ?? [];
}

let cache: ModelsInfo | null = null;
const listeners = new Set<(m: ModelsInfo) => void>();
export async function reloadModels(): Promise<ModelsInfo> {
  cache = await as.get<ModelsInfo>("/providers");
  for (const l of listeners) l(cache);
  return cache;
}
export function useModels(): ModelsInfo | null {
  const [m, setM] = useState<ModelsInfo | null>(cache);
  useEffect(() => {
    listeners.add(setM);
    if (!cache) void reloadModels().catch(() => {});
    return () => void listeners.delete(setM);
  }, []);
  return m;
}

export interface SourceOption {
  value: string;
  label: string;
  disabled?: boolean;
}
/** Choices for a picker. `lead`: no Codex (a lead's tool limits rely on Claude Code). */
export function sourceOptions(m: ModelsInfo | null, { lead = false } = {}): SourceOption[] {
  const out: SourceOption[] = [{ value: "claude", label: `Claude 订阅${m && !m.subscriptions.claude ? "（本机没装 Claude Code）" : ""}` }];
  if (!lead) out.push({ value: "codex", label: `Codex 订阅${m && !m.subscriptions.codex ? "（本机没装 Codex）" : ""}`, disabled: !!m && !m.subscriptions.codex });
  for (const p of m?.providers ?? []) out.push({ value: `api:${p.id}`, label: `${p.name} API${p.hasKey ? "" : "（还没填 key）"}`, disabled: !p.hasKey });
  return out;
}
export function sourceOfAgent(a: { adapterType?: string; metadata?: { agentself?: { source?: string } } } | undefined): string {
  return a?.metadata?.agentself?.source ?? (a?.adapterType === "codex_local" ? "codex" : "claude");
}
export function sourceLabel(source: string, m: ModelsInfo | null): string {
  if (source === "codex") return "Codex 订阅";
  if (source.startsWith("api:")) return `${m?.providers.find((p) => p.id === source.slice(4))?.name ?? source.slice(4)} API`;
  return "Claude 订阅";
}
/** The adapter a source runs on (robot eye colour, Codex-only UI). */
export const adapterOfSource = (source: string) => (source === "codex" ? "codex_local" : "claude_local");
