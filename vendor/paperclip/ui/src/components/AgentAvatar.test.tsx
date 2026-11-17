// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { registerAgentAdapters } from "@/agenteam/lib/avatar";
import { AgentAvatar } from "./AgentAvatar";
import { AgentCharacter } from "./AgentCharacter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => registerAgentAdapters([]));
const drawing = (container: HTMLElement, n = 0) => decodeURIComponent(container.querySelectorAll("img")[n]?.getAttribute("src") ?? "");

it("renders the selected model in small and animated portraits without pet controls", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  const agent = { id: "coder", adapterType: "claude_local", adapterConfig: { model: "deepseek-chat" }, status: "running" };
  try {
    await act(async () => root.render(<><AgentAvatar agent={agent} /><AgentCharacter agent={agent} /></>));
    expect(drawing(container)).toContain('data-family="deepseek"');
    expect(drawing(container)).toContain('data-action="working"');
    expect(drawing(container)).not.toContain("@keyframes");
    expect(drawing(container, 1)).toContain("@keyframes");
    expect(container.querySelector("button,canvas,input")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("refreshes already mounted ID-only avatars after context hydration and model changes", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<AgentAvatar agent={{ id: "a" }} label="员工" />));
    expect(drawing(container)).toContain('data-family="other"');
    await act(async () => registerAgentAdapters([{ id: "a", adapterType: "codex_local", status: "running" }]));
    expect(drawing(container)).toContain('data-family="codex"');
    await act(async () => registerAgentAdapters([{ id: "a", adapterType: "claude_local", adapterConfig: { model: "deepseek-chat" } }]));
    expect(drawing(container)).toContain('data-family="deepseek"');
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("员工");
    await act(async () => registerAgentAdapters([]));
    expect(drawing(container)).toContain('data-family="other"');
  } finally { await act(async () => root.unmount()); }
});

it("keeps explicit still and paused portraits static, and animates an identity-free fallback", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<>
      <AgentCharacter agent={{ adapterType: "codex_local" }} state="thinking" motion="still" />
      <AgentCharacter agent={{ id: "a", adapterType: "codex_local", status: "paused" }} state="working" />
      <AgentCharacter state="thinking" />
    </>));
    expect(drawing(container)).toContain('data-family="codex"');
    expect(drawing(container)).toContain('data-action="thinking"');
    expect(drawing(container)).not.toContain("@keyframes");
    expect(drawing(container, 1)).toContain('data-action="paused"');
    expect(drawing(container, 1)).not.toContain("@keyframes");
    expect(drawing(container, 2)).toContain("@keyframes");
    expect(drawing(container, 2)).toContain("prefers-reduced-motion:reduce");
  } finally { await act(async () => root.unmount()); }
});
