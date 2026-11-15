import { describe, expect, it } from "vitest";
import { dropRemindersFor, dueReminders, SETTLED_STATUSES } from "../src/store.js";

const r = (issueId: string, dueAt = "2026-11-15T12:00:00Z") => ({ issueId, agentId: "a", dueAt, note: "" });

describe("reminders on settled tasks (P1 run 5)", () => {
  it("drops only the settled task's reminders", () => {
    const { kept, dropped } = dropRemindersFor([r("top"), r("other"), r("top")], ["top"]);
    expect(dropped).toHaveLength(2);
    expect(kept.map((x) => x.issueId)).toEqual(["other"]);
  });
  it("in_review, done and cancelled are settled; blocked and in_progress are not", () => {
    for (const s of ["in_review", "done", "cancelled"]) expect(SETTLED_STATUSES.has(s)).toBe(true);
    for (const s of ["blocked", "in_progress", "todo"]) expect(SETTLED_STATUSES.has(s)).toBe(false);
  });
  it("due reminders still split by time", () => {
    const { due, rest } = dueReminders([r("a", "2026-11-15T11:00:00Z"), r("b", "2026-11-15T13:00:00Z")], Date.parse("2026-11-15T12:00:00Z"));
    expect(due.map((x) => x.issueId)).toEqual(["a"]);
    expect(rest.map((x) => x.issueId)).toEqual(["b"]);
  });
});
