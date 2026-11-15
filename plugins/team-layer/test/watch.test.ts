import { describe, expect, it } from "vitest";
import { afterCheck, classifyProbe, dueWatches, newWatch, wakeComment } from "../src/watch.js";

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
