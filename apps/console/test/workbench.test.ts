// SETO workbench logic (docs/handoff/design/DESIGN.md §4.7–4.9): stages and acceptance documents.
import { describe, expect, it } from "vitest";
import { cardsOfLead, progressOf, statusOf, tasksOfLead } from "../../../vendor/paperclip/ui/src/agentself/lib/progress";
import { cronText } from "../../../vendor/paperclip/ui/src/agentself/lib/cron";
import { parseAcceptance } from "../../../vendor/paperclip/ui/src/agentself/lib/acceptance-parse";
import { criteriaMarkdown, evidenceMarkdown, verificationMarkdown } from "../../../plugins/team-layer/src/acceptance";

const issue = (o: Record<string, unknown>) => ({ id: "x", identifier: null, title: "t", status: "todo", parentId: null, projectId: "p", assigneeAgentId: "lead", createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z", ...o }) as never;
const top = issue({ id: "top", status: "blocked" });

describe("stages (§4.8)", () => {
  it("写任务书 until the lead delegates", () => {
    expect(progressOf(issue({ id: "top", status: "todo" }), [], [])).toMatchObject({ stage: 0, bad: false, text: "写任务书" });
  });
  it("员工在做 while the child runs, 验收 once it is done", () => {
    const kid = issue({ id: "k", parentId: "top", status: "in_progress", assigneeAgentId: "emp" });
    expect(progressOf(top, [top, kid], [])).toMatchObject({ stage: 1, text: "员工在做", employeeId: "emp" });
    const done = issue({ id: "k", parentId: "top", status: "done", assigneeAgentId: "emp" });
    expect(progressOf(top, [top, done], [])).toMatchObject({ stage: 2, text: "验收中" });
  });
  it("red at 验收 when the rework limit asks the user", () => {
    const kid = issue({ id: "k", parentId: "top", status: "blocked", assigneeAgentId: "emp" });
    const card = { type: "decide", issueId: "top", title: "「复现」已返工 2 次" } as never;
    expect(progressOf(top, [top, kid], [card])).toMatchObject({ stage: 2, bad: true, text: "返工 2/2 · 等你决定" });
  });
  it("你确认 when the parent is in review; cancelled children are ignored", () => {
    expect(progressOf(issue({ id: "top", status: "in_review" }), [], [])).toMatchObject({ stage: 3, text: "待你确认" });
    const old = issue({ id: "k0", parentId: "top", status: "cancelled", createdAt: "2026-11-15T11:00:00Z" });
    const cur = issue({ id: "k1", parentId: "top", status: "in_progress" });
    expect(progressOf(top, [top, old, cur], []).childId).toBe("k1");
  });
});

describe("one status everywhere (PR #3 review: AGE-129)", () => {
  // a task waiting for the user's answer while its employee's subtask runs
  const t129 = issue({ id: "t129", status: "in_progress", projectId: "other", assigneeAgentId: "lead" });
  const kid = issue({ id: "k129", parentId: "t129", status: "in_progress", assigneeAgentId: "emp" });
  const ask = { type: "decide", issueId: "t129", title: "要不要换数据集？", department: "某个项目名", source: { kind: "interaction" } } as never;
  const ctx = {
    agents: [
      { id: "lead", name: "科研主管", metadata: { agentself: { isLead: true, department: "research" } } },
      { id: "emp", name: "小码", metadata: { agentself: { department: "research" } } },
    ],
    departments: [{ key: "research", name: "科研", projectId: "p-research", leadAgentId: "lead", members: ["lead", "emp"] }],
  } as never;
  const dept = (ctx as { departments: never[] }).departments[0];

  it("drawer header says 等你决定 like the progress panel", () => {
    const p = progressOf(t129, [t129, kid], [ask]);
    expect(p).toMatchObject({ stage: 1, waiting: true, text: "等你决定" });
    expect(statusOf(t129, p)).toEqual({ text: "等你决定", tone: "hot" });
    expect(statusOf(t129, progressOf(t129, [t129, kid], []))).toEqual({ text: "员工在做", tone: "" });
    expect(statusOf(issue({ status: "in_review" }), null)).toEqual({ text: "待你确认", tone: "good" });
  });
  it("an ask on the employee's subtask counts for the parent", () => {
    const onKid = { ...(ask as object), issueId: "k129" } as never;
    expect(progressOf(t129, [t129, kid], [onKid]).waiting).toBe(true);
  });
  it("lead page counts a task the lead owns outside the team project, and its ask card", () => {
    expect(tasksOfLead(ctx, [t129, kid], dept).map((i: { id: string }) => i.id)).toEqual(["t129"]);
    expect(cardsOfLead(ctx, [t129, kid], [ask], dept)).toHaveLength(1);
  });
  it("hire cards go to the lead who asked; other teams' tasks do not count", () => {
    const hire = { type: "hire", issueId: null, title: "新建员工", department: "x", source: { kind: "hire", leadAgentId: "lead" } } as never;
    const foreign = issue({ id: "f", status: "todo", projectId: "p-life", assigneeAgentId: "someone" });
    const foreignAsk = { type: "decide", issueId: "f", title: "?", department: null, source: { kind: "interaction" } } as never;
    expect(cardsOfLead(ctx, [t129, foreign], [hire, foreignAsk], dept)).toEqual([hire]);
    expect(tasksOfLead(ctx, [foreign], dept)).toEqual([]);
  });
});

describe("cron in words (PR #3 review: 盯守 time)", () => {
  it("reads the schedules the UI offers", () => {
    expect(cronText("30 8 * * *")).toBe("每天 08:30");
    expect(cronText("0 9 * * 1-5")).toBe("工作日 09:00");
    expect(cronText("0 9 * * 1")).toBe("每周一 09:00");
    expect(cronText("*/15 * * * *")).toBe("每 15 分钟");
    expect(cronText("0 */4 * * *")).toBe("每 4 小时");
    expect(cronText("0 9 1 * *")).toBe("每月 1 日 09:00");
  });
  it("leaves anything else as written", () => {
    expect(cronText("0 9 * 1 *")).toBe("0 9 * 1 *");
    expect(cronText("@daily")).toBe("@daily");
  });
});

describe("acceptance documents (§4.7 / §4.9)", () => {
  it("reads exactly what the plugin writes", () => {
    const criteria = [
      { id: "c1", text: "复现主结果", evidence: "指标表" },
      { id: "c2", text: "给出结论", evidence: "" },
    ];
    const a = parseAcceptance({
      criteria: criteriaMarkdown(criteria),
      evidence: evidenceMarkdown(criteria, [{ criterionId: "c1", evidence: "results/table.md：误差 1.3%", missing: false }], [{ criterionId: "c2", kind: "invalid_criterion", reason: "需要用户数据" }]),
      verification: verificationMarkdown(
        criteria,
        [
          { criterionId: "c1", verdict: "passed", reason: "误差在范围内", suggestion: "" },
          { criterionId: "c2", verdict: "uncertain", reason: "没有证据", suggestion: "补结论" },
        ],
        "sonnet",
      ),
    });
    expect(a.model).toBe("sonnet");
    expect(a.passed).toBe(1);
    expect(a.rows[0]).toMatchObject({ id: "c1", text: "复现主结果", wanted: "指标表", evidence: "results/table.md：误差 1.3%", verdict: "passed", reason: "误差在范围内" });
    expect(a.rows[1]).toMatchObject({ id: "c2", evidence: null, dispute: "需要用户数据", verdict: "uncertain" });
  });
  it("criteria alone: not yet verified", () => {
    const a = parseAcceptance({ criteria: "# 验收标准\n\n- **c1** 只有标准\n" });
    expect(a.rows).toEqual([{ id: "c1", text: "只有标准", wanted: "", evidence: null, dispute: null, verdict: null, reason: null }]);
    expect(a.model).toBeNull();
  });
});
