// Build Paperclip (and the AgenTeam UI inside it) by hand: `node scripts/build.mjs [--ui] [--install]`.
// On Windows Paperclip's package scripts need Git Bash; plain `pnpm build` in cmd fails with
// "命令语法不正确". This finds Git Bash and passes it to pnpm (see scripts/lib/shell.mjs).
//   --install  run `pnpm install --frozen-lockfile` first
//   --ui       build only the UI (vendor/paperclip/ui), the quick path after interface changes
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitBash, pnpmEnv } from "./lib/shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paperclip = path.join(root, "vendor", "paperclip");
const argv = new Set(process.argv.slice(2));

if (process.platform === "win32" && !gitBash()) {
  console.error("没找到 Git Bash（Paperclip 的构建脚本要用它）。装好 Git for Windows，或者用环境变量 AGENTEAM_BASH 指向 bash.exe。");
  process.exit(1);
}
const env = pnpmEnv();
function run(args, cwd) {
  console.log(`> pnpm ${args.join(" ")}  (${path.relative(root, cwd) || "."})`);
  const r = spawnSync("pnpm", args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (argv.has("--install")) run(["install", "--frozen-lockfile"], paperclip);
if (argv.has("--ui")) run(["exec", "vite", "build"], path.join(paperclip, "ui"));
else run(["build"], paperclip);
console.log("构建完成。重启生效：node scripts/stop.mjs，然后 node scripts/start.mjs");
