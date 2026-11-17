// The product was renamed Agentself → AgenTeam. An install from before the rename keeps working:
// the data directory, the environment variables and the per-agent runtime folders are carried over once.
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
  try {
    fs.renameSync(old, next);
    return "renamed";
  } catch {
    fs.cpSync(old, next, { recursive: true });
    return "copied";
  }
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
