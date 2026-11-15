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
  const base = { employeeId: kid?.assigneeAgentId ?? null, childId: kid?.id ?? null };
  const decide = cards.find((c) => (c.type === "decide" || c.type === "hire") && c.issueId === top.id);

  if (top.status === "in_review" || top.status === "done") return { ...base, stage: 3, bad: false, text: "待你确认" };
  if (decide && /返工/.test(decide.title)) {
    const n = decide.title.match(/(\d+)\s*次/)?.[1];
    return { ...base, stage: 2, bad: true, text: `返工 ${n ?? 2}/2 · 等你决定` };
  }
  if (!kid) return { ...base, stage: 0, bad: false, text: decide ? "等你决定" : "写任务书" };
  if (kid.status === "done" || kid.status === "in_review") return { ...base, stage: 2, bad: false, text: "验收中" };
  if (kid.status === "blocked") return { ...base, stage: 1, bad: true, text: decide ? "等你决定" : "员工卡住了" };
  return { ...base, stage: 1, bad: false, text: decide ? "等你决定" : "员工在做" };
}
