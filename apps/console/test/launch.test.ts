// One-click launch (scripts/launch.mjs): start only when needed, wait, then open the browser.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { healthy, launch, openCommand } from "../../../scripts/launch.mjs";

function server(up: { v: boolean }) {
  return new Promise<{ base: string; close: () => void }>((resolve) => {
    const s = http.createServer((req, res) => {
      res.statusCode = up.v ? 200 : 503;
      res.end("{}");
    });
    s.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });
}

describe("launch", () => {
  it("opens the right command per platform", () => {
    expect(openCommand("win32", "http://x").cmd).toBe("cmd.exe");
    expect(openCommand("win32", "http://x").args).toEqual(["/d", "/c", "start", '""', "http://x"]);
    expect(openCommand("darwin", "http://x")).toMatchObject({ cmd: "open", args: ["http://x"] });
    expect(openCommand("linux", "http://x")).toMatchObject({ cmd: "xdg-open", args: ["http://x"] });
  });
  it("already running: does not start anything, just opens", async () => {
    const up = { v: true };
    const s = await server(up);
    const calls: string[] = [];
    const how = await launch({ base: s.base, start: () => calls.push("start"), openUrl: (u: string) => calls.push(`open ${u}`), log: () => {} });
    s.close();
    expect(how).toBe("already-running");
    expect(calls).toEqual([`open ${s.base}`]);
  });
  it("not running: starts once, waits until it answers, then opens", async () => {
    const up = { v: false };
    const s = await server(up);
    const calls: string[] = [];
    const how = await launch({
      base: s.base,
      pollMs: 20,
      waitMs: 5000,
      start: () => {
        calls.push("start");
        setTimeout(() => (up.v = true), 120);
      },
      openUrl: (u: string) => calls.push(`open ${u}`),
      log: () => {},
    });
    s.close();
    expect(how).toBe("started");
    expect(calls).toEqual(["start", `open ${s.base}`]);
  });
  it("never comes up: throws with where to look, and does not open", async () => {
    const s = await server({ v: false });
    const calls: string[] = [];
    await expect(launch({ base: s.base, pollMs: 10, waitMs: 80, start: () => calls.push("start"), openUrl: () => calls.push("open"), log: () => {} })).rejects.toThrow(/没起来/);
    s.close();
    expect(calls).toEqual(["start"]);
  });
  it("--no-open: starts and waits but does not open", async () => {
    const s = await server({ v: true });
    const calls: string[] = [];
    await launch({ base: s.base, open: false, openUrl: () => calls.push("open"), log: () => {} });
    s.close();
    expect(calls).toEqual([]);
  });
  it("healthy needs both the Paperclip and the AgenTeam endpoint", async () => {
    const s = await server({ v: true });
    expect(await healthy(s.base)).toBe(true);
    s.close();
    expect(await healthy("http://127.0.0.1:1")).toBe(false);
  });
});
