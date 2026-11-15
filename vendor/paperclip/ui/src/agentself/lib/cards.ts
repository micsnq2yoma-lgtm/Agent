// Workbench cards (PLAN 4.3 / 7.0): built from Paperclip attention items, top-level issues and
// front-desk answers. Pure functions — unit-tested in test/cards.test.ts.
import type { Tier } from "@agentself/shared";

/** Sentinels the UI replaces with skin terms (no hard-coded role words). */
export const FRONTDESK = "__frontdesk__";
export const LEAD = "__lead__";

/**
 * `hire` (v0.6): a lead proposed a new employee; it counts as "要你拍板" (DESIGN §4.6).
 * `notice`: an employee or the memory job told the user something (notify_user); no reply needed,
 * filed under 交付结果.
 */
export type CardType = "decide" | "deliver" | "answer" | "failed" | "hire" | "notice";

export interface CardOption {
  id: string;
  label: string;
}

export interface Card {
  id: string;
  type: CardType;
  tier: Tier;
  who: string;
  model: string | null;
  department: string | null;
  ref: string | null;
  title: string;
  explain: string | null;
  ifNoReply: string | null;
  createdAt: string;
  snoozedUntil: string | null;
  options: CardOption[];
  primary: string;
  source:
    | { kind: "interaction"; issueId: string; interactionId: string; questionId: string; dismissalKey: string | null }
    | { kind: "approval"; approvalId: string; dismissalKey: string | null }
    | { kind: "decision"; decisionId: string; dismissalKey: string | null }
    | { kind: "issue"; issueId: string; dismissalKey: string | null }
    | { kind: "run"; issueId: string | null; runId: string | null; dismissalKey: string | null }
    | { kind: "answer"; answerId: string }
    | { kind: "notice"; noticeId: string; companyId: string }
    | { kind: "hire"; hireId: string; leadAgentId: string; name: string; capabilities: string; adapterType: string; reason: string };
  issueId: string | null;
}

export interface AttentionItem {
  id: string;
  sourceKind: string;
  subject?: { kind?: string; id?: string; title?: string; identifier?: string | null; status?: string; metadata?: Record<string, unknown> };
  relatedIssue?: { id: string; title: string; identifier?: string | null; status?: string; metadata?: Record<string, unknown> } | null;
  project?: { id: string; name: string } | null;
  whyNow?: string;
  severity?: string;
  createdAt: string;
  activityAt?: string;
  dismissalKey?: string | null;
  dismissal?: unknown;
  snoozedUntil?: string | null;
  resolverAudience?: { createdByAgentId?: string | null; createdByAgentName?: string | null } | null;
  originAgentName?: string | null;
  detail?: { firstQuestionText?: string } & Record<string, unknown>;
}

export interface Interaction {
  id: string;
  issueId: string;
  kind: string;
  status: string;
  title?: string | null;
  payload?: {
    title?: string | null;
    prompt?: string;
    acceptLabel?: string;
    rejectLabel?: string;
    target?: { type?: string; key?: string; issueId?: string };
    questions?: Array<{ id: string; prompt: string; helpText?: string | null; options: Array<{ id: string; label: string }> }>;
  };
  createdByAgentId?: string | null;
}

export interface AgentLite {
  id: string;
  name: string;
  adapterType?: string;
  adapterConfig?: { model?: string };
  metadata?: { agentself?: { department?: string; departmentName?: string; isLead?: boolean } };
}

export interface IssueLite {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  parentId?: string | null;
  projectId?: string | null;
  assigneeAgentId?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export interface Answer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  status: "open" | "handled";
}

export function modelOf(a: AgentLite | undefined): string | null {
  if (!a) return null;
  if (a.adapterConfig?.model) return String(a.adapterConfig.model);
  if (a.adapterType === "claude_local") return "Claude";
  if (a.adapterType === "codex_local") return "Codex";
  return null;
}

const HIGH_KINDS = new Set(["issue_thread_interaction", "approval", "decision", "budget_alert", "join_request", "recovery_action"]);
const FAILED_KINDS = new Set(["failed_run", "agent_error_alert"]);

function splitHelp(help: string | null | undefined): { explain: string | null; ifNoReply: string | null } {
  if (!help) return { explain: null, ifNoReply: null };
  const m = help.match(/不回复会怎样[:：]\s*(.*)$/s);
  if (m) {
    const explain = help.slice(0, m.index).trim();
    return { explain: explain || null, ifNoReply: m[1].trim() };
  }
  return { explain: help, ifNoReply: null };
}

