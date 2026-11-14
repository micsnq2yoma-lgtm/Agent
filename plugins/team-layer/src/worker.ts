// team-layer worker: wires the pure rules (./rules) to Paperclip events, state and tools.
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { FeedMessage } from "@agentself/shared";
import { applyRework, checkHop, issueDepth, type IssueStatus } from "./rules/index.js";
import { addNotice, dueReminders, type Reminder } from "./store.js";
import path from "node:path";
import { appendRunLog, consolidate, logLine, runClaudeJson, shouldConsolidate, weeklyArchive } from "./memory-jobs.js";

type Ctx = Parameters<Parameters<typeof definePlugin>[0]["setup"]>[0];

interface Config {
  reworkLimit: number;
  maxDepth: number;
  burstMax: number;
  burstWindowMinutes: number;
  boardUserId: string;
  idleMinutes: number;
  consolidationModel: string;
}

const DEFAULTS: Config = {
  reworkLimit: 3,
  maxDepth: 8,
  burstMax: 20,
  burstWindowMinutes: 10,
  boardUserId: "local-board",
  idleMinutes: 30,
  consolidationModel: "haiku",
};

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
        ctx.logger.info("memory consolidated", { agentId: agent.id, ok: r.ok, commit: r.ok ? r.commit : null });
        for (const s of r.suggestions) {
          await addNotice(ctx, c.id, { text: `记忆整理建议（${agent.name ?? ""}）：${s}`, issueId: null, agentId: agent.id });
        }
      } catch (err) {
        ctx.logger.error("memory consolidation failed", { agentId: agent.id, err: String(err) });
      }
    }
  }
}

async function memoryWeeklyTick(ctx: Ctx) {
  for (const cid of await knownCompanies(ctx)) {
    const c = { id: cid };
    for (const agent of (await ctx.agents.list({ companyId: c.id })) as AgentLike[]) {
      const memDir = memDirOf(agent);
      if (memDir) ctx.logger.info("memory weekly archive", { agentId: agent.id, ...weeklyArchive(memDir) });
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

async function onIssueUpdated(ctx: Ctx, companyId: string, issueId: string, payload: Record<string, unknown>, actor: { id?: string; type?: string }) {
  const prev = (payload._previous as { status?: IssueStatus } | undefined)?.status;
  const next = payload.status as IssueStatus | undefined;
  if (!prev || !next || prev === next) return;

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
        ctx.logger.error("issue.created handler failed", { err: String(err) });
      }
    });

    ctx.events.on("issue.updated", async (e) => {
      if (!e.entityId) return;
      try {
        await onIssueUpdated(ctx, e.companyId, e.entityId, (e.payload ?? {}) as Record<string, unknown>, { id: e.actorId, type: e.actorType });
      } catch (err) {
        ctx.logger.error("issue.updated handler failed", { err: String(err) });
      }
    });

    for (const ev of ["agent.run.finished", "agent.run.failed"] as const) {
      ctx.events.on(ev, async (e) => {
        try {
          await onRunEnded(ctx, e.companyId, (e.payload ?? {}) as { agentId?: string; issueId?: string | null; status?: string; error?: string | null });
        } catch (err) {
          ctx.logger.error("run log failed", { err: String(err) });
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

    ctx.jobs.register("later-tick", async () => {
      for (const cid of await knownCompanies(ctx)) {
        const c = { id: cid };
        const key = companyKey(c.id, "reminders");
        const list = await getState<Reminder[]>(ctx, key, []);
        if (list.length === 0) continue;
        const { due, rest } = dueReminders(list, Date.now());
        for (const r of due) {
          try {
            if (r.note) await ctx.issues.createComment(r.issueId, `⏰ 稍后提醒：${r.note}`, c.id);
            await ctx.issues.requestWakeup(r.issueId, c.id, { reason: "agentself_later" } as never);
          } catch (err) {
            ctx.logger.error("later wake failed", { issueId: r.issueId, err: String(err) });
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
