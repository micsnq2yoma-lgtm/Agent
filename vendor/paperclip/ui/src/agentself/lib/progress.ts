// Task progress (DESIGN §4.8): where a top-level task stands in the four plan-B stages.
// Pure, so the workbench panel, the drawer and the lead page agree.
import type { Context, Issue } from "./api";
import type { Card } from "./cards";

export const STAGE_NAMES = ["写任务书", "员工在做", "验收", "你确认"] as const;

export interface Progress {
  /** 0 写任务书 · 1 员工在做 · 2 验收 · 3 你确认 */
  stage: 0 | 1 | 2 | 3;
  /** the current stage has a problem (rework limit reached, employee blocked) */
  bad: boolean;
  text: string;
  /** a card on this task is waiting for the user (decide / hire) */
  waiting: boolean;
  /** employee on the latest subtask */
  employeeId: string | null;
  childId: string | null;
}

/** The lead that owns a top-level task: its assignee when that is a lead, else the team's lead. */
export function leadOf(ctx: Context, top: Issue) {
  const a = ctx.agents.find((x) => x.id === top.assigneeAgentId);
  if (a?.metadata?.agentself?.isLead) return a;
  const dept = ctx.departments.find((d) => d.projectId === top.projectId);
  return ctx.agents.find((x) => x.id === dept?.leadAgentId) ?? a ?? null;
}

export function progressOf(top: Issue, issues: Issue[], cards: Card[]): Progress {
  const kids = issues.filter((i) => i.parentId === top.id && i.status !== "cancelled").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kid = kids[0] ?? null;
  const decide = cards.find((c) => (c.type === "decide" || c.type === "hire") && c.issueId != null && (c.issueId === top.id || kids.some((k) => k.id === c.issueId)));
  const base = { employeeId: kid?.assigneeAgentId ?? null, childId: kid?.id ?? null, waiting: !!decide };

  if (top.status === "in_review" || top.status === "done") return { ...base, stage: 3, bad: false, text: "待你确认" };
  if (decide && /返工/.test(decide.title)) {
    const n = decide.title.match(/(\d+)\s*次/)?.[1];
    return { ...base, stage: 2, bad: true, text: `返工 ${n ?? 2}/2 · 等你决定` };
  }
  if (!kid) return { ...base, stage: 0, bad: false, text: decide ? "等你决定" : "写任务书" };
  if (kid.status === "done" || kid.status === "in_review") return { ...base, stage: 2, bad: false, text: decide ? "等你决定" : "验收中" };
  if (kid.status === "blocked") return { ...base, stage: 1, bad: true, text: decide ? "等你决定" : "员工卡住了" };
  return { ...base, stage: 1, bad: false, text: decide ? "等你决定" : "员工在做" };
}

/** Header status of a top-level task: the progress wording wins while something is pending. */
export function statusOf(top: Issue, p: Progress | null): { text: string; tone: "" | "hot" | "good" } {
  if (top.status === "in_review") return { text: "待你确认", tone: "good" };
  if (top.status === "done") return { text: "完成", tone: "" };
  if (top.status === "cancelled") return { text: "已取消", tone: "" };
  if (top.status === "backlog") return { text: "已暂停", tone: "" };
  if (p?.waiting || p?.bad) return { text: p.text, tone: "hot" };
  return { text: p?.text ?? "进行中", tone: "" };
}

const OPEN = (i: Issue) => !i.parentId && !["done", "cancelled"].includes(i.status);

/**
 * Top-level open tasks of one lead: in the team's project, or assigned to the lead (a task the
 * lead owns can sit outside the team project, e.g. created from the full task form).
 */
export function tasksOfLead(ctx: Context, issues: Issue[], dept: Context["departments"][number]): Issue[] {
  return issues.filter((i) => OPEN(i) && ((dept.projectId && i.projectId === dept.projectId) || (dept.leadAgentId && leadOf(ctx, i)?.id === dept.leadAgentId)));
}

/** Cards that need the user and belong to a lead: by task (or its subtasks), else by hire request or team name. */
export function cardsOfLead(ctx: Context, issues: Issue[], cards: Card[], dept: Context["departments"][number]): Card[] {
  const mine = new Set<string>();
  for (const i of issues) {
    const top = i.parentId ? issues.find((x) => x.id === i.parentId) : i;
    if (!top) continue;
    if ((dept.projectId && top.projectId === dept.projectId) || (dept.leadAgentId && leadOf(ctx, top)?.id === dept.leadAgentId)) mine.add(i.id);
  }
  return cards.filter((c) => {
    if (c.type !== "decide" && c.type !== "hire") return false;
    if (c.source.kind === "hire") return c.source.leadAgentId === dept.leadAgentId;
    if (c.issueId) return mine.has(c.issueId);
    return c.department === dept.name;
  });
}
