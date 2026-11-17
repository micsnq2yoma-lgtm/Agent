#!/usr/bin/env node
// Agentself local service (P8): hosts the Agentself-only endpoints under /agentself/api
// (front desk, Feishu, office snapshot, settings, memory, department wizard, skins).
// Browsers never call it directly: the Paperclip server (:3100) reverse-proxies
// /agentself/api/* here, so it listens on loopback only and serves no UI.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, DEFAULT_ROUTER_MODEL, parseRoute, runClaude } from "./frontdesk.mjs";
import { buildOfficeSnapshot } from "./office.mjs";
import { imStatus, startIm } from "./im.mjs";
import { listAccounts, MAIL_PRESETS, plainPasswordAccounts, presetFor, readAccounts, removeAccount, saveAccount, testAccount } from "./mail.mjs";
import { addPaper, defaultRoot, getPaper, libraryRoot, libraryStats, listPapers, pdfPath, removePaper, searchLibrary, setLibraryRoot, updatePaper, writeNotes } from "../../../scripts/lib/library.mjs";
import { addEmployee, createDepartment, listTemplates, readTemplate, setAgentModel, setAgentSource, syncAgentRuntime } from "../../../scripts/lib/department.mjs";
import { fetchModels, listProviders, removeProvider, saveProvider, sourceLabel, sourceOf, SUBSCRIPTION_MODELS } from "../../../scripts/lib/providers.mjs";
import { codexConfigProblems } from "../../../scripts/lib/codex-check.mjs";
import { listServers, MCP_CATALOG, readServers, removeServer, saveServer, testServer } from "../../../scripts/lib/mcp-servers.mjs";
import { commitMemory, listMemory, resolveMemoryPath } from "../../../scripts/lib/memory.mjs";
import { refreshAllInstructions, refreshInstructions } from "../../../scripts/lib/instructions.mjs";
import { appendDecision, ensureProfile, listProposals, PROFILE_FILES, readProfile, resolveProposal, writeProfile } from "../../../scripts/lib/profile.mjs";
import { exportDepartment as exportDept } from "../../../scripts/lib/share.mjs";
import { BUILTIN_SKINS, validateSkin } from "../../../packages/skins/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");
const PAPERCLIP = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const PORT = Number(process.env.AGENTSELF_PORT ?? 3200);
const HOST = process.env.AGENTSELF_HOST ?? "127.0.0.1";
const HOME = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const STORE = path.join(HOME, "console.json");

/* ---------------- store ---------------- */
const DEFAULT_SETTINGS = {
  companyName: "AgenTeam",
  frontdeskModel: DEFAULT_ROUTER_MODEL, // the router model (key kept for existing settings files)
  askWhenUnclear: true,
  skin: "office",
  externalDefault: "ask",
  globalBudgetCents: 0,
  feishu: { enabled: false, appId: "", secretRef: "", allowUserIds: [], pushTiers: ["high"] },
  // nightly self-update (scripts/update.mjs): at `hour` local time, only when nobody is working
  autoUpdate: { enabled: false, hour: 4 },
};
function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return { answers: [], hireRequests: [], ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } };
  } catch {
    return { answers: [], hireRequests: [], settings: { ...DEFAULT_SETTINGS } };
  }
}
let store = loadStore();
function saveStore() {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE);
}

