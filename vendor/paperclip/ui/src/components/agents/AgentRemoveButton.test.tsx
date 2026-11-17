// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { AgentRemoveButton } from "./AgentRemoveButton";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";

let root: Root;
const screen = {
  queryByRole: (role: string) => document.querySelector(`[role="${role}"]`),
  getByRole: (role: string, options?: { name: string }) => {
    const element = role === "button" ? [...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === options?.name) : document.querySelector(`[role="${role}"]`);
    if (!element) throw new Error(`Missing ${role}: ${options?.name ?? ""}`);
    return element as HTMLElement;
  },
};
const click = async (element: HTMLElement) => act(async () => element.click());
const waitFor = vi.waitFor;

vi.mock("@/api/agents", () => ({ agentsApi: { terminate: vi.fn() } }));
const employees = ["甲", "乙"].map((name, i) => ({ id: `agent-${i}`, companyId: "company-test", name, status: "paused" } as Agent));
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); });
async function setup(agents = employees) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.agents.list("company-test"), employees);
  const removed = vi.fn();
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><AgentRemoveButton companyId="company-test" agents={agents} onRemoved={removed} /></QueryClientProvider>));
  return { client, removed };
}
describe("employee removal", () => {
  it("requires confirmation and cancelling leaves employees untouched", async () => {
    await setup([employees[0]]);
    await click(screen.getByRole("button", { name: "移除 甲" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("历史任务和记录保留");
    await click(screen.getByRole("button", { name: "取消" }));
    expect(agentsApi.terminate).not.toHaveBeenCalled();
  });
  it("scopes removal to the company, then updates the roster cache", async () => {
    vi.mocked(agentsApi.terminate).mockResolvedValue({ ...employees[0], status: "terminated" });
    const { client, removed } = await setup([employees[0]]);
    await click(screen.getByRole("button", { name: "移除 甲" }));
    await click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(removed).toHaveBeenCalledWith(["agent-0"]));
    expect(agentsApi.terminate).toHaveBeenCalledWith("agent-0", "company-test");
    expect(client.getQueryData<Agent[]>(queryKeys.agents.list("company-test"))?.[0].status).toBe("terminated");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("keeps failures visible and retries only failed employees", async () => {
    vi.mocked(agentsApi.terminate).mockImplementation(async (id) => {
      if (id === "agent-1") throw new Error("仍有待处理审批");
      return { ...employees[0], status: "terminated" };
    });
    const { removed } = await setup();
    await click(screen.getByRole("button", { name: "移除所选员工" }));
    await click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("乙：仍有待处理审批"));
    expect(removed).toHaveBeenCalledWith(["agent-0"]);
    vi.mocked(agentsApi.terminate).mockResolvedValue({ ...employees[1], status: "terminated" });
    await click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(vi.mocked(agentsApi.terminate).mock.calls.map(([id]) => id)).toEqual(["agent-0", "agent-1", "agent-1"]);
  });
});
