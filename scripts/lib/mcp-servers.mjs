// Tool servers (MCP) for employees: a curated catalog plus custom ones, installed per machine.
// ~/.agenteam/mcp-servers.json  { servers: [{ id, name, transport, command, args, env, secretEnv,
//                                  url, tokenSecretId, enabled, scope }] }
//   transport "stdio": command + args (+ env); "http": url (+ a bearer token)
//   env: plain values; secretEnv: { NAME: secretId } — Paperclip secrets bound into the agent's env
//   scope: "all" (every employee) or ["<agentId>", …]
// Each agent's runtime gets the servers that apply to it on sync (scripts/lib/department.mjs):
//   Claude Code — entries in .agenteam/mcp.json; secrets referenced as ${NAME}
//   Codex       — `-c mcp_servers.<id>.*`; secrets forwarded with env_vars / bearer_token_env_var
// Leads get none: they only use the management tools.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = () => process.env.AGENTEAM_HOME ?? path.join(os.homedir(), ".agenteam");
const file = () => path.join(home(), "mcp-servers.json");

/**
 * Curated starting points. Package names and options are the projects' own; check `docs` if one
 * changes. `needs`: what the machine must have. `fields`: what the user fills in.
 */
export const MCP_CATALOG = [
  {
    id: "filesystem",
    name: "文件夹读写",
    description: "让员工读写指定的文件夹（比如数据、实验结果目录），超出这些文件夹的访问会被拒绝。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    fields: [{ key: "paths", label: "允许访问的文件夹（每行一个）", kind: "args", multiline: true }],
    needs: "Node.js（npx）",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "playwright",
    name: "浏览器自动化",
    description: "打开网页、点击、填表、截图，适合需要登录或交互的网站。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    fields: [],
    needs: "Node.js（npx）；第一次会下载浏览器",
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "github",
    name: "GitHub",
    description: "看仓库、issue、PR、代码搜索；写操作（提 PR、评论）属于对外动作，员工会先问。",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    fields: [{ key: "token", label: "GitHub Personal Access Token", kind: "token" }],
    needs: "GitHub 账号的 token",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "notion",
    name: "Notion",
    description: "读写你授权给集成的 Notion 页面和数据库，适合整理读书笔记、实验记录。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    fields: [{ key: "NOTION_TOKEN", label: "Notion 集成的 token（ntn_ 开头）", kind: "secret" }],
    needs: "Node.js（npx）；在 Notion 里建一个集成并把页面分享给它",
    docs: "https://github.com/makenotion/notion-mcp-server",
  },
  {
    id: "context7",
    name: "代码库文档（Context7）",
    description: "查各种编程库最新版本的文档和用法，写代码时少踩过时 API 的坑。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    fields: [],
    needs: "Node.js（npx）",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "zotero",
    name: "Zotero",
    description: "检索你本机 Zotero 文献库里的条目、笔记和标注。",
    transport: "stdio",
    command: "zotero-mcp",
    args: [],
    env: { ZOTERO_LOCAL: "true" },
    fields: [],
    needs: "Python；先 pip install zotero-mcp（或 uv tool install），并打开 Zotero（本地 API）",
    docs: "https://github.com/54yyyu/zotero-mcp",
  },
  {
    id: "arxiv",
    name: "arXiv 检索",
    description: "按关键词、作者、日期检索 arXiv（找到的论文可以再用论文库收进来）。",
    transport: "stdio",
    command: "uvx",
    args: ["arxiv-mcp-server"],
    fields: [],
    needs: "Python 的 uv（uvx）",
    docs: "https://github.com/blazickjp/arxiv-mcp-server",
  },
  {
    id: "tavily",
    name: "联网搜索（Tavily）",
    description: "给没有自带联网搜索的员工（比如部分 API 模型）加上网页搜索和抓取。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "tavily-mcp@latest"],
    fields: [{ key: "TAVILY_API_KEY", label: "Tavily API key", kind: "secret" }],
    needs: "Node.js（npx）；Tavily 账号",
    docs: "https://github.com/tavily-ai/tavily-mcp",
  },
];

