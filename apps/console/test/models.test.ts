// Model sources: Claude / Codex subscriptions per machine, everything else over an API.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { listProviders, mergeEnv, resolveSource, saveProvider, sourceOf } from "../../../scripts/lib/providers.mjs";
// @ts-expect-error plain JS module
import { agentAdapterConfig, codexMcpArgs, validatePack } from "../../../scripts/lib/department.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentself-models-"));

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
    const args = codexMcpArgs({ nodePath: "C:\\Program Files\\nodejs\\node.exe" });
    expect(args).toContain("mcp_servers.agentself.command='C:\\Program Files\\nodejs\\node.exe'");
    expect(args.find((a: string) => a.startsWith("mcp_servers.agentself.args="))).toMatch(/mcp-team\.mjs', '--role=employee'\]$/);
    expect(args.find((a: string) => a.startsWith("mcp_servers.agentself.env_vars="))).toMatch(/PAPERCLIP_API_KEY/);
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
