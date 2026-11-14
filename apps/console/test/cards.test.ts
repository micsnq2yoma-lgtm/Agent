import { describe, expect, it } from "vitest";
import { buildCards, countByType, filterCards, type AttentionItem, type Interaction } from "../src/lib/cards";

const agents = [
  { id: "lead", name: "科研主管", adapterType: "claude_local", metadata: { agentself: { department: "research", isLead: true } } },
  { id: "emp", name: "实验员", adapterType: "codex_local", metadata: { agentself: { department: "research" } } },
];
const deptOf = (p: string | null | undefined) => (p === "proj" ? "科研部" : null);

const askItem = (id: string, issueId: string, createdBy = "emp"): AttentionItem => ({
  id: `att-${id}`,
  sourceKind: "issue_thread_interaction",
  subject: { kind: "interaction", id, metadata: { createdByAgentId: createdBy } },
  relatedIssue: { id: issueId, title: "复现论文", identifier: "AGE-9" },
  project: { id: "proj", name: "科研部" },
  createdAt: "2026-11-14T10:00:00Z",
  dismissalKey: `attention:interaction:${id}`,
  resolverAudience: { createdByAgentId: createdBy },
});

describe("workbench cards", () => {
  it("turns an ask_user_questions interaction into a decide card with options and no-reply text", () => {
    const inter: Interaction = {
      id: "i1",
      issueId: "x",
      kind: "ask_user_questions",
      status: "pending",
      payload: { questions: [{ id: "choice", prompt: "现在开始训练吗？", helpText: "会占用 GPU 6 小时。\n不回复会怎样：明早再提醒", options: [{ id: "o1", label: "开始" }, { id: "o2", label: "先别动" }] }] },
    };
    const [c] = buildCards({ attention: [askItem("i1", "x")], interactions: { i1: inter }, issues: [], agents, answers: [], departmentOfProject: deptOf });
    expect(c.type).toBe("decide");
    expect(c.tier).toBe("high");
    expect(c.who).toBe("实验员");
    expect(c.model).toBe("Codex");
    expect(c.title).toBe("现在开始训练吗？");
    expect(c.options.map((o) => o.label)).toEqual(["开始", "先别动"]);
    expect(c.ifNoReply).toBe("明早再提醒");
    expect(c.explain).toBe("会占用 GPU 6 小时。");
  });

  it("a report confirmation becomes a single delivery card (no duplicate in_review card)", () => {
    const inter: Interaction = {
      id: "i2",
      issueId: "top",
      kind: "request_confirmation",
      status: "pending",
      payload: { prompt: "验收吗？", acceptLabel: "验收通过", rejectLabel: "需要修改", target: { type: "issue_document", key: "report" } },
    };
    const cards = buildCards({
      attention: [askItem("i2", "top", "lead")],
      interactions: { i2: inter },
      issues: [{ id: "top", title: "复现论文", status: "in_review", assigneeAgentId: "lead", projectId: "proj" }],
      agents,
      answers: [],
      departmentOfProject: deptOf,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("deliver");
    expect(cards[0].primary).toBe("验收通过");
  });

  it("top-level in_review issues without a confirmation become delivery cards", () => {
    const cards = buildCards({
      attention: [],
      interactions: {},
      issues: [
        { id: "a", title: "组会 PPT", status: "in_review", assigneeAgentId: "lead", projectId: "proj" },
        { id: "b", title: "子任务", status: "in_review", parentId: "a" },
      ],
      agents,
      answers: [],
      departmentOfProject: deptOf,
    });
    expect(cards.map((c) => [c.type, c.title, c.department])).toEqual([["deliver", "组会 PPT", "科研部"]]);
  });

  it("orders decide > deliver > answer, newest first, and hides snoozed / dismissed items", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const cards = buildCards({
      attention: [
        { ...askItem("i3", "x"), createdAt: "2026-11-14T09:00:00Z" },
        { ...askItem("i4", "y"), createdAt: "2026-11-14T11:00:00Z" },
        { ...askItem("i5", "z"), snoozedUntil: "2026-11-14T15:00:00Z" },
        { ...askItem("i6", "w"), dismissal: { at: "x" } },
      ],
      interactions: {},
      issues: [{ id: "d", title: "交付", status: "in_review", projectId: "proj", updatedAt: "2026-11-14T11:30:00Z" }],
      agents,
      answers: [{ id: "a1", question: "天气", answer: "明天有雨", createdAt: "2026-11-14T11:59:00Z", status: "open" }],
      departmentOfProject: deptOf,
      now,
    });
    expect(cards.map((c) => c.id)).toEqual(["att-i4", "att-i3", "issue:d", "answer:a1"]);
    expect(countByType(cards)).toEqual({ all: 4, decide: 2, deliver: 1, answer: 1 });
    expect(filterCards(cards, "answer", null).map((c) => c.title)).toEqual(["明天有雨"]);
  });

  it("approvals and failed runs map to the right tiers", () => {
    const cards = buildCards({
      attention: [
        { id: "ap", sourceKind: "approval", subject: { id: "A1", title: "发公众号" }, createdAt: "2026-11-14T10:00:00Z" },
        { id: "fr", sourceKind: "failed_run", subject: { id: "R1", title: "运行失败" }, createdAt: "2026-11-14T10:00:00Z" },
      ],
      interactions: {},
      issues: [],
      agents,
      answers: [],
      departmentOfProject: deptOf,
    });
    expect(cards.find((c) => c.id === "ap")).toMatchObject({ type: "decide", tier: "high", primary: "批准" });
    expect(cards.find((c) => c.id === "fr")).toMatchObject({ type: "failed", tier: "medium" });
  });

  it("department filter keeps cards without a department (e.g. front-desk answers)", () => {
    const cards = buildCards({
      attention: [askItem("i7", "x")],
      interactions: {},
      issues: [],
      agents,
      answers: [{ id: "a", question: "q", answer: "a", createdAt: "2026-11-14T10:00:00Z", status: "open" }],
      departmentOfProject: deptOf,
    });
    expect(filterCards(cards, "all", "公司部").map((c) => c.type)).toEqual(["answer"]);
    expect(filterCards(cards, "all", "科研部")).toHaveLength(2);
  });
});