/* ---------------- registry ---------------- */
export function readServers() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(v?.servers) ? v.servers : [];
  } catch {
    return [];
  }
}
function writeServers(list) {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ servers: list }, null, 2));
}
/** Without secret ids (the UI only needs to know a secret is set). */
export function listServers() {
  return readServers().map(({ secretEnv, tokenSecretId, ...s }) => ({ ...s, secretKeys: Object.keys(secretEnv ?? {}), hasToken: !!tokenSecretId }));
}
const ID = /^[a-z][a-z0-9-]{1,30}$/;
/** Env names a server may not take over (they steer the agent itself). */
const RESERVED_ENV = /^(PAPERCLIP_|AGENTEAM_|ANTHROPIC_|OPENAI_API_KEY$|PATH$|HOME$|USERPROFILE$|APPDATA$)/;

/**
 * Add or update a server. `secretIds`: { NAME: secretId } for secret env values the caller stored
 * in Paperclip; `tokenSecretId` for an http bearer token.
 */
export function saveServer(input, { secretIds = {}, tokenSecretId } = {}) {
  const id = String(input.id ?? "").trim().toLowerCase();
  if (!ID.test(id) || id === "agenteam") throw Object.assign(new Error("工具服务的 id 要用小写英文字母开头（字母、数字、-），不能叫 agenteam"), { status: 400 });
  const list = readServers();
  const cur = list.find((s) => s.id === id) ?? {};
  const transport = input.transport ?? cur.transport ?? "stdio";
  const next = {
    ...cur,
    id,
    name: String(input.name ?? cur.name ?? id).trim(),
    catalogId: input.catalogId ?? cur.catalogId ?? null,
    transport,
    enabled: input.enabled ?? cur.enabled ?? true,
    scope: input.scope === "all" || Array.isArray(input.scope) ? input.scope : (cur.scope ?? "all"),
    updatedAt: new Date().toISOString(),
  };
  if (transport === "stdio") {
    next.command = String(input.command ?? cur.command ?? "").trim();
    next.args = Array.isArray(input.args) ? input.args.map(String) : (cur.args ?? []);
    next.env = { ...(cur.env ?? {}), ...(input.env ?? {}) };
    next.secretEnv = { ...(cur.secretEnv ?? {}), ...secretIds };
    if (!next.command) throw Object.assign(new Error("要填启动命令"), { status: 400 });
    for (const k of [...Object.keys(next.env), ...Object.keys(next.secretEnv)]) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw Object.assign(new Error(`环境变量名不对：${k}`), { status: 400 });
      if (RESERVED_ENV.test(k)) throw Object.assign(new Error(`环境变量 ${k} 是系统自己用的，工具服务不能设置`), { status: 400 });
    }
  } else if (transport === "http") {
    next.url = String(input.url ?? cur.url ?? "").trim();
    if (!/^https?:\/\//.test(next.url)) throw Object.assign(new Error("要填 http(s) 地址"), { status: 400 });
    if (tokenSecretId) next.tokenSecretId = tokenSecretId;
  } else throw Object.assign(new Error(`不支持的连接方式：${transport}`), { status: 400 });
  writeServers([...list.filter((s) => s.id !== id), next]);
  return listServers().find((s) => s.id === id);
}
export function removeServer(id) {
  writeServers(readServers().filter((s) => s.id !== id));
}

/* ---------------- per-agent runtime ---------------- */
const tokenEnv = (id) => `AGENTEAM_MCP_${id.toUpperCase().replace(/-/g, "_")}_TOKEN`;
/** Servers that apply to an agent (employees only). */
export function serversFor(agent) {
  if (agent?.metadata?.agenteam?.isLead) return [];
  return readServers().filter((s) => s.enabled !== false && (s.scope === "all" || (Array.isArray(s.scope) && s.scope.includes(agent?.id))));
}
/** Env bindings an agent needs for its servers' secrets: { NAME: secret_ref }. */
export function mcpEnvFor(agent) {
  const env = {};
  for (const s of serversFor(agent)) {
    for (const [k, secretId] of Object.entries(s.secretEnv ?? {})) env[k] = { type: "secret_ref", secretId, version: "latest" };
    if (s.transport === "http" && s.tokenSecretId) env[tokenEnv(s.id)] = { type: "secret_ref", secretId: s.tokenSecretId, version: "latest" };
  }
  return env;
}
/** Every env name any registered server could bind (to drop the ones no longer wanted). */
export function allMcpEnvKeys() {
  const keys = new Set();
  for (const s of readServers()) {
    for (const k of Object.keys(s.secretEnv ?? {})) keys.add(k);
    if (s.transport === "http") keys.add(tokenEnv(s.id));
  }
  return [...keys];
}
/** Claude Code `mcpServers` entries (merged into .agenteam/mcp.json). */
export function claudeMcpEntries(agent) {
  const out = {};
  for (const s of serversFor(agent)) {
    if (s.transport === "http") {
      out[s.id] = { type: "http", url: s.url, ...(s.tokenSecretId ? { headers: { Authorization: `Bearer \${${tokenEnv(s.id)}}` } } : {}) };
    } else {
      const env = { ...(s.env ?? {}) };
      for (const k of Object.keys(s.secretEnv ?? {})) env[k] = `\${${k}}`;
      out[s.id] = { command: s.command, args: s.args ?? [], ...(Object.keys(env).length ? { env } : {}) };
    }
  }
  return out;
}
/**
 * A TOML string for a Codex `-c` override that contains no whitespace at all: on Windows the
 * probe and runs go through cmd.exe and the npm .cmd shim, and an argument with spaces gets split
 * there (Codex: "unexpected argument"). Plain values become literal strings ('C:\x'); values with
 * whitespace or quotes become basic strings with whitespace escaped as \uXXXX.
 */