/* ---------------- paperclip ---------------- */
async function pc(method, p, body) {
  const res = await fetch(`${PAPERCLIP}/api${p}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}
const arr = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

/** The product was renamed Agentself → AgenTeam: the company created under the old name follows once. */
async function renameLegacyCompany(company) {
  try {
    await pc("PATCH", `/companies/${company.id}`, { name: "AgenTeam" });
    company.name = "AgenTeam";
    if (store.settings.companyName === "Agentself") {
      store.settings.companyName = "AgenTeam";
      saveStore();
    }
  } catch {
    /* keep working under the old name */
  }
}

export async function loadContext() {
  const companies = arr(await pc("GET", "/companies")).filter((c) => c.status !== "archived");
  const company = companies.find((c) => c.name === store.settings.companyName) ?? companies.find((c) => c.name === "Agentself") ?? companies[0] ?? null;
  if (company?.name === "Agentself") await renameLegacyCompany(company);
  if (!company) return { company: null, departments: [], agents: [], projects: [] };
  const [agents, projects] = await Promise.all([pc("GET", `/companies/${company.id}/agents`), pc("GET", `/companies/${company.id}/projects`)]);
  const deptMap = new Map();
  for (const a of arr(agents)) {
    const m = a.metadata?.agentself;
    // terminated agents (a removed team whose history kept its rows) no longer make a team
    if (!m?.department || a.status === "terminated") continue;
    const d = deptMap.get(m.department) ?? { key: m.department, name: m.departmentName ?? m.department, projectId: m.projectId ?? null, leadAgentId: null, members: [] };
    if (m.isLead) d.leadAgentId = a.id;
    // The pack icon lives on the employees (the lead's Paperclip icon is a crown).
    else if (!d.icon && a.icon) d.icon = a.icon;
    d.members.push(a.id);
    deptMap.set(m.department, d);
  }
  const departments = [...deptMap.values()].map((d) => {
    const project = arr(projects).find((p) => p.id === d.projectId);
    return { ...d, description: project?.description ?? "", archived: project?.archivedAt ? true : false };
  });
  return { company, departments, agents: arr(agents), projects: arr(projects) };
}

/* ---------------- router (plan B) ---------------- */
function externalNote(mode) {
  return mode === "direct" ? "\n\n—— 对外动作：可以直接做（用户已授权）。" : "\n\n—— 对外动作：先问我（发邮件、发布、推代码、花钱前先问）。";
}

/** Leads = agents created by Agentself with isLead; their team description helps the router. */
export function leadsOf(ctx) {
  return ctx.agents
    .filter((a) => a.metadata?.agentself?.isLead && a.status !== "terminated")
    .map((a) => {
      const dept = ctx.departments.find((d) => d.key === a.metadata.agentself.department);
      // What the team can actually do lives on its employees; the lead's own capabilities are about
      // managing. Without them the router cannot tell whose domain "write a script…" is (PR #4 p14).
      const crew = ctx.agents
        .filter((e) => dept?.members?.includes(e.id) && e.id !== a.id && e.status !== "terminated" && e.capabilities)
        .map((e) => `${e.name}（${e.capabilities}）`);
      return {
        id: a.id,
        name: a.name,
        team: dept?.name ?? a.metadata.agentself.departmentName ?? "",
        description: [a.capabilities, dept?.description, crew.length ? `员工：${crew.join("，")}` : ""].filter(Boolean).join("；"),
        projectId: dept?.projectId ?? null,
      };
    });
}

/** Every task from the input box goes to a lead, with the user's original words as the description. */
async function createTask(ctx, lead, { title, text, external, routerNote }) {
  const issue = await pc("POST", `/companies/${ctx.company.id}/issues`, {
    title: String(title || text.split(/\r?\n/)[0]).slice(0, 200),
    description: text + (routerNote ? `\n\n—— 路由说明（自动判断，可能不准）：${routerNote}` : "") + externalNote(external),
    projectId: lead.projectId ?? undefined,
    assigneeAgentId: lead.id,
    status: "todo",
  });
  return { route: "task", leadId: lead.id, assigneeAgentId: lead.id, assigneeName: lead.name, department: ctx.agents.find((a) => a.id === lead.id)?.metadata?.agentself?.department ?? null, issue };
}

function addAnswer(companyId, text, question, extra = {}) {
  const a = {
    id: `ans_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    companyId,
    question,
    answer: text,
    createdAt: new Date().toISOString(),
    status: "open",
    ...extra,
  };
  store.answers = [a, ...store.answers].slice(0, 300);
  saveStore();
  return a;
}

async function frontdesk(body) {
  const ctx = await loadContext();
  if (!ctx.company) throw Object.assign(new Error("还没有团队，请先新建一位主管和他的员工"), { status: 409 });
  const text = String(body.text ?? "").trim();
  if (!text) throw Object.assign(new Error("内容为空"), { status: 400 });
  const external = body.external === "direct" ? "direct" : "ask";
  const to = body.to ?? { kind: "auto" };
  const leads = leadsOf(ctx);

  // Picked by hand: a lead, or (older UI) a team, which means its lead.
  if (to.kind === "lead" || to.kind === "agent" || to.kind === "department") {
    const lead =
      to.kind === "department"
        ? leads.find((l) => ctx.agents.find((a) => a.id === l.id)?.metadata?.agentself?.department === to.id)
        : leads.find((l) => l.id === to.id);
    if (!lead) throw Object.assign(new Error("找不到这位主管"), { status: 400 });
    return createTask(ctx, lead, { text, external, routerNote: "用户手动指定" });
  }

  const issues = arr(await pc("GET", `/companies/${ctx.company.id}/issues`))
    .filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status))
    .map((i) => ({ ...i, assigneeName: ctx.agents.find((a) => a.id === i.assigneeAgentId)?.name }));
  const prompt = buildPrompt({ text, leads, openIssues: issues, now: new Date().toLocaleString("zh-CN"), profile: readProfile(HOME, "user") });
  const { text: raw } = await runClaude(prompt, { model: store.settings.frontdeskModel });
  const r = parseRoute(raw);
  logRoute(text, raw, r);
  if (body.dryRun) return { dryRun: true, ...r };

  if (r.route === "answer") {
    return { route: "answer", answer: addAnswer(ctx.company.id, r.answer, text) };
  }
  if (r.route === "task") {
    // models sometimes answer with the lead's name instead of the id
    const lead = leads.find((l) => l.id === r.lead) ?? leads.find((l) => l.name === r.lead);
    if (lead) return createTask(ctx, lead, { title: r.title, text, external, routerNote: r.why ?? "" });
  }
  if (r.route === "followup" && r.issueId) {
    const issue = issues.find((i) => i.id === r.issueId);
    if (issue) {
      // A comment wakes the issue's assignee: the lead who owns it decides what to pass on.
      await pc("POST", `/issues/${issue.id}/comments`, { body: `用户补充：${text}` });
      return { route: "followup", issue, assigneeName: issue.assigneeName ?? null };
    }
  }
  // unclear, or the router named a lead that does not exist: the user picks the lead.
  const ids = new Set(leads.map((l) => l.id));
  return {
    route: "unclear",
    title: r.title ?? text.split(/\r?\n/)[0].slice(0, 60),
    description: text,
    external,
    candidates: (Array.isArray(r.candidates) ? r.candidates : []).filter((id) => ids.has(id)),
  };
}

