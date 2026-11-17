#!/usr/bin/env node
// One-click launch: start AgenTeam if it is not running, wait until it answers, open it in the browser.
// This is what the desktop shortcut runs (scripts/create-shortcut.ps1 → scripts/launch.vbs → this file).
//   node scripts/launch.mjs            # start if needed, then open http://127.0.0.1:3100
//   node scripts/launch.mjs --no-open  # start if needed, don't open the browser
// Env: AGENTEAM_APP (default http://127.0.0.1:3100), AGENTEAM_NO_OPEN=1.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function healthy(base, fetchImpl = fetch) {
  try {
    const [a, b] = await Promise.all([fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(3000) }), fetchImpl(`${base}/agenteam/api/context`, { signal: AbortSignal.timeout(3000) })]);
    return a.ok && b.ok;
  } catch {
    return false;
  }
}

/** The command that opens a URL in the default browser. */
export function openCommand(platform, url) {
  if (platform === "win32") return { cmd: "cmd.exe", args: ["/d", "/c", "start", '""', url], opts: { windowsVerbatimArguments: true } };
  if (platform === "darwin") return { cmd: "open", args: [url], opts: {} };
  return { cmd: "xdg-open", args: [url], opts: {} };
}

function startDetached() {
  spawn(process.execPath, [path.join(root, "scripts", "start.mjs")], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
}
function openBrowser(url) {
  const { cmd, args, opts } = openCommand(process.platform, url);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true, ...opts });
  child.on("error", () => {}); // no browser opener (headless box): the URL is printed anyway
  child.unref();
}

/**
 * @returns {Promise<"already-running" | "started">}
 * Throws when it does not come up in `waitMs`.
 */
export async function launch({ base = "http://127.0.0.1:3100", open = true, waitMs = 5 * 60_000, pollMs = 2000, start = startDetached, openUrl = openBrowser, check = healthy, log = console.log } = {}) {
  let how = "already-running";
  if (!(await check(base))) {
    log("AgenTeam 没有在运行，正在启动（第一次可能要一两分钟）…");
    start();
    how = "started";
    const end = Date.now() + waitMs;
    while (Date.now() < end && !(await check(base))) await new Promise((r) => setTimeout(r, pollMs));
    if (!(await check(base))) throw new Error(`AgenTeam 在 ${Math.round(waitMs / 60_000)} 分钟内没起来，看 ~/.agenteam/logs/paperclip.log`);
  }
  log(`AgenTeam 已就绪：${base}`);
  if (open) openUrl(base);
  return how;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const open = !process.argv.includes("--no-open") && process.env.AGENTEAM_NO_OPEN !== "1";
  launch({ base: process.env.AGENTEAM_APP ?? "http://127.0.0.1:3100", open }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
