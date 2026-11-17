#!/usr/bin/env node
// Stop AgenTeam: the supervisor started by scripts/start.mjs and everything under it
// (Paperclip, the local service). Used by scripts/update.mjs; safe to run when nothing runs.
// Usage: node scripts/stop.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome } from "./lib/legacy.mjs";
import { stopWindowsTree } from "./lib/windows-stop.mjs";

const home = resolveHome();
const pidFile = path.join(home, "run", "supervisor.pid");

async function up(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** Kill a process and its children. */
function killTree(pid, log) {
  if (process.platform === "win32") return stopWindowsTree(pid, { log });
  spawnSync("pkill", ["-TERM", "-P", String(pid)]);
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/** Processes still listening on a port (a Paperclip started by hand, or an orphan). */
function pidsOnPort(port) {
  if (process.platform === "win32") {
    const out = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout ?? "";
    return [...new Set(out.split(/\r?\n/).filter((l) => l.includes(`:${port} `) && /LISTENING/.test(l)).map((l) => Number(l.trim().split(/\s+/).pop())).filter(Boolean))];
  }
  const out = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "";
  return out.split(/\s+/).map(Number).filter(Boolean);
}

export async function stopAgenteam(log = console.log) {
  fs.mkdirSync(path.join(home, "run"), { recursive: true });
  fs.writeFileSync(path.join(home, "run", "stopping"), String(process.pid));
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    if (pid) log(killTree(pid, log) ? `stopped supervisor ${pid}` : `supervisor ${pid} was not running`);
    fs.rmSync(pidFile, { force: true });
  }
  // leftovers: Paperclip (3100) and the local service (3200)
  for (const port of [3100, 3200]) for (const pid of pidsOnPort(port)) if (pid !== process.pid) log(killTree(pid, log) ? `stopped pid ${pid} on :${port}` : `could not stop pid ${pid} on :${port}`);
  const end = Date.now() + 30_000;
  while (Date.now() < end && ((await up("http://127.0.0.1:3100/api/health")) || (await up("http://127.0.0.1:3200/agenteam/api/settings")))) await new Promise((r) => setTimeout(r, 1000));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stopAgenteam();
