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
import { buildPrompt, DEFAULT_STEWARD_MODEL, parseRoute, runClaude } from "./frontdesk.mjs";
import { buildOfficeSnapshot } from "./office.mjs";
import { imStatus, startIm } from "./im.mjs";
import { createDepartment, listTemplates, readTemplate } from "../../../scripts/lib/department.mjs";
import { commitMemory, listMemory, resolveMemoryPath } from "../../../scripts/lib/memory.mjs";
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
  frontdeskModel: DEFAULT_STEWARD_MODEL,
  askWhenUnclear: true,
  skin: "office",
  externalDefault: "ask",
  globalBudgetCents: 0,
  feishu: { enabled: false, appId: "", secretRef: "", allowUserIds: [], pushTiers: ["high"] },
};
function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return { answers: [], ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } };
  } catch {
    return { answers: [], settings: { ...DEFAULT_SETTINGS } };
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

/* ---------------- steward (总管) ---------------- */
function externalNote(mode) {
  return mode === "direct" ? "\n\n—— 对外动作：可以直接做（用户已授权）。" : "\n\n—— 对外动作：先问我（发邮件、发布、推代码、花钱前用 team.ask 确认）。";
}
const PLAN_NOTE =
  "\n\n—— 开工方式：先出计划。先读必要的资料，然后用 team.ask 把一份简短计划发给用户（要做什么、分几步、预计多久、预计花费、主要风险），选项为「同意开工 / 修改计划 / 取消」。用户同意后才能动手。";
const DIRECT_NOTE = "\n\n—— 开工方式：直接开工。";

/** The user's own notes for the steward: ~/.agentself/steward/user.md and rules.md (both optional). */
function stewardNotes() {
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(HOME, "steward", f), "utf8").slice(0, 8000);
    } catch {
      return "";
    }
  };
  return { profile: read("user.md"), rules: read("rules.md") };
}

/** Employees = agents created through Agentself; "department" in metadata is the user's own category. */
function employeesOf(ctx) {
  return ctx.agents
    .filter((a) => a.metadata?.agentself && a.status !== "terminated")
    .map((a) => ({ id: a.id, name: a.name, category: a.metadata.agentself.departmentName ?? a.metadata.agentself.department, capabilities: a.capabilities ?? a.title ?? "" }));
}
const deptOfAgent = (ctx, agent) => ctx.departments.find((d) => d.key === agent?.metadata?.agentself?.department);
/** A category has no lead any more; packs created before v0.6 may still have one. */
const defaultAssignee = (dept) => dept?.leadAgentId ?? dept?.members?.[0] ?? undefined;

async function createTask(ctx, dept, { title, description, external, assigneeAgentId, mode }) {
  const issue = await pc("POST", `/companies/${ctx.company.id}/issues`, {
    title: title.slice(0, 200),
    description: (description ?? title) + (mode === "plan" ? PLAN_NOTE : mode === "direct" ? DIRECT_NOTE : "") + externalNote(external),
    projectId: dept?.projectId ?? undefined,
    assigneeAgentId: assigneeAgentId ?? defaultAssignee(dept),
    status: "todo",
  });
  return issue;
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
  if (!ctx.company) throw Object.assign(new Error("还没有团队，请先创建员工"), { status: 409 });
  const text = String(body.text ?? "").trim();
  if (!text) throw Object.assign(new Error("内容为空"), { status: 400 });
  const external = body.external === "direct" ? "direct" : "ask";
  const to = body.to ?? { kind: "auto" };
  const firstLine = text.split(/\r?\n/)[0].slice(0, 60);

  // The user picked the target by hand: no steward call, no start-mode note.
  if (to.kind === "department") {
    const dept = ctx.departments.find((d) => d.key === to.id);
    if (!dept) throw Object.assign(new Error("分类不存在"), { status: 400 });
    const issue = await createTask(ctx, dept, { title: firstLine, description: text, external });
    return { route: "task", department: dept.key, assigneeAgentId: issue.assigneeAgentId ?? null, assigneeName: ctx.agents.find((x) => x.id === issue.assigneeAgentId)?.name ?? null, issue };
  }
  if (to.kind === "agent") {
    const agent = ctx.agents.find((a) => a.id === to.id);
    if (!agent) throw Object.assign(new Error("员工不存在"), { status: 400 });
    const dept = deptOfAgent(ctx, agent);
    const issue = await createTask(ctx, dept, { title: firstLine, description: text, external, assigneeAgentId: agent.id });
    return { route: "task", department: dept?.key ?? null, assigneeAgentId: agent.id, assigneeName: agent.name, issue };
  }

  const employees = employeesOf(ctx);
  const issues = arr(await pc("GET", `/companies/${ctx.company.id}/issues`))
    .filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status))
    .map((i) => ({ ...i, assigneeName: ctx.agents.find((a) => a.id === i.assigneeAgentId)?.name }));
  const prompt = buildPrompt({ text, employees, openIssues: issues, now: new Date().toLocaleString("zh-CN"), ...stewardNotes() });
  const { text: raw } = await runClaude(prompt, { model: store.settings.frontdeskModel });
  const r = parseRoute(raw);
  if (body.dryRun) return { dryRun: true, ...r };

  if (r.route === "answer") {
    return { route: "answer", answer: addAnswer(ctx.company.id, r.answer, text) };
  }
  if (r.route === "task") {
    const agent = ctx.agents.find((a) => a.id === r.employee && a.metadata?.agentself);
    if (agent) {
      const dept = deptOfAgent(ctx, agent);
      const issue = await createTask(ctx, dept, { title: r.title ?? firstLine, description: r.description ?? text, external, assigneeAgentId: agent.id, mode: r.mode });
      return { route: "task", department: dept?.key ?? null, assigneeAgentId: agent.id, assigneeName: agent.name, mode: r.mode, issue };
    }
  }
  if (r.route === "followup" && r.issueId) {
    const issue = issues.find((i) => i.id === r.issueId);
    if (issue) {
      await pc("POST", `/issues/${issue.id}/comments`, { body: `用户补充：${r.comment ?? text}` });
      return { route: "followup", issue };
    }
  }
  // unclear (or the steward named someone who does not exist): the user picks the employee.
  const ids = new Set(employees.map((e) => e.id));
  return {
    route: "unclear",
    title: r.title ?? firstLine,
    description: r.description ?? text,
    external,
    candidates: (Array.isArray(r.candidates) ? r.candidates : []).filter((id) => ids.has(id)),
  };
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
    const agent = body.agentId ? ctx.agents.find((a) => a.id === body.agentId && a.metadata?.agentself) : null;
    const dept = agent ? deptOfAgent(ctx, agent) : ctx.departments.find((d) => d.key === body.department);
    if (!agent && !dept) return send(res, 400, { error: "员工或分类不存在" });
    // The steward could not place this task, so it has not judged its size either: plan first.
    const issue = await createTask(ctx, dept, { title: body.title, description: body.description, external: body.external, assigneeAgentId: agent?.id, mode: "plan" });
    return send(res, 200, { route: "task", department: dept?.key ?? null, assigneeAgentId: issue.assigneeAgentId ?? null, assigneeName: ctx.agents.find((x) => x.id === issue.assigneeAgentId)?.name ?? null, mode: "plan", issue });
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
