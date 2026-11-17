// Office snapshot (PLAN 7.1): agent status + runs + attention -> pixel animation state.
import { modelFamilyFor } from "@agentself/shared";
const arr = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

/** Pure mapping, priority order from PLAN 7.1. */
export function animFor({ agent, lastRunFailed, waitingCards, running, inReview, justDelivered }) {
  if (agent.status === "error" || lastRunFailed) return "failed";
  if (waitingCards > 0) return "waiting";
  if (agent.status === "running" || running) return "working";
  if (inReview) return "delivering";
  if (agent.status === "paused" || agent.status === "budget_paused" || agent.pauseReason === "budget") return "paused";
  if (justDelivered) return "walk_to_lead";
  return "idle";
}

export function eyeFor(adapterType, model) {
  return modelFamilyFor(adapterType, model);
}

export function modelLabel(agent) {
  const m = agent.adapterConfig?.model;
  if (m) return String(m);
  if (agent.adapterType === "claude_local") return "Claude";
  if (agent.adapterType === "codex_local") return "Codex";
  return agent.adapterType ?? "";
}

export async function buildOfficeSnapshot(ctx, pc, now = Date.now()) {
  if (!ctx.company) return { at: new Date(now).toISOString(), departments: [], people: [] };
  const cid = ctx.company.id;
  const [attention, issues, runs] = await Promise.all([
    pc("GET", `/companies/${cid}/attention`).catch(() => ({ items: [] })),
    pc("GET", `/companies/${cid}/issues`).catch(() => []),
    pc("GET", `/companies/${cid}/heartbeat-runs?limit=200`).catch(() => []),
  ]);
  const items = arr(attention);
  const issueList = arr(issues);
  const runList = arr(runs);

  const people = ctx.agents
    .filter((a) => a.metadata?.agentself)
    .map((agent) => {
      const m = agent.metadata.agentself;
      const agentRuns = runList.filter((r) => r.agentId === agent.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const last = agentRuns[0];
      const running = agentRuns.some((r) => r.status === "running" || r.status === "queued");
      const waitingCards = items.filter(
        (it) => it.resolverAudience?.createdByAgentId === agent.id || it.subject?.metadata?.createdByAgentId === agent.id || it.originAgentId === agent.id,
      ).length;
      const mine = issueList.filter((i) => i.assigneeAgentId === agent.id);
      const inReview = mine.some((i) => i.status === "in_review");
      const justDelivered = mine.some((i) => i.parentId && i.status === "done" && now - Date.parse(i.updatedAt ?? 0) < 60_000);
      const current = mine.find((i) => i.status === "in_progress");
      return {
        agentId: agent.id,
        departmentId: m.department ?? null,
        name: agent.name,
        title: agent.title ?? "",
        model: modelLabel(agent),
        eye: eyeFor(agent.adapterType, agent.adapterConfig?.model),
        isLead: !!m.isLead,
        anim: animFor({ agent, lastRunFailed: last?.status === "failed", waitingCards, running, inReview, justDelivered }),
        bubble: current?.title ?? null,
        pendingCards: waitingCards,
        currentIssueId: current?.id ?? null,
      };
    });
  return {
    at: new Date(now).toISOString(),
    departments: ctx.departments.map((d) => ({ id: d.key, name: d.name, icon: "" })),
    people,
  };
}
