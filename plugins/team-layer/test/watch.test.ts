import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { rewriteLegacyPaths } from "../../../scripts/lib/legacy.mjs";
import { afterCheck, classifyProbe, dueWatches, newWatch, wakeComment, watchesFor } from "../src/watch.js";

const t0 = Date.parse("2026-11-15T10:00:00Z");
const ctx = { companyId: "c", agentId: "a", cwd: "/w", now: t0, id: "w1" };

describe("watch", () => {
  it("clamps the interval and the lifetime", () => {
    const w = newWatch({ issueId: "i", command: "check.sh", everyMinutes: 0.5, maxHours: 500 }, ctx);
    expect(w.everyMinutes).toBe(2);
    expect(Date.parse(w.expiresAt) - t0).toBe(72 * 3600_000);
    expect(Date.parse(w.nextAt) - t0).toBe(2 * 60_000);
    expect(newWatch({ issueId: "i", command: "x" }, ctx).everyMinutes).toBe(10);
    expect(() => newWatch({ issueId: "i" }, ctx)).toThrow(/command/);
  });
  it("probe contract: 0 finished, 1 running, else error", () => {
    expect(classifyProbe({ code: 0 })).toBe("finished");
    expect(classifyProbe({ code: 1 })).toBe("running");
    expect(classifyProbe({ code: 2 })).toBe("error");
    expect(classifyProbe({ code: 0, timedOut: true })).toBe("error");
    expect(classifyProbe({ code: null, spawnError: "ENOENT" })).toBe("error");
  });
  it("keeps running watches, wakes on finish / error / expiry", () => {
    const w = newWatch({ issueId: "i", command: "x", everyMinutes: 5, maxHours: 1 }, ctx);
    expect(dueWatches([w], t0)).toHaveLength(0);
    expect(dueWatches([w], t0 + 5 * 60_000)).toHaveLength(1);
    const r = afterCheck(w, "running", t0 + 5 * 60_000);
    expect(r.wake).toBeNull();
    expect(r.keep!.checks).toBe(1);
    expect(Date.parse(r.keep!.nextAt)).toBe(t0 + 10 * 60_000);
    expect(afterCheck(w, "finished", t0).wake).toBe("finished");
    expect(afterCheck(w, "error", t0).wake).toBe("error");
    expect(afterCheck(w, "running", t0 + 2 * 3600_000)).toEqual({ keep: null, wake: "expired" });
  });
  it("wake comment carries the output tail", () => {
    const w = newWatch({ issueId: "i", command: "check.sh", note: "训练 v2" }, ctx);
    const c = wakeComment(w, "finished", "a".repeat(3000) + "END");
    expect(c).toContain("看守已结束：训练 v2");
    expect(c).toContain("END");
    expect(c.length).toBeLessThan(2000);
  });
});

describe("watchesFor (project drawer)", () => {
  it("only the task family's watches and reminders, soonest first, command trimmed", () => {
    const a = newWatch({ issueId: "kid", command: "x".repeat(400), everyMinutes: 30 }, { ...ctx, id: "wa" });
    const b = newWatch({ issueId: "kid", command: "probe.sh", everyMinutes: 5 }, { ...ctx, id: "wb" });
    const other = newWatch({ issueId: "elsewhere", command: "probe.sh" }, { ...ctx, id: "wc" });
    const rem = [
      { issueId: "lead", agentId: "L", dueAt: "2026-11-15T12:00:00Z", note: "看看进度" },
      { issueId: "elsewhere", agentId: "L", dueAt: "2026-11-15T11:00:00Z", note: "" },
    ];
    const v = watchesFor([a, b, other], rem, ["lead", "kid"]);
    expect(v.watches.map((w) => w.id)).toEqual(["wb", "wa"]);
    expect(v.watches[1].command).toHaveLength(300);
    expect(v.reminders).toEqual([{ issueId: "lead", agentId: "L", dueAt: "2026-11-15T12:00:00Z", note: "看看进度" }]);
  });
  it("a watch registered before the rename follows the data folder: its folder and command, nothing else", () => {
    const w = newWatch({ issueId: "i", command: "node /h/.agentself/workspaces/x/check.mjs" }, { ...ctx, cwd: "/h/.agentself/workspaces/x" });
    const moved = rewriteLegacyPaths(w, "/h/.agentself", "/h/.agenteam");
    expect(moved).toMatchObject({ cwd: "/h/.agenteam/workspaces/x", command: "node /h/.agenteam/workspaces/x/check.mjs", id: w.id, issueId: "i" });
    expect(rewriteLegacyPaths(moved, "/h/.agentself", "/h/.agenteam")).toBeNull();
    expect(rewriteLegacyPaths(newWatch({ issueId: "i", command: "x" }, { ...ctx, cwd: "/srv/w" }), "/h/.agentself", "/h/.agenteam")).toBeNull();
  });
});
