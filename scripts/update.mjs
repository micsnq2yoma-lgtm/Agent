#!/usr/bin/env node
// Update this machine's AgenTeam to the latest `main`, with automatic rollback.
//   node scripts/update.mjs            # update now (stops, builds, restarts, checks health)
//   node scripts/update.mjs --check    # only say whether an update is available (JSON)
//   node scripts/update.mjs --no-backup
// Steps: refuse on local changes → fetch → back up (Paperclip database via `paperclipai
// db:backup`, ~/.agenteam without workspaces) → stop → fast-forward → install only what the
// lockfiles changed → build only what changed → start → health check. If the new version
// does not come up healthy, the code goes back to the previous commit, is rebuilt and started
// again. The database is NOT restored automatically (Paperclip may have migrated it); the
// backup path is printed so it can be restored by hand.
// Every run appends to ~/.agenteam/logs/update.log and writes ~/.agenteam/run/update.json.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitBash, pnpmEnv } from "./lib/shell.mjs";
import { resolveHome } from "./lib/legacy.mjs";
import { mergeUpdateState } from "./lib/update-state.mjs";
import { stopAgenteam } from "./stop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "paperclip");
const home = resolveHome();
const args = new Set(process.argv.slice(2));
const branch = process.env.AGENTEAM_UPDATE_BRANCH ?? "main";
const stateFile = path.join(home, "run", "update.json");
fs.mkdirSync(path.join(home, "logs"), { recursive: true });
fs.mkdirSync(path.dirname(stateFile), { recursive: true });

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(home, "logs", "update.log"), line + "\n");
}
function state(patch) {
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    /* first run */
  }
  fs.writeFileSync(stateFile, JSON.stringify(mergeUpdateState(cur, patch), null, 2));
}
// git and gh are real executables: run them without a shell, so arguments with spaces or "&" stay whole.
const NO_SHELL = new Set(["git", "gh"]);
function sh(cmd, argv, cwd = root, { quiet = false } = {}) {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", shell: process.platform === "win32" && !NO_SHELL.has(cmd), windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: pnpmEnv() });
  if (!quiet && r.stdout?.trim()) fs.appendFileSync(path.join(home, "logs", "update.log"), r.stdout);
  if (r.stderr?.trim()) fs.appendFileSync(path.join(home, "logs", "update.log"), r.stderr);
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} 失败（${r.status}）：${(r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-3).join(" / ")}`);
  return (r.stdout ?? "").trim();
}
const git = (...a) => sh("git", a, root, { quiet: true });
const pnpm = process.env.AGENTEAM_PNPM ?? "pnpm";
async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** Install and build what changed between two commits ("" = build everything). */
export function installAndBuild(from, to) {
  const changed = from ? git("diff", "--name-only", from, to).split(/\r?\n/).filter(Boolean) : null;
  const any = (re) => !changed || changed.some((f) => re.test(f));
  if (any(/^pnpm-lock\.yaml$|^(apps|packages|plugins)\/[^/]+\/package\.json$|^package\.json$/)) {
    log("installing root dependencies");
    sh(pnpm, ["install", "--frozen-lockfile"], root);
  }
  if (any(/^vendor\/paperclip\/(pnpm-lock\.yaml|package\.json|.*\/package\.json)$/)) {
    log("installing Paperclip dependencies");
    sh(pnpm, ["install", "--frozen-lockfile"], vendor);
  }
  if (any(/^vendor\/paperclip\/(server|packages|cli)\//)) {
    log("building Paperclip");
    sh(pnpm, ["build"], vendor);
  } else if (any(/^vendor\/paperclip\/ui\//)) {
    log("building the interface");
    sh(pnpm, ["exec", "vite", "build"], path.join(vendor, "ui"));
  }
  if (any(/^(plugins|packages)\//)) {
    log("building plugins and packages");
    sh(pnpm, ["build"], root);
  }
}

export function startDetached() {
  const child = spawn(process.execPath, [path.join(root, "scripts", "start.mjs")], { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
export async function waitHealthy(minutes = Number(process.env.AGENTEAM_UPDATE_HEALTH_MINUTES ?? 4)) {
  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    if ((await healthy("http://127.0.0.1:3100/api/health")) && (await healthy("http://127.0.0.1:3100/agenteam/api/context"))) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

export function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(home, "backups", stamp);
  fs.mkdirSync(dir, { recursive: true });
  // ~/.agenteam without the bulky or regenerable parts (agent workspaces hold experiment data)
  const skip = new Set(["workspaces", "backups", "logs", "run"]);
  for (const e of fs.readdirSync(home)) if (!skip.has(e)) fs.cpSync(path.join(home, e), path.join(dir, "agenteam", e), { recursive: true });
  let db = null;
  try {
    const out = sh(pnpm, ["paperclipai", "db:backup", "--json", "--dir", path.join(dir, "paperclip")], vendor, { quiet: true });
    // the JSON sits between the CLI's banner and its closing line
    db = out.match(/"backupFile":\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\\/g, "\\") ?? path.join(dir, "paperclip");
  } catch (e) {
    log(`database backup failed: ${e.message}`);
    throw new Error("数据库备份失败，没有更新（备份要在 Paperclip 运行时做：先 node scripts/start.mjs）。加 --no-backup 可以跳过备份（不建议）。");
  }
  // keep the last five
  const all = fs.readdirSync(path.join(home, "backups")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) fs.rmSync(path.join(home, "backups", old), { recursive: true, force: true });
  return { dir, db };
}

export async function checkForUpdate() {
  git("fetch", "--quiet", "origin", branch);
  const head = git("rev-parse", "HEAD");
  const target = git("rev-parse", `origin/${branch}`);
  const behind = Number(git("rev-list", "--count", `HEAD..origin/${branch}`));
  const ahead = Number(git("rev-list", "--count", `origin/${branch}..HEAD`));
  const subjects = behind ? git("log", "--format=%h %s", `HEAD..origin/${branch}`).split(/\r?\n/).slice(0, 20) : [];
  return { branch, current: head.slice(0, 7), latest: target.slice(0, 7), behind, ahead, changes: subjects };
}

async function main() {
  if (args.has("--check")) {
    const c = await checkForUpdate();
    state({ lastCheck: c });
    console.log(JSON.stringify(c, null, 2));
    return;
  }
  const dirty = git("status", "--porcelain", "--untracked-files=no");
  if (dirty) throw new Error(`仓库里有未提交的改动，先提交或还原再更新：\n${dirty}`);
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== branch) throw new Error(`当前不在 ${branch} 分支上`);
  const c = await checkForUpdate();
  if (c.ahead) throw new Error(`本地有 ${c.ahead} 个提交不在 origin/${branch} 上，不能快进；先推送或处理掉`);
  if (!c.behind) {
    log(`already up to date (${c.current})`);
    state({ status: "up_to_date", current: c.current });
    return;
  }
  log(`updating ${c.current} → ${c.latest} (${c.behind} commits)`);
  state({ status: "updating", from: c.current, to: c.latest, changes: c.changes, error: null });
  const prev = git("rev-parse", "HEAD");
  const saved = args.has("--no-backup") ? null : backup();
  if (saved) log(`backup: ${saved.dir}`);

  await stopAgenteam(log);
  let failure = null;
  try {
    git("merge", "--ff-only", `origin/${branch}`);
    installAndBuild(prev, "HEAD");
    startDetached();
    if (!(await waitHealthy())) throw new Error("新版本启动后健康检查没通过（4 分钟内 Paperclip 或本地服务没起来）");
    log(`updated to ${c.latest}`);
    state({ status: "updated", current: c.latest, backup: saved?.dir ?? null });
    return;
  } catch (e) {
    failure = e;
  }

  // roll back the code (the repository was clean, so a hard reset only moves back the update)
  log(`update failed: ${failure.message}; rolling back to ${prev.slice(0, 7)}`);
  await stopAgenteam(log);
  try {
    const now = git("rev-parse", "HEAD");
    git("reset", "--hard", prev);
    installAndBuild(now, prev);
    startDetached();
    const ok = await waitHealthy();
    log(ok ? `rolled back to ${prev.slice(0, 7)}` : "rolled back, but the old version did not come up either");
    state({ status: ok ? "rolled_back" : "broken", current: prev.slice(0, 7), error: failure.message, backup: saved?.dir ?? null });
  } catch (e) {
    log(`rollback failed: ${e.message}`);
    state({ status: "broken", error: `${failure.message}；回退也失败：${e.message}`, backup: saved?.dir ?? null });
  }
  throw new Error(
    `更新失败，已回退到 ${prev.slice(0, 7)}：${failure.message}` +
      (saved ? `\n数据库没有自动恢复。如果新版本已经改过数据库、旧版本运行不正常，用这份备份恢复：${saved.db ?? saved.dir}` : ""),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    log(`ERROR ${e.message}`);
    process.exitCode = 1;
  });
}
