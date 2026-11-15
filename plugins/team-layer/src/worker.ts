// team-layer worker: wires the pure rules (./rules) to Paperclip events, state and tools.
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { FeedMessage } from "@agentself/shared";
import { applyRework, isDuplicateTransition, checkHop, issueDepth, type IssueStatus } from "./rules/index.js";
import { addNotice, dismissNotice, dropRemindersFor, dueReminders, SETTLED_STATUSES, type Reminder } from "./store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { appendRunLog, consolidate, logLine, runClaudeJson, shouldConsolidate, weeklyArchive } from "./memory-jobs.js";
// Shared with the local service; bundled into the worker by esbuild.
// @ts-expect-error plain JS module without type declarations
import { refreshInstructions } from "../../../scripts/lib/instructions.mjs";
import {
  criteriaMarkdown,
  evidenceMarkdown,
  normalizeCriteria,
  normalizeEvidence,
  parseVerdicts,
  verdictSummary,
  verificationMarkdown,
  verifierPrompt,
  type Criterion,
  type CriterionVerdict,
  type Dispute,
  type EvidenceItem,
} from "./acceptance.js";
import { afterCheck, classifyProbe, dueWatches, newWatch, WATCH_LIMITS, wakeComment, type Watch } from "./watch.js";

type Ctx = Parameters<Parameters<typeof definePlugin>[0]["setup"]>[0];

interface Config {
  reworkLimit: number;
  maxDepth: number;
  burstMax: number;
  burstWindowMinutes: number;
  boardUserId: string;
  idleMinutes: number;
  consolidationModel: string;
  /** Independent verifier: a different model from the lead, run with no tools. */
  verifierModel: string;
}

const DEFAULTS: Config = {
  reworkLimit: 2,
  maxDepth: 8,
  burstMax: 20,
  burstWindowMinutes: 10,
  boardUserId: "local-board",
  idleMinutes: 30,
  consolidationModel: "haiku",
  verifierModel: "sonnet",
};

/* ------------------------------------------------------------------ */
/* Profile proposals (plan B step 2): consolidation proposes, the user  */
/* confirms in Settings, then it is written into the global "about me". */
/* Same file format as scripts/lib/profile.mjs.                         */
/* ------------------------------------------------------------------ */

const agentselfHome = () => process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");

