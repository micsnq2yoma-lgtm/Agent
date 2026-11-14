// src/worker.ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

// src/rules/index.ts
var DEFAULT_REWORK_LIMIT = 3;
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
var DEFAULTS = { reworkLimit: 3, maxDepth: 8, burstMax: 20, burstWindowMinutes: 10, boardUserId: "local-board" };
async function config(ctx) {
  const raw = await ctx.config.get() ?? {};
  return { ...DEFAULTS, ...raw };
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
  const cfg = await config(ctx);
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
async function onIssueUpdated(ctx, companyId, issueId, payload, actor) {
  const prev = payload._previous?.status;
  const next = payload.status;
  if (!prev || !next || prev === next) return;
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || !issue.parentId) return;
  const cfg = await config(ctx);
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
        await onIssueUpdated(ctx, e.companyId, e.entityId, e.payload ?? {}, { id: e.actorId, type: e.actorType });
      } catch (err) {
        ctx.logger.error("issue.updated handler failed", { err: String(err) });
      }
    });
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
        const cfg = await config(ctx);
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
      const companies = await ctx.companies.list({});
      for (const c of companies) {
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
