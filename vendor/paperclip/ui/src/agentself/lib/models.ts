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
  /** yuan per million tokens, per model (filled in by the user from pricingUrl) */
  prices?: Record<string, Price>;
  pricingUrl?: string;
}
export interface Price {
  input?: number;
  output?: number;
  /** cache-hit input price */
  cached?: number;
}
export interface ModelsInfo {
  providers: Provider[];
  subscriptions: { claude: string | null; codex: string | null; codexProblems?: { code: string; message: string; fix: string; file: string }[] };
  subscriptionModels?: { claude: string[]; codex: string[] };
}

/** The price of a model on an API source, if the user has filled it in. */
export function priceOf(m: ModelsInfo | null, source: string | undefined, model: string | undefined): Price | null {
  if (!source?.startsWith("api:") || !model) return null;
  return m?.providers.find((x) => x.id === source.slice(4))?.prices?.[model] ?? null;
}
const yuan = (n: number) => `¥${n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/0$/, "")}`;
/** "输入 ¥2 · 输出 ¥3 / 百万 token（缓存命中 ¥0.2）" */
export function priceText(p: Price | null | undefined): string {
  if (!p || (p.input === undefined && p.output === undefined)) return "";
  const parts = [p.input !== undefined ? `输入 ${yuan(p.input)}` : null, p.output !== undefined ? `输出 ${yuan(p.output)}` : null].filter(Boolean);
  return `${parts.join(" · ")} / 百万 token${p.cached !== undefined ? `（缓存命中 ${yuan(p.cached)}）` : ""}`;
}
/** Estimated yuan for token counts at a price (same rule as scripts/lib/providers.mjs estimateYuan). */
export function estimateYuan(t: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }, p: Price | null | undefined): number | null {
  if (!p || (p.input === undefined && p.output === undefined)) return null;
  const input = p.input ?? 0;
  return ((t.inputTokens ?? 0) * input + (t.cachedInputTokens ?? 0) * (p.cached ?? input) + (t.outputTokens ?? 0) * (p.output ?? 0)) / 1e6;
}
export const formatYuan = (n: number) => `¥${n < 0.01 && n > 0 ? "<0.01" : n.toFixed(2)}`;

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