/** One line per routing decision in ~/.agentself/logs/router.log, to see why something went "unclear". */
function logRoute(text, raw, r) {
  try {
    const dir = path.join(HOME, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "router.log"), `${JSON.stringify({ at: new Date().toISOString(), text: text.slice(0, 300), route: r.route, lead: r.lead ?? null, raw: String(raw ?? "").slice(0, 1000) })}\n`);
  } catch {
    /* logging must never break routing */
  }
}

/* ---------------- models: subscriptions and API providers ---------------- */
/** Which subscription CLIs this machine has (version only; login state is the CLI's business). */
function subscriptionStatus() {
  const v = (cmd) => {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: process.platform === "win32", windowsHide: true, timeout: 10_000 });
    return r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : null;
  };
  const codex = v("codex");
  // a broken ~/.codex/config.toml stops every Codex run; say so where Codex is chosen
  return { claude: v(process.env.AGENTSELF_CLAUDE_BIN ?? "claude"), codex, codexProblems: codex ? codexConfigProblems() : [] };
}
/** Save a provider; an API key goes into Paperclip's secret store (created once, rotated after). */
async function putProvider(id, body) {
  const ctx = await loadContext();
  const cur = listProviders(HOME).find((x) => x.id === id);
  let secretId = cur?.secretId ?? null;
  const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (key) {
    if (!ctx.company) throw Object.assign(new Error("先新建一个团队，再填 API key"), { status: 409 });
    if (secretId) await pc("POST", `/secrets/${secretId}/rotate`, { value: key });
    else secretId = (await pc("POST", `/companies/${ctx.company.id}/secrets`, { name: `agentself-${id}-api-key`, value: key, description: `AgenTeam：${body.name ?? cur?.name ?? id} 的 API key` })).id;
  }
  const saved = saveProvider(HOME, id, { name: body.name, baseUrl: body.baseUrl, model: body.model, smallModel: body.smallModel, prices: body.prices, pricingUrl: body.pricingUrl, ...(secretId ? { secretId } : {}) });
  // agents on this provider pick up a new endpoint / model on their next sync
  if (key || body.baseUrl || body.model || body.smallModel) void syncAllAgents(() => {}).catch(() => {});
  return saved;
}
/**
 * Save a mailbox. The app password goes into Paperclip's secret store (created once, rotated after);
 * mail.json keeps the secretId and agents get the password as an env binding on their next sync.
 * Before any team exists there is no store yet: the password waits in mail.json and moves later.
 */
async function putMail(body) {
  const ctx = await loadContext();
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const id = String(body.id ?? "").trim() || String(body.address ?? "").trim().toLowerCase();
  const cur = readAccounts().find((a) => a.id === id);
  let secretId = cur?.secretId ?? null;
  if (password && ctx.company) secretId = await storeMailSecret(ctx.company.id, id, password, secretId);
  const saved = saveAccount({ ...body, id, ...(secretId ? { password: undefined } : {}) }, { secretId });
  void syncAllAgents(() => {}).catch(() => {});
  return saved;
}
async function storeMailSecret(companyId, id, password, secretId) {
  if (secretId) {
    await pc("POST", `/secrets/${secretId}/rotate`, { value: password });
    return secretId;
  }
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return (await pc("POST", `/companies/${companyId}/secrets`, { name: `agentself-mail-${slug}`, value: password, description: `AgenTeam：邮箱 ${id} 的授权码` })).id;
}
/** Move app passwords still in mail.json (older versions, or saved before the first team) into the store. */
async function migrateMailPasswords() {
  const plain = plainPasswordAccounts();
  if (!plain.length) return 0;
  const ctx = await loadContext();
  if (!ctx.company) return 0;
  for (const a of plain) saveAccount({ ...a, password: undefined }, { secretId: await storeMailSecret(ctx.company.id, a.id, a.password, a.secretId ?? null) });
  return plain.length;
}

/** One tiny request to the provider's Anthropic-compatible endpoint with the key just typed (not stored). */
async function testProvider(id, body) {
  const p = listProviders(HOME).find((x) => x.id === id);
  const baseUrl = String(body.baseUrl ?? p?.baseUrl ?? "").replace(/\/$/, "");
  const model = body.model ?? p?.model;
  const key = String(body.apiKey ?? "").trim();
  if (!baseUrl || !model) throw Object.assign(new Error("缺少接口地址或模型名"), { status: 400 });
  if (!key) throw Object.assign(new Error("测试要在这里填一次 API key（已保存的 key 在 Paperclip 密钥库里，读不出来）"), { status: 400 });
  const t0 = Date.now();
  const r = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "回复 ok" }] }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 300) };
  let reply = "";
  try {
    reply = (JSON.parse(text).content ?? []).map((c) => c.text ?? "").join("").trim();
  } catch {
    /* not JSON */
  }
  return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 80) };
}

