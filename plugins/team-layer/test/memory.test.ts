import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  appendRunLog,
  capNotes,
  consolidate,
  consolidationPrompt,
  logLine,
  parseConsolidation,
  redactSecrets,
  shouldConsolidate,
  todayLog,
  weeklyArchive,
} from "../src/memory-jobs.js";

function tmpMem() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentself-mem-"));
  const mem = path.join(dir, "memory");
  fs.mkdirSync(path.join(mem, "log"), { recursive: true });
  fs.mkdirSync(path.join(mem, "topics"), { recursive: true });
  fs.writeFileSync(path.join(mem, "identity.md"), "# 文献员\n");
  fs.writeFileSync(path.join(mem, "style.md"), "# 工作方式\n");
  fs.writeFileSync(path.join(mem, "notes.md"), "# 经验与事实\n\n- 旧经验\n");
  fs.writeFileSync(path.join(mem, "user.md"), "# 关于用户\n");
  return mem;
}

describe("memory: when to consolidate", () => {
  const now = 10 * 3600_000;
  it("waits until the agent has been idle for 30 minutes", () => {
    expect(shouldConsolidate({ lastRunAt: now - 10 * 60_000, lastConsolidatedAt: null, lastLogWriteAt: now - 10 * 60_000, now })).toBe(false);
    expect(shouldConsolidate({ lastRunAt: now - 31 * 60_000, lastConsolidatedAt: null, lastLogWriteAt: now - 31 * 60_000, now })).toBe(true);
  });
  it("only runs when there is new log since the last consolidation", () => {
    expect(shouldConsolidate({ lastRunAt: now - 3600_000, lastConsolidatedAt: now - 1800_000, lastLogWriteAt: now - 3600_000, now })).toBe(false);
    expect(shouldConsolidate({ lastRunAt: null, lastConsolidatedAt: null, lastLogWriteAt: null, now })).toBe(false);
  });
  it("idle threshold is configurable", () => {
    expect(shouldConsolidate({ lastRunAt: now - 2 * 60_000, lastConsolidatedAt: null, lastLogWriteAt: now - 2 * 60_000, now, idleMinutes: 1 })).toBe(true);
  });
});

describe("memory: text helpers", () => {
  it("formats a log line", () => {
    const l = logLine({ at: new Date(2026, 10, 14, 9, 5), issue: "AGE-4", title: "写说明", status: "完成一轮", costUsd: 0.1234 });
    expect(l).toBe("- 09:05 AGE-4 写说明 — 完成一轮 · $0.123");
  });
  it("parses model output and rejects junk", () => {
    expect(parseConsolidation('x {"notes":"n","user":"u","suggestions":["s"]} y')).toEqual({ notes: "n", user: "u", suggestions: ["s"], profileProposals: [] });
    // Global "about me" changes are only proposed; the user confirms them in Settings.
    expect(parseConsolidation('{"notes":"n","user":"u","profileProposals":["偏好表格", " "]}')?.profileProposals).toEqual(["偏好表格"]);
    expect(parseConsolidation("no json")).toBeNull();
    expect(parseConsolidation('{"notes":1}')).toBeNull();
  });
  it("caps notes by dropping the oldest bullets", () => {
    const text = ["# 经验", "", ...Array.from({ length: 50 }, (_, i) => `- 经验 ${i} ${"x".repeat(40)}`)].join("\n");
    const capped = capNotes(text, 500);
    expect(capped.length).toBeLessThanOrEqual(500);
    expect(capped).toContain("经验 49");
    expect(capped).not.toContain("经验 0 ");
    expect(capped.startsWith("# 经验")).toBe(true);
  });
  it("redacts secrets", () => {
    expect(redactSecrets("key sk-ant-abcdefghijklmnopqrstuv done")).toBe("key [已隐去] done");
  });
  it("prompt forbids editing identity/style", () => {
    expect(consolidationPrompt({ notes: "", user: "", identity: "I", style: "S", logs: "L" })).toContain("identity.md / style.md 不能改");
  });
});

describe("memory: files and git", () => {
  it("appends run logs into today's file", () => {
    const mem = tmpMem();
    appendRunLog(mem, "- 10:00 第一条");
    appendRunLog(mem, "- 10:05 第二条 sk-ant-abcdefghijklmnopqrstuv");
    const text = fs.readFileSync(todayLog(mem), "utf8");
    expect(text).toContain("第一条");
    expect(text).toContain("[已隐去]");
  });
  it("consolidation writes notes/user and makes a git commit", async () => {
    const mem = tmpMem();
    appendRunLog(mem, "- 10:00 用户要求结论放最前面");
    const r = await consolidate(mem, async (prompt) => {
      expect(prompt).toContain("用户要求结论放最前面");
      return JSON.stringify({ notes: "# 经验与事实\n\n- 旧经验\n- 汇报时结论放最前面", user: "# 关于用户\n\n- 喜欢先看结论", suggestions: [] });
    });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(mem, "notes.md"), "utf8")).toContain("结论放最前面");
    const log = spawnSync("git", ["log", "--oneline"], { cwd: mem, encoding: "utf8" }).stdout;
    expect(log).toContain("整理记忆");
  });
  it("weekly archive moves old logs and stale topics", () => {
    const mem = tmpMem();
    fs.writeFileSync(path.join(mem, "log", "2026-10-01.md"), "old");
    fs.writeFileSync(path.join(mem, "log", "2026-11-13.md"), "new");
    const topic = path.join(mem, "topics", "old-paper.md");
    fs.writeFileSync(topic, "t");
    const past = new Date("2026-08-01");
    fs.utimesSync(topic, past, past);
    const r = weeklyArchive(mem, new Date("2026-11-14T12:00:00"));
    expect(r.moved.sort()).toEqual(["log/2026-10-01.md", "topics/old-paper.md"]);
    expect(fs.existsSync(path.join(mem, "archive", "2026-10.md"))).toBe(true);
    expect(fs.existsSync(path.join(mem, "log", "2026-11-13.md"))).toBe(true);
    expect(r.commit).toBeTruthy();
  });
});
