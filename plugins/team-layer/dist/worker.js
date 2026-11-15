// src/worker.ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

// src/rules/index.ts
var DEFAULT_REWORK_LIMIT = 2;
function applyRework(input) {
  const limit = input.limit ?? DEFAULT_REWORK_LIMIT;
  const wasDelivered = input.prevStatus === "in_review" || input.prevStatus === "done";
  const sentBack = input.nextStatus === "in_progress" || input.nextStatus === "todo";
  const byOther = input.actorAgentId == null || input.actorAgentId !== input.assigneeAgentId;
  const isRework = wasDelivered && sentBack && byOther;
  const count = isRework ? input.count + 1 : input.count;
  return { count, isRework, escalate: isRework && count >= limit };
}
var DEFAULT_MAX_DEPTH = 8;
var DEFAULT_BURST = { max: 20, windowMs: 10 * 60 * 1e3 };
function issueDepth(issueId, parentOf) {
  let depth = 1;
  const seen = /* @__PURE__ */ new Set([issueId]);
  let cur = parentOf(issueId);
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    depth++;
    cur = parentOf(cur);
  }
  return depth;
}
function checkHop(input) {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const burst = input.burst ?? DEFAULT_BURST;
  if (input.depth > maxDepth) {
    return { block: true, reason: "depth", detail: `\u5B50\u4EFB\u52A1\u5C42\u7EA7 ${input.depth} \u8D85\u8FC7\u4E0A\u9650 ${maxDepth}` };
  }
  const recent = input.runCreations.filter((t) => input.now - t <= burst.windowMs).length;
  if (recent > burst.max) {
    return { block: true, reason: "burst", detail: `\u540C\u4E00\u8FD0\u884C ${burst.windowMs / 6e4} \u5206\u949F\u5185\u521B\u5EFA ${recent} \u4E2A\u4EFB\u52A1\uFF0C\u8D85\u8FC7 ${burst.max}` };
  }
  return { block: false };
}
var TIER_TABLE = {
  decision: "high",
  approval: "high",
  agent_question: "high",
  budget_alert: "high",
  rework_limit: "high",
  hop_limit: "high",
  lead_report: "medium",
  run_failed: "medium",
  frontdesk_answer: "low",
  task_progress: "low",
  routine_done: "low",
  memory_suggestion: "low"
};
function tierOf(kind) {
  return TIER_TABLE[kind];
}
var recentTransitions = /* @__PURE__ */ new Map();
var seenEventIds = /* @__PURE__ */ new Set();
function isDuplicateTransition(eventId, issueId, payload, now = Date.now()) {
  if (eventId) {
    if (seenEventIds.has(eventId)) return true;
    seenEventIds.add(eventId);
    if (seenEventIds.size > 2e3) seenEventIds.clear();
  }
  const prev = payload._previous?.status;
  const next = payload.status;
  if (!prev || !next || prev === next) return false;
  const k = `${issueId}:${prev}>${next}`;
  const last = recentTransitions.get(k);
  recentTransitions.set(k, now);
  if (recentTransitions.size > 2e3) recentTransitions.clear();
  return last !== void 0 && now - last < 1e3;
}

