import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { buildPrompt, parseRoute } from "../server/frontdesk.mjs";
// @ts-expect-error plain JS module
import { animFor, eyeFor } from "../server/office.mjs";

describe("front desk", () => {
  it("parses JSON routes, tolerating extra text", () => {
    expect(parseRoute('好的 {"route":"answer","answer":"明天有雨"}')).toEqual({ route: "answer", answer: "明天有雨" });
    expect(parseRoute('{"route":"task","department":"research","title":"t","description":"d"}').route).toBe("task");
  });
  it("falls back to an answer for non-JSON output or unknown routes", () => {
    expect(parseRoute("直接回答")).toEqual({ route: "answer", answer: "直接回答" });
    expect(parseRoute('{"route":"weird"}').route).toBe("answer");
  });
  it("prompt lists departments and open issues", () => {
    const p = buildPrompt({
      text: "今天天气",
      departments: [{ key: "research", name: "科研部", description: "论文" }],
      openIssues: [{ id: "i1", identifier: "AGE-1", title: "复现", status: "in_progress", departmentName: "科研部" }],
      now: "2026/11/14",
    });
    expect(p).toContain("research: 科研部");
    expect(p).toContain("AGE-1");
    expect(p).toContain("今天天气");
  });
});

describe("office state mapping (PLAN 7.1 priority)", () => {
  const base = { agent: { status: "idle" }, lastRunFailed: false, waitingCards: 0, running: false, inReview: false, justDelivered: false };
  it("follows the priority order", () => {
    expect(animFor({ ...base, agent: { status: "error" }, waitingCards: 1, running: true })).toBe("failed");
    expect(animFor({ ...base, lastRunFailed: true })).toBe("failed");
    expect(animFor({ ...base, waitingCards: 2, running: true })).toBe("waiting");
    expect(animFor({ ...base, running: true, inReview: true })).toBe("working");
    expect(animFor({ ...base, agent: { status: "running" } })).toBe("working");
    expect(animFor({ ...base, inReview: true, agent: { status: "paused" } })).toBe("delivering");
    expect(animFor({ ...base, agent: { status: "paused" } })).toBe("paused");
    expect(animFor({ ...base, justDelivered: true })).toBe("walk_to_lead");
    expect(animFor(base)).toBe("idle");
  });
  it("eye colour follows the model", () => {
    expect(eyeFor("claude_local")).toBe("claude");
    expect(eyeFor("codex_local")).toBe("codex");
    expect(eyeFor("process")).toBe("other");
  });
});
