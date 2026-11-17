// Paperclip's package scripts use POSIX commands (mkdir -p, cp…). On Windows pnpm must run them with
// Git Bash. The path differs per machine, so it is found here and handed to pnpm through
// npm_config_script_shell instead of being written into vendor/paperclip/.npmrc.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Git Bash on this machine, or null (not Windows, or Git not found). */
export function gitBash() {
  if (process.platform !== "win32") return null;
  if (process.env.AGENTEAM_BASH && fs.existsSync(process.env.AGENTEAM_BASH)) return process.env.AGENTEAM_BASH;
  const candidates = [];
  const exec = spawnSync("git", ["--exec-path"], { encoding: "utf8", shell: false, windowsHide: true }).stdout?.trim();
  // …\Git\mingw64\libexec\git-core → …\Git\bin\bash.exe
  if (exec) candidates.push(path.resolve(exec, "..", "..", "..", "bin", "bash.exe"));
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]) if (base) candidates.push(path.join(base, "Git", "bin", "bash.exe"));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Env for pnpm commands: the script shell on Windows. */
export function pnpmEnv(base = process.env) {
  const bash = gitBash();
  return bash ? { ...base, npm_config_script_shell: bash } : base;
}