function addProfileProposals(items: string[], from: { agentId: string; name: string }) {
  if (items.length === 0) return 0;
  const file = path.join(agentselfHome(), "profile", "proposals.json");
  let list: Array<{ id: string; text: string; status: string }> = [];
  try {
    list = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    list = [];
  }
  const open = new Set(list.filter((p) => p.status === "pending").map((p) => p.text));
  let added = 0;
  for (const text of items) {
    if (open.has(text)) continue;
    list.push({ id: `prop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, from: from.name, agentId: from.agentId, createdAt: new Date().toISOString(), status: "pending" } as never);
    added++;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(list.slice(-200), null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return added;
}

/* ------------------------------------------------------------------ */
/* Memory (PLAN 5)                                                     */
/* ------------------------------------------------------------------ */

type AgentLike = { id: string; name?: string; adapterConfig?: Record<string, unknown> | null; metadata?: Record<string, unknown> | null };

function memDirOf(agent: AgentLike | null): string | null {
  if (!agent?.metadata || !(agent.metadata as { agentself?: unknown }).agentself) return null;
  const cwd = agent.adapterConfig?.cwd;
  return typeof cwd === "string" && cwd ? path.join(cwd, "memory") : null;
}

const agentKey = (agentId: string, k: string) => ({ scopeKind: "agent" as const, scopeId: agentId, stateKey: k });

async function onRunEnded(ctx: Ctx, companyId: string, p: { agentId?: string; issueId?: string | null; status?: string; error?: string | null }) {
  if (!p.agentId) return;
  const agent = (await ctx.agents.get(p.agentId, companyId)) as AgentLike | null;
  const memDir = memDirOf(agent);
  if (!memDir) return;
  const issue = p.issueId ? await ctx.issues.get(p.issueId, companyId) : null;
  const status = p.status === "succeeded" ? "完成一轮" : `失败（${p.error ?? p.status}）`;
  appendRunLog(memDir, logLine({ at: new Date(), issue: issue?.identifier ?? null, title: issue?.title ?? null, status }));
  const now = Date.now();
  await ctx.state.set(agentKey(p.agentId, "lastRunAt"), now);
  await ctx.state.set(agentKey(p.agentId, "lastLogWriteAt"), now);
  refreshAgentInstructions(memDir);
}

/** The agent may have written to its memory during the run: put the new contents into its instructions. */
function refreshAgentInstructions(memDir: string) {
  try {
    (refreshInstructions as (cwd: string, home: string) => boolean)(path.dirname(memDir), agentselfHome());
  } catch {
    /* an agent without an Agentself runtime, or a transient fs error: next run refreshes again */
  }
}

async function memoryIdleTick(ctx: Ctx) {
  for (const cid of await knownCompanies(ctx)) {
    const c = { id: cid };
    const cfg = await config(ctx, cid);
    for (const agent of (await ctx.agents.list({ companyId: c.id })) as AgentLike[]) {
      const memDir = memDirOf(agent);
      if (!memDir) continue;
      const [lastRunAt, lastConsolidatedAt, lastLogWriteAt] = (await Promise.all(
        ["lastRunAt", "lastConsolidatedAt", "lastLogWriteAt"].map((k) => ctx.state.get(agentKey(agent.id, k))),
      )) as Array<number | null>;
      if (!shouldConsolidate({ lastRunAt, lastConsolidatedAt, lastLogWriteAt, now: Date.now(), idleMinutes: cfg.idleMinutes })) continue;
      try {
        const r = await consolidate(memDir, (prompt) => runClaudeJson(prompt, cfg.consolidationModel));
        await ctx.state.set(agentKey(agent.id, "lastConsolidatedAt"), Date.now());
        refreshAgentInstructions(memDir);
        ctx.logger.info("memory consolidated", { agentId: agent.id, ok: r.ok, commit: r.ok ? r.commit : null });
        for (const s of r.suggestions) {
          await addNotice(ctx, c.id, { text: `记忆整理建议（${agent.name ?? ""}）：${s}`, issueId: null, agentId: agent.id });
        }
        const added = addProfileProposals(r.profileProposals, { agentId: agent.id, name: agent.name ?? "" });
        if (added) await addNotice(ctx, c.id, { text: `有 ${added} 条关于你的新了解待确认（设置 → 关于我）`, issueId: null, agentId: agent.id });
      } catch (err) {
        ctx.logger.error(`memory consolidation failed: ${errText(err)}`, { agentId: agent.id, err: String(err) });
      }
    }
  }
}

async function memoryWeeklyTick(ctx: Ctx) {
  for (const cid of await knownCompanies(ctx)) {
    const c = { id: cid };
    for (const agent of (await ctx.agents.list({ companyId: c.id })) as AgentLike[]) {
      const memDir = memDirOf(agent);
      if (!memDir) continue;
      ctx.logger.info("memory weekly archive", { agentId: agent.id, ...weeklyArchive(memDir) });
      refreshAgentInstructions(memDir);
    }
  }
}

async function config(ctx: Ctx, companyId: string): Promise<Config> {
  const raw = ((await ctx.config.get(companyId).catch(() => ({}))) ?? {}) as Partial<Config>;
  return { ...DEFAULTS, ...raw };
}

/* Jobs run without a company scope, so the plugin remembers which companies it has seen
   (from events / tool calls) and only touches those. Paperclip grants proactive access to
   companies that have a config row for this plugin (created by setup-department). */
const COMPANIES_KEY = { scopeKind: "instance" as const, stateKey: "knownCompanies" };
async function rememberCompany(ctx: Ctx, companyId: string | undefined) {
  if (!companyId) return;
  const list = ((await ctx.state.get(COMPANIES_KEY)) ?? []) as string[];
  if (!list.includes(companyId)) await ctx.state.set(COMPANIES_KEY, [...list, companyId]);
}
async function knownCompanies(ctx: Ctx): Promise<string[]> {
  return ((await ctx.state.get(COMPANIES_KEY)) ?? []) as string[];
}

const issueKey = (issueId: string, stateKey: string) => ({ scopeKind: "issue" as const, scopeId: issueId, stateKey });
const companyKey = (companyId: string, stateKey: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey });

async function getState<T>(ctx: Ctx, key: Parameters<Ctx["state"]["get"]>[0], fallback: T): Promise<T> {
  const v = await ctx.state.get(key);
  return (v ?? fallback) as T;
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

async function askOnIssue(
  ctx: Ctx,
  input: { companyId: string; issueId: string; title: string; prompt: string; options: string[]; authorAgentId?: string; key: string; helpText?: string },
) {
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
            options: input.options.map((label, i) => ({ id: `o${i + 1}`, label })),
          },
        ],
      },
    } as never,
    input.companyId,
    input.authorAgentId ? { authorAgentId: input.authorAgentId } : undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Rules wired to events                                               */
/* ------------------------------------------------------------------ */

async function onIssueCreated(ctx: Ctx, companyId: string, issueId: string, actor: { id?: string; type?: string }) {
  const cfg = await config(ctx, companyId);
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || !issue.parentId) return;

  // Depth: walk parents (cached per call).
  const parents = new Map<string, string | null>();
  parents.set(issue.id, issue.parentId ?? null);
  let cur: string | null = issue.parentId ?? null;
  for (let i = 0; cur && i < cfg.maxDepth + 2; i++) {
    const p = await ctx.issues.get(cur, companyId);
    parents.set(cur, p?.parentId ?? null);
    cur = p?.parentId ?? null;
  }
  const depth = issueDepth(issue.id, (id) => parents.get(id));

  // Burst: issues created by the same agent within the window.
  const now = Date.now();
  let creations: number[] = [];
  if (actor.type === "agent" && actor.id) {
    const key = companyKey(companyId, `burst:${actor.id}`);
    const windowMs = cfg.burstWindowMinutes * 60_000;
    creations = (await getState<number[]>(ctx, key, [])).filter((t) => now - t <= windowMs);
    creations.push(now);
    await ctx.state.set(key, creations);
  }

  const verdict = checkHop({
    depth,
    runCreations: creations,
    now,
    maxDepth: cfg.maxDepth,
    burst: { max: cfg.burstMax, windowMs: cfg.burstWindowMinutes * 60_000 },
  });
  if (!verdict.block) return;

  await ctx.issues.update(issue.id, { status: "blocked" }, companyId);
  ctx.logger.warn("hop limit", { issueId, reason: verdict.reason, detail: verdict.detail });
  await askOnIssue(ctx, {
    companyId,
    issueId: issue.parentId,
    key: `agentself:hop:${issue.id}`,
    title: "任务拆得太深 / 太多，已暂停",
    prompt: `${verdict.detail}。新任务「${issue.title}」已置为 blocked。怎么处理？`,
    helpText: "不回复会怎样：该任务保持 blocked，不会继续往下拆。",
    options: ["放行这个任务", "取消这个任务", "停止继续拆分，先汇总"],
  });
}

// Paperclip can deliver the same issue.updated twice (seen in p1-rules: two handlers
// ran concurrently and counted one rework as two). Dedupe by event id and by an
// identical transition on the same issue within 1s, and serialize per issue.
const issueQueues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (issueQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  issueQueues.set(key, run.catch(() => {}));
  return run;
}

async function dropWakeupsFor(ctx: Ctx, companyId: string, issueIds: string[]) {
  const rKey = companyKey(companyId, "reminders");
  const r = dropRemindersFor(await getState<Reminder[]>(ctx, rKey, []), issueIds);
  if (r.dropped.length) await ctx.state.set(rKey, r.kept);
  const wKey = companyKey(companyId, "watches");
  const w = dropRemindersFor(await getState<Watch[]>(ctx, wKey, []), issueIds);
  if (w.dropped.length) await ctx.state.set(wKey, w.kept);
  if (r.dropped.length || w.dropped.length) ctx.logger.info(`dropped ${r.dropped.length} reminder(s) and ${w.dropped.length} watch(es) for settled task(s) ${issueIds.join(",")}`);
}

async function onIssueUpdated(ctx: Ctx, companyId: string, issueId: string, payload: Record<string, unknown>, actor: { id?: string; type?: string }) {
  const prev = (payload._previous as { status?: IssueStatus } | undefined)?.status;
  const next = payload.status as IssueStatus | undefined;
  if (!prev || !next || prev === next) return;

  // A task that is reported, done or cancelled needs no more wake-ups: drop its reminders and watches.
  if (SETTLED_STATUSES.has(next)) await dropWakeupsFor(ctx, companyId, [issueId]);

  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || !issue.parentId) return; // rework only applies to child issues
  const cfg = await config(ctx, companyId);
  const key = issueKey(issueId, "reworkCount");
  const count = await getState<number>(ctx, key, 0);
  const r = applyRework({
    prevStatus: prev,
    nextStatus: next,
    actorAgentId: actor.type === "agent" ? actor.id ?? null : null,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    count,
    limit: cfg.reworkLimit,
  });
  if (!r.isRework) return;
  await ctx.state.set(key, r.count);
  ctx.logger.info("rework", { issueId, count: r.count });
  if (!r.escalate) return;

  // Stop auto rework: block the child and ask the user on the parent (wakes the lead on answer).
  await ctx.issues.update(issueId, { status: "blocked" }, companyId);
  await askOnIssue(ctx, {
    companyId,
    issueId: issue.parentId,
    key: `agentself:rework:${issueId}:${r.count}`,
    title: `「${issue.title}」已返工 ${r.count} 次`,
    prompt: `子任务「${issue.title}」已被打回 ${r.count} 次，已停止自动返工。怎么处理？`,
    helpText: "不回复会怎样：该子任务保持 blocked，主管不会再自动返工。",
    options: ["继续返工", "换人做", "放弃这个子任务"],
  });
}

/* ------------------------------------------------------------------ */
/* Acceptance + watch helpers (plan B step 2)                          */
/* ------------------------------------------------------------------ */

interface VerificationState {
  status: "running" | "done" | "failed";
  evidenceAt: string | null;
  startedAt?: number;
  verdicts?: CriterionVerdict[];
  model?: string;
  error?: string;
}

/** A finished verifier run waiting for the verify-tick job to record it (local file, no host calls). */
interface VerifyJob {
  companyId: string;
  childId: string;
  ownerId: string;
  evidenceAt: string | null;
  model: string;
  criteria: Criterion[];
  raw: string | null;
  error: string | null;
  attempts: number;
}

const verifyDir = () => path.join(agentselfHome(), "verify");
const verifyFile = (childId: string) => path.join(verifyDir(), `${childId.replace(/[^\w-]/g, "_")}.json`);

function writeVerifyJob(job: VerifyJob) {
  fs.mkdirSync(verifyDir(), { recursive: true });
  const f = verifyFile(job.childId);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(job));
  fs.renameSync(`${f}.tmp`, f);
}

function readVerifyJobs(): VerifyJob[] {
  if (!fs.existsSync(verifyDir())) return [];
  const out: VerifyJob[] = [];
  for (const f of fs.readdirSync(verifyDir())) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(verifyDir(), f), "utf8")));
    } catch {
      /* half-written or broken: skip */
    }
  }
  return out;
}

const removeVerifyJob = (job: VerifyJob) => fs.rmSync(verifyFile(job.childId), { force: true });

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Criteria live on the lead's (parent) task; a child task resolves them through its parent. */
async function criteriaFor(ctx: Ctx, issueId: string, companyId: string): Promise<{ ownerId: string; criteria: Criterion[] } | null> {
  const own = (await ctx.state.get(issueKey(issueId, "criteria"))) as Criterion[] | null;
  if (own?.length) return { ownerId: issueId, criteria: own };
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue?.parentId) return null;
  const parent = (await ctx.state.get(issueKey(issue.parentId, "criteria"))) as Criterion[] | null;
  return parent?.length ? { ownerId: issue.parentId, criteria: parent } : null;
}

async function docBody(ctx: Ctx, issueId: string, key: string, companyId: string): Promise<string> {
  try {
    return (await ctx.issues.documents.get(issueId, key, companyId))?.body ?? "";
  } catch {
    return "";
  }
}

/** Run a probe command with a hard timeout; never throws. */
function runProbe(command: string, cwd: string | null, timeoutMs = 60_000): Promise<{ code: number | null; timedOut: boolean; spawnError: string | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, { shell: true, cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, windowsHide: true });
    } catch (e) {
      return resolve({ code: null, timedOut: false, spawnError: errText(e), output: "" });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const add = (d: Buffer) => {
      output = (output + d.toString()).slice(-8000);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, spawnError: errText(e), output });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, spawnError: null, output });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

const plugin = definePlugin({
  async setup(ctx) {
    for (const ev of ["issue.created", "issue.updated", "agent.run.started", "agent.created", "company.created"] as const) {
      ctx.events.on(ev, async (e) => rememberCompany(ctx, e.companyId).catch(() => {}));
    }

    ctx.events.on("issue.created", async (e) => {
      if (!e.entityId) return;
      try {
        await onIssueCreated(ctx, e.companyId, e.entityId, { id: e.actorId, type: e.actorType });
      } catch (err) {
        ctx.logger.error(`issue.created handler failed: ${errText(err)}`, { err: String(err) });
      }
    });

    ctx.events.on("issue.updated", async (e) => {
      if (!e.entityId) return;
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      if (isDuplicateTransition(e.eventId, e.entityId, payload)) return;
      try {
        const id = e.entityId;
        await serialize(id, () => onIssueUpdated(ctx, e.companyId, id, payload, { id: e.actorId, type: e.actorType }));
      } catch (err) {
        ctx.logger.error(`issue.updated handler failed: ${errText(err)}`, { err: String(err) });
      }
    });

    for (const ev of ["agent.run.finished", "agent.run.failed"] as const) {
      ctx.events.on(ev, async (e) => {
        try {
          await onRunEnded(ctx, e.companyId, (e.payload ?? {}) as { agentId?: string; issueId?: string | null; status?: string; error?: string | null });
        } catch (err) {
          ctx.logger.error(`run log failed: ${errText(err)}`, { err: String(err) });
        }
      });
    }
    ctx.jobs.register("memory-idle", async () => memoryIdleTick(ctx));
    ctx.jobs.register("memory-weekly", async () => memoryWeeklyTick(ctx));

    /* ---------------- card tools (PLAN 4.4) ---------------- */

    ctx.tools.register(
      "ask",
      { displayName: "team.ask", description: "Ask the user", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId: string; question: string; options: string[]; ifNoReply?: string };
        const card = await askOnIssue(ctx, {
          companyId: run.companyId,
          issueId: p.issueId,
          key: `agentself:ask:${run.runId}:${p.question.slice(0, 40)}`,
          title: p.question.slice(0, 200),
          prompt: p.question,
          helpText: p.ifNoReply ? `不回复会怎样：${p.ifNoReply}` : null as never,
          options: p.options,
          authorAgentId: run.agentId,
        });
        return { content: `已发出卡片 ${card.id}。结束本轮；用户作答后你会被唤醒，答案在 issue 线程里。`, data: { interactionId: card.id } };
      },
    );

    ctx.tools.register(
      "notice",
      { displayName: "team.notice", description: "Notify the user", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { text: string; issueId?: string };
        const msg = await addNotice(ctx, run.companyId, { text: p.text, issueId: p.issueId ?? null, agentId: run.agentId });
        return { content: `已通知（${msg.id}）` };
      },
    );

    ctx.tools.register(
      "resolve",
      { displayName: "team.resolve", description: "Close a card", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId: string; interactionId: string; reason?: string };
        const cfg = await config(ctx, run.companyId);
        const r = await ctx.issues.respondInteraction(
          p.issueId,
          p.interactionId,
          { action: "reject", actorUserId: cfg.boardUserId, reason: p.reason ?? "发起者已关闭此卡片" },
          run.companyId,
        );
        return { content: r.applied ? "卡片已关闭" : "卡片之前已处理" };
      },
    );

    ctx.tools.register(
      "later",
      { displayName: "team.later", description: "Wake me later", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId: string; minutes: number; note?: string };
        const key = companyKey(run.companyId, "reminders");
        const list = await getState<Reminder[]>(ctx, key, []);
        const dueAt = new Date(Date.now() + p.minutes * 60_000).toISOString();
        list.push({ issueId: p.issueId, agentId: run.agentId, dueAt, note: p.note ?? "" });
        await ctx.state.set(key, list);
        return { content: `好的，${p.minutes} 分钟后（${dueAt}）唤醒你。结束本轮即可。` };
      },
    );

    /* ---------------- acceptance (plan B step 2, after LobeHub) ---------------- */

    ctx.tools.register(
      "criteria",
      { displayName: "team.criteria", description: "Lead: set acceptance criteria on a task", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId?: string; items?: unknown };
        if (!p.issueId) return { content: "缺少 issueId（填你负责的父任务）" };
        let criteria: Criterion[];
        try {
          criteria = normalizeCriteria(p.items);
        } catch (e) {
          return { content: errText(e) };
        }
        await ctx.state.set(issueKey(p.issueId, "criteria"), criteria);
        await ctx.issues.documents.upsert({ issueId: p.issueId, key: "criteria", title: "验收标准", body: criteriaMarkdown(criteria), companyId: run.companyId, changeSummary: "主管设定验收标准" });
        return {
          content: `已保存 ${criteria.length} 条验收标准：\n${criteria.map((c) => `${c.id}：${c.text}`).join("\n")}\n把这些编号原样写进子任务的描述，员工会按编号提交证据。`,
          data: { criteria },
        };
      },
    );

    ctx.tools.register(
      "evidence",
      { displayName: "team.evidence", description: "Employee: submit evidence per criterion", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId?: string; items?: unknown; disputes?: unknown };
        if (!p.issueId) return { content: "缺少 issueId（填你自己的任务）" };
        const found = await criteriaFor(ctx, p.issueId, run.companyId);
        if (!found) return { content: "这个任务没有结构化的验收标准，直接按任务书写 report 即可。" };
        let r: ReturnType<typeof normalizeEvidence>;
        try {
          r = normalizeEvidence(found.criteria, p);
        } catch (e) {
          return { content: errText(e) };
        }
        await ctx.state.set(issueKey(p.issueId, "evidence"), { items: r.items, disputes: r.disputes, at: new Date().toISOString() });
        await ctx.issues.documents.upsert({ issueId: p.issueId, key: "evidence", title: "逐条证据", body: evidenceMarkdown(found.criteria, r.items, r.disputes), companyId: run.companyId, changeSummary: "员工提交证据" });
        return {
          content: r.missing.length
            ? `已保存。以下标准还没有证据：${r.missing.join("、")}。能补就补；确实没有就在 report 里说明，再交付。`
            : `已保存，${found.criteria.length} 条标准都有证据。写好 report 后把任务置为 done。`,
          data: { missing: r.missing },
        };
      },
    );

    // Paperclip calls plugin tools with a 30 s RPC timeout, and a tool call's invocation scope ends when
    // it returns: host calls made afterwards are refused ("missing, expired, or unknown invocation
    // scope", seen in P1). So verify does every host read inside the call, starts the verifier as a
    // plain child process that writes its output to a local file, and returns. The "verify-tick" job,
    // which runs with its own scope, picks the file up, stores the verdicts, writes the "verification"
    // document and comments on the lead's task, which wakes the lead.
    ctx.tools.register(
      "verify",
      { displayName: "team.verify", description: "Lead: independent per-criterion check of a child task", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId?: string };
        if (!p.issueId) return { content: "缺少 issueId（填员工交付的子任务）" };
        const childId = p.issueId;
        const companyId = run.companyId;
        const cfg = await config(ctx, companyId);
        const found = await criteriaFor(ctx, childId, companyId);
        if (!found) return { content: "没有找到结构化的验收标准，请自己对照任务书判定。" };
        const ev = ((await ctx.state.get(issueKey(childId, "evidence"))) ?? { items: [], disputes: [] }) as { items: EvidenceItem[]; disputes: Dispute[]; at?: string };
        const evidenceAt = ev.at ?? null;
        const vKey = issueKey(childId, "verification");
        const cur = (await ctx.state.get(vKey)) as VerificationState | null;
        const text = { passed: "通过", failed: "未通过", uncertain: "无法判断" } as const;

        if (cur?.status === "done" && cur.evidenceAt === evidenceAt && cur.verdicts) {
          const sum = verdictSummary(cur.verdicts);
          return {
            content: `独立核查（${cur.model ?? cfg.verifierModel}）：通过 ${sum.passed}，未通过 ${sum.failed}，无法判断 ${sum.uncertain}。\n${cur.verdicts
              .map((v) => `${v.criterionId} ${text[v.verdict]}：${v.reason}${v.suggestion ? `（建议：${v.suggestion}）` : ""}`)
              .join("\n")}\n这是参考意见，最终由你判定；推翻某条时在汇报里写明理由。`,
            data: { status: "done", verdicts: cur.verdicts, ...sum },
          };
        }
        if (cur?.status === "running" && cur.evidenceAt === evidenceAt && Date.now() - (cur.startedAt ?? 0) < 10 * 60_000) {
          return { content: "核查还在进行中。结束本轮；完成后会在你的任务上留言叫醒你。", data: { status: "running" } };
        }
        // A failed check is not retried silently: tell the lead why, so it can judge by itself.
        if (cur?.status === "failed" && cur.evidenceAt === evidenceAt) {
          return { content: `上一次独立核查失败：${cur.error ?? "原因未知"}。员工的证据没有变化，不再重试；请自己逐条判定。员工补交证据后可以再调用。`, data: { status: "failed" } };
        }

        // Every host read happens here, inside the call.
        const prompt = verifierPrompt({
          goal: (await docBody(ctx, found.ownerId, "brief", companyId)) || ((await ctx.issues.get(found.ownerId, companyId))?.title ?? ""),
          criteria: found.criteria,
          items: ev.items,
          disputes: ev.disputes,
          report: await docBody(ctx, childId, "report", companyId),
        });
        await ctx.state.set(vKey, { status: "running", evidenceAt, startedAt: Date.now(), model: cfg.verifierModel } satisfies VerificationState);
        await rememberCompany(ctx, companyId);
        const job: VerifyJob = { companyId, childId, ownerId: found.ownerId, evidenceAt, model: cfg.verifierModel, criteria: found.criteria, raw: null, error: null, attempts: 0 };
        // No host calls from here on: the call's scope ends when we return.
        void runClaudeJson(prompt, cfg.verifierModel, 300_000, undefined, [
          "--disallowedTools",
          "Bash,PowerShell,Edit,Write,Read,Grep,Glob,WebSearch,WebFetch,Task,Agent,NotebookEdit",
        ])
          .then((raw) => writeVerifyJob({ ...job, raw }))
          .catch((e) => writeVerifyJob({ ...job, error: errText(e) }));
        return { content: `已开始独立核查（${cfg.verifierModel}，一般 1–3 分钟）。结束本轮；完成后会在你的任务上留言叫醒你，那时再调用一次 verify 拿逐条结果。`, data: { status: "running" } };
      },
    );

    ctx.jobs.register("verify-tick", async () => {
      for (const job of readVerifyJobs()) {
        const vKey = issueKey(job.childId, "verification");
        try {
          const verdicts = job.raw != null ? parseVerdicts(job.raw, job.criteria) : null;
          if (!verdicts) {
            const error = job.error ?? "核查员的输出无法解析";
            await ctx.state.set(vKey, { status: "failed", evidenceAt: job.evidenceAt, error, model: job.model } satisfies VerificationState);
            await ctx.issues.createComment(job.ownerId, `🔎 独立核查没跑成（子任务 ${job.childId}）：${error.slice(0, 300)}。请自己逐条判定。`, job.companyId);
            ctx.logger.error(`verify failed for ${job.childId}: ${error}`);
          } else {
            await ctx.state.set(vKey, { status: "done", evidenceAt: job.evidenceAt, verdicts, model: job.model } satisfies VerificationState);
            await ctx.issues.documents.upsert({ issueId: job.childId, key: "verification", title: "独立核查", body: verificationMarkdown(job.criteria, verdicts, job.model), companyId: job.companyId, changeSummary: "独立核查" });
            const sum = verdictSummary(verdicts);
            await ctx.issues.createComment(job.ownerId, `🔎 独立核查完成（子任务 ${job.childId}）：通过 ${sum.passed}，未通过 ${sum.failed}，无法判断 ${sum.uncertain}。再调用一次 verify 查看逐条结果。`, job.companyId);
          }
          removeVerifyJob(job);
        } catch (e) {
          // Keep the file and retry next minute; give up after a few attempts so it cannot loop forever.
          const attempts = job.attempts + 1;
          ctx.logger.error(`verify-tick could not record ${job.childId} (attempt ${attempts}): ${errText(e)}`);
          if (attempts >= 5) removeVerifyJob(job);
          else writeVerifyJob({ ...job, attempts });
        }
      }
    });

    // Called by submit_report before it touches the task's status, so stale reminders are dropped even
    // when Paperclip refuses the status change (P1 run 6).
    ctx.tools.register(
      "settle",
      { displayName: "team.settle", description: "Drop pending reminders and watches for a task", parametersSchema: { type: "object" } },
      async (params, run) => {
        const p = params as { issueId?: string };
        if (!p.issueId) return { content: "缺少 issueId" };
        await dropWakeupsFor(ctx, run.companyId, [p.issueId]);
        return { content: "已取消这个任务上未触发的提醒和看守" };
      },
    );

    /* ---------------- long-running experiment watch (plan B step 2) ---------------- */

    ctx.tools.register(
      "watch",
      { displayName: "team.watch", description: "Employee: wake me when a long job finishes", parametersSchema: { type: "object" } },
      async (params, run) => {
        const key = companyKey(run.companyId, "watches");
        const list = await getState<Watch[]>(ctx, key, []);
        if (list.length >= WATCH_LIMITS.maxPerCompany) return { content: "看守太多了，先结束一些再加。" };
        const agent = (await ctx.agents.get(run.agentId, run.companyId)) as AgentLike | null;
        const cwd = typeof agent?.adapterConfig?.cwd === "string" ? agent.adapterConfig.cwd : null;
        let w: Watch;
        try {
          w = newWatch(params as Record<string, unknown>, { companyId: run.companyId, agentId: run.agentId, cwd, now: Date.now(), id: `watch_${Date.now().toString(36)}` });
        } catch (e) {
          return { content: errText(e) };
        }
        await ctx.state.set(key, [...list, w]);
        await rememberCompany(ctx, run.companyId);
        return {
          content: `已开始看守：每 ${w.everyMinutes} 分钟运行一次探测命令（不消耗模型额度），退出码 0 表示结束、1 表示还在跑、其他表示出错；结束、出错或到 ${w.expiresAt} 时叫醒你。现在结束本轮。`,
          data: { watchId: w.id },
        };
      },
    );

    ctx.jobs.register("watch-tick", async () => {
      for (const cid of await knownCompanies(ctx)) {
        const key = companyKey(cid, "watches");
        const list = await getState<Watch[]>(ctx, key, []);
        const due = dueWatches(list, Date.now());
        if (due.length === 0) continue;
        const next = new Map(list.map((w) => [w.id, w as Watch | null]));
        for (const w of due) {
          const r = await runProbe(w.command, w.cwd);
          const res = afterCheck(w, classifyProbe(r), Date.now());
          next.set(w.id, res.keep);
          if (!res.wake) continue;
          try {
            await ctx.issues.createComment(w.issueId, wakeComment(w, res.wake, r.spawnError ?? r.output), cid);
            await ctx.issues.requestWakeup(w.issueId, cid, { reason: "agentself_watch" } as never);
          } catch (err) {
            ctx.logger.error(`watch wake failed: ${errText(err)}`, { issueId: w.issueId, err: errText(err) });
          }
        }
        // Re-read so watches added while probes ran are kept.
        const latest = await getState<Watch[]>(ctx, key, []);
        await ctx.state.set(
          key,
          latest.flatMap((w) => (next.has(w.id) ? (next.get(w.id) ? [next.get(w.id)!] : []) : [w])),
        );
      }
    });

    ctx.jobs.register("later-tick", async () => {
      for (const cid of await knownCompanies(ctx)) {
        const c = { id: cid };
        const key = companyKey(c.id, "reminders");
        const list = await getState<Reminder[]>(ctx, key, []);
        if (list.length === 0) continue;
        const { due, rest } = dueReminders(list, Date.now());
        for (const r of due) {
          try {
            // Safety net for an issue.updated we missed: never wake anyone on a settled task.
            const issue = await ctx.issues.get(r.issueId, c.id).catch(() => null);
            if (issue && SETTLED_STATUSES.has(String(issue.status))) continue;
            if (r.note) await ctx.issues.createComment(r.issueId, `⏰ 稍后提醒：${r.note}`, c.id);
            await ctx.issues.requestWakeup(r.issueId, c.id, { reason: "agentself_later" } as never);
          } catch (err) {
            ctx.logger.error(`later wake failed: ${errText(err)}`, { issueId: r.issueId, err: String(err) });
          }
        }
        if (due.length) await ctx.state.set(key, rest);
      }
    });

    ctx.actions.register("register", async (params) => {
      const companyId = (params as { companyId?: string }).companyId;
      await rememberCompany(ctx, companyId);
      return { ok: true, companies: await knownCompanies(ctx) };
    });

    // the workbench's 知道了 on a notice card
    ctx.actions.register("notice-dismiss", async (params) => {
      const p = params as { companyId?: string; id?: string };
      if (!p.companyId || !p.id) return { ok: false };
      const key = companyKey(p.companyId, "notices");
      const r = dismissNotice(await getState<FeedMessage[]>(ctx, key, []), p.id);
      if (r.found) await ctx.state.set(key, r.list);
      return { ok: r.found };
    });

    /* ---------------- data for the console ---------------- */
    ctx.data.register("notices", async (params) => {
      const companyId = (params as { companyId?: string }).companyId;
      if (!companyId) return [];
      return getState<FeedMessage[]>(ctx, companyKey(companyId, "notices"), []);
    });
  },

  async onApiRequest(input) {
    if (input.routeKey === "feed") {
      return { status: 200, body: { ok: true, companyId: input.companyId } };
    }
    return { status: 404, body: { error: "not found" } };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
