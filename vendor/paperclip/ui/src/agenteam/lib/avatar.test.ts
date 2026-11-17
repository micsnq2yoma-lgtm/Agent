import { afterEach, expect, it, vi } from "vitest";
import { employeeRevision, registerAgentAdapters, registeredEmployee, robotAvatarUrl, subscribeEmployees } from "./avatar";

const svg = (id: string, ...args: Parameters<typeof robotAvatarUrl> extends [string, ...infer R] ? R : never) => decodeURIComponent(robotAvatarUrl(id, ...args));
afterEach(() => registerAgentAdapters([]));
it("updates hydrated identities and retains the model in partial assignee records", () => {
  expect(svg("a")).toContain('data-family="other"');
  const listener = vi.fn(); const unsubscribe = subscribeEmployees(listener);
  const record = { id: "a", adapterType: "claude_local", adapterConfig: { model: "deepseek-chat" }, status: "running" };
  registerAgentAdapters([record]);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(svg("a", false, "rest", true, { id: "a", adapterType: "claude_local" })).toContain('data-family="deepseek"');
  expect(svg("a")).toContain('data-action="working"');
  const revision = employeeRevision(); registerAgentAdapters([record]); expect(employeeRevision()).toBe(revision);
  registerAgentAdapters([{ ...record, adapterConfig: { model: "gpt-5.4" } }]);
  expect(svg("a")).toContain('data-family="codex"'); unsubscribe();
});
it("respects explicit configuration changes and a paused status over a pose", () => {
  registerAgentAdapters([{ id: "a", adapterType: "claude_local", adapterConfig: { model: "deepseek-chat" }, status: "paused" }]);
  expect(svg("a", false, "working", true)).toContain('data-action="paused"');
  expect(svg("a", false, undefined, false, { adapterConfig: null })).toContain('data-family="claude"');
});
it("removes identities and cached URLs when the company context changes", () => {
  registerAgentAdapters([{ id: "old", adapterType: "codex_local" }]);
  expect(svg("old")).toContain('data-family="codex"');
  registerAgentAdapters([{ id: "new", adapterType: "kimi_local" }]);
  expect(registeredEmployee("old")).toBeUndefined();
  expect(svg("old")).toContain('data-family="other"');
});
