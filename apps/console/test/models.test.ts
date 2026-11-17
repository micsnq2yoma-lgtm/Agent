// Model sources: Claude / Codex subscriptions per machine, everything else over an API.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { estimateYuan, listProviders, mergeEnv, normalizeContextLengths, normalizePrices, parseModelContextLengths, resolveSource, saveProvider, sourceOf } from "../../../scripts/lib/providers.mjs";
import { contextLengthOf, contextLengthText } from "../../../vendor/paperclip/ui/src/agentself/lib/model-context";
import type { ModelsInfo } from "../../../vendor/paperclip/ui/src/agentself/lib/models";
// @ts-expect-error plain JS module
import { agentAdapterConfig, codexMcpArgs, validatePack } from "../../../scripts/lib/department.mjs";
// @ts-expect-error plain JS module
import { tomlStr } from "../../../scripts/lib/mcp-servers.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentself-models-"));
const previousHome = process.env.AGENTSELF_HOME;
// everything that reads ~/.agentself (mailboxes, tool servers) reads this empty home, not the machine's
process.env.AGENTSELF_HOME = home;
afterAll(() => {
  if (previousHome === undefined) delete process.env.AGENTSELF_HOME;
  else process.env.AGENTSELF_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("API providers", () => {
  it("presets list without keys until one is saved; the key itself is never stored here", () => {
    const ds = listProviders(home).find((p: { id: string }) => p.id === "deepseek");
    expect(ds).toMatchObject({ hasKey: false, baseUrl: "https://api.deepseek.com/anthropic" });
    saveProvider(home, "deepseek", { model: "deepseek-reasoner", secretId: "sec-1" });
    expect(listProviders(home).find((p: { id: string }) => p.id === "deepseek")).toMatchObject({ hasKey: true, model: "deepseek-reasoner" });
    expect(fs.readFileSync(path.join(home, "providers.json"), "utf8")).not.toMatch(/sk-/);
  });
  it("an API source runs on Claude Code with the provider's endpoint and a secret reference", () => {
    const r = resolveSource("api:deepseek", home);
    expect(r.adapterType).toBe("claude_local");
    expect(r.model).toBe("deepseek-reasoner");
    expect(r.env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(r.env.ANTHROPIC_AUTH_TOKEN).toEqual({ type: "secret_ref", secretId: "sec-1", version: "latest" });
    expect(r.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek-reasoner");
  });
  it("subscriptions need no env; unknown or keyless providers are refused", () => {
    expect(resolveSource("claude", home)).toEqual({ adapterType: "claude_local", env: {} });
    expect(resolveSource("codex", home)).toEqual({ adapterType: "codex_local", env: {} });
    expect(() => resolveSource("api:kimi", home)).toThrow(/还没有填 API key/);
    expect(() => resolveSource("api:nope", home)).toThrow(/没有这个服务商/);
  });
  it("custom providers need an Anthropic-compatible URL", () => {
    expect(() => saveProvider(home, "my-gw", { name: "网关" })).toThrow(/接口地址/);
    expect(saveProvider(home, "my-gw", { name: "网关", baseUrl: "https://gw.example/anthropic", model: "m1" })).toMatchObject({ id: "my-gw", preset: false });
  });
  it("switching source swaps only the env keys it manages", () => {
    const cur = { ANTHROPIC_BASE_URL: "x", ANTHROPIC_AUTH_TOKEN: { type: "secret_ref" }, HTTP_PROXY: "http://proxy" };
    expect(mergeEnv(cur, {})).toEqual({ HTTP_PROXY: "http://proxy" });
  });
  it("older agents follow their adapter", () => {
    expect(sourceOf({ adapterType: "codex_local" })).toBe("codex");
    expect(sourceOf({ adapterType: "claude_local" })).toBe("claude");
    expect(sourceOf({ adapterType: "claude_local", metadata: { agentself: { source: "api:glm" } } })).toBe("api:glm");
  });
});

describe("Codex employees get the team tools", () => {
  it("the team MCP server is registered through -c overrides, with the run's variables forwarded", () => {
    const args = codexMcpArgs({ nodePath: "D:\\Apps\\node\\node.exe" });
    expect(args).toContain("mcp_servers.agentself.command='D:\\Apps\\node\\node.exe'");
    expect(args.find((a: string) => a.startsWith("mcp_servers.agentself.args="))).toMatch(/mcp-team\.mjs','--role=employee'\]$/);
    expect(args).toContain("mcp_servers.agentself.env_vars=['PAPERCLIP_API_URL','PAPERCLIP_API_KEY','PAPERCLIP_AGENT_ID','PAPERCLIP_COMPANY_ID','PAPERCLIP_RUN_ID','PAPERCLIP_TASK_ID','AGENTSELF_HOME']");
  });
  it("no argument has whitespace in it: Windows splits those on the way to Codex (codex-cli 0.128)", () => {
    const args = codexMcpArgs({ nodePath: "C:\\Program Files\\nodejs\\node.exe" });
    for (const a of args) expect(a).not.toMatch(/\s/);
    expect(args).toContain("mcp_servers.agentself.command='node'");
  });
  it("values with spaces or quotes become escaped basic strings", () => {
    expect(tomlStr("D:\\My Docs\\x.mjs")).toBe('"D:\\\\My\\u0020Docs\\\\x.mjs"');
    expect(tomlStr("it's")).toBe('"it\'s"');
    expect(tomlStr("plain")).toBe("'plain'");
  });
  it("Codex employees use the CLI engine without the Codex sandbox", () => {
    const c = agentAdapterConfig({ role: "employee", adapterType: "codex_local", cwd: "/w/e", nodePath: "node" });
    expect(c).toMatchObject({ engine: "cli", dangerouslyBypassApprovalsAndSandbox: true });
    expect(c.extraArgs.join(" ")).toMatch(/mcp_servers\.agentself/);
  });
  it("a lead cannot run on Codex; employees can use any source", () => {
    const base = { schema: "agentself.department/1", name: "T", lead: { name: "L" }, members: [{ key: "a", name: "A", source: "api:deepseek" }] };
    expect(validatePack(base)).toEqual([]);
    expect(validatePack({ ...base, lead: { name: "L", source: "codex" } }).join()).toMatch(/主管只能用 Claude Code/);
    expect(validatePack({ ...base, members: [{ key: "a", name: "A", source: "gemini" }] }).join()).toMatch(/模型来源不支持/);
  });
});

// @ts-expect-error plain JS module
import { fetchModels, parseModelList } from "../../../scripts/lib/providers.mjs";
// @ts-expect-error plain JS module
import { setAgentModel } from "../../../scripts/lib/department.mjs";

describe("model market", () => {
  it("reads OpenAI- and Anthropic-style model lists", () => {
    expect(parseModelList({ object: "list", data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }] })).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(parseModelList({ data: [{ id: "glm-4.6", type: "model" }], has_more: false })).toEqual(["glm-4.6"]);
    expect(parseModelList({ models: ["a", "a", "b"] })).toEqual(["a", "b"]);
  });
  it("asks the provider's list endpoint, falls back to <baseUrl>/v1/models, and saves the list", async () => {
    const asked: string[] = [];
    const fake = async (url: string, o: { headers: Record<string, string> }) => {
      asked.push(`${url} ${o.headers.authorization}`);
      if (url.includes("api.deepseek.com/models")) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }) };
    };
    const r = await fetchModels(home, "deepseek", { apiKey: "sk-x", fetchImpl: fake });
    expect(r.models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(asked).toEqual(["https://api.deepseek.com/models Bearer sk-x", "https://api.deepseek.com/anthropic/v1/models Bearer sk-x"]);
    expect(listProviders(home).find((p: { id: string }) => p.id === "deepseek").models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    await expect(fetchModels(home, "deepseek", { apiKey: "" })).rejects.toThrow(/填一次 API key/);
  });
  it("an agent's own model wins over the provider default", () => {
    expect(resolveSource("api:deepseek", home, { model: "deepseek-chat" }).env.ANTHROPIC_MODEL).toBe("deepseek-chat");
    expect(resolveSource("api:deepseek", home).model).toBe("deepseek-reasoner");
    expect(resolveSource("claude", home, { model: "sonnet" })).toEqual({ adapterType: "claude_local", env: {}, model: "sonnet" });
  });
  it("setAgentModel stores the choice and rewrites the env for API agents", async () => {
    process.env.AGENTSELF_HOME = home;
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const agent = { id: "E", adapterType: "claude_local", adapterConfig: { cwd: "/w/e", model: "deepseek-reasoner", env: { HTTP_PROXY: "p" } }, metadata: { agentself: { isLead: false, source: "api:deepseek" } } };
    const api = async (method: string, p: string, body: Record<string, unknown>) => {
      calls.push([method, p, body]);
      return method === "GET" ? agent : { ...agent, ...body };
    };
    await setAgentModel("E", "deepseek-chat", { api, log: () => {} });
    const patch = calls.find((c) => c[0] === "PATCH")![2] as { adapterConfig: { model: string; env: Record<string, unknown> }; replaceAdapterConfig: boolean; metadata: { agentself: { model: string } } };
    expect(patch.adapterConfig.model).toBe("deepseek-chat");
    expect(patch.adapterConfig.env.ANTHROPIC_MODEL).toBe("deepseek-chat");
    expect(patch.adapterConfig.env.HTTP_PROXY).toBe("p");
    expect(patch.replaceAdapterConfig).toBe(true);
    expect(patch.metadata.agentself.model).toBe("deepseek-chat");
    await expect(setAgentModel("E", "bad model name!", { api, log: () => {} })).rejects.toThrow(/模型名不对/);
  });
});

describe("model prices (yuan per million tokens)", () => {
  it("bad values are dropped, a model needs an input or output price", () => {
    expect(normalizePrices({ "deepseek-chat": { input: "2", output: 3, cached: "0.2" }, empty: { input: "", output: null }, bad: { input: -1, output: "x" }, " ": { input: 1 } })).toEqual({
      "deepseek-chat": { input: 2, output: 3, cached: 0.2 },
    });
    expect(normalizePrices(null)).toEqual({});
  });
  it("estimate: cache hits at the cached price, else at the input price; no price → null", () => {
    const t = { inputTokens: 1_000_000, cachedInputTokens: 2_000_000, outputTokens: 500_000 };
    expect(estimateYuan(t, { input: 2, cached: 0.2, output: 8 })).toBeCloseTo(2 + 0.4 + 4);
    expect(estimateYuan(t, { input: 2, output: 8 })).toBeCloseTo(2 + 4 + 4);
    expect(estimateYuan(t, undefined)).toBeNull();
  });
  it("prices are saved with the provider, presets carry their pricing page", () => {
    saveProvider(home, "deepseek", { prices: { "deepseek-chat": { input: 2, output: 3 } } });
    const p = listProviders(home).find((x: { id: string }) => x.id === "deepseek");
    expect(p.prices).toEqual({ "deepseek-chat": { input: 2, output: 3 } });
    expect(p.pricingUrl).toMatch(/^https:\/\//);
  });
});

describe("optional model context lengths (tokens)", () => {
  it("accepts only positive safe integers and leaves unspecified models unknown", () => {
    expect(normalizeContextLengths({ " model-a ": "4096", "model-b": 8192, empty: "", whitespace: " ", zero: 0, negative: -1, fraction: 1.5, huge: Number.MAX_SAFE_INTEGER + 1, infinity: Infinity, invalid: "128k", boolean: true, array: [2048], object: {}, missing: null })).toEqual({
      "model-a": 4096,
      "model-b": 8192,
    });
    expect(normalizeContextLengths(null)).toEqual({});
    expect(normalizeContextLengths([4096])).toEqual({});
    expect(listProviders(fs.mkdtempSync(path.join(home, "empty-")))).toSatisfy((providers: Array<{ contextLengths?: unknown }>) => providers.every((p) => p.contextLengths === undefined));
  });
  it("reads explicit context fields across model-list shapes without treating input/output limits as context", () => {
    expect(parseModelContextLengths({ data: [
      { id: " a ", context_length: 4096 },
      { id: "b", context_window: "8192" },
      { id: "c", contextLength: 2048 },
      { id: "d", contextWindow: 16384 },
      { id: "e", max_context_length: 32768 },
      { id: "f", context_window_tokens: 65536 },
      { id: "output-only", max_output_tokens: 1024 },
      { id: "input-only", max_input_tokens: 1024 },
      { id: "bad", context_length: -1 },
      { context_length: 1024 },
      "name-with-128k",
    ] })).toEqual({ a: 4096, b: 8192, c: 2048, d: 16384, e: 32768, f: 65536 });
    expect(parseModelContextLengths({ models: [{ name: "model-a", context_window: 2048 }, "model-b"] })).toEqual({ "model-a": 2048 });
    expect(parseModelContextLengths([{ model: "model-c", context_length: 4096 }])).toEqual({ "model-c": 4096 });
  });
  it("fetching models carries returned context metadata and preserves manually entered values when omitted", async () => {
    saveProvider(home, "context-test", { baseUrl: "https://models.example/anthropic", model: "reported", smallModel: "manual", contextLengths: { reported: 4096, manual: 2048 }, prices: { reported: { input: 2 } } });
    const result = await fetchModels(home, "context-test", {
      apiKey: "synthetic-test-value",
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: "reported", context_length: 8192 }, { id: "manual" }, { id: "unknown" }] }) }),
    });
    expect(result.models).toEqual(["manual", "reported", "unknown"]);
    expect(result.contextLengths).toEqual({ reported: 8192 });
    expect(listProviders(home).find((p: { id: string }) => p.id === "context-test")).toMatchObject({ contextLengths: { reported: 8192, manual: 2048 }, prices: { reported: { input: 2 } } });
    saveProvider(home, "context-test", { contextLengths: { reported: "", manual: "16384" } });
    const saved = listProviders(home).find((p: { id: string }) => p.id === "context-test");
    expect(saved.contextLengths).toEqual({ manual: 16384 });
    expect(saved.prices).toEqual({ reported: { input: 2 } });
    expect(fs.readFileSync(path.join(home, "providers.json"), "utf8")).not.toContain("synthetic-test-value");
  });
  it("the employee picker uses the chosen provider/model, including defaults and unknown lengths", () => {
    const models: ModelsInfo = {
      providers: [
        { id: "first", name: "First", baseUrl: "", model: "main", smallModel: "light", hasKey: true, preset: false, contextLengths: { main: 8192, light: 4096, manual: 2048 } },
        { id: "second", name: "Second", baseUrl: "", model: "main", smallModel: "main", hasKey: true, preset: false, contextLengths: { main: 16384 } },
      ],
      subscriptions: { claude: null, codex: null },
    };
    expect(contextLengthOf(models, "api:first", "light")).toBe(4096);
    expect(contextLengthOf(models, "api:first", "")).toBe(8192);
    expect(contextLengthOf(models, "api:second", "main")).toBe(16384);
    expect(contextLengthOf(models, "api:first", "unknown")).toBeNull();
    expect(contextLengthOf(models, "claude", "main")).toBeNull();
    expect(contextLengthOf(null, "api:first", "main")).toBeNull();
    expect(contextLengthOf(models, "api:first", "manual")).toBe(2048);
    expect(contextLengthText(8192)).toBe("上下文 8,192 token");
    expect(contextLengthText(null)).toBe("上下文未提供");
    expect(contextLengthText(-1)).toBe("上下文未提供");
  });
});
