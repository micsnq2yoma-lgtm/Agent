// Loads everything the workbench needs and turns it into cards.
import { as, list, pc, type Context, type Issue } from "./api";
import { buildCards, hireCards, noticeCards, sortCards, type Answer, type AttentionItem, type Card, type HireRequest, type Interaction, type Notice } from "./cards";

export interface Feed {
  cards: Card[];
  issues: Issue[];
  handled: Card[];
}

const interactionCache = new Map<string, Interaction>();

/** The team-layer plugin's id (its data and actions are addressed by id). */
let teamLayerId: string | null = null;
async function teamLayer(): Promise<string | null> {
  if (teamLayerId) return teamLayerId;
  const plugins = list<{ id: string; pluginKey: string }>(await pc.get("/plugins").catch(() => []));
  teamLayerId = plugins.find((p) => p.pluginKey === "agenteam.team-layer")?.id ?? null;
  return teamLayerId;
}
async function loadNotices(companyId: string): Promise<Notice[]> {
  const id = await teamLayer();
  if (!id) return [];
  const r = await pc.post<{ data?: Notice[] }>(`/plugins/${id}/data/notices`, { companyId, params: { companyId } }).catch(() => null);
  return Array.isArray(r?.data) ? r.data : [];
}

export interface WatchView {
  id: string;
  issueId: string;
  agentId: string;
  command: string;
  everyMinutes: number;
  checks: number;
  nextAt: string;
  expiresAt: string;
  note: string;
}
export interface ReminderView {
  issueId: string;
  agentId: string;
  dueAt: string;
  note: string;
}
/** Experiment watches and pending reminders on these tasks (team-layer plugin). */
export async function loadWatches(companyId: string, issueIds: string[]): Promise<{ watches: WatchView[]; reminders: ReminderView[] }> {
  const id = await teamLayer();
  const empty = { watches: [], reminders: [] };
  if (!id || !issueIds.length) return empty;
  const r = await pc.post<{ data?: { watches?: WatchView[]; reminders?: ReminderView[] } }>(`/plugins/${id}/data/watches`, { companyId, params: { companyId, issueIds } }).catch(() => null);
  return { watches: r?.data?.watches ?? [], reminders: r?.data?.reminders ?? [] };
}

export async function loadFeed(ctx: Context): Promise<Feed> {
  if (!ctx.company) return { cards: [], issues: [], handled: [] };
  const cid = ctx.company.id;
  const [attention, issues, answers, hires, notices] = await Promise.all([
    pc.get<{ items: AttentionItem[] }>(`/companies/${cid}/attention`),
    pc.get<Issue[]>(`/companies/${cid}/issues`),
    as.get<Answer[]>(`/answers?companyId=${cid}`),
    as.get<HireRequest[]>(`/hire-requests?status=pending`).catch(() => [] as HireRequest[]),
    loadNotices(cid),
  ]);
  const items = list<AttentionItem>(attention);

  // fetch interaction details for interaction items (cached; pending ones refresh when missing)
  const interactions: Record<string, Interaction> = {};
  const needIssue = new Set<string>();
  for (const it of items) {
    if (it.sourceKind !== "issue_thread_interaction" || !it.subject?.id || !it.relatedIssue) continue;
    const cached = interactionCache.get(it.subject.id);
    if (cached) interactions[it.subject.id] = cached;
    else needIssue.add(it.relatedIssue.id);
  }
  await Promise.all(
    [...needIssue].map(async (issueId) => {
      const all = list<Interaction>(await pc.get(`/issues/${issueId}/interactions`));
      for (const i of all) {
        interactionCache.set(i.id, i);
        interactions[i.id] = i;
      }
    }),
  );

  const deptOfProject = (projectId: string | null | undefined) => ctx.departments.find((d) => d.projectId === projectId)?.name ?? null;
  const issueList = list<Issue>(issues);
  const built = buildCards({
    attention: items,
    interactions,
    issues: issueList,
    agents: ctx.agents,
    answers: list<Answer>(answers),
    departmentOfProject: deptOfProject,
  });
  const cards = sortCards([...hireCards(list<HireRequest>(hires)), ...noticeCards(notices, ctx.agents, issueList), ...built]);
  const handled = buildCards({
    attention: [],
    interactions: {},
    issues: issueList.filter((i) => !i.parentId && i.status === "done").map((i) => ({ ...i, status: "in_review" })),
    agents: ctx.agents,
    answers: list<Answer>(answers)
      .filter((a) => a.status === "handled")
      .map((a) => ({ ...a, status: "open" as const })),
    departmentOfProject: deptOfProject,
  }).slice(0, 30);
  return { cards, issues: issueList, handled };
}

/* ---------------- actions ---------------- */

export async function act(card: Card, optionId: string, extra?: { comment?: string; name?: string; source?: string }) {
  const s = card.source;
  switch (s.kind) {
    case "hire":
      return as.post(`/hire-requests/${s.hireId}/${optionId === "approve" ? "approve" : "reject"}`, optionId === "approve" ? { name: extra?.name || s.name, ...(extra?.source ? { source: extra.source } : {}) } : { reason: extra?.comment ?? "" });
    case "interaction":
      if (optionId === "__accept") return pc.post(`/issues/${s.issueId}/interactions/${s.interactionId}/accept`, {});
      if (optionId === "__reject" || optionId === "rework")
        return pc.post(`/issues/${s.issueId}/interactions/${s.interactionId}/reject`, { reason: extra?.comment || "需要修改" });
      return pc.post(`/issues/${s.issueId}/interactions/${s.interactionId}/respond`, {
        answers: [{ questionId: s.questionId, optionIds: [optionId] }],
      });
    case "approval":
      return pc.post(`/approvals/${s.approvalId}/${optionId === "approve" ? "approve" : "reject"}`, {});
    case "decision":
      return pc.post(`/decisions/${s.decisionId}/decide`, { optionId });
    case "issue":
      if (optionId === "done") return pc.patch(`/issues/${s.issueId}`, { status: "done" });
      if (optionId === "rework")
        return pc.patch(`/issues/${s.issueId}`, { status: "in_progress", comment: `用户要求返工：${extra?.comment ?? "请根据反馈修改后重新汇报"}` });
      return null;
    case "answer":
      return as.post(`/answers/${s.answerId}/dismiss`);
    case "run":
      return dismiss(card);
    case "notice": {
      const id = await teamLayer();
      if (!id) throw new Error("没有找到 team-layer 插件");
      return pc.post(`/plugins/${id}/actions/notice-dismiss`, { companyId: s.companyId, params: { companyId: s.companyId, id: s.noticeId } });
    }
  }
}

export async function dismiss(card: Card, companyId?: string) {
  const key = "dismissalKey" in card.source ? card.source.dismissalKey : null;
  if (key && companyId) return pc.post(`/companies/${companyId}/inbox-dismissals`, { itemKey: key, kind: "dismiss" });
  if (card.source.kind === "answer") return as.post(`/answers/${card.source.answerId}/dismiss`);
  return null;
}

export async function snooze(card: Card, companyId: string, until: Date) {
  const key = "dismissalKey" in card.source ? card.source.dismissalKey : null;
  if (!key) return null;
  return pc.post(`/companies/${companyId}/inbox-dismissals`, { itemKey: key, kind: "snooze", snoozedUntil: until.toISOString() });
}

export async function loadDecisionOptions(decisionId: string) {
  const d = await pc.get<{ options?: Array<{ id: string; label: string }>; body?: string }>(`/decisions/${decisionId}`);
  return { options: d.options ?? [], body: d.body ?? "" };
}
