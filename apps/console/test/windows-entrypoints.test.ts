import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS module
import { createDepartment, registerWithTeamLayer } from "../../../scripts/lib/department.mjs";
import { relocatedTeamLayerPath } from "../../../vendor/paperclip/server/src/agenteam/plugin-path";

const folders: string[] = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenteam-entry-")); folders.push(dir); return dir; };
afterEach(() => { vi.unstubAllEnvs(); for (const dir of folders.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const launcher = fs.readFileSync(new URL("../../../scripts/launch.vbs", import.meta.url), "utf8");

describe("Windows desktop entrypoint", () => {
  it("can be parsed independently of the Windows ANSI code page", () => {
    expect(launcher).not.toMatch(/[^\x00-\x7f]/);
  });
  it.skipIf(process.platform !== "win32")("runs the real VBS in a spaced Unicode directory without opening the application", () => {
    const dir = path.join(tmp(), "测试 space & directory", "scripts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "launch.vbs"), launcher);
    fs.writeFileSync(path.join(dir, "launch.mjs"), "import fs from 'node:fs'; fs.writeFileSync(new URL('./called.txt', import.meta.url), 'called');");
    const result = spawnSync("cscript.exe", ["//B", "//Nologo", path.join(dir, "launch.vbs")], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "called.txt"))).toBe(true);
  });
});

describe("team creation preflight", () => {
  const pack = { schema: "agenteam.department/1", name: "隔离测试", lead: { name: "主管" }, members: [{ key: "worker", name: "员工", adapterType: "claude_local" }] };
  it.each(["missing", "error"])("does not create employees or workspaces when the plugin is %s", async (mode) => {
    const home = path.join(tmp(), "data");
    vi.stubEnv("AGENTEAM_HOME", home);
    const api = vi.fn(async (_method: string, url: string) => {
      if (url === "/plugins") return mode === "missing" ? [] : [{ id: "plugin-original", pluginKey: "agenteam.team-layer" }];
      if (url.includes("/config")) return { configJson: { verifierModel: "preserve" } };
      throw new Error("WORKER_UNAVAILABLE");
    });
    await expect(createDepartment(pack, { api, ensureCompany: async () => ({ id: "test-company" }), log: () => {} })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("本次未创建") });
    expect(api.mock.calls.every(([, url]) => url.startsWith("/plugins"))).toBe(true);
    expect(fs.existsSync(home)).toBe(false);
  });
  it("registers the company without replacing existing plugin configuration", async () => {
    const api = vi.fn(async (_method: string, url: string) => {
      if (url === "/plugins") return [{ id: "plugin-original", pluginKey: "agenteam.team-layer" }];
      if (url.includes("/config")) return { configJson: { verifierModel: "preserve" } };
      return { ok: true };
    });
    await registerWithTeamLayer("test-company", { api, log: () => {} });
    expect(api.mock.calls).toEqual([
      ["GET", "/plugins"],
      ["GET", "/plugins/plugin-original/config?companyId=test-company"],
      ["POST", "/plugins/plugin-original/bridge/action", { key: "register", companyId: "test-company", params: { companyId: "test-company" } }],
    ]);
  });
});

describe("moved bundled plugin", () => {
  function fixture() {
    const root = tmp();
    const packagePath = path.join(root, "plugins", "team-layer");
    fs.mkdirSync(packagePath, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "agenteam" }));
    fs.writeFileSync(path.join(packagePath, "package.json"), JSON.stringify({ name: "@agenteam/team-layer" }));
    const plugin = { pluginKey: "agenteam.team-layer", packageName: "@agenteam/team-layer", packagePath: path.join(root, "old-location") };
    return { root, packagePath, plugin, from: path.join(root, "vendor/paperclip/server/src/agenteam") };
  }
  it("locates the bundled package after a directory move, from source or compiled server", () => {
    const f = fixture();
    expect(relocatedTeamLayerPath(f.plugin, f.from)).toBe(f.packagePath);
    expect(relocatedTeamLayerPath(f.plugin, path.join(f.root, "vendor/paperclip/server/dist/agenteam"))).toBe(f.packagePath);
  });
  it("leaves existing paths, registry installs and unrelated plugins alone", () => {
    const f = fixture();
    expect(relocatedTeamLayerPath({ ...f.plugin, packagePath: f.packagePath }, f.from)).toBeNull();
    expect(relocatedTeamLayerPath({ ...f.plugin, packagePath: null }, f.from)).toBeNull();
    expect(relocatedTeamLayerPath({ ...f.plugin, pluginKey: "other.plugin" }, f.from)).toBeNull();
    expect(relocatedTeamLayerPath({ ...f.plugin, packageName: "other-package" }, f.from)).toBeNull();
  });
  it("does not use a similarly named directory with a different package identity", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.packagePath, "package.json"), JSON.stringify({ name: "unexpected" }));
    expect(relocatedTeamLayerPath(f.plugin, f.from)).toBeNull();
  });
});