// src/store.ts
function dueReminders(list, now) {
  const due = [];
  const rest = [];
  for (const r of list) (Date.parse(r.dueAt) <= now ? due : rest).push(r);
  return { due, rest };
}
var MAX_NOTICES = 200;
function appendNotice(list, msg, max = MAX_NOTICES) {
  return [msg, ...list].slice(0, max);
}
async function addNotice(ctx, companyId, input) {
  const key = { scopeKind: "company", scopeId: companyId, stateKey: "notices" };
  const list = await ctx.state.get(key) ?? [];
  const msg = {
    id: `notice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "task_progress",
    tier: tierOf("task_progress"),
    companyId,
    issueId: input.issueId,
    agentId: input.agentId,
    title: input.text.slice(0, 200),
    body: input.text,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "open"
  };
  await ctx.state.set(key, appendNotice(list, msg));
  return msg;
}

// src/worker.ts
import path2 from "node:path";

// src/memory-jobs.ts
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
function gitCommit(memDir, message) {
  if (!fs.existsSync(memDir)) return null;
  const git = (args) => spawnSync("git", args, { cwd: memDir, encoding: "utf8", windowsHide: true });
  if (!fs.existsSync(path.join(memDir, ".git"))) {
    git(["init", "-q"]);
    git(["config", "user.name", "Agentself Memory"]);
    git(["config", "user.email", "memory@agentself.local"]);
    git(["config", "core.autocrlf", "false"]);
  }
  git(["add", "-A"]);
  if (!git(["status", "--porcelain"]).stdout.trim()) return null;
  if (git(["commit", "-q", "-m", message]).status !== 0) return null;
  return git(["rev-parse", "--short", "HEAD"]).stdout.trim();
}
function todayLog(memDir, now = /* @__PURE__ */ new Date()) {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return path.join(memDir, "log", `${d}.md`);
}
function appendRunLog(memDir, line, now = /* @__PURE__ */ new Date()) {
  const file = todayLog(memDir, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${path.basename(file, ".md")} \u5DE5\u4F5C\u65E5\u5FD7

`);
  fs.appendFileSync(file, redactSecrets(line) + "\n");
}
var readFile = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
async function consolidate(memDir, run) {
  const prompt = consolidationPrompt({
    identity: readFile(path.join(memDir, "identity.md")),
    style: readFile(path.join(memDir, "style.md")),
    notes: readFile(path.join(memDir, "notes.md")),
    user: readFile(path.join(memDir, "user.md")),
    logs: recentLogs(memDir)
  });
  const parsed = parseConsolidation(await run(prompt));
  if (!parsed) return { ok: false, reason: "\u6A21\u578B\u8F93\u51FA\u65E0\u6CD5\u89E3\u6790", suggestions: [] };
  fs.writeFileSync(path.join(memDir, "notes.md"), capNotes(redactSecrets(parsed.notes)).trimEnd() + "\n");
  fs.writeFileSync(path.join(memDir, "user.md"), redactSecrets(parsed.user).trimEnd() + "\n");
  const commit = gitCommit(memDir, "\u6574\u7406\u8BB0\u5FC6\uFF1A\u63D0\u70BC\u6700\u8FD1\u65E5\u5FD7\u5230 notes/user");
  return { ok: true, commit, suggestions: parsed.suggestions };
}
function weeklyArchive(memDir, now = /* @__PURE__ */ new Date(), logDays = 14, topicDays = 60) {
  const moved = [];
  const logDir = path.join(memDir, "log");
  if (fs.existsSync(logDir)) {
    for (const f of fs.readdirSync(logDir)) {
      const m = f.match(/^(\d{4})-(\d{2})-\d{2}\.md$/);
      if (!m || now.getTime() - Date.parse(f.slice(0, 10)) < logDays * 864e5) continue;
      const dst = path.join(memDir, "archive", `${m[1]}-${m[2]}.md`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.appendFileSync(dst, `

${fs.readFileSync(path.join(logDir, f), "utf8")}`);
      fs.rmSync(path.join(logDir, f));
      moved.push(`log/${f}`);
    }
  }
  const topics = path.join(memDir, "topics");
  if (fs.existsSync(topics)) {
    for (const f of fs.readdirSync(topics)) {
      const p = path.join(topics, f);
      if (!f.endsWith(".md") || now.getTime() - fs.statSync(p).mtimeMs < topicDays * 864e5) continue;
      const dst = path.join(memDir, "archive", "topics", f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(p, dst);
      moved.push(`topics/${f}`);
    }
  }
  const commit = moved.length ? gitCommit(memDir, `\u6BCF\u5468\u5F52\u6863\uFF1A${moved.length} \u4E2A\u6587\u4EF6`) : null;
  return { moved, commit };
}
var DEFAULT_IDLE_MINUTES = 30;
var NOTES_MAX_CHARS = 6e3;
function logLine(input) {
  const hhmm = input.at.toTimeString().slice(0, 5);
  const cost = input.costUsd != null ? ` \xB7 $${input.costUsd.toFixed(3)}` : "";
  const issue = input.issue ? `${input.issue} ` : "";
  const summary = input.summary ? `
  ${input.summary.replace(/\s+/g, " ").slice(0, 300)}` : "";
  return `- ${hhmm} ${issue}${input.title ?? "\uFF08\u65E0\u6807\u9898\uFF09"} \u2014 ${input.status}${cost}${summary}`;
}
function shouldConsolidate(input) {
  const idleMs = (input.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 6e4;
  if (input.lastLogWriteAt == null) return false;
  if (input.lastConsolidatedAt != null && input.lastLogWriteAt <= input.lastConsolidatedAt) return false;
  if (input.lastRunAt != null && input.now - input.lastRunAt < idleMs) return false;
  return true;
}
function consolidationPrompt(input) {
  return `\u4F60\u5728\u6574\u7406\u4E00\u540D AI \u5458\u5DE5\u7684\u957F\u671F\u8BB0\u5FC6\u3002\u6839\u636E\u6700\u8FD1\u7684\u5DE5\u4F5C\u65E5\u5FD7\uFF0C\u66F4\u65B0\u5B83\u7684\u7ECF\u9A8C\u7B14\u8BB0\u548C\u7528\u6237\u504F\u597D\u3002

\u89C4\u5219\uFF1A
- notes.md\uFF1A\u957F\u671F\u6709\u7528\u7684\u7ECF\u9A8C\u548C\u4E8B\u5B9E\uFF0C\u4E00\u6761\u4E00\u884C\uFF08"- " \u5F00\u5934\uFF09\uFF0C\u5408\u5E76\u91CD\u590D\u3001\u5220\u9664\u8FC7\u65F6\uFF0C\u603B\u957F\u5EA6\u4E0D\u8D85\u8FC7 ${input.maxChars ?? NOTES_MAX_CHARS} \u5B57\u7B26\u3002\u4FDD\u7559\u539F\u6709\u4ECD\u7136\u6709\u6548\u7684\u6761\u76EE\u3002
- user.md\uFF1A\u7528\u6237\u660E\u786E\u8868\u8FBE\u8FC7\u7684\u504F\u597D\u548C\u80CC\u666F\uFF0C\u540C\u6837\u5408\u5E76\u53BB\u91CD\u3002\u6CA1\u6709\u65B0\u4FE1\u606F\u5C31\u539F\u6837\u8FD4\u56DE\u3002
- \u4E0D\u8981\u7F16\u9020\u65E5\u5FD7\u91CC\u6CA1\u6709\u7684\u4E1C\u897F\uFF1B\u4E0D\u8981\u5199\u5165\u4EFB\u4F55\u5BC6\u94A5\u3001\u4EE4\u724C\u3001\u5BC6\u7801\u3002
- identity.md / style.md \u4E0D\u80FD\u6539\uFF1B\u5982\u679C\u65E5\u5FD7\u663E\u793A\u9700\u8981\u8C03\u6574\uFF0C\u5199\u8FDB suggestions\uFF08\u6BCF\u6761\u4E00\u53E5\u8BDD\uFF09\uFF0C\u5426\u5219\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002

\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF1A{"notes": "<\u5B8C\u6574\u7684\u65B0 notes.md>", "user": "<\u5B8C\u6574\u7684\u65B0 user.md>", "suggestions": ["..."]}

## identity.md
${input.identity}

## style.md
${input.style}

## \u5F53\u524D notes.md
${input.notes}

## \u5F53\u524D user.md
${input.user}

## \u6700\u8FD1\u65E5\u5FD7
${input.logs}`;
}
function parseConsolidation(raw) {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(raw.slice(s, e + 1));
    if (typeof o.notes !== "string" || typeof o.user !== "string") return null;
    return { notes: o.notes, user: o.user, suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String) : [] };
  } catch {
    return null;
  }
}
function capNotes(text, max = NOTES_MAX_CHARS) {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const header = lines.filter((l) => !l.startsWith("- "));
  const bullets = lines.filter((l) => l.startsWith("- "));
  while (bullets.length && [...header, ...bullets].join("\n").length > max) bullets.shift();
  return [...header, ...bullets].join("\n");
}
var SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
function redactSecrets(text) {
  return text.replace(SECRET_RE, "[\u5DF2\u9690\u53BB]");
}
function recentLogs(memDir, days = 7, now = /* @__PURE__ */ new Date()) {
  const dir = path.join(memDir, "log");
  if (!fs.existsSync(dir)) return "";
  const cutoff = now.getTime() - days * 864e5;
  return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && Date.parse(f.slice(0, 10)) >= cutoff - 864e5).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n").slice(-2e4);
}
function runClaudeJson(prompt, model = "haiku", timeoutMs = 18e4, bin = process.env.AGENTSELF_CLAUDE_BIN ?? "claude") {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-p", "--model", model, "--output-format", "json"], { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("consolidation timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => out += d);
    child.stderr.on("data", (d) => err += d);
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      try {
        resolve(JSON.parse(out).result ?? "");
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(prompt);
  });
}

