import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createEmbeddedPostgresSupervisor } from "../../../vendor/paperclip/server/src/embedded-postgres-supervisor";
// @ts-expect-error plain JS module
import { postgresCluster, processTree, stopWindowsTree } from "../../../scripts/lib/windows-stop.mjs";

const rows = [
  { ProcessId: 11, ParentProcessId: 1, Name: "node.exe" },
  { ProcessId: 12, ParentProcessId: 11, Name: "node.exe" },
  { ProcessId: 13, ParentProcessId: 12, Name: "postgres.exe" },
  { ProcessId: 14, ParentProcessId: 13, Name: "postgres.exe" },
  { ProcessId: 25, ParentProcessId: 1, Name: "postgres.exe" },
];
const cluster = (row: any) => row.ProcessId === 13 ? { pid: 13, dir: "test database", pgCtl: "pg_ctl.exe" } : null;

describe("Windows database-safe stop", () => {
  it("cancels recovery already waiting when an update begins", async () => {
    const events = new EventEmitter();
    let allowed = true;
    const createInstance = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: { start: vi.fn(), stop: vi.fn(), process: events }, createInstance,
      shouldRecover: () => allowed, beforeRestart: async () => { allowed = false; },
    });
    events.emit("exit", 1, null);
    await supervisor.waitForRecovery();
    expect(createInstance).not.toHaveBeenCalled();
  });
  it("does not restart PostgreSQL after the updater requests a clean stop", async () => {
    const events = new EventEmitter();
    const createInstance = vi.fn();
    const stop = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: { start: vi.fn(), stop, process: events },
      createInstance, shouldRecover: () => false,
    });
    events.emit("exit", 0, null);
    await supervisor.waitForRecovery();
    await supervisor.shutdown();
    expect(createInstance).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
  it("still recovers an unexpected database exit during normal operation", async () => {
    const events = new EventEmitter();
    const start = vi.fn(async () => {});
    const replacement = { start, stop: vi.fn(async () => {}), process: new EventEmitter() };
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: { start: vi.fn(), stop: vi.fn(), process: events },
      createInstance: () => replacement, shouldRecover: () => true,
    });
    events.emit("exit", 1, null);
    await supervisor.waitForRecovery();
    expect(start).toHaveBeenCalledOnce();
    await supervisor.shutdown();
  });
  it("closes the database before its Windows console owner, leaving unrelated databases alone", () => {
    const run = vi.fn(() => ({ status: 0 }));
    expect(stopWindowsTree(11, { rows, run, cluster })).toBe(true);
    expect(run.mock.calls.map((call: any) => call.slice(0, 2))).toEqual([
      ["pg_ctl.exe", ["stop", "-D", "test database", "-m", "fast", "-w", "-t", "30"]],
      ["taskkill", ["/PID", "11", "/F"]], ["taskkill", ["/PID", "12", "/F"]],
    ]);
  });
  it("refuses to force-kill an unidentifiable postgres child", () => {
    const run = vi.fn();
    expect(() => stopWindowsTree(11, { rows, run, cluster: () => null })).toThrow("无法确认");
    expect(run).not.toHaveBeenCalled();
  });
  it("does not report success if pg_ctl fails", () => {
    const run = (cmd: string) => ({ status: cmd === "pg_ctl.exe" ? 1 : 0 });
    expect(() => stopWindowsTree(11, { rows, run, cluster })).toThrow("未正常停止");
  });
  it("ignores unrelated processes and handles an already exited root", () => {
    expect(processTree(rows, 11).map((r: any) => r.ProcessId)).toEqual([11, 12, 13, 14]);
    expect(stopWindowsTree(500, { rows, run: vi.fn() })).toBe(false);
  });
  it("validates PID and data directory including paths with spaces", () => {
    const dir = path.resolve("test data");
    const row = { Name: "postgres.exe", ProcessId: 13, CommandLine: `postgres -D "${dir}" -p 5555`, ExecutablePath: path.resolve("native/bin/postgres.exe") };
    expect(postgresCluster(row, () => `13\n${dir}\n`, () => true).dir).toBe(dir);
    expect(() => postgresCluster(row, () => `99\n${dir}\n`, () => true)).toThrow("身份不一致");
    expect(() => postgresCluster(row, () => `13\n${path.resolve("another db")}\n`, () => true)).toThrow("身份不一致");
  });
  it("refuses missing pg_ctl before stopping any process", () => {
    expect(() => postgresCluster({Name:"postgres.exe", CommandLine:'postgres -D "db"', ExecutablePath:path.resolve("postgres.exe")}, () => "", () => false)).toThrow("pg_ctl");
  });
});
