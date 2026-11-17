// The product was renamed Agentself → AgenTeam. An install from before the rename keeps working:
// the data directory, the environment variables and the per-agent runtime folders are carried over once.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OLD_DIR = ".agentself";
const NEW_DIR = ".agenteam";

/** AGENTSELF_* variables (set by hand, in the user's environment, in a service) still count. */
export function adoptLegacyEnv(env = process.env) {
  for (const k of Object.keys(env)) {
    if (k.startsWith("AGENTSELF_") && env[`AGENTEAM_${k.slice(10)}`] === undefined) env[`AGENTEAM_${k.slice(10)}`] = env[k];
  }
}

// Importing this module is enough for the environment part: entry points import it first, so any
// module that reads AGENTEAM_* at load time already sees the old names.
adoptLegacyEnv();

/** The old default data folder (~/.agentself); paths saved under it moved with migrateHome. */
export const legacyHome = (homedir = os.homedir()) => path.join(homedir, OLD_DIR);

/**
 * A copy of `value` with every string path under `oldHome` pointed at `newHome` (either slash style,
 * case-insensitive on Windows), or null when nothing pointed there. Used for agents' adapter configs.
 */
export function rewriteLegacyPaths(value, oldHome, newHome, { win = process.platform === "win32" } = {}) {
  if (!oldHome || !newHome || path.resolve(oldHome) === path.resolve(newHome)) return null;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const variants = [...new Set([oldHome, oldHome.replace(/\\/g, "/"), oldHome.replace(/\//g, "\\")])];
  const re = new RegExp(`(${variants.map(esc).join("|")})(?=$|[\\\\/])`, win ? "gi" : "g");
  let changed = false;
  const walk = (v) => {
    if (typeof v === "string") {
      const out = v.replace(re, (m) => (m.includes("/") && !m.includes("\\") ? newHome.replace(/\\/g, "/") : newHome));
      if (out !== v) changed = true;
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value);
  return changed ? out : null;
}

/**
 * The acceptance watcher's scheduled task runs a wrapper inside the data folder; after the folder moved,
 * point the wrapper's paths and the task at the new place (Windows only; the task keeps its schedule).
 */
export function relinkAcceptanceTask(oldHome, newHome, { win = process.platform === "win32", run = spawnSync } = {}) {
  const wrapper = path.join(newHome, "acceptance-watch.cmd");
  if (!fs.existsSync(wrapper)) return false;
  const text = fs.readFileSync(wrapper, "utf8");
  const next = text.split(oldHome).join(newHome);
  if (next !== text) fs.writeFileSync(wrapper, next);
  if (!win) return next !== text;
  const r = run("schtasks", ["/Change", "/TN", "AgenTeam-acceptance", "/TR", `"${wrapper}"`], { encoding: "utf8", windowsHide: true });
  return r.status === 0;
}

/** The data directory to read now: the new one, or the old one if it has not been moved yet. Never moves anything. */
export function resolveHome(env = process.env, homedir = os.homedir()) {
  adoptLegacyEnv(env);
  if (env.AGENTEAM_HOME) return env.AGENTEAM_HOME;
  const next = path.join(homedir, NEW_DIR);
  const old = path.join(homedir, OLD_DIR);
  return !fs.existsSync(next) && fs.existsSync(old) ? old : next;
}

/**
 * Move ~/.agentself to ~/.agenteam (only when AGENTEAM_HOME is not set and the new one does not exist).
 * A rename that fails (a file still open on Windows) falls back to a copy; the old folder is left in place.
 * Returns what happened: "none" | "renamed" | "copied".
 */
export function migrateHome(env = process.env, homedir = os.homedir()) {
  adoptLegacyEnv(env);
  if (env.AGENTEAM_HOME) return "none";
  const next = path.join(homedir, NEW_DIR);
  const old = path.join(homedir, OLD_DIR);
  if (fs.existsSync(next) || !fs.existsSync(old)) return "none";
  let how;
  try {
    fs.renameSync(old, next);
    how = "renamed";
  } catch {
    fs.cpSync(old, next, { recursive: true });
    how = "copied";
  }
  try {
    relinkAcceptanceTask(old, next);
  } catch {
    /* no watcher on this machine, or schtasks refused: re-run acceptance-watch --install */
  }
  return how;
}

/** An agent's working folder keeps its instructions and MCP config in <cwd>/.agenteam (was .agentself). */
export function migrateRuntimeDir(cwd) {
  const old = path.join(cwd, OLD_DIR);
  const next = path.join(cwd, NEW_DIR);
  if (!fs.existsSync(old)) return false;
  try {
    if (!fs.existsSync(next)) fs.renameSync(old, next);
    else fs.rmSync(old, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
