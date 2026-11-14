import { describe, expect, it } from "vitest";
import { addNotice, appendNotice, dueReminders } from "../src/store.js";

describe("later reminders", () => {
  it("splits due and pending reminders", () => {
    const list = [
      { issueId: "a", agentId: "x", dueAt: "2026-11-14T10:00:00Z", note: "" },
      { issueId: "b", agentId: "x", dueAt: "2026-11-14T12:00:00Z", note: "" },
    ];
    const { due, rest } = dueReminders(list, Date.parse("2026-11-14T11:00:00Z"));
    expect(due.map((r) => r.issueId)).toEqual(["a"]);
    expect(rest.map((r) => r.issueId)).toEqual(["b"]);
  });
});

describe("notices", () => {
  it("keeps newest first and caps length", () => {
    const mk = (id: string) => ({ id }) as never;
    const out = appendNotice([mk("1"), mk("2")], mk("3"), 2);
    expect(out.map((m: { id: string }) => m.id)).toEqual(["3", "1"]);
  });
  it("stores a low-tier notice in company state", async () => {
    const store = new Map<string, unknown>();
    const ctx = {
      state: {
        get: async (k: { scopeId: string; stateKey: string }) => store.get(`${k.scopeId}/${k.stateKey}`),
        set: async (k: { scopeId: string; stateKey: string }, v: unknown) => void store.set(`${k.scopeId}/${k.stateKey}`, v),
      },
    };
    const msg = await addNotice(ctx, "c1", { text: "进展：完成第一步", issueId: "i1", agentId: "a1" });
    expect(msg.tier).toBe("low");
    expect((store.get("c1/notices") as unknown[]).length).toBe(1);
  });
});