export function buildCards(input: {
  attention: AttentionItem[];
  interactions: Record<string, Interaction>;
  issues: IssueLite[];
  agents: AgentLite[];
  answers: Answer[];
  departmentOfProject: (projectId: string | null | undefined) => string | null;
  now?: number;
}): Card[] {
  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const cards: Card[] = [];
  const seenIssue = new Set<string>();

  for (const it of input.attention) {
    if (it.dismissal) continue;
    const issue = it.relatedIssue ?? null;
    const creatorId = it.resolverAudience?.createdByAgentId ?? (it.subject?.metadata?.createdByAgentId as string | undefined) ?? null;
    const creator = creatorId ? agentById.get(creatorId) : undefined;
    const who = creator?.name ?? it.resolverAudience?.createdByAgentName ?? it.originAgentName ?? "系统";
    const department = it.project?.name ?? input.departmentOfProject(null);
    const base = {
      who,
      model: modelOf(creator),
      department,
      ref: issue?.identifier ?? null,
      createdAt: it.createdAt,
      snoozedUntil: it.snoozedUntil ?? null,
      issueId: issue?.id ?? null,
    };

    if (it.sourceKind === "issue_thread_interaction" && it.subject?.id && issue) {
      const inter = input.interactions[it.subject.id];
      const q = inter?.payload?.questions?.[0];
      if (inter && inter.kind !== "ask_user_questions") {
        // confirmations: accept / reject. A confirmation on the lead report is a delivery card.
        const isReport = inter.payload?.target?.type === "issue_document" && inter.payload?.target?.key === "report";
        const accept = inter.payload?.acceptLabel ?? (isReport ? "验收通过" : "同意");
        if (isReport) seenIssue.add(issue.id);
        cards.push({
          ...base,
          id: it.id,
          type: isReport ? "deliver" : "decide",
          tier: isReport ? "medium" : "high",
          title: isReport ? (issue.title ?? inter.title ?? "交付结果") : (inter.payload?.prompt ?? inter.title ?? it.subject.title ?? "需要你确认"),
          explain: isReport ? (inter.payload?.prompt ?? null) : (it.whyNow ?? null),
          ifNoReply: null,
          options: [
            { id: "__accept", label: accept },
            ...(isReport ? [] : [{ id: "__reject", label: inter.payload?.rejectLabel ?? "不同意" }]),
          ],
          primary: accept,
          source: { kind: "interaction", issueId: issue.id, interactionId: it.subject.id, questionId: "", dismissalKey: it.dismissalKey ?? null },
        });
        continue;
      }
      const { explain, ifNoReply } = splitHelp(q?.helpText);
      const options = (q?.options ?? []).map((o) => ({ id: o.id, label: o.label }));
      cards.push({
        ...base,
        id: it.id,
        type: "decide",
        tier: "high",
        title: q?.prompt ?? it.detail?.firstQuestionText ?? it.subject.title ?? "需要你回答",
        explain,
        ifNoReply,
        options,
        primary: options[0]?.label ?? "去回答",
        source: { kind: "interaction", issueId: issue.id, interactionId: it.subject.id, questionId: q?.id ?? "", dismissalKey: it.dismissalKey ?? null },
      });
      continue;
    }
    if (it.sourceKind === "approval" && it.subject?.id) {
      cards.push({
        ...base,
        id: it.id,
        type: "decide",
        tier: "high",
        title: it.subject.title ?? "有一项审批等你批准",
        explain: it.whyNow ?? null,
        ifNoReply: null,
        options: [
          { id: "approve", label: "批准" },
          { id: "reject", label: "拒绝" },
        ],
        primary: "批准",
        source: { kind: "approval", approvalId: it.subject.id, dismissalKey: it.dismissalKey ?? null },
      });
      continue;
    }
    if (it.sourceKind === "decision" && it.subject?.id) {
      cards.push({
        ...base,
        id: it.id,
        type: "decide",
        tier: "high",
        title: it.subject.title ?? "需要你决定",
        explain: it.whyNow ?? null,
        ifNoReply: null,
        options: [],
        primary: "去决定",
        source: { kind: "decision", decisionId: it.subject.id, dismissalKey: it.dismissalKey ?? null },
      });
      continue;
    }
    if (FAILED_KINDS.has(it.sourceKind)) {
      cards.push({
        ...base,
        id: it.id,
        type: "failed",
        tier: "medium",
        title: it.subject?.title ?? "运行失败",
        explain: it.whyNow ?? null,
        ifNoReply: null,
        options: [],
        primary: "查看",
        source: { kind: "run", issueId: issue?.id ?? null, runId: it.subject?.id ?? null, dismissalKey: it.dismissalKey ?? null },
      });
      continue;
    }
    if (it.sourceKind === "review" && issue && !issue.id) continue;
    if (HIGH_KINDS.has(it.sourceKind)) {
      cards.push({
        ...base,
        id: it.id,
        type: "decide",
        tier: "high",
        title: it.subject?.title ?? it.whyNow ?? "需要你处理",
        explain: it.whyNow ?? null,
        ifNoReply: null,
        options: [],
        primary: "去处理",
        source: { kind: "issue", issueId: issue?.id ?? "", dismissalKey: it.dismissalKey ?? null },
      });
    }
  }

  // Lead reports: top-level issues waiting for the user's confirmation.
  for (const i of input.issues) {
    if (i.parentId || i.status !== "in_review" || seenIssue.has(i.id)) continue;
    seenIssue.add(i.id);
    const lead = i.assigneeAgentId ? agentById.get(i.assigneeAgentId) : undefined;
    cards.push({
      id: `issue:${i.id}`,
      type: "deliver",
      tier: "medium",
      who: lead?.name ?? LEAD,
      model: modelOf(lead),
      department: input.departmentOfProject(i.projectId),
      ref: i.identifier ?? null,
      title: i.title,
      explain: null,
      ifNoReply: null,
      createdAt: i.updatedAt ?? i.createdAt ?? new Date(0).toISOString(),
      snoozedUntil: null,
      options: [
        { id: "done", label: "确认完成" },
        { id: "rework", label: "返工" },
      ],
      primary: "确认完成",
      source: { kind: "issue", issueId: i.id, dismissalKey: null },
      issueId: i.id,
    });
  }

  for (const a of input.answers) {
    if (a.status !== "open") continue;
    cards.push({
      id: `answer:${a.id}`,
      type: "answer",
      tier: "low",
      who: FRONTDESK,
      model: null,
      department: null,
      ref: null,
      title: a.answer.split(/\n/)[0].slice(0, 120),
      explain: `你问：${a.question}\n\n${a.answer}`,
      ifNoReply: null,
      createdAt: a.createdAt,
      snoozedUntil: null,
      options: [],
      primary: "知道了",
      source: { kind: "answer", answerId: a.id },
      issueId: null,
    });
  }

  const now = input.now ?? Date.now();
  return sortCards(cards.filter((c) => !c.snoozedUntil || Date.parse(c.snoozedUntil) <= now));
}

