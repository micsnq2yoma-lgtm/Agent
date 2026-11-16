import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { buildPrompt, parseRoute } from "../server/frontdesk.mjs";
// @ts-expect-error plain JS module
import { animFor, eyeFor } from "../server/office.mjs";

describe("router (plan B)", () => {
  it("parses JSON routes, tolerating extra text", () => {
    expect(parseRoute('好的 {"route":"answer","answer":"明天有雨"}')).toEqual({ route: "answer", answer: "明天有雨" });
    expect(parseRoute('{"route":"task","lead":"l1","title":"t","why":"科研类"}')).toEqual({ route: "task", lead: "l1", title: "t", why: "科研类" });
  });
  it("falls back to an answer for non-JSON output or unknown routes", () => {
    expect(parseRoute("直接回答")).toEqual({ route: "answer", answer: "直接回答" });
    expect(parseRoute('{"route":"weird"}').route).toBe("answer");
  });
  it("prompt lists leads with their team, open issues, and the user's profile", () => {
    const p = buildPrompt({
      text: "今天天气",
      leads: [{ id: "l1", name: "阿研", team: "科研", description: "读论文、做实验" }],
      openIssues: [{ id: "i1", identifier: "AGE-1", title: "复现", status: "in_progress", assigneeName: "阿研" }],
      now: "2026/11/15",
      profile: "课题是蛋白质折叠",
    });
    expect(p).toContain("l1 | 阿研 | 团队：科研 | 负责：读论文、做实验");
    expect(p).toContain("AGE-1");
    expect(p).toContain("负责主管：阿研");
    expect(p).toContain("今天天气");
    expect(p).toContain("课题是蛋白质折叠");
    // The router must not rewrite the request: the lead reads the original words.
    expect(p).toContain("不要改写用户的要求");
  });
  it("prompt works with no leads and no profile", () => {
    const p = buildPrompt({ text: "x", now: "now" });
    expect(p).toContain("还没有主管");
    expect(p).not.toContain("关于用户：");
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

describe("the router sees what each team can do (PR #4 p14)", () => {
  it("a lead's description includes its employees' capabilities", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    process.env.AGENTSELF_HOME ??= path.join(os.tmpdir(), `agentself-test-${Date.now()}`);
    // @ts-expect-error plain JS module
    const { leadsOf } = await import("../server/server.mjs");
    const ctx = {
      agents: [
        { id: "L", name: "科研主管", capabilities: "理解需求、验收", status: "idle", metadata: { agentself: { isLead: true, department: "research" } } },
        { id: "E", name: "科研员", capabilities: "写代码跑实验", status: "idle", metadata: { agentself: { department: "research" } } },
        { id: "X", name: "离职员工", capabilities: "不该出现", status: "terminated", metadata: { agentself: { department: "research" } } },
      ],
      departments: [{ key: "research", name: "科研", projectId: "p", leadAgentId: "L", members: ["L", "E", "X"], description: "" }],
    };
    const [lead] = leadsOf(ctx);
    expect(lead.description).toContain("科研员（写代码跑实验）");
    expect(lead.description).not.toContain("不该出现");
  });
});
