// AgenTeam: the Rust runner daemon (paperclip-runnerd) is not shipped for Windows
// upstream either (published builds only carry darwin/linux binaries). On Windows,
// skip it when cargo is unavailable instead of failing the whole build.
import { spawnSync } from "node:child_process";

const hasCargo = spawnSync("cargo", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
if (process.platform === "win32" && !hasCargo) {
  console.log("[paperclip-runner] cargo not found on Windows; skipping paperclip-runnerd binary build");
  process.exit(0);
}
const cargo = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", "runner/Cargo.toml", "--locked", "-p", "paperclip-runner-core", "--bin", "paperclip-runnerd"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (cargo.status !== 0) process.exit(cargo.status ?? 1);
const stage = spawnSync(process.execPath, ["scripts/stage-runner-binary.mjs"], { stdio: "inherit" });
process.exit(stage.status ?? 1);