const ORDER: Record<CardType, number> = { decide: 0, hire: 0, deliver: 1, failed: 1, notice: 1, answer: 2 };
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => ORDER[a.type] - ORDER[b.type] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export type Filter = "all" | "decide" | "deliver" | "answer";
export function filterCards(cards: Card[], f: Filter, department: string | null): Card[] {
  return cards.filter(
    (c) =>
      (f === "all" || c.type === f || (f === "deliver" && (c.type === "failed" || c.type === "notice")) || (f === "decide" && c.type === "hire")) &&
      (!department || !c.department || c.department === department),
  );
}

export function countByType(cards: Card[]) {
  return {
    all: cards.length,
    decide: cards.filter((c) => c.type === "decide" || c.type === "hire").length,
    deliver: cards.filter((c) => c.type === "deliver" || c.type === "failed" || c.type === "notice").length,
    answer: cards.filter((c) => c.type === "answer").length,
  };
}

export interface HireRequest {
  id: string;
  leadAgentId: string;
  leadName: string;
  team: string;
  issueId: string | null;
  name: string;
  capabilities: string;
  adapterType: "claude_local" | "codex_local";
  reason: string;
  createdAt: string;
}

/** Pending hiring requests → `hire` cards in the same grid (DESIGN §4.6). */
export function hireCards(list: HireRequest[]): Card[] {
  return list.map((h) => ({
    id: `hire:${h.id}`,
    type: "hire" as const,
    tier: "high" as Tier,
    who: h.leadName,
    model: null,
    department: h.team || null,
    ref: null,
    title: `新建员工「${h.name}」`,
    explain: h.reason || null,
    ifNoReply: "不会新建，主管会继续等你决定",
    createdAt: h.createdAt,
    snoozedUntil: null,
    options: [
      { id: "approve", label: "同意并新建" },
      { id: "reject", label: "不同意" },
    ],
    primary: "同意并新建",
    source: { kind: "hire" as const, hireId: h.id, leadAgentId: h.leadAgentId, name: h.name, capabilities: h.capabilities, adapterType: h.adapterType, reason: h.reason },
    issueId: h.issueId,
  }));
}

/** "刚刚 / 5 分钟前 / 3 小时前 / 11-14" */
export function relTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Plugin notices (team-layer `notices` data): open ones become cards. */
export interface Notice {
  id: string;
  companyId: string;
  title: string;
  body?: string;
  issueId?: string | null;
  agentId?: string | null;
  createdAt: string;
  status: "open" | "handled" | "snoozed";
}

export function noticeCards(list: Notice[], agents: AgentLite[], issues: IssueLite[] = []): Card[] {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  return list
    .filter((n) => n.status === "open")
    .map((n) => {
      const agent = n.agentId ? agentById.get(n.agentId) : undefined;
      const issue = n.issueId ? issues.find((i) => i.id === n.issueId) : undefined;
      return {
        id: `notice:${n.id}`,
        type: "notice" as const,
        tier: "low" as const,
        who: agent?.name ?? "系统",
        model: modelOf(agent),
        department: null,
        ref: issue?.identifier ?? null,
        title: n.title.split(/\n/)[0].slice(0, 120),
        explain: n.body && n.body !== n.title ? n.body : null,
        ifNoReply: null,
        createdAt: n.createdAt,
        snoozedUntil: null,
        options: [{ id: "dismiss", label: "知道了" }],
        primary: "知道了",
        source: { kind: "notice" as const, noticeId: n.id, companyId: n.companyId },
        issueId: n.issueId ?? null,
      };
    });
}
