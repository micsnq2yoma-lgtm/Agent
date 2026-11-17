import { describe, expect, it } from "vitest";
import { modelFamilyFor, officeAnimForStatus } from "../src/index.js";

describe("employee identity", () => {
  it.each([
    ["claude_local", "deepseek-chat", "deepseek"],
    ["claude_local", "DeepSeek-V3.2", "deepseek"],
    ["opencode_local", "openrouter/deepseek/deepseek-r1", "deepseek"],
    ["claude_local", "gpt-5.4", "codex"],
    ["http", "openai/o3-mini", "codex"],
    ["codex_local", "anthropic/claude-sonnet-4", "claude"],
    ["http", "google/gemini-3-pro", "gemini"],
    ["http", "moonshot-v1", "kimi"],
    ["http", "z-ai/glm-5", "glm"],
    ["http", "qwen3-coder", "qwen"],
    ["http", "MiniMax-M2.5", "minimax"],
    ["http", "x-ai/grok-4", "grok"],
    ["claude_local", "custom-private-model", "other"],
    ["codex_local", undefined, "codex"],
    ["gemini_local", "auto", "gemini"],
    ["kimi_local", "default", "kimi"],
    ["process", undefined, "other"],
    [undefined, undefined, "other"],
  ])("%s / %s identifies %s", (adapter, model, family) => {
    expect(modelFamilyFor(adapter, model)).toBe(family);
  });
  it("ignores malformed model configuration", () => {
    expect(modelFamilyFor("codex_local", { unexpected: true })).toBe("codex");
  });
  it.each([["running", "working"], ["error", "failed"], ["paused", "paused"], ["budget_paused", "paused"], ["terminated", "paused"], ["pending_approval", "waiting"], ["active", "idle"]])("maps observed %s to %s", (status, action) => {
    expect(officeAnimForStatus(status)).toBe(action);
  });
});
