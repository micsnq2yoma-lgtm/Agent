// Where an agent's model comes from (per machine: each install has its own subscriptions and keys).
//   "claude"        the Claude subscription this machine's Claude Code is logged into
//   "codex"         the Codex subscription this machine's Codex CLI is logged into
//   "api:<id>"      any other model over its API: Claude Code pointed at the provider's
//                   Anthropic-compatible endpoint (ANTHROPIC_BASE_URL + key), so the agent keeps the
//                   same tools, MCP servers and instructions as a Claude agent
// Provider settings live in ~/.agentself/providers.json; API keys are Paperclip company secrets
// (only their ids are stored here) and reach the run as a secret_ref env binding.
import fs from "node:fs";
import path from "node:path";

/**
 * Anthropic-compatible endpoints. Model names and prices change often: model names are defaults the
 * user can edit, and prices are not preset at all — the user copies them from `pricingUrl` once.
 */
export const PROVIDER_PRESETS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-chat", smallModel: "deepseek-chat", modelsUrl: "https://api.deepseek.com/models", keyUrl: "https://platform.deepseek.com/api_keys", pricingUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing", blurb: "推理和代码能力强，价格低" },
  { id: "kimi", name: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/anthropic", model: "kimi-k2-turbo-preview", smallModel: "kimi-k2-turbo-preview", modelsUrl: "https://api.moonshot.cn/v1/models", keyUrl: "https://platform.moonshot.cn/console/api-keys", pricingUrl: "https://platform.moonshot.cn/docs/pricing/chat", blurb: "长上下文，擅长读长文档和工具调用" },
  { id: "glm", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-4.6", smallModel: "glm-4.5-air", modelsUrl: "https://open.bigmodel.cn/api/paas/v4/models", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys", pricingUrl: "https://open.bigmodel.cn/pricing", blurb: "代码和智能体任务，有包月套餐" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", model: "qwen3-coder-plus", smallModel: "qwen3-coder-plus", modelsUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models", keyUrl: "https://bailian.console.aliyun.com/?apiKey=1", pricingUrl: "https://help.aliyun.com/zh/model-studio/models", blurb: "阿里云百炼，模型种类多" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic", model: "MiniMax-M2", smallModel: "MiniMax-M2", modelsUrl: "https://api.minimaxi.com/v1/models", keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", pricingUrl: "https://platform.minimaxi.com/document/Price", blurb: "智能体和代码任务" },
];

/** Env keys this module manages on an agent; switching source removes the ones no longer wanted. */
export const MANAGED_ENV = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
];

