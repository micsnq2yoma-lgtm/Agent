#!/usr/bin/env node
// Start Agentself: Paperclip (from vendor/paperclip source) + the console server.
// Restarts a service if it exits. Logs go to ~/.agentself/logs/.
// Usage: node scripts/start.mjs [--no-paperclip] [--no-console]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const logs = path.join(home, "logs");
fs.mkdirSync(logs, { recursive: true });
const args = new Set(process.argv.slice(2));

function findPnpm() {
  if (process.env.AGENTSELF_PNPM) return process.env.AGENTSELF_PNPM;
  const candidates = [path.join(process.env.APPDATA ?? "", "npm", "pnpm.cmd"), "pnpm"];
  for (const c of candidates) {
    const r = spawnSync(c, ["-v"], { encoding: "utf8", shell: process.platform === "win32" });
    const v = (r.stdout ?? "").trim();
    if (r.status === 0 && /^\d+\.\d+/.test(v)) {
      const [maj, min] = v.split(".").map(Number);
      if (maj > 9 || (maj === 9 && min >= 15)) return c;
    }
  }
  return "pnpm";
}

async function healthy(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function supervise(name, cmd, cmdArgs, cwd, healthUrl, extraEnv = {}) {
  let backoff = 2000;
  const run = async () => {
    if (healthUrl && (await healthy(healthUrl))) {
      log(`${name} already running (${healthUrl}); watching`);
      const t = setInterval(async () => {
        if (!(await healthy(healthUrl))) {
          clearInterval(t);
          run();
        }
      }, 15000);
      return;
    }
    const out = fs.openSync(path.join(logs, `${name}.log`), "a");
    log(`starting ${name}: ${cmd} ${cmdArgs.join(" ")}`);
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd, stdio: ["ignore", out, out], shell: process.platform === "win32", windowsHide: true, env: { ...process.env, ...extraEnv } });
    child.on("exit", (code) => {
      log(`${name} exited (${code}); restarting in ${backoff / 1000}s`);
      if (Date.now() - started > 60_000) backoff = 2000;
      setTimeout(run, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  };
  run();
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(logs, "supervisor.log"), line + "\n");
}

if (!args.has("--no-paperclip")) {
  // Serve the built (translated) admin UI instead of the slow Vite dev middleware.
  supervise("paperclip", findPnpm(), ["paperclipai", "run"], path.join(root, "vendor", "paperclip"), "http://127.0.0.1:3100/api/health", {
    PAPERCLIP_UI_DEV_MIDDLEWARE: process.env.PAPERCLIP_UI_DEV_MIDDLEWARE ?? "false",
  });
}
if (!args.has("--no-console")) {
  supervise("console", process.execPath, [path.join(root, "apps", "console", "server", "server.mjs")], path.join(root, "apps", "console"), "http://127.0.0.1:3200/agentself/settings");
}