export function tomlStr(v) {
  const s = String(v);
  if (!/[\s'"]/.test(s)) return `'${s}'`;
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\s/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}
/** A TOML array with no whitespace in it (see tomlStr). */
export const tomlArr = (xs) => `[${xs.map(tomlStr).join(",")}]`;
const tomlTable = (entries) => `{${entries.map(([n, v]) => `${n}=${tomlStr(v)}`).join(",")}}`;
/** Codex `-c` overrides for an agent's servers. */
export function codexMcpEntries(agent) {
  const args = [];
  for (const s of serversFor(agent)) {
    const k = `mcp_servers.${s.id}`;
    if (s.transport === "http") {
      args.push("-c", `${k}.url=${tomlStr(s.url)}`);
      if (s.tokenSecretId) args.push("-c", `${k}.bearer_token_env_var=${tomlStr(tokenEnv(s.id))}`);
    } else {
      args.push("-c", `${k}.command=${tomlStr(s.command)}`, "-c", `${k}.args=${tomlArr(s.args ?? [])}`);
      const env = Object.entries(s.env ?? {});
      if (env.length) args.push("-c", `${k}.env=${tomlTable(env)}`);
      const fwd = Object.keys(s.secretEnv ?? {});
      if (fwd.length) args.push("-c", `${k}.env_vars=${tomlArr(fwd)}`);
    }
    args.push("-c", `${k}.startup_timeout_sec=60`);
  }
  return args;
}

/* ---------------- test ---------------- */
/**
 * Start a server once and list its tools (values typed in the form, not the stored secrets).
 * stdio: newline-delimited JSON-RPC; http: one initialize + tools/list over POST.
 */
export async function testServer(spec, { timeoutMs = 90_000 } = {}) {
  if (spec.transport === "http") return testHttp(spec, timeoutMs);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(spec.command, spec.args ?? [], { env: { ...process.env, ...(spec.env ?? {}) }, shell: process.platform === "win32", windowsHide: true });
    let buf = "";
    let err = "";
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve({ ...r, ms: Date.now() - t0, stderr: err.trim().slice(-400) });
    };
    const timer = setTimeout(() => finish({ ok: false, error: "启动超时（第一次用 npx / uvx 下载可能要一两分钟，再试一次）" }), timeoutMs);
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.on("error", (e) => finish({ ok: false, error: `启动失败：${e.message}（${spec.command} 装了吗？）` }));
    child.on("exit", (code) => finish({ ok: false, error: `进程退出（${code}）` }));
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (m.id === 2) finish(m.error ? { ok: false, error: m.error.message } : { ok: true, tools: (m.result?.tools ?? []).map((x) => x.name) });
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agenteam", version: "1.0" } } });
  });
}
async function testHttp(spec, timeoutMs) {
  const t0 = Date.now();
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(spec.token ? { authorization: `Bearer ${spec.token}` } : {}) };
  const call = async (body, session) => {
    const r = await fetch(spec.url, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
    const json = text.trim().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).pop() ?? "{}");
    return { json, session: r.headers.get("mcp-session-id") ?? session };
  };
  try {
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agenteam", version: "1.0" } } });
    const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, init.session);
    return { ok: true, tools: (list.json.result?.tools ?? []).map((x) => x.name), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}