// src/worker.ts
var DEFAULTS = {
  reworkLimit: 2,
  maxDepth: 8,
  burstMax: 20,
  burstWindowMinutes: 10,
  boardUserId: "local-board",
  idleMinutes: 30,
  consolidationModel: "haiku"
};
function memDirOf(agent) {
  if (!agent?.metadata || !agent.metadata.agentself) return null;
  const cwd = agent.adapterConfig?.cwd;
  return typeof cwd === "string" && cwd ? path2.join(cwd, "memory") : null;
}
var agentKey = (agentId, k) => ({ scopeKind: "agent", scopeId: agentId, stateKey: k });
async function onRunEnded(ctx, companyId, p) {
  if (!p.agentId) return;
  const agent = await ctx.agents.get(p.agentId, companyId);
  const memDir = memDirOf(agent);
  if (!memDir) return;
  const issue = p.issueId ? await ctx.issues.get(p.issueId, companyId) : null;
  const status = p.status === "succeeded" ? "\u5B8C\u6210\u4E00\u8F6E" : `\u5931\u8D25\uFF08${p.error ?? p.status}\uFF09`;
  appendRunLog(memDir, logLine({ at: /* @__PURE__ */ new Date(), issue: issue?.identifier ?? null, title: issue?.title ?? null, status }));
  const now = Date.now();
  await ctx.state.set(agentKey(p.agentId, "lastRunAt"), now);
  await ctx.state.set(agentKey(p.agentId, "lastLogWriteAt"), now);
}
async function memoryIdleTick(ctx) {
  for (const cid of await knownCompanies(ctx)) {
    const c = { id: cid };
    const cfg = await config(ctx, cid);
    for (const agent of await ctx.agents.list({ companyId: c.id })) {
      const memDir = memDirOf(agent);
      if (!memDir) continue;
      const [lastRunAt, lastConsolidatedAt, lastLogWriteAt] = await Promise.all(
        ["lastRunAt", "lastConsolidatedAt", "lastLogWriteAt"].map((k) => ctx.state.get(agentKey(agent.id, k)))
      );
      if (!shouldConsolidate({ lastRunAt, lastConsolidatedAt, lastLogWriteAt, now: Date.now(), idleMinutes: cfg.idleMinutes })) continue;
      try {
        const r = await consolidate(memDir, (prompt) => runClaudeJson(prompt, cfg.consolidationModel));
        await ctx.state.set(agentKey(agent.id, "lastConsolidatedAt"), Date.now());
        ctx.logger.info("memory consolidated", { agentId: agent.id, ok: r.ok, commit: r.ok ? r.commit : null });
        for (const s of r.suggestions) {
          await addNotice(ctx, c.id, { text: `\u8BB0\u5FC6\u6574\u7406\u5EFA\u8BAE\uFF08${agent.name ?? ""}\uFF09\uFF1A${s}`, issueId: null, agentId: agent.id });
        }
      } catch (err) {
        ctx.logger.error("memory consolidation failed", { agentId: agent.id, err: String(err) });
      }
    }
  }
}
async function memoryWeeklyTick(ctx) {
  for (const cid of await knownCompanies(ctx)) {
    const c = { id: cid };
    for (const agent of await ctx.agents.list({ companyId: c.id })) {
      const memDir = memDirOf(agent);
      if (memDir) ctx.logger.info("memory weekly archive", { agentId: agent.id, ...weeklyArchive(memDir) });
    }
  }
}
async function config(ctx, companyId) {
  const raw = await ctx.config.get(companyId).catch(() => ({})) ?? {};
  return { ...DEFAULTS, ...raw };
}
var COMPANIES_KEY = { scopeKind: "instance", stateKey: "knownCompanies" };
async function rememberCompany(ctx, companyId) {
  if (!companyId) return;
  const list = await ctx.state.get(COMPANIES_KEY) ?? [];
  if (!list.includes(companyId)) await ctx.state.set(COMPANIES_KEY, [...list, companyId]);
}
async function knownCompanies(ctx) {
  return await ctx.state.get(COMPANIES_KEY) ?? [];
}
var issueKey = (issueId, stateKey) => ({ scopeKind: "issue", scopeId: issueId, stateKey });
var companyKey = (companyId, stateKey) => ({ scopeKind: "company", scopeId: companyId, stateKey });
async function getState(ctx, key, fallback) {
  const v = await ctx.state.get(key);
  return v ?? fallback;
}
async function askOnIssue(ctx, input) {
  return ctx.issues.askUserQuestions(
    input.issueId,
    {
      idempotencyKey: input.key,
      title: input.title,
      payload: {
        version: 1,
        title: input.title,
        questions: [
          {
            id: "choice",
            prompt: input.prompt,
            helpText: input.helpText ?? null,
            selectionMode: "single",
            required: true,
            allowOther: false,
            options: input.options.map((label, i) => ({ id: `o${i + 1}`, label }))
          }
        ]
      }
    },
    input.companyId,
    input.authorAgentId ? { authorAgentId: input.authorAgentId } : void 0
  );
}
async function onIssueCreated(ctx, companyId, issueId, actor) {
  const cfg = await config(ctx, companyId);
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || !issue.parentId) return;
  const parents = /* @__PURE__ */ new Map();
  parents.set(issue.id, issue.parentId ?? null);
  let cur = issue.parentId ?? null;
  for (let i = 0; cur && i < cfg.maxDepth + 2; i++) {
    const p = await ctx.issues.get(cur, companyId);
    parents.set(cur, p?.parentId ?? null);
    cur = p?.parentId ?? null;
  }
  const depth = issueDepth(issue.id, (id) => parents.get(id));
  const now = Date.now();
  let creations = [];
  if (actor.type === "agent" && actor.id) {
    const key = companyKey(companyId, `burst:${actor.id}`);
    const windowMs = cfg.burstWindowMinutes * 6e4;
    creations = (await getState(ctx, key, [])).filter((t) => now - t <= windowMs);
    creations.push(now);
    await ctx.state.set(key, creations);
  }
  const verdict = checkHop({
    depth,
    runCreations: creations,
    now,
    maxDepth: cfg.maxDepth,
    burst: { max: cfg.burstMax, windowMs: cfg.burstWindowMinutes * 6e4 }
  });
  if (!verdict.block) return;
  await ctx.issues.update(issue.id, { status: "blocked" }, companyId);
  ctx.logger.warn("hop limit", { issueId, reason: verdict.reason, detail: verdict.detail });
  await askOnIssue(ctx, {
    companyId,
    issueId: issue.parentId,
    key: `agentself:hop:${issue.id}`,
    title: "\u4EFB\u52A1\u62C6\u5F97\u592A\u6DF1 / \u592A\u591A\uFF0C\u5DF2\u6682\u505C",
    prompt: `${verdict.detail}\u3002\u65B0\u4EFB\u52A1\u300C${issue.title}\u300D\u5DF2\u7F6E\u4E3A blocked\u3002\u600E\u4E48\u5904\u7406\uFF1F`,
    helpText: "\u4E0D\u56DE\u590D\u4F1A\u600E\u6837\uFF1A\u8BE5\u4EFB\u52A1\u4FDD\u6301 blocked\uFF0C\u4E0D\u4F1A\u7EE7\u7EED\u5F80\u4E0B\u62C6\u3002",
    options: ["\u653E\u884C\u8FD9\u4E2A\u4EFB\u52A1", "\u53D6\u6D88\u8FD9\u4E2A\u4EFB\u52A1", "\u505C\u6B62\u7EE7\u7EED\u62C6\u5206\uFF0C\u5148\u6C47\u603B"]
  });
}
var issueQueues = /* @__PURE__ */ new Map();
function serialize(key, fn) {
  const run = (issueQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  issueQueues.set(key, run.catch(() => {
  }));
  return run;
}
async function onIssueUpdated(ctx, companyId, issueId, payload, actor) {
  const prev = payload._previous?.status;
  const next = payload.status;
  if (!prev || !next || prev === next) return;
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || !issue.parentId) return;
  const cfg = await config(ctx, companyId);
  const key = issueKey(issueId, "reworkCount");
  const count = await getState(ctx, key, 0);
  const r = applyRework({
    prevStatus: prev,
    nextStatus: next,
    actorAgentId: actor.type === "agent" ? actor.id ?? null : null,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    count,
    limit: cfg.reworkLimit
  });
  if (!r.isRework) return;
  await ctx.state.set(key, r.count);
  ctx.logger.info("rework", { issueId, count: r.count });
  if (!r.escalate) return;
  await ctx.issues.update(issueId, { status: "blocked" }, companyId);
  await askOnIssue(ctx, {
    companyId,
    issueId: issue.parentId,
    key: `agentself:rework:${issueId}:${r.count}`,
    title: `\u300C${issue.title}\u300D\u5DF2\u8FD4\u5DE5 ${r.count} \u6B21`,
    prompt: `\u5B50\u4EFB\u52A1\u300C${issue.title}\u300D\u5DF2\u88AB\u6253\u56DE ${r.count} \u6B21\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u8FD4\u5DE5\u3002\u600E\u4E48\u5904\u7406\uFF1F`,
    helpText: "\u4E0D\u56DE\u590D\u4F1A\u600E\u6837\uFF1A\u8BE5\u5B50\u4EFB\u52A1\u4FDD\u6301 blocked\uFF0C\u4E3B\u7BA1\u4E0D\u4F1A\u518D\u81EA\u52A8\u8FD4\u5DE5\u3002",
    options: ["\u7EE7\u7EED\u8FD4\u5DE5", "\u6362\u4EBA\u505A", "\u653E\u5F03\u8FD9\u4E2A\u5B50\u4EFB\u52A1"]
  });
}
var plugin = definePlugin({
  async setup(ctx) {
    for (const ev of ["issue.created", "issue.updated", "agent.run.started", "agent.created", "company.created"]) {
      ctx.events.on(ev, async (e) => rememberCompany(ctx, e.companyId).catch(() => {
      }));
    }
    ctx.events.on("issue.created", async (e) => {
      if (!e.entityId) return;
      try {
        await onIssueCreated(ctx, e.companyId, e.entityId, { id: e.actorId, type: e.actorType });
      } catch (err) {
        ctx.logger.error("issue.created handler failed", { err: String(err) });
      }
    });
    ctx.events.on("issue.updated", async (e) => {
      if (!e.entityId) return;
      const payload = e.payload ?? {};
      if (isDuplicateTransition(e.eventId, e.entityId, payload)) return;
      try {
        const id = e.entityId;
        await serialize(id, () => onIssueUpdated(ctx, e.companyId, id, payload, { id: e.actorId, type: e.actorType }));
      } catch (err) {
        ctx.logger.error("issue.updated handler failed", { err: String(err) });
      }
    });
    for (const ev of ["agent.run.finished", "agent.run.failed"]) {
      ctx.events.on(ev, async (e) => {
        try {
          await onRunEnded(ctx, e.companyId, e.payload ?? {});
        } catch (err) {
          ctx.logger.error("run log failed", { err: String(err) });
        }
      });
    }
    ctx.jobs.register("memory-idle", async () => memoryIdleTick(ctx));
    ctx.jobs.register("memory-weekly", async () => memoryWeeklyTick(ctx));
    ctx.tools.register(
      "ask",
      { displayName: "team.ask", description: "Ask the user", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params;
        const card = await askOnIssue(ctx, {
          companyId: run.companyId,
          issueId: p.issueId,
          key: `agentself:ask:${run.runId}:${p.question.slice(0, 40)}`,
          title: p.question.slice(0, 200),
          prompt: p.question,
          helpText: p.ifNoReply ? `\u4E0D\u56DE\u590D\u4F1A\u600E\u6837\uFF1A${p.ifNoReply}` : null,
          options: p.options,
          authorAgentId: run.agentId
        });
        return { content: `\u5DF2\u53D1\u51FA\u5361\u7247 ${card.id}\u3002\u7ED3\u675F\u672C\u8F6E\uFF1B\u7528\u6237\u4F5C\u7B54\u540E\u4F60\u4F1A\u88AB\u5524\u9192\uFF0C\u7B54\u6848\u5728 issue \u7EBF\u7A0B\u91CC\u3002`, data: { interactionId: card.id } };
      }
    );
    ctx.tools.register(
      "notice",
      { displayName: "team.notice", description: "Notify the user", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params;
        const msg = await addNotice(ctx, run.companyId, { text: p.text, issueId: p.issueId ?? null, agentId: run.agentId });
        return { content: `\u5DF2\u901A\u77E5\uFF08${msg.id}\uFF09` };
      }
    );
    ctx.tools.register(
      "resolve",
      { displayName: "team.resolve", description: "Close a card", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params;
        const cfg = await config(ctx, run.companyId);
        const r = await ctx.issues.respondInteraction(
          p.issueId,
          p.interactionId,
          { action: "reject", actorUserId: cfg.boardUserId, reason: p.reason ?? "\u53D1\u8D77\u8005\u5DF2\u5173\u95ED\u6B64\u5361\u7247" },
          run.companyId
        );
        return { content: r.applied ? "\u5361\u7247\u5DF2\u5173\u95ED" : "\u5361\u7247\u4E4B\u524D\u5DF2\u5904\u7406" };
      }
    );
    ctx.tools.register(
      "later",
      { displayName: "team.later", description: "Wake me later", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params;
        const key = companyKey(run.companyId, "reminders");
        const list = await getState(ctx, key, []);
        const dueAt = new Date(Date.now() + p.minutes * 6e4).toISOString();
        list.push({ issueId: p.issueId, agentId: run.agentId, dueAt, note: p.note ?? "" });
        await ctx.state.set(key, list);
        return { content: `\u597D\u7684\uFF0C${p.minutes} \u5206\u949F\u540E\uFF08${dueAt}\uFF09\u5524\u9192\u4F60\u3002\u7ED3\u675F\u672C\u8F6E\u5373\u53EF\u3002` };
      }
    );
    ctx.jobs.register("later-tick", async () => {
      for (const cid of await knownCompanies(ctx)) {
        const c = { id: cid };
        const key = companyKey(c.id, "reminders");
        const list = await getState(ctx, key, []);
        if (list.length === 0) continue;
        const { due, rest } = dueReminders(list, Date.now());
        for (const r of due) {
          try {
            if (r.note) await ctx.issues.createComment(r.issueId, `\u23F0 \u7A0D\u540E\u63D0\u9192\uFF1A${r.note}`, c.id);
            await ctx.issues.requestWakeup(r.issueId, c.id, { reason: "agentself_later" });
          } catch (err) {
            ctx.logger.error("later wake failed", { issueId: r.issueId, err: String(err) });
          }
        }
        if (due.length) await ctx.state.set(key, rest);
      }
    });
    ctx.actions.register("register", async (params) => {
      const companyId = params.companyId;
      await rememberCompany(ctx, companyId);
      return { ok: true, companies: await knownCompanies(ctx) };
    });
    ctx.data.register("notices", async (params) => {
      const companyId = params.companyId;
      if (!companyId) return [];
      return getState(ctx, companyKey(companyId, "notices"), []);
    });
  },
  async onApiRequest(input) {
    if (input.routeKey === "feed") {
      return { status: 200, body: { ok: true, companyId: input.companyId } };
    }
    return { status: 404, body: { error: "not found" } };
  }
});
var worker_default = plugin;
runWorker(plugin, import.meta.url);
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
