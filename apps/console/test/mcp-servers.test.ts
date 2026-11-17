// Tool servers (MCP) for employees: registry, scope, and what Claude / Codex agents get.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AGENTEAM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agenteam-mcp-"));
// @ts-expect-error plain JS module
const m = await import("../../../scripts/lib/mcp-servers.mjs");
// @ts-expect-error plain JS module
const dept = await import("../../../scripts/lib/department.mjs");

const emp = (id: string) => ({ id, metadata: { agenteam: { isLead: false } } });
const lead = { id: "L", metadata: { agenteam: { isLead: true } } };

describe("registry", () => {
  it("validates ids, commands, URLs and env names", () => {
    expect(() => m.saveServer({ id: "Bad Id", command: "x" })).toThrow(/小写英文/);
    expect(() => m.saveServer({ id: "agenteam", command: "x" })).toThrow(/不能叫 agenteam/);
    expect(() => m.saveServer({ id: "nocmd" })).toThrow(/启动命令/);
    expect(() => m.saveServer({ id: "web", transport: "http", url: "ftp://x" })).toThrow(/http/);
    expect(() => m.saveServer({ id: "evil", command: "x", env: { ANTHROPIC_BASE_URL: "http://evil" } })).toThrow(/系统自己用的/);
  });
  it("lists servers without secret ids", () => {
    m.saveServer({ id: "notion", name: "Notion", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] }, { secretIds: { NOTION_TOKEN: "sec-n" } });
    m.saveServer({ id: "github", name: "GitHub", transport: "http", url: "https://api.githubcopilot.com/mcp/", scope: ["E2"] }, { tokenSecretId: "sec-g" });
    m.saveServer({ id: "files", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\Data"], env: { LOG: "info" } });
    const list = m.listServers();
    expect(list.find((s: { id: string }) => s.id === "notion")).toMatchObject({ secretKeys: ["NOTION_TOKEN"], scope: "all" });
    expect(JSON.stringify(list)).not.toMatch(/sec-n|sec-g/);
  });
});

describe("what each agent gets", () => {
  it("scope: everyone, or only the listed employees; never leads", () => {
    expect(m.serversFor(emp("E1")).map((s: { id: string }) => s.id).sort()).toEqual(["files", "notion"]);
    expect(m.serversFor(emp("E2")).map((s: { id: string }) => s.id).sort()).toEqual(["files", "github", "notion"]);
    expect(m.serversFor(lead)).toEqual([]);
  });
  it("Claude: mcp.json entries reference secrets as ${NAME}; the token goes in a header", () => {
    const e = m.claudeMcpEntries(emp("E2"));
    expect(e.notion).toEqual({ command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN: "${NOTION_TOKEN}" } });
    expect(e.github).toEqual({ type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${AGENTEAM_MCP_GITHUB_TOKEN}" } });
    expect(e.files.env).toEqual({ LOG: "info" });
  });
  it("secrets are bound into the agent's env as secret references", () => {
    expect(m.mcpEnvFor(emp("E2"))).toEqual({
      NOTION_TOKEN: { type: "secret_ref", secretId: "sec-n", version: "latest" },
      AGENTEAM_MCP_GITHUB_TOKEN: { type: "secret_ref", secretId: "sec-g", version: "latest" },
    });
  });
  it("Codex: -c overrides, secrets forwarded with env_vars / bearer_token_env_var", () => {
    const a = m.codexMcpEntries(emp("E2")).join(" ");
    expect(a).toMatch(/mcp_servers\.notion\.command='npx'/);
    expect(a).toMatch(/mcp_servers\.notion\.env_vars=\['NOTION_TOKEN'\]/);
    expect(a).toMatch(/mcp_servers\.files\.env=\{LOG='info'\}/);
    expect(a).toMatch(/mcp_servers\.github\.bearer_token_env_var='AGENTEAM_MCP_GITHUB_TOKEN'/);
    const cfg = dept.agentAdapterConfig({ role: "employee", adapterType: "codex_local", cwd: "/w", nodePath: "node", agent: emp("E2") });
    expect(cfg.extraArgs.join(" ")).toMatch(/mcp_servers\.agenteam\..*mcp_servers\.notion\./);
  });
  it("Claude employees' mcp.json gets them next to the team server; leads only the team server", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agenteam-mcp-cwd-"));
    dept.writeAgentRuntime(cwd, { role: "employee", adapterType: "claude_local", agent: emp("E1") });
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(cwd, ".agenteam", "mcp.json"), "utf8")).mcpServers).sort()).toEqual(["agenteam", "files", "notion"]);
    dept.writeAgentRuntime(cwd, { role: "lead", adapterType: "claude_local", agent: lead });
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(cwd, ".agenteam", "mcp.json"), "utf8")).mcpServers)).toEqual(["agenteam"]);
  });
  it("disabled or removed servers disappear", () => {
    m.saveServer({ id: "files", enabled: false });
    expect(m.serversFor(emp("E1")).map((s: { id: string }) => s.id)).toEqual(["notion"]);
    m.removeServer("notion");
    expect(m.serversFor(emp("E1"))).toEqual([]);
    expect(m.mcpEnvFor(emp("E1"))).toEqual({});
  });
});