const file = (home) => path.join(home, "providers.json");
export function readProviders(home) {
  try {
    const v = JSON.parse(fs.readFileSync(file(home), "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function writeProviders(home, all) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file(home), JSON.stringify(all, null, 2));
}

const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

/** Presets merged with what the user saved, plus custom providers. Never includes key values. */
export function listProviders(home) {
  const saved = readProviders(home);
  const out = PROVIDER_PRESETS.map((p) => ({ ...p, ...(saved[p.id] ?? {}), preset: true }));
  for (const [id, v] of Object.entries(saved)) if (!PROVIDER_PRESETS.some((p) => p.id === id)) out.push({ id, name: v.name ?? id, ...v, preset: false });
  return out.map(({ secretId, ...p }) => ({ ...p, hasKey: !!secretId, secretId: secretId ?? null }));
}

/** Save a provider's settings (not the key: the caller stores it as a secret and passes `secretId`). */
export function saveProvider(home, id, patch) {
  const key = slug(id);
  if (!key) throw Object.assign(new Error("服务商要有一个英文 id"), { status: 400 });
  const all = readProviders(home);
  const preset = PROVIDER_PRESETS.find((p) => p.id === key);
  const cur = all[key] ?? {};
  const next = { ...cur };
  for (const k of ["name", "baseUrl", "model", "smallModel", "secretId", "modelsUrl", "models", "modelsFetchedAt"]) if (patch[k] !== undefined) next[k] = typeof patch[k] === "string" ? patch[k].trim() : patch[k];
  if (patch.prices !== undefined) next.prices = normalizePrices(patch.prices);
  if (patch.contextLengths !== undefined) next.contextLengths = normalizeContextLengths(patch.contextLengths);
  if (patch.pricingUrl !== undefined && !preset) next.pricingUrl = String(patch.pricingUrl).trim();
  if (!preset && !next.baseUrl) throw Object.assign(new Error("自定义服务商要填 Anthropic 兼容接口地址"), { status: 400 });
  if (next.baseUrl && !/^https?:\/\//.test(next.baseUrl)) throw Object.assign(new Error("接口地址要以 http(s):// 开头"), { status: 400 });
  next.updatedAt = new Date().toISOString();
  all[key] = next;
  writeProviders(home, all);
  return listProviders(home).find((p) => p.id === key);
}
export function removeProvider(home, id) {
  const all = readProviders(home);
  delete all[id];
  writeProviders(home, all);
}

/** The agent's source as stored in its metadata; older agents follow their adapter. */
export function sourceOf(agent) {
  const s = agent?.metadata?.agentself?.source;
  if (typeof s === "string" && s) return s;
  return agent?.adapterType === "codex_local" ? "codex" : "claude";
}

/** Human label: "Claude 订阅" / "Codex 订阅" / "DeepSeek API". */
export function sourceLabel(source, home) {
  if (source === "codex") return "Codex 订阅";
  if (source?.startsWith("api:")) return `${listProviders(home).find((p) => p.id === source.slice(4))?.name ?? source.slice(4)} API`;
  return "Claude 订阅";
}

/**
 * What an agent runs with for a source: adapter type, model and env bindings.
 * `role` matters only for defaults (leads default to Opus on the Claude subscription).
 */
export function resolveSource(source, home, { model: override = null } = {}) {
  if (!source || source === "claude") return { adapterType: "claude_local", env: {}, ...(override ? { model: override } : {}) };
  if (source === "codex") return { adapterType: "codex_local", env: {}, ...(override ? { model: override } : {}) };
  if (!source.startsWith("api:")) throw Object.assign(new Error(`未知的模型来源：${source}`), { status: 400 });
  const p = listProviders(home).find((x) => x.id === source.slice(4));
  if (!p) throw Object.assign(new Error(`没有这个服务商：${source.slice(4)}`), { status: 400 });
  if (!p.secretId) throw Object.assign(new Error(`${p.name} 还没有填 API key（设置 → 模型与订阅）`), { status: 400 });
  // the agent's own choice of model on this provider wins over the provider default
  const model = override || p.model || p.smallModel;
  const small = p.smallModel || p.model;
  return {
    adapterType: "claude_local",
    model,
    env: {
      ANTHROPIC_BASE_URL: p.baseUrl,
      ANTHROPIC_AUTH_TOKEN: { type: "secret_ref", secretId: p.secretId, version: "latest" },
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: small,
      ANTHROPIC_SMALL_FAST_MODEL: small,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  };
}

/** Replace the managed env keys of an existing env with the new source's (other keys are kept). */
export function mergeEnv(cur, next) {
  const out = {};
  for (const [k, v] of Object.entries(cur ?? {})) if (!MANAGED_ENV.includes(k)) out[k] = v;
  return { ...out, ...next };
}

const modelItems = (json) => (Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : []);
const modelId = (m) => {
  const id = typeof m === "string" ? m : (m?.id ?? m?.name ?? m?.model);
  return typeof id === "string" ? id.trim() : "";
};

/** Model ids from an OpenAI-style `{ data: [{ id }] }` or Anthropic-style list. Pure. */
export function parseModelList(json) {
  return [...new Set(modelItems(json).map(modelId).filter(Boolean))].sort();
}

const contextLength = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** Optional context length in tokens, keyed by model id; never inferred from a model name. */
export function normalizeContextLengths(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .map(([model, value]) => [model.trim(), contextLength(value)])
    .filter(([model, value]) => model && value !== undefined));
}

/** Read only explicit context-window fields; output or input limits are not total context lengths. */
export function parseModelContextLengths(json) {
  const entries = [];
  for (const model of modelItems(json)) {
    const id = modelId(model);
    if (!id || !model || typeof model !== "object") continue;
    const length = [model.context_length, model.context_window, model.contextLength, model.contextWindow, model.max_context_length, model.context_window_tokens]
      .map(contextLength).find((value) => value !== undefined);
    if (length !== undefined) entries.push([id, length]);
  }
  return Object.fromEntries(entries);
}

/**
 * Ask a provider which models it has, with a key the user just typed (stored keys cannot be read
 * back). Tries the provider's list endpoint, then `<baseUrl>/v1/models`. Saves the list.
 */
export async function fetchModels(home, id, { apiKey, baseUrl, fetchImpl = fetch } = {}) {
  const p = listProviders(home).find((x) => x.id === id);
  const key = String(apiKey ?? "").trim();
  if (!key) throw Object.assign(new Error("获取模型列表要在这里填一次 API key"), { status: 400 });
  const base = String(baseUrl ?? p?.baseUrl ?? "").replace(/\/$/, "");
  const urls = [p?.modelsUrl, base && `${base}/v1/models`].filter(Boolean);
  let lastErr = "没有可用的模型列表地址";
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, { headers: { authorization: `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        lastErr = `${new URL(url).host} 返回 ${r.status}`;
        continue;
      }
      const json = await r.json();
      const models = parseModelList(json);
      if (!models.length) {
        lastErr = `${new URL(url).host} 没有返回模型`;
        continue;
      }
      const fetchedContextLengths = parseModelContextLengths(json);
      // Omitted metadata must not erase a length the user has already filled in.
      const contextLengths = { ...normalizeContextLengths(listProviders(home).find((x) => x.id === id)?.contextLengths), ...fetchedContextLengths };
      saveProvider(home, id, { models, contextLengths, modelsFetchedAt: new Date().toISOString() });
      return { models, contextLengths: fetchedContextLengths, from: url };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw Object.assign(new Error(`没拿到模型列表：${lastErr}。可以直接手填模型名。`), { status: 502 });
}

/** Common model names for the subscriptions (aliases the CLIs accept); the CLI default is used when empty. */
export const SUBSCRIPTION_MODELS = {
  claude: ["claude-opus-5-5", "opus", "sonnet", "haiku"],
  codex: [],
};

/* ---------------- prices ---------------- */
/**
 * Prices per model, in yuan per million tokens: { model: { input, output, cached? } }. Anything
 * that is not a finite non-negative number is dropped; a model with neither input nor output goes.
 * `cached` is the cache-hit input price (DeepSeek and others charge less for it). Pure.
 */
export function normalizePrices(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const num = (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e4) / 1e4 : undefined;
  };
  for (const [model, p] of Object.entries(raw)) {
    const name = String(model).trim();
    if (!name || !p || typeof p !== "object") continue;
    const price = { input: num(p.input), output: num(p.output), cached: num(p.cached) };
    if (price.input === undefined && price.output === undefined) continue;
    out[name] = Object.fromEntries(Object.entries(price).filter(([, v]) => v !== undefined));
  }
  return out;
}

/**
 * Estimated cost in yuan of some token counts at a model's price (null when there is no price).
 * Cached input uses the cache-hit price when given, else the normal input price. Pure.
 */
export function estimateYuan({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 }, price) {
  if (!price || (price.input === undefined && price.output === undefined)) return null;
  const input = price.input ?? 0;
  const cached = price.cached ?? input;
  return (inputTokens * input + cachedInputTokens * cached + outputTokens * (price.output ?? 0)) / 1e6;
}
