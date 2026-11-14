#!/usr/bin/env node
// Agentself console server: serves the built UI, proxies /api to Paperclip and hosts
// Agentself-only endpoints under /agentself (front desk, settings, office snapshot).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, parseRoute, runClaude } from "./frontdesk.mjs";
import { buildOfficeSnapshot } from "./office.mjs";
import { imStatus } from "./im.mjs";
import { createDepartment, listTemplates, readTemplate } from "../../../scripts/lib/department.mjs";
import { commitMemory, listMemory, resolveMemoryPath } from "../../../scripts/lib/memory.mjs";
import { exportDepartment as exportDept } from "../../../scripts/lib/share.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAPERCLIP = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const PORT = Number(process.env.AGENTSELF_PORT ?? 3200);
const HOST = process.env.AGENTSELF_HOST ?? "127.0.0.1";
const DIST = path.resolve(here, "..", "dist");
const HOME = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const STORE = path.join(HOME, "console.json");

/* ---------------- store ---------------- */
const DEFAULT_SETTINGS = {
  companyName: "Agentself",
  frontdeskModel: "haiku",
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

/* ---------------- front desk ---------------- */
function externalNote(mode) {
  return mode === "direct" ? "\n\n—— 对外动作：可以直接做（用户已授权）。" : "\n\n—— 对外动作：先问我（发邮件、发布、推代码、花钱前用 team.ask 确认）。";
}

async function createTask(ctx, dept, { title, description, external, assigneeAgentId }) {
  const issue = await pc("POST", `/companies/${ctx.company.id}/issues`, {
    title: title.slice(0, 200),
    description: (description ?? title) + externalNote(external),
    projectId: dept?.projectId ?? undefined,
    assigneeAgentId: assigneeAgentId ?? dept?.leadAgentId ?? undefined,
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
  if (!ctx.company) throw Object.assign(new Error("还没有团队，请先创建部门"), { status: 409 });
  const text = String(body.text ?? "").trim();
  if (!text) throw Object.assign(new Error("内容为空"), { status: 400 });
  const external = body.external === "direct" ? "direct" : "ask";
  const to = body.to ?? { kind: "auto" };
  const firstLine = text.split(/\r?\n/)[0].slice(0, 60);

  if (to.kind === "department") {
    const dept = ctx.departments.find((d) => d.key === to.id);
    if (!dept) throw Object.assign(new Error("部门不存在"), { status: 400 });
    const issue = await createTask(ctx, dept, { title: firstLine, description: text, external });
    return { route: "task", department: dept.key, issue };
  }
  if (to.kind === "agent") {
    const agent = ctx.agents.find((a) => a.id === to.id);
    const dept = ctx.departments.find((d) => d.key === agent?.metadata?.agentself?.department);
    const issue = await createTask(ctx, dept, { title: firstLine, description: text, external, assigneeAgentId: to.id });
    return { route: "task", department: dept?.key ?? null, issue };
  }

  const issues = arr(await pc("GET", `/companies/${ctx.company.id}/issues`))
    .filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status))
    .map((i) => ({ ...i, departmentName: ctx.departments.find((d) => d.projectId === i.projectId)?.name }));
  const prompt = buildPrompt({ text, departments: ctx.departments, openIssues: issues, now: new Date().toLocaleString("zh-CN") });
  const { text: raw } = await runClaude(prompt, { model: store.settings.frontdeskModel });
  const r = parseRoute(raw);

  if (r.route === "answer") {
    return { route: "answer", answer: addAnswer(ctx.company.id, r.answer, text) };
  }
  if (r.route === "task") {
    const dept = ctx.departments.find((d) => d.key === r.department);
    if (dept) {
      const issue = await createTask(ctx, dept, { title: r.title ?? firstLine, description: r.description ?? text, external });
      return { route: "task", department: dept.key, issue };
    }
  }
  if (r.route === "followup" && r.issueId) {
    const issue = issues.find((i) => i.id === r.issueId);
    if (issue) {
      await pc("POST", `/issues/${issue.id}/comments`, { body: `用户补充：${r.comment ?? text}` });
      return { route: "followup", issue };
    }
  }
  // unclear: let the user pick the department in the UI (ask card behaviour)
  return {
    route: "unclear",
    title: r.title ?? firstLine,
    description: r.description ?? text,
    external,
    candidates: (r.candidates ?? ctx.departments.map((d) => d.key)).filter((k) => ctx.departments.some((d) => d.key === k)),
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
  const p = url.pathname.replace(/^\/agentself/, "");
  if (req.method === "GET" && p === "/context") {
    const ctx = await loadContext();
    return send(res, 200, { ...ctx, settings: store.settings, paperclipUrl: PAPERCLIP });
  }
  if (req.method === "POST" && p === "/frontdesk") return send(res, 200, await frontdesk(await readJson(req)));
  if (req.method === "POST" && p === "/frontdesk/assign") {
    const body = await readJson(req);
    const ctx = await loadContext();
    const dept = ctx.departments.find((d) => d.key === body.department);
    if (!dept) return send(res, 400, { error: "部门不存在" });
    const issue = await createTask(ctx, dept, { title: body.title, description: body.description, external: body.external });
    return send(res, 200, { route: "task", department: dept.key, issue });
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

  /* IM (PLAN 6) */
  if (req.method === "GET" && p === "/feishu/status") return send(res, 200, { status: imStatus() });
  return send(res, 404, { error: "not found" });
}

function proxy(req, res) {
  const target = new URL(req.url, PAPERCLIP);
  const upstream = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => send(res, 502, { error: `Paperclip 不可用：${e.message}` }));
  req.pipe(upstream);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
function serveStatic(req, res, url) {
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file)) return send(res, 503, { error: "界面还没构建：pnpm --filter @agentself/console build" });
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    try {
      if (url.pathname.startsWith("/agentself/")) return await handleAgentself(req, res, url);
      if (url.pathname.startsWith("/api/")) return proxy(req, res);
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(e);
      send(res, e.status ?? 500, { error: e.message ?? String(e) });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => console.log(`Agentself console http://${HOST}:${PORT}  (Paperclip ${PAPERCLIP})`));
}
