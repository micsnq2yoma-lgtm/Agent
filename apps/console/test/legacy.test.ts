// The Agentself → AgenTeam rename: an install from before it keeps its data, env and runtime folders.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { adoptLegacyEnv, migrateHome, migrateRuntimeDir, relinkAcceptanceTask, resolveHome, rewriteLegacyPaths } from "../../../scripts/lib/legacy.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agenteam-legacy-"));

describe("legacy rename", () => {
  it("AGENTSELF_* variables fill in AGENTEAM_* only where those are unset", () => {
    const env: Record<string, string> = { AGENTSELF_PORT: "1", AGENTSELF_HOST: "a", AGENTEAM_HOST: "b" };
    adoptLegacyEnv(env);
    expect(env).toMatchObject({ AGENTEAM_PORT: "1", AGENTEAM_HOST: "b" });
  });
  it("reads the old data folder until it is moved, then moves it once", () => {
    const h = tmp();
    fs.mkdirSync(path.join(h, ".agentself", "run"), { recursive: true });
    fs.writeFileSync(path.join(h, ".agentself", "console.json"), "{}");
    expect(resolveHome({}, h)).toBe(path.join(h, ".agentself"));
    expect(migrateHome({}, h)).toBe("renamed");
    expect(fs.existsSync(path.join(h, ".agenteam", "console.json"))).toBe(true);
    expect(fs.existsSync(path.join(h, ".agentself"))).toBe(false);
    expect(resolveHome({}, h)).toBe(path.join(h, ".agenteam"));
    expect(migrateHome({}, h)).toBe("none");
  });
  it("does nothing when AGENTEAM_HOME is set, or when the new folder already exists", () => {
    const h = tmp();
    fs.mkdirSync(path.join(h, ".agentself"));
    expect(migrateHome({ AGENTEAM_HOME: "/x" }, h)).toBe("none");
    expect(resolveHome({ AGENTSELF_HOME: "/y" }, h)).toBe("/y");
    fs.mkdirSync(path.join(h, ".agenteam"));
    expect(migrateHome({}, h)).toBe("none");
    expect(fs.existsSync(path.join(h, ".agentself"))).toBe(true);
  });
  it("an agent's old runtime folder moves, or is dropped when the new one is already there", () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, ".agentself"));
    fs.writeFileSync(path.join(cwd, ".agentself", "mcp.json"), "{}");
    expect(migrateRuntimeDir(cwd)).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".agenteam", "mcp.json"))).toBe(true);
    fs.mkdirSync(path.join(cwd, ".agentself"));
    expect(migrateRuntimeDir(cwd)).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".agentself"))).toBe(false);
    expect(migrateRuntimeDir(cwd)).toBe(false);
  });
  it("agent paths under the old data folder follow it (Windows slashes and case), others stay", () => {
    const cfg = { cwd: "C:\\Users\\A\\.agentself\\workspaces\\x", files: ["c:/users/a/.agentself/w/i.md"], other: "C:\\Users\\A\\.agentselfish", n: 1 };
    expect(rewriteLegacyPaths(cfg, "C:\\Users\\A\\.agentself", "C:\\Users\\A\\.agenteam", { win: true })).toEqual({
      cwd: "C:\\Users\\A\\.agenteam\\workspaces\\x",
      files: ["C:/Users/A/.agenteam/w/i.md"],
      other: "C:\\Users\\A\\.agentselfish",
      n: 1,
    });
    expect(rewriteLegacyPaths({ cwd: "/srv/x" }, "/h/.agentself", "/h/.agenteam")).toBeNull();
    expect(rewriteLegacyPaths({ cwd: "/h/.agentself/w" }, "/h/.agentself", "/h/.agentself")).toBeNull();
  });
  it("the acceptance task's wrapper is pointed at the moved folder and the task re-pointed", () => {
    const h = tmp();
    const oldHome = path.join(h, ".agentself");
    const newHome = path.join(h, ".agenteam");
    fs.mkdirSync(newHome);
    fs.writeFileSync(path.join(newHome, "acceptance-watch.cmd"), `node watch.mjs >> "${oldHome}\\logs\\acceptance-watch.log"`);
    const calls: string[][] = [];
    expect(relinkAcceptanceTask(oldHome, newHome, { win: true, run: (_c: string, a: string[]) => (calls.push(a), { status: 0 }) })).toBe(true);
    expect(fs.readFileSync(path.join(newHome, "acceptance-watch.cmd"), "utf8")).toContain(`${newHome}\\logs`);
    expect(calls[0]).toEqual(["/Change", "/TN", "AgenTeam-acceptance", "/TR", `"${path.join(newHome, "acceptance-watch.cmd")}"`]);
    expect(relinkAcceptanceTask(oldHome, path.join(h, "none"), { win: true })).toBe(false);
  });
});
