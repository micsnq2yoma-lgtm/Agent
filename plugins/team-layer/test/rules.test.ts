import { describe, expect, it } from "vitest";
import {
  applyRework,
  checkHop,
  gateOpen,
  issueDepth,
  kindFromAttention,
  shouldWakeLeadForGate,
  sortFeed,
  tierOf,
} from "../src/rules/index.js";

describe("Studio gate", () => {
  it("opens only when all children are done or cancelled", () => {
    expect(gateOpen([{ status: "done" }, { status: "in_progress" }])).toBe(false);
    expect(gateOpen([{ status: "done" }, { status: "cancelled" }])).toBe(true);
    expect(gateOpen([])).toBe(false);
  });
  it("wakes once when two children finish together", () => {
    const children = [
      { status: "done" as const, updatedAt: "2026-11-14T10:00:00.000Z" },
      { status: "done" as const, updatedAt: "2026-11-14T10:00:00.100Z" },
    ];
    expect(shouldWakeLeadForGate({ children, lastGateWakeAt: null })).toBe(true);
    expect(shouldWakeLeadForGate({ children, lastGateWakeAt: "2026-11-14T10:00:01.000Z" })).toBe(false);
  });
  it("wakes again only if a child changed after the last gate wake", () => {
    const children = [
      { status: "done" as const, updatedAt: "2026-11-14T10:05:00.000Z" },
      { status: "done" as const, updatedAt: "2026-11-14T10:00:00.000Z" },
    ];
    expect(shouldWakeLeadForGate({ children, lastGateWakeAt: "2026-11-14T10:01:00.000Z" })).toBe(true);
  });
  it("does not wake while a child is still open", () => {
    expect(
      shouldWakeLeadForGate({
        children: [
          { status: "done", updatedAt: "2026-11-14T10:00:00.000Z" },
          { status: "todo", updatedAt: "2026-11-14T10:00:00.000Z" },
        ],
        lastGateWakeAt: null,
      }),
    ).toBe(false);
  });
});

describe("rework counting", () => {
  const base = { actorAgentId: "lead", assigneeAgentId: "emp", count: 0 } as const;
  it("counts in_review -> in_progress by the lead", () => {
    const r = applyRework({ ...base, prevStatus: "in_review", nextStatus: "in_progress" });
    expect(r).toEqual({ count: 1, isRework: true, escalate: false });
  });
  it("counts done -> todo", () => {
    expect(applyRework({ ...base, prevStatus: "done", nextStatus: "todo" }).isRework).toBe(true);
  });
  it("ignores the assignee moving its own task", () => {
    const r = applyRework({ ...base, actorAgentId: "emp", prevStatus: "in_review", nextStatus: "in_progress" });
    expect(r.isRework).toBe(false);
    expect(r.count).toBe(0);
  });
  it("ignores forward transitions", () => {
    expect(applyRework({ ...base, prevStatus: "todo", nextStatus: "in_progress" }).isRework).toBe(false);
  });
  it("escalates on the 2nd rework (plan B: send back once, then ask the user)", () => {
    let count = 0;
    const results = [1, 2].map(() => {
      const r = applyRework({ ...base, count, prevStatus: "in_review", nextStatus: "in_progress" });
      count = r.count;
      return r.escalate;
    });
    expect(results).toEqual([false, true]);
  });
  it("respects a custom limit", () => {
    expect(applyRework({ ...base, count: 0, limit: 1, prevStatus: "done", nextStatus: "in_progress" }).escalate).toBe(true);
  });
});

describe("hop limit", () => {
  const chain = (n: number) => {
    // i1 <- i2 <- ... <- in  (i1 is top-level)
    const parent: Record<string, string | null> = { i1: null };
    for (let i = 2; i <= n; i++) parent[`i${i}`] = `i${i - 1}`;
    return (id: string) => parent[id];
  };
  it("computes depth with top-level = 1", () => {
    expect(issueDepth("i1", chain(1))).toBe(1);
    expect(issueDepth("i9", chain(9))).toBe(9);
  });
  it("survives cycles", () => {
    const p: Record<string, string> = { a: "b", b: "a" };
    expect(issueDepth("a", (id) => p[id])).toBe(2);
  });
  it("allows depth 8 and blocks depth 9", () => {
    expect(checkHop({ depth: 8, runCreations: [], now: 0 }).block).toBe(false);
    const v = checkHop({ depth: 9, runCreations: [], now: 0 });
    expect(v.block && v.reason).toBe("depth");
  });
  it("blocks more than 20 creations by one run within 10 minutes", () => {
    const now = 10 * 60 * 1000;
    const ok = Array.from({ length: 20 }, (_, i) => now - i * 1000);
    expect(checkHop({ depth: 2, runCreations: ok, now }).block).toBe(false);
    const v = checkHop({ depth: 2, runCreations: [...ok, now], now });
    expect(v.block && v.reason).toBe("burst");
  });
  it("ignores creations older than the window", () => {
    const now = 60 * 60 * 1000;
    const old = Array.from({ length: 50 }, () => 0);
    expect(checkHop({ depth: 2, runCreations: [...old, now], now }).block).toBe(false);
  });
  it("supports configurable thresholds", () => {
    expect(checkHop({ depth: 4, runCreations: [], now: 0, maxDepth: 3 }).block).toBe(true);
    expect(checkHop({ depth: 1, runCreations: [0, 0, 0], now: 0, burst: { max: 2, windowMs: 1000 } }).block).toBe(true);
  });
});

describe("three-tier classification (PLAN 4.3)", () => {
  it("high: decisions, approvals, questions, budget, rework limit, hop limit", () => {
    for (const k of ["decision", "approval", "agent_question", "budget_alert", "rework_limit", "hop_limit"] as const) {
      expect(tierOf(k)).toBe("high");
    }
  });
  it("medium: lead reports and run failures", () => {
    expect(tierOf("lead_report")).toBe("medium");
    expect(tierOf("run_failed")).toBe("medium");
  });
  it("low: front-desk answers, progress, routine completions", () => {
    for (const k of ["frontdesk_answer", "task_progress", "routine_done", "memory_suggestion"] as const) {
      expect(tierOf(k)).toBe("low");
    }
  });
  it("maps attention items", () => {
    expect(kindFromAttention({ kind: "decision" })).toBe("decision");
    expect(kindFromAttention({ type: "approval_pending" })).toBe("approval");
    expect(kindFromAttention({ kind: "issue_interaction", reason: "ask_user_questions" })).toBe("agent_question");
    expect(kindFromAttention({ kind: "issue", reason: "in_review" })).toBe("lead_report");
    expect(kindFromAttention({ kind: "run", status: "x", reason: "run_failed" })).toBe("run_failed");
    expect(kindFromAttention({ kind: "something" })).toBe("task_progress");
  });
  it("sorts high first then newest first", () => {
    const sorted = sortFeed([
      { id: "a", tier: "low" as const, createdAt: "2026-11-14T12:00:00Z" },
      { id: "b", tier: "high" as const, createdAt: "2026-11-14T09:00:00Z" },
      { id: "c", tier: "high" as const, createdAt: "2026-11-14T10:00:00Z" },
      { id: "d", tier: "medium" as const, createdAt: "2026-11-14T11:00:00Z" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
  });
});