/** The team-layer plugin's verifierModel (per company plugin config): read, or set when `body` is given. */
async function verifierSetting(body) {
  const ctx = await loadContext();
  const plugin = arr(await pc("GET", "/plugins")).find((x) => x.pluginKey === "agentself.team-layer");
  if (!plugin || !ctx.company) return { verifierModel: "sonnet", available: false };
  const cur = (await pc("GET", `/plugins/${plugin.id}/config?companyId=${ctx.company.id}`).catch(() => null))?.configJson ?? {};
  if (body?.verifierModel) {
    const v = String(body.verifierModel).trim();
    if (!/^(codex(:[\w.-]+)?|[\w.-]+)$/.test(v)) throw Object.assign(new Error("核查员模型格式不对"), { status: 400 });
    await pc("POST", `/plugins/${plugin.id}/config`, { companyId: ctx.company.id, configJson: { ...cur, verifierModel: v } });
    return { verifierModel: v, available: true };
  }
  return { verifierModel: cur.verifierModel ?? "sonnet", available: true };
}

/* ---------------- team-layer notices (notify_user, memory job) for Feishu ---------------- */
async function teamLayerPluginId() {
  return arr(await pc("GET", "/plugins")).find((x) => x.pluginKey === "agentself.team-layer")?.id ?? null;
}
async function teamLayerNotices(companyId) {
  const id = await teamLayerPluginId();
  if (!id) return [];
  const r = await pc("POST", `/plugins/${id}/data/notices`, { companyId, params: { companyId } });
  return Array.isArray(r?.data) ? r.data : [];
}
async function dismissTeamLayerNotice(noticeId) {
  const ctx = await loadContext();
  const id = await teamLayerPluginId();
  if (!id || !ctx.company) throw new Error("没有团队层插件");
  return pc("POST", `/plugins/${id}/actions/notice-dismiss`, { companyId: ctx.company.id, params: { companyId: ctx.company.id, id: noticeId } });
}

/* ---------------- tool servers (MCP) ---------------- */
/** Form → spec for a test run (secret values as typed; nothing stored). */
function mcpSpec(body) {
  return {
    transport: body.transport ?? "stdio",
    command: body.command,
    args: body.args ?? [],
    env: { ...(body.env ?? {}), ...(body.secrets ?? {}) },
    url: body.url,
    token: body.token,
  };
}
/** Install / change a server: secret values become Paperclip secrets, then every agent is re-synced. */
async function putMcpServer(id, body) {
  const ctx = await loadContext();
  const cur = readServers().find((x) => x.id === id);
  const secretIds = {};
  const wantSecrets = Object.entries(body.secrets ?? {}).filter(([, v]) => String(v ?? "").trim());
  let tokenSecretId;
  if ((wantSecrets.length || body.token) && !ctx.company) throw Object.assign(new Error("先新建一个团队，再填密钥"), { status: 409 });
  const store = async (name, value, existing) => {
    if (existing) {
      await pc("POST", `/secrets/${existing}/rotate`, { value });
      return existing;
    }
    return (await pc("POST", `/companies/${ctx.company.id}/secrets`, { name, value, description: `AgenTeam 工具服务 ${id}` })).id;
  };
  for (const [k, v] of wantSecrets) secretIds[k] = await store(`agentself-mcp-${id}-${k.toLowerCase()}`, String(v).trim(), cur?.secretEnv?.[k]);
  if (String(body.token ?? "").trim()) tokenSecretId = await store(`agentself-mcp-${id}-token`, String(body.token).trim(), cur?.tokenSecretId);
  const saved = saveServer({ ...body, id }, { secretIds, tokenSecretId });
  void syncAllAgents(() => {}).catch(() => {});
  return saved;
}

/* ---------------- self-update (release: one install per machine) ---------------- */
const UPDATE_SCRIPT = path.join(REPO_ROOT, "scripts", "update.mjs");
const updateStateFile = path.join(HOME, "run", "update.json");
function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateStateFile, "utf8"));
  } catch {
    return {};
  }
}
/** `node scripts/update.mjs --check` (git fetch + compare); resolves with its JSON. */
function checkUpdate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [UPDATE_SCRIPT, "--check"], { cwd: REPO_ROOT, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(out.slice(out.indexOf("{"))));
      } catch {
        reject(new Error(`检查更新失败（${code}）：${(err || out).trim().slice(-300)}`));
      }
    });
  });
}
/** Who is working right now (an update restarts everything, so wait for them). */
async function busyAgents() {
  const ctx = await loadContext();
  return ctx.agents.filter((a) => a.status === "running").map((a) => a.name);
}
/**
 * Start the update outside this process tree: the update stops the supervisor and everything
 * under it (this service included), so it must not be one of its children.
 */
function launchUpdate() {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/d", "/c", "start", '""', "/b", `"${process.execPath}"`, `"${UPDATE_SCRIPT}"`], { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.execPath, [UPDATE_SCRIPT], { cwd: REPO_ROOT, detached: true, stdio: "ignore" }).unref();
  }
}
let lastAutoUpdateDay = null;
async function autoUpdateTick() {
  const a = store.settings.autoUpdate ?? {};
  const now = new Date();
  const day = now.toDateString();
  if (!a.enabled || now.getHours() !== Number(a.hour ?? 4) || lastAutoUpdateDay === day) return;
  try {
    const c = await checkUpdate();
    if (!c.behind) return void (lastAutoUpdateDay = day);
    const busy = await busyAgents();
    if (busy.length) return console.log(`auto-update waits: ${busy.join("、")} still working`);
    lastAutoUpdateDay = day;
    console.log(`auto-update: ${c.current} → ${c.latest}`);
    launchUpdate();
  } catch (e) {
    console.error(`auto-update check failed: ${e instanceof Error ? e.message : e}`);
  }
}

