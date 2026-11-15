#!/usr/bin/env node
// Agentself local service (P8): hosts the Agentself-only endpoints under /agentself/api
// (front desk, Feishu, office snapshot, settings, memory, department wizard, skins).
// Browsers never call it directly: the Paperclip server (:3100) reverse-proxies
// /agentself/api/* here, so it listens on loopback only and serves no UI.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, DEFAULT_ROUTER_MODEL, parseRoute, runClaude } from "./frontdesk.mjs";
import { buildOfficeSnapshot } from "./office.mjs";
import { imStatus, startIm } from "./im.mjs";
import { addEmployee, createDepartment, listTemplates, readTemplate } from "../../../scripts/lib/department.mjs";
import { commitMemory, listMemory, resolveMemoryPath } from "../../../scripts/lib/memory.mjs";
import { appendDecision, ensureProfile, listProposals, PROFILE_FILES, readProfile, resolveProposal, writeProfile } from "../../../scripts/lib/profile.mjs";
import { exportDepartment as exportDept } from "../../../scripts/lib/share.mjs";
import { BUILTIN_SKINS, validateSkin } from "../../../packages/skins/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAPERCLIP = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const PORT = Number(process.env.AGENTSELF_PORT ?? 3200);
const HOST = process.env.AGENTSELF_HOST ?? "127.0.0.1";
const HOME = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const STORE = path.join(HOME, "console.json");

/* ---------------- store ---------------- */
const DEFAULT_SETTINGS = {
  companyName: "Agentself",
  frontdeskModel: DEFAULT_ROUTER_MODEL, // the router model (key kept for existing settings files)
  askWhenUnclear: true,
  skin: "office",
  externalDefault: "ask",
  globalBudgetCents: 0,
  feishu: { enabled: false, appId: "", secretRef: "", allowUserIds: [], pushTiers: ["high"] },
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

export async function loadContext() {
  const companies = arr(await pc("GET", "/companies")).filter((c) => c.status !== "archived");
  const company = companies.find((c) => c.name === store.settings.companyName) ?? companies[0] ?? null;
  if (!company) return { company: null, departments: [], agents: [], projects: [] };
  const [agents, projects] = await Promise.all([pc("GET", `/companies/${company.id}/agents`), pc("GET", `/companies/${company.id}/projects`)]);
  const deptMap = new Map();
  for (const a of arr(agents)) {
    const m = a.metadata?.agentself;
    if (!m?.department) continue;
    const d = deptMap.get(m.department) ?? { key: m.department, name: m.departmentName ?? m.department, projectId: m.projectId ?? null, leadAgentId: null, members: [] };
    if (m.isLead) d.leadAgentId = a.id;
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
      return { id: a.id, name: a.name, team: dept?.name ?? a.metadata.agentself.departmentName ?? "", description: [a.capabilities, dept?.description].filter(Boolean).join("；"), projectId: dept?.projectId ?? null };
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
  if (body.dryRun) return { dryRun: true, ...r };

  if (r.route === "answer") {
    return { route: "answer", answer: addAnswer(ctx.company.id, r.answer, text) };
  }
  if (r.route === "task") {
    const lead = leads.find((l) => l.id === r.lead);
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
        model: body.model ?? h.model ?? undefined,
      },
      { api: pc, log: () => {} },
    );
    h.status = "approved";
    h.agentId = agent.id;
    if (h.issueId) await pc("POST", `/issues/${h.issueId}/comments`, { body: `用户同意了新建员工：「${agent.name}」（${agent.id}，${agent.adapterType === "codex_local" ? "Codex" : "Claude"}），负责：${agent.capabilities ?? ""}。现在可以派活给他。` }).catch(() => {});
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
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/profile/decisions") {
    // Called by leads (curl) when the user says "from now on…"; appends one line.
    const body = await readJson(req);
    return send(res, 200, appendDecision(HOME, { kind: body.kind, text: body.text, scope: body.scope, source: body.source }));
  }
  if (req.method === "GET" && p === "/profile") return send(res, 200, { files: PROFILE_FILES });
  if (req.method === "GET" && p === "/profile/proposals") {
    const status = url.searchParams.get("status");
    return send(res, 200, listProposals(HOME).filter((x) => !status || x.status === status));
  }
  const ppm = p.match(/^\/profile\/proposals\/([\w-]+)\/(accept|reject)$/);
  if (req.method === "POST" && ppm) {
    const body = await readJson(req);
    return send(res, 200, resolveProposal(HOME, ppm[1], ppm[2], body.text));
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
    console.log(`Agentself local service http://${HOST}:${PORT}/agentself/api  (open the app at ${PAPERCLIP})`);
    void restartIm();
  });
}
