// team-layer worker: wires the pure rules (./rules) to Paperclip events, state and tools.
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { FeedMessage } from "@agentself/shared";
import { applyRework, checkHop, issueDepth, type IssueStatus } from "./rules/index.js";
import { addNotice, dueReminders, type Reminder } from "./store.js";

type Ctx = Parameters<Parameters<typeof definePlugin>[0]["setup"]>[0];

interface Config {
  reworkLimit: number;
  maxDepth: number;
  burstMax: number;
  burstWindowMinutes: number;
  boardUserId: string;
}

const DEFAULTS: Config = { reworkLimit: 3, maxDepth: 8, burstMax: 20, burstWindowMinutes: 10, boardUserId: "local-board" };

async function config(ctx: Ctx): Promise<Config> {
  const raw = ((await ctx.config.get()) ?? {}) as Partial<Config>;
  return { ...DEFAULTS, ...raw };
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
  const cfg = await config(ctx);
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
  const cfg = await config(ctx);
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
        const cfg = await config(ctx);
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
      const companies = await ctx.companies.list({});
      for (const c of companies as Array<{ id: string }>) {
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
