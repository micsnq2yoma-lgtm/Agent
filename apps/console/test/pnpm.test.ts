import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS module
import { ensurePnpm, findPnpm, pnpmCommand, pnpmVersion, withBin } from "../../../scripts/lib/pnpm.mjs";

const dirs: string[] = [];
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agenteam pnpm test "));
  dirs.push(home);
  const env = { SystemRoot: process.env.SystemRoot, Path: path.dirname(process.execPath), AGENTEAM_HOME: home };
  return { home, env };
}
function fakePnpm(home: string, version = pnpmVersion, legacy = false) {
  const prefix = path.join(home, "tools", "pnpm", pnpmVersion);
  const bin = legacy ? prefix : path.join(prefix, "node_modules", ".bin");
  const cli = path.join(prefix, legacy ? "package" : "node_modules/pnpm", "bin", "pnpm.cjs");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), "unused");
  fs.writeFileSync(cli, `console.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : JSON.stringify(process.argv.slice(2)))`);
  return { cli, bin };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("pnpm discovery and bootstrap", () => {
  it.each([false, true])("finds local pnpm without PATH, including old unpacked layout (%s)", (legacy) => {
    const { home, env } = fixture();
    const { cli, bin } = fakePnpm(home, pnpmVersion, legacy);
    const found = findPnpm({ home, env });
    expect(found).toMatchObject({ command: process.execPath, args: [cli], shell: false, version: pnpmVersion });
    expect(found.env.Path.split(path.delimiter)[0]).toBe(bin);
    expect(env.Path).toBe(path.dirname(process.execPath));
  });
  it("passes spaced paths and arguments unchanged to Node", () => {
    const { home, env } = fixture();
    fakePnpm(home);
    const spec = pnpmCommand(["run", "argument with spaces & symbols"], env);
    const result = spawnSync(spec.command, spec.args, { env: spec.env, shell: spec.shell, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["run", "argument with spaces & symbols"]);
  });
  it("accepts pinned pnpm on PATH without installing anything", () => {
    const { home, env } = fixture();
    const run = vi.fn(() => ({ status: 0, stdout: pnpmVersion + "\n" }));
    expect(ensurePnpm({ home, env, run }).version).toBe(pnpmVersion);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(home, "tools"))).toBe(false);
  });
  it("does not hide a broken explicit override or install over it", () => {
    const { home, env } = fixture();
    fakePnpm(home);
    const run = vi.fn();
    expect(() => ensurePnpm({ home, env: { ...env, AGENTSELF_PNPM: path.join(home, "missing.cmd") }, run })).toThrow("AGENTEAM_PNPM");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects a failed executable instead of accepting its stdout", () => {
    const { home, env } = fixture();
    expect(findPnpm({ home, env, run: () => ({ status: 1, stdout: pnpmVersion }) })).toBeNull();
  });
  it("installs the pinned version locally and finds it again in a fresh lookup", () => {
    const { home, env } = fixture();
    const calls: { args: string[]; options: any }[] = [];
    const run = (cmd: string, args: string[], options: any) => {
      if (args.includes("install")) {
        calls.push({ args, options });
        fakePnpm(home);
        return { status: 0, stdout: "" };
      }
      if (cmd === "pnpm") return { status: 1, stdout: "" };
      return spawnSync(cmd, args, options);
    };
    expect(ensurePnpm({ home, env, run, log: () => {} }).version).toBe(pnpmVersion);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(expect.arrayContaining(["--prefix", path.join(home, "tools/pnpm", pnpmVersion), `pnpm@${pnpmVersion}`, "--ignore-scripts", "--no-save", "--package-lock=false"]));
    expect(calls[0].options.shell).toBe(false);
    expect(findPnpm({ home, env }).version).toBe(pnpmVersion);
    ensurePnpm({ home, env, run });
    expect(calls).toHaveLength(1);
  });
  it("reports download failure without exposing npm output", () => {
    const { home, env } = fixture();
    expect(() => ensurePnpm({ home, env, log: () => {}, run: () => ({ status: 1, stderr: "private-registry-credential" }) })).toThrow("自动准备 pnpm 失败");
  });
  it("does not accept a successful npm exit without a working pnpm", () => {
    const { home, env } = fixture();
    expect(() => ensurePnpm({ home, env, log: () => {}, run: (_: string, args: string[]) => ({ status: args.includes("install") ? 0 : 1, stdout: "" }) })).toThrow("仍无法执行");
  });
  it("preserves the Windows Path key without creating a shadow PATH", () => {
    const result = withBin({ Path: "existing", OTHER: "keep" }, "tools");
    expect(result).toEqual({ Path: `tools${path.delimiter}existing`, OTHER: "keep" });
  });
});
