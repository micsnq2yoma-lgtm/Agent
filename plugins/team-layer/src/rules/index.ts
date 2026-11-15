// Team-layer rules (PLAN 4.2, 4.3, 4.5). Pure functions — no I/O — so they can be unit-tested.
import type { MessageKind, Tier } from "@agentself/shared";

/* ------------------------------------------------------------------ */
/* Studio gate                                                         */
/* ------------------------------------------------------------------ */

export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";

/** Children count as finished when done or cancelled. */
export function gateOpen(children: Array<{ status: IssueStatus }>): boolean {
  return children.length > 0 && children.every((c) => c.status === "done" || c.status === "cancelled");
}

/**
 * Decide whether the lead should be woken for a parent when a child finishes.
 * Paperclip already wakes once natively (issue_children_completed); this is a guard used
 * by the plugin to avoid sending a second wake if several completions race.
 * `lastGateWakeAt` is the time the plugin last saw a gate wake for this parent.
 */
export function shouldWakeLeadForGate(input: {
  children: Array<{ status: IssueStatus; updatedAt: string }>;
  lastGateWakeAt: string | null;
}): boolean {
  if (!gateOpen(input.children)) return false;
  if (!input.lastGateWakeAt) return true;
  const latestChange = Math.max(...input.children.map((c) => Date.parse(c.updatedAt)));
  // Only wake again if some child changed after the previous gate wake (e.g. reopened then done).
  return latestChange > Date.parse(input.lastGateWakeAt);
}

/* ------------------------------------------------------------------ */
/* Rework counting                                                     */
/* ------------------------------------------------------------------ */

// Plan B: the lead sends a delivery back once; the second send-back asks the user.
export const DEFAULT_REWORK_LIMIT = 2;

export interface ReworkResult {
  count: number;
  /** true when this transition is a rework (sent back for more work). */
  isRework: boolean;
  /** true when the limit is reached: stop auto rework and raise an ask card. */
  escalate: boolean;
}

/**
 * A rework is a transition from in_review/done back to in_progress/todo made by someone
 * other than the assignee (normally the lead).
 */
export function applyRework(input: {
  prevStatus: IssueStatus;
  nextStatus: IssueStatus;
  actorAgentId: string | null;
  assigneeAgentId: string | null;
  count: number;
  limit?: number;
}): ReworkResult {
  const limit = input.limit ?? DEFAULT_REWORK_LIMIT;
  const wasDelivered = input.prevStatus === "in_review" || input.prevStatus === "done";
  const sentBack = input.nextStatus === "in_progress" || input.nextStatus === "todo";
  const byOther = input.actorAgentId == null || input.actorAgentId !== input.assigneeAgentId;
  const isRework = wasDelivered && sentBack && byOther;
  const count = isRework ? input.count + 1 : input.count;
  return { count, isRework, escalate: isRework && count >= limit };
}

/* ------------------------------------------------------------------ */
/* Hop limit                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_BURST = { max: 20, windowMs: 10 * 60 * 1000 };

/** Depth of an issue: top-level = 1. Guards against cycles. */
export function issueDepth(issueId: string, parentOf: (id: string) => string | null | undefined): number {
  let depth = 1;
  const seen = new Set<string>([issueId]);
  let cur = parentOf(issueId);
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    depth++;
    cur = parentOf(cur);
  }
  return depth;
}

export type HopVerdict = { block: false } | { block: true; reason: "depth" | "burst"; detail: string };

export function checkHop(input: {
  depth: number;
  /** creation timestamps (ms) of issues created by the same run, including this one */
  runCreations: number[];
  now: number;
  maxDepth?: number;
  burst?: { max: number; windowMs: number };
}): HopVerdict {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const burst = input.burst ?? DEFAULT_BURST;
  if (input.depth > maxDepth) {
    return { block: true, reason: "depth", detail: `子任务层级 ${input.depth} 超过上限 ${maxDepth}` };
  }
  const recent = input.runCreations.filter((t) => input.now - t <= burst.windowMs).length;
  if (recent > burst.max) {
    return { block: true, reason: "burst", detail: `同一运行 ${burst.windowMs / 60000} 分钟内创建 ${recent} 个任务，超过 ${burst.max}` };
  }
  return { block: false };
}

/* ------------------------------------------------------------------ */
/* Three-tier classification                                           */
/* ------------------------------------------------------------------ */

const TIER_TABLE: Record<MessageKind, Tier> = {
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
  memory_suggestion: "low",
};

export function tierOf(kind: MessageKind): Tier {
  return TIER_TABLE[kind];
}

/** Map a Paperclip attention item to our message kind. Unknown items fall back to medium-ish "run_failed" only if failing, else task_progress. */
export function kindFromAttention(item: { kind?: string; type?: string; sourceType?: string; status?: string; reason?: string }): MessageKind {
  const k = `${item.kind ?? ""} ${item.type ?? ""} ${item.sourceType ?? ""} ${item.reason ?? ""}`.toLowerCase();
  if (k.includes("decision")) return "decision";
  if (k.includes("approval")) return "approval";
  if (k.includes("question") || k.includes("interaction") || k.includes("ask_user")) return "agent_question";
  if (k.includes("budget")) return "budget_alert";
  if (k.includes("review")) return "lead_report";
  if (k.includes("fail") || k.includes("error")) return "run_failed";
  return "task_progress";
}

const TIER_ORDER: Record<Tier, number> = { high: 0, medium: 1, low: 2 };

/** Feed order: high first, then newest first. */
export function sortFeed<T extends { tier: Tier; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/* Duplicate event delivery                                            */
const recentTransitions = new Map<string, number>();
const seenEventIds = new Set<string>();
export function isDuplicateTransition(eventId: string | undefined, issueId: string, payload: Record<string, unknown>, now = Date.now()): boolean {
  if (eventId) {
    if (seenEventIds.has(eventId)) return true;
    seenEventIds.add(eventId);
    if (seenEventIds.size > 2000) seenEventIds.clear();
  }
  const prev = (payload._previous as { status?: string } | undefined)?.status;
  const next = payload.status as string | undefined;
  if (!prev || !next || prev === next) return false;
  const k = `${issueId}:${prev}>${next}`;
  const last = recentTransitions.get(k);
  recentTransitions.set(k, now);
  if (recentTransitions.size > 2000) recentTransitions.clear();
  return last !== undefined && now - last < 1000;
}
