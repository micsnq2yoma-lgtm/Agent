import { expect, it } from "vitest";
import { buildOfficeSnapshot, eyeFor } from "../server/office.mjs";

it("identifies a compatible endpoint by the selected model", () => {
  expect(eyeFor("claude_local", "deepseek-chat")).toBe("deepseek");
  expect(eyeFor("codex_local")).toBe("codex");
  expect(eyeFor("http", { malformed: true })).toBe("other");
});
it("preserves the observed task and state in the office snapshot", async () => {
  const title = "核对本周交付报告中的全部证据，并整理未完成的检查项目供主管确认";
  const ctx = { company: { id: "company" }, departments: [{ key: "dev", name: "研发" }], agents: [
    { id: "a", name: "小鲸", status: "running", adapterType: "claude_local", adapterConfig: { model: "deepseek-chat" }, metadata: { agentself: { department: "dev" } } },
  ] };
  const snapshot = await buildOfficeSnapshot(ctx, async (_method: string, url: string) => url.endsWith("/issues") ? [{ id: "task", assigneeAgentId: "a", status: "in_progress", title }] : []);
  expect(snapshot.people[0]).toMatchObject({ eye: "deepseek", anim: "working", bubble: title, currentIssueId: "task" });
});
