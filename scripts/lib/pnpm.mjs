// One pnpm lookup for install/build/start/update. Only install.mjs may download it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveHome } from "./legacy.mjs";

export const pnpmVersion = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).packageManager.split("@")[1];

export function withBin(env, dir) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return { ...env, [key]: [dir, env[key]].filter(Boolean).join(path.delimiter) };
}

function command(file, env) {
  // npm shims and our older unpacked installation both have a JS entry point.
  // Running that with Node avoids cmd.exe splitting paths containing spaces.
  const dir = path.dirname(file);
  const cli = [file.endsWith(".cjs") || file.endsWith(".js") ? file : null,
    path.join(dir, "node_modules/pnpm/bin/pnpm.cjs"),
    path.join(dir, "../pnpm/bin/pnpm.cjs"),
    path.join(dir, "package/bin/pnpm.cjs")].find((p) => p && fs.existsSync(p));
  const childEnv = path.isAbsolute(file) ? withBin(env, dir) : { ...env };
  if (cli) return { command: process.execPath, args: [cli], shell: false, env: childEnv };
  return { command: process.platform === "win32" && path.isAbsolute(file) ? `"${file}"` : file,
    args: [], shell: process.platform === "win32", env: childEnv };
}

export function findPnpm({ env = process.env, home = resolveHome(env), run = spawnSync } = {}) {
  const explicit = env.AGENTEAM_PNPM ?? env.AGENTSELF_PNPM;
  const prefix = path.join(home, "tools", "pnpm", pnpmVersion);
  const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const candidates = explicit ? [explicit] : [
    path.join(prefix, "node_modules", ".bin", bin), path.join(prefix, bin),
    env.PNPM_HOME && path.join(env.PNPM_HOME, bin),
    env.APPDATA && path.join(env.APPDATA, "npm", bin), "pnpm",
  ].filter(Boolean);
  for (const file of candidates) {
    if (path.isAbsolute(file) && !fs.existsSync(file)) continue;
    const spec = command(file, env);
    const result = run(spec.command, [...spec.args, "--version"], {
      env: spec.env, shell: spec.shell, encoding: "utf8", windowsHide: true, timeout: 20_000,
    });
    if (result.status === 0 && result.stdout?.trim() === pnpmVersion) return { ...spec, version: pnpmVersion };
  }
  if (explicit) throw new Error(`AGENTEAM_PNPM（兼容 AGENTSELF_PNPM）指定的 pnpm 不可用或版本不符，需要 ${pnpmVersion}。请检查该路径及执行权限，或取消此变量后重试。`);
  return null;
}

export function requirePnpm(options) {
  const found = findPnpm(options);
  if (!found) throw new Error(`未找到可用的 pnpm ${pnpmVersion}。请运行 node scripts/install.mjs，安装脚本会自动准备所需版本。`);
  return found;
}

export function ensurePnpm({ env = process.env, home = resolveHome(env), run = spawnSync, log = console.log } = {}) {
  const found = findPnpm({ env, home, run });
  if (found) return found;
  const prefix = path.join(home, "tools", "pnpm", pnpmVersion);
  // Locate npm's JS entry point instead of depending on npm.cmd or Corepack activation.
  const pathValue = Object.entries(env).find(([k]) => k.toLowerCase() === "path")?.[1] ?? "";
  const dirs = [path.dirname(process.execPath), ...pathValue.split(path.delimiter).filter(Boolean)];
  const npmCli = dirs.flatMap((dir) => [path.join(dir, "node_modules/npm/bin/npm-cli.js"),
    path.join(dir, "../lib/node_modules/npm/bin/npm-cli.js"),
    path.join(dir, "../share/nodejs/npm/bin/npm-cli.js")]).find((p) => fs.existsSync(p));
  if (!npmCli) throw new Error("未找到 Node 附带的 npm。请安装包含 npm 的 Node 24.11+，然后重新运行安装脚本。");
  log(`正在准备 pnpm ${pnpmVersion}（仅安装到 AgenTeam 工具目录，不修改全局 PATH）…`);
  fs.mkdirSync(prefix, { recursive: true });
  const result = run(process.execPath, [npmCli, "install", "--prefix", prefix, `pnpm@${pnpmVersion}`,
    "--no-save", "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: prefix, env, shell: false, encoding: "utf8", windowsHide: true, timeout: 180_000,
  });
  // Do not echo npm output: registry credentials/proxy URLs may appear in errors.
  if (result.status !== 0) throw new Error(`自动准备 pnpm 失败（${result.error?.code ?? result.status ?? "未知错误"}）。请检查 npm 仓库网络连接和 AgenTeam 工具目录写权限，再重试安装；无需启用 Corepack。`);
  const installed = findPnpm({ env, home, run });
  if (!installed) throw new Error(`pnpm 安装命令已结束，但 ${pnpmVersion} 仍无法执行。请检查工具目录权限后重试。`);
  return installed;
}

export function pnpmCommand(args, env = process.env) {
  const spec = requirePnpm({ env });
  return { ...spec, args: [...spec.args, ...args] };
}
