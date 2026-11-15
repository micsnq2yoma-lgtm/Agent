import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { buildPrompt, parseRoute } from "../server/frontdesk.mjs";
// @ts-expect-error plain JS module
import { animFor, eyeFor } from "../server/office.mjs";

describe("front desk", () => {
  it("parses JSON routes, tolerating extra text", () => {
    expect(parseRoute('好的 {"route":"answer","answer":"明天有雨"}')).toEqual({ route: "answer", answer: "明天有雨" });
  });
  it("a task plans first unless the steward explicitly says direct", () => {
    expect(parseRoute('{"route":"task","employee":"e1","title":"t","description":"d"}').mode).toBe("plan");
    expect(parseRoute('{"route":"task","employee":"e1","mode":"weird","title":"t"}').mode).toBe("plan");
    expect(parseRoute('{"route":"task","employee":"e1","mode":"direct","title":"t"}').mode).toBe("direct");
  });
  it("falls back to an answer for non-JSON output or unknown routes", () => {
    expect(parseRoute("直接回答")).toEqual({ route: "answer", answer: "直接回答" });
    expect(parseRoute('{"route":"weird"}').route).toBe("answer");
  });
  it("prompt lists employees with their category, open issues, and the user's notes", () => {
    const p = buildPrompt({
      text: "今天天气",
      employees: [{ id: "e1", name: "小研", category: "科研", capabilities: "读论文、跑实验" }],
      openIssues: [{ id: "i1", identifier: "AGE-1", title: "复现", status: "in_progress", assigneeName: "小研" }],
      now: "2026/11/14",
      profile: "课题是蛋白质折叠",
      rules: "生活类的事一律直接开工",
    });
    expect(p).toContain("e1 | 小研 | 分类：科研");
    expect(p).toContain("AGE-1");
    expect(p).toContain("今天天气");
    expect(p).toContain("课题是蛋白质折叠");
    expect(p).toContain("生活类的事一律直接开工");
  });
  it("prompt works with no employees and no notes", () => {
    const p = buildPrompt({ text: "x", now: "now" });
    expect(p).toContain("还没有员工");
    expect(p).not.toContain("关于用户（必须参考）");
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