/* ---------------- agent runtime sync ---------------- */
/** Rewrite every Agentself agent's instructions file, MCP config and adapter config (picks up skill / tool updates). */
export async function syncAllAgents(log = console.log) {
  // passwords saved before the first team (or by older versions) move into the store first, so the
  // agents synced below get them as bindings
  const moved = await migrateMailPasswords().catch((e) => (log(`mailbox password move failed: ${e instanceof Error ? e.message : e}`), 0));
  if (moved) log(`moved ${moved} mailbox password(s) into the secret store`);
  const ctx = await loadContext();
  let n = 0;
  for (const a of ctx.agents.filter((x) => x.metadata?.agentself && x.status !== "terminated")) {
    try {
      if (await syncAgentRuntime(a, { api: pc, log })) n++;
    } catch (e) {
      log(`agent ${a.name} sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}

/* ---------------- hiring (plan B step 2) ---------------- */
const MAX_PENDING_HIRES_PER_LEAD = 3;

async function proposeHire(body) {
  const ctx = await loadContext();
  const lead = ctx.agents.find((a) => a.id === body.leadAgentId && a.metadata?.agentself?.isLead);
  if (!lead) throw Object.assign(new Error("leadAgentId 必须是一位主管（用 $PAPERCLIP_AGENT_ID）"), { status: 400 });
  const name = String(body.name ?? "").trim().slice(0, 40);
  const capabilities = String(body.capabilities ?? body.focus ?? "").trim().slice(0, 300);
  if (!name || !capabilities) throw Object.assign(new Error("要写清新员工的名字（name）和负责什么（capabilities）"), { status: 400 });
  const pending = store.hireRequests.filter((h) => h.leadAgentId === lead.id && h.status === "pending");
  if (pending.length >= MAX_PENDING_HIRES_PER_LEAD) throw Object.assign(new Error(`已有 ${pending.length} 条待批准的新建请求，先等用户处理`), { status: 409 });
  const h = {
    id: `hire_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    companyId: ctx.company.id,
    leadAgentId: lead.id,
    leadName: lead.name,
    team: lead.metadata.agentself.departmentName ?? "",
    issueId: body.issueId ?? null,
    name,
    capabilities,
    adapterType: body.adapterType === "codex_local" ? "codex_local" : "claude_local",
    model: body.model ? String(body.model).slice(0, 60) : null,
    skills: Array.isArray(body.skills) ? body.skills.map(String).slice(0, 10) : [],
    reason: String(body.reason ?? "").slice(0, 600),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  store.hireRequests = [h, ...store.hireRequests].slice(0, 100);
  saveStore();
  return { id: h.id, status: h.status, message: "已提交，等用户批准。结束本轮；批准或拒绝后你会在任务评论里收到消息并被唤醒。" };
}

async function resolveHire(id, action, body) {
  const h = store.hireRequests.find((x) => x.id === id);
  if (!h) throw Object.assign(new Error("没有这条请求"), { status: 404 });
  if (h.status !== "pending") return h;
  if (action === "approve") {
    const agent = await addEmployee(
      h.leadAgentId,
      {
        name: String(body.name ?? h.name).trim() || h.name,
        capabilities: String(body.capabilities ?? h.capabilities),
        adapterType: body.adapterType ?? h.adapterType,
        // the user can pick the model source on the approval card (Claude / Codex / an API model)
        source: body.source ?? h.source ?? undefined,
        model: body.model ?? h.model ?? undefined,
      },
      { api: pc, log: () => {} },
    );
    h.status = "approved";
    h.agentId = agent.id;
    if (h.issueId) await pc("POST", `/issues/${h.issueId}/comments`, { body: `用户同意了新建员工：「${agent.name}」（${agent.id}，${sourceLabel(sourceOf(agent), HOME)}），负责：${agent.capabilities ?? ""}。现在可以派活给他。` }).catch(() => {});
  } else {
    h.status = "rejected";
    h.rejectReason = String(body.reason ?? "").slice(0, 300);
    if (h.issueId) await pc("POST", `/issues/${h.issueId}/comments`, { body: `用户没有同意新建员工「${h.name}」${h.rejectReason ? `：${h.rejectReason}` : ""}。请交给现有员工，或调整方案后再说明。` }).catch(() => {});
  }
  h.resolvedAt = new Date().toISOString();
  saveStore();
  return h;
}

/* ---------------- http ---------------- */
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handleAgentself(req, res, url) {
  const p = url.pathname.replace(/^\/agentself\/api/, "");
  if (req.method === "GET" && p === "/context") {
    const ctx = await loadContext();
    return send(res, 200, { ...ctx, settings: store.settings, paperclipUrl: PAPERCLIP });
  }
  if (req.method === "POST" && p === "/frontdesk") return send(res, 200, await frontdesk(await readJson(req)));
  if (req.method === "POST" && p === "/frontdesk/assign") {
    const body = await readJson(req);
    const ctx = await loadContext();
    const leads = leadsOf(ctx);
    const lead = leads.find((l) => l.id === body.agentId) ?? leads.find((l) => ctx.agents.find((a) => a.id === l.id)?.metadata?.agentself?.department === body.department);
    if (!lead) return send(res, 400, { error: "找不到这位主管" });
    return send(res, 200, await createTask(ctx, lead, { title: body.title, text: String(body.description ?? body.title ?? ""), external: body.external, routerNote: "用户在网页上选定" }));
  }

  /* global profile (plan B): about me + decision records, read by every lead */
  const pm = p.match(/^\/profile\/(user|decisions|declined|askfirst)$/);
  if (pm && req.method === "GET") return send(res, 200, { text: (ensureProfile(HOME), readProfile(HOME, pm[1], 200_000)) });
  if (pm && req.method === "PUT") {
    const body = await readJson(req);
    writeProfile(HOME, pm[1], body.text);
    return send(res, 200, { ok: true, refreshed: refreshAllInstructions(HOME) });
  }
  if (req.method === "POST" && p === "/profile/decisions") {
    // Called by leads (curl) when the user says "from now on…"; appends one line.
    const body = await readJson(req);
    const r = appendDecision(HOME, { kind: body.kind, text: body.text, scope: body.scope, source: body.source });
    return send(res, 200, { ...r, refreshed: refreshAllInstructions(HOME) });
  }
  if (req.method === "GET" && p === "/profile") return send(res, 200, { files: PROFILE_FILES });
  if (req.method === "POST" && (p === "/agents/sync" || p === "/leads/sync")) return send(res, 200, { synced: await syncAllAgents(() => {}) });
  if (req.method === "GET" && p === "/profile/proposals") {
    const status = url.searchParams.get("status");
    return send(res, 200, listProposals(HOME).filter((x) => !status || x.status === status));
  }
  const ppm = p.match(/^\/profile\/proposals\/([\w-]+)\/(accept|reject)$/);
  if (req.method === "POST" && ppm) {
    const body = await readJson(req);
    const r = resolveProposal(HOME, ppm[1], ppm[2], body.text);
    if (r.status === "accepted") refreshAllInstructions(HOME);
    return send(res, 200, r);
  }

  /* hiring (plan B step 2): a lead proposes, the user approves, this service creates the employee */
  if (req.method === "POST" && p === "/hire-requests") {
    const body = await readJson(req);
    return send(res, 200, await proposeHire(body));
  }
  if (req.method === "GET" && p === "/hire-requests") {
    const status = url.searchParams.get("status");
    return send(res, 200, store.hireRequests.filter((h) => !status || h.status === status));
  }
  const hm = p.match(/^\/hire-requests\/([\w-]+)\/(approve|reject)$/);
  if (req.method === "POST" && hm) {
    const body = await readJson(req);
    return send(res, 200, await resolveHire(hm[1], hm[2], body));
  }
  if (req.method === "GET" && p === "/answers") {
    const companyId = url.searchParams.get("companyId");
    return send(res, 200, store.answers.filter((a) => !companyId || a.companyId === companyId));
  }
  const m = p.match(/^\/answers\/([^/]+)\/(dismiss|reopen)$/);
  if (req.method === "POST" && m) {
    const a = store.answers.find((x) => x.id === m[1]);
    if (!a) return send(res, 404, { error: "not found" });
    a.status = m[2] === "dismiss" ? "handled" : "open";
    saveStore();
    return send(res, 200, a);
  }
  if (p === "/settings") {
    if (req.method === "GET") return send(res, 200, store.settings);
    if (req.method === "PUT") {
      const body = await readJson(req);
      store.settings = { ...store.settings, ...body, feishu: { ...store.settings.feishu, ...(body.feishu ?? {}) } };
      saveStore();
      if (body.feishu) void restartIm();
      return send(res, 200, store.settings);
    }
  }
  if (req.method === "GET" && p === "/office") {
    const ctx = await loadContext();
    return send(res, 200, await buildOfficeSnapshot(ctx, pc));
  }

  /* departments (wizard, PLAN 7.4) */
  if (req.method === "GET" && p === "/departments/templates") return send(res, 200, listTemplates());
  const tm = p.match(/^\/departments\/templates\/([a-z0-9-]+)$/);
  if (req.method === "GET" && tm) return send(res, 200, readTemplate(tm[1]));
  if (req.method === "POST" && p === "/departments") {
    const pack = await readJson(req);
    const out = await createDepartment(pack, { companyName: store.settings.companyName, api: (m, pp, b) => pc(m, pp, b), log: () => {} });
    return send(res, 200, out);
  }
  if (req.method === "GET" && p === "/departments/export") {
    const key = url.searchParams.get("key");
    return send(res, 200, await exportDept(key, { api: (m, pp, b) => pc(m, pp, b) }));
  }

  /* memory files (PLAN 5) */
  const mm = p.match(/^\/memory\/([0-9a-f-]{36})(\/file)?$/);
  if (mm) {
    const agent = await pc("GET", `/agents/${mm[1]}`);
    const cwd = agent.adapterConfig?.cwd;
    if (!cwd) return send(res, 404, { error: "该员工没有工作目录" });
    if (!mm[2] && req.method === "GET") return send(res, 200, listMemory(cwd));
    const file = resolveMemoryPath(cwd, url.searchParams.get("path") ?? "");
    if (req.method === "GET") return send(res, 200, { text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "" });
    if (req.method === "PUT") {
      const body = await readJson(req);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(body.text ?? ""));
      const sha = commitMemory(cwd, `用户编辑 ${url.searchParams.get("path")}`);
      refreshInstructions(cwd, HOME);
      return send(res, 200, { ok: true, commit: sha });
    }
  }

  /* skins (PLAN 7.2): shared skins live in ~/.agentself/skins/<id>.json */
  const SKIN_DIR = path.join(HOME, "skins");
  if (req.method === "GET" && p === "/skins") {
    if (!fs.existsSync(SKIN_DIR)) return send(res, 200, []);
    const out = [];
    for (const f of fs.readdirSync(SKIN_DIR).filter((x) => x.endsWith(".json"))) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(SKIN_DIR, f), "utf8")));
      } catch {
        /* skip broken files */
      }
    }
    return send(res, 200, out);
  }
  if (req.method === "POST" && p === "/skins") {
    const skin = await readJson(req);
    const errs = validateSkin(skin);
    if (errs.length) return send(res, 400, { error: `皮肤格式不对：${errs.slice(0, 5).join(", ")}` });
    if (BUILTIN_SKINS.includes(skin.id)) return send(res, 400, { error: "不能覆盖内置皮肤，请换一个 id" });
    fs.mkdirSync(SKIN_DIR, { recursive: true });
    fs.writeFileSync(path.join(SKIN_DIR, `${skin.id}.json`), JSON.stringify(skin, null, 2));
    return send(res, 200, { ok: true, id: skin.id });
  }

  /* IM (PLAN 6) */
  if (req.method === "GET" && p === "/feishu/status") return send(res, 200, { status: imStatus() });
  /* models: Claude / Codex subscriptions, everything else over an API (per machine) */
  if (req.method === "GET" && p === "/providers") return send(res, 200, { providers: listProviders(HOME), subscriptions: subscriptionStatus(), subscriptionModels: SUBSCRIPTION_MODELS });
  const pmm = p.match(/^\/providers\/([\w-]+)\/models$/);
  if (pmm && req.method === "POST") {
    const body = await readJson(req);
    return send(res, 200, await fetchModels(HOME, pmm[1], { apiKey: body.apiKey, baseUrl: body.baseUrl }));
  }
  const amm = p.match(/^\/agents\/([\w-]+)\/model$/);
  if (amm && req.method === "POST") {
    const body = await readJson(req);
    const agent = await setAgentModel(amm[1], body.model, { api: pc, log: () => {} });
    return send(res, 200, { id: agent.id, model: agent.adapterConfig?.model ?? null });
  }
  const pvm = p.match(/^\/providers\/([\w-]+)$/);
  if (pvm && req.method === "PUT") return send(res, 200, await putProvider(pvm[1], await readJson(req)));
  if (pvm && req.method === "DELETE") {
    removeProvider(HOME, pvm[1]);
    return send(res, 200, { ok: true });
  }
  const pvt = p.match(/^\/providers\/([\w-]+)\/test$/);
  if (pvt && req.method === "POST") return send(res, 200, await testProvider(pvt[1], await readJson(req)));
  const srcm = p.match(/^\/agents\/([\w-]+)\/source$/);
  if (srcm && req.method === "POST") {
    const body = await readJson(req);
    const agent = await setAgentSource(srcm[1], String(body.source ?? ""), { api: pc, log: () => {} });
    return send(res, 200, { id: agent.id, source: sourceOf(agent), label: sourceLabel(sourceOf(agent), HOME) });
  }
  /* tool servers (MCP) for employees */
  if (req.method === "GET" && p === "/mcp/catalog") return send(res, 200, { catalog: MCP_CATALOG, installed: listServers() });
  if (req.method === "POST" && p === "/mcp/test") return send(res, 200, await testServer(mcpSpec(await readJson(req))));
  const mcm = p.match(/^\/mcp\/servers\/([\w-]+)$/);
  if (mcm && req.method === "PUT") return send(res, 200, await putMcpServer(mcm[1], await readJson(req)));
  if (mcm && req.method === "DELETE") {
    removeServer(mcm[1]);
    void syncAllAgents(() => {}).catch(() => {});
    return send(res, 200, { ok: true });
  }
  /* paper library (a folder the user chooses) */
  if (p === "/library/settings" && req.method === "GET") return send(res, 200, { ...libraryStats(), defaultRoot: defaultRoot() });
  if (p === "/library/settings" && req.method === "PUT") {
    const body = await readJson(req);
    const r = setLibraryRoot(body.root, { move: !!body.move });
    return send(res, 200, { ...r, ...libraryStats() });
  }
  if (p === "/library/papers" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const filters = { tag: url.searchParams.get("tag") || null, status: url.searchParams.get("status") || null, limit: Number(url.searchParams.get("limit") ?? 200) };
    if (q.trim()) return send(res, 200, { results: searchLibrary(q, filters) });
    let all = listPapers();
    if (filters.tag) all = all.filter((x) => (x.tags ?? []).includes(filters.tag));
    if (filters.status) all = all.filter((x) => x.status === filters.status);
    return send(res, 200, { results: all.slice(0, filters.limit) });
  }
  if (p === "/library/papers" && req.method === "POST") {
    const body = await readJson(req);
    return send(res, 200, await addPaper({ ref: String(body.ref ?? "").trim(), tags: body.tags ?? [], by: "用户" }));
  }
  if (p === "/library/upload" && req.method === "POST") {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 200 * 1024 * 1024) return send(res, 413, { error: "PDF 超过 200 MB" });
      chunks.push(c);
    }
    const name = url.searchParams.get("name") ?? "paper.pdf";
    const tags = (url.searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    return send(res, 200, await addPaper({ file: { name, data: Buffer.concat(chunks) }, tags, by: "用户" }));
  }
  const lpm = p.match(/^\/library\/papers\/([\w.-]+)(?:\/(notes|pdf))?$/);
  if (lpm) {
    const [, id, sub] = lpm;
    if (!sub && req.method === "GET") return send(res, 200, getPaper(id));
    if (!sub && req.method === "PUT") return send(res, 200, updatePaper(id, await readJson(req)));
    if (!sub && req.method === "DELETE") {
      removePaper(id);
      return send(res, 200, { ok: true });
    }
    if (sub === "notes" && req.method === "PUT") {
      const body = await readJson(req);
      return send(res, 200, { notes: writeNotes(id, String(body.text ?? ""), { mode: body.mode === "append" ? "append" : "replace", by: "用户" }) });
    }
    if (sub === "pdf" && req.method === "GET") {
      const f = pdfPath(id);
      if (!f) return send(res, 404, { error: "这篇没有 PDF" });
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="${id}.pdf"` });
      return fs.createReadStream(f).pipe(res);
    }
  }
  /* mailboxes (IMAP; read and drafts only) */
  if (req.method === "GET" && p === "/mail/accounts") return send(res, 200, { accounts: listAccounts(), presets: MAIL_PRESETS.map((x) => ({ host: x.host, note: x.note })) });
  if (req.method === "GET" && p === "/mail/preset") {
    const pr = presetFor(url.searchParams.get("address"));
    return send(res, 200, pr ? { host: pr.host, note: pr.note } : {});
  }
  if (req.method === "PUT" && p === "/mail/accounts") return send(res, 200, await putMail(await readJson(req)));
  const mam = p.match(/^\/mail\/accounts\/(.+)$/);
  if (mam && req.method === "DELETE") {
    removeAccount(decodeURIComponent(mam[1]));
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/mail/test") {
    const body = await readJson(req);
    try {
      return send(res, 200, await testAccount(body));
    } catch (e) {
      return send(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (p === "/verifier" && (req.method === "GET" || req.method === "PUT")) return send(res, 200, await verifierSetting(req.method === "PUT" ? await readJson(req) : null));
  if (req.method === "GET" && p === "/update/status") {
    const check = url.searchParams.get("check") === "1" ? await checkUpdate() : null;
    return send(res, 200, { ...readUpdateState(), ...(check ? { lastCheck: check } : {}) });
  }
  if (req.method === "POST" && p === "/update/run") {
    const body = await readJson(req);
    const busy = await busyAgents();
    if (busy.length && !body.force) return send(res, 409, { error: `${busy.join("、")} 正在干活，更新会重启整个系统。等他们结束，或勾选"现在就更新"。`, busy });
    launchUpdate();
    return send(res, 202, { started: true });
  }
  return send(res, 404, { error: "not found" });
}

function restartIm() {
  return startIm({
    settings: store.settings,
    store,
    saveStore,
    pc,
    loadContext,
    frontdesk,
    createChannel: async (opts) => (await import("@agentself/im-feishu")).createFeishuChannel(opts),
    notices: teamLayerNotices,
    handlers: {
      hire: (id, action) => resolveHire(id, action, {}),
      notice: (id) => dismissTeamLayerNotice(id),
    },
  }).catch((e) => console.error("IM start failed", e));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    try {
      if (url.pathname.startsWith("/agentself/api/")) return await handleAgentself(req, res, url);
      return send(res, 404, { error: `工作台已并入 Paperclip：请打开 ${PAPERCLIP}` });
    } catch (e) {
      console.error(e);
      send(res, e.status ?? 500, { error: e.message ?? String(e) });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => {
    console.log(`AgenTeam local service http://${HOST}:${PORT}/agentself/api  (open the app at ${PAPERCLIP})`);
    void restartIm();
    setInterval(() => void autoUpdateTick(), 10 * 60_000);
    // Paperclip may still be starting; retry the sync for a few minutes, and say why each try failed.
    const trySync = (left) =>
      syncAllAgents()
        .then((n) => console.log(`synced ${n} agent runtime(s)`))
        .catch((e) => {
          const why = e instanceof Error ? e.message : String(e);
          if (left > 0) {
            console.error(`agent runtime sync failed (${why}); retrying in 15 s, ${left} tries left`);
            setTimeout(() => trySync(left - 1), 15_000);
          } else console.error(`agent runtime sync gave up (${why}); run POST /agentself/api/agents/sync once Paperclip is up`);
        });
    trySync(20);
  });
}
