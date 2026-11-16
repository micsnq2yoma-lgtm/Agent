#!/usr/bin/env node
// First install on one machine (Windows; also works on macOS / Linux for development).
// Each machine is an independent Agentself with its own subscriptions, API keys and data.
//   git clone https://github.com/micsnq2yoma-lgtm/Agentself.git; cd Agentself
//   node scripts/install.mjs            # check → install → build → first-run setup → start → plugin → autostart
//   node scripts/install.mjs --no-autostart
// Safe to run again: every step skips what is already done.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopAgentself } from "./stop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "paperclip");
const args = new Set(process.argv.slice(2));
const win = process.platform === "win32";
const ok = (s) => console.log(`✔ ${s}`);
const step = (s) => console.log(`\n▶ ${s}`);
const warn = (s) => console.log(`⚠ ${s}`);

function run(cmd, argv, cwd = root, { capture = false } = {}) {
  const r = spawnSync(cmd, argv, { cwd, stdio: capture ? "pipe" : "inherit", encoding: "utf8", shell: win, windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} 失败（${r.status}）${capture ? `：${(r.stderr || r.stdout || "").trim().slice(-300)}` : ""}`);
  return (r.stdout ?? "").trim();
}
function version(cmd, flag = "--version") {
  const r = spawnSync(cmd, [flag], { encoding: "utf8", shell: win, windowsHide: true });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : null;
}
async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
async function api(method, p, body) {
  const r = await fetch(`http://127.0.0.1:3100/api${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// 1. prerequisites
step("检查环境");
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 24 || (maj === 24 && min < 11)) throw new Error(`需要 Node 24.11 以上，现在是 ${process.versions.node}`);
ok(`Node ${process.versions.node}`);
const pnpmV = version("pnpm", "-v");
if (!pnpmV) throw new Error("没有 pnpm：先运行 corepack enable，再 corepack prepare pnpm@9.15.9 --activate");
ok(`pnpm ${pnpmV}`);
ok(`git ${version("git")?.replace(/^git version /, "") ?? "?"}`);
const claudeV = version("claude");
claudeV ? ok(`Claude Code ${claudeV}`) : warn("没有 Claude Code：npm i -g @anthropic-ai/claude-code，再运行 claude 登录这台电脑的订阅（主管、路由、核查员都要用）");
const codexV = version("codex");
codexV ? ok(`Codex ${codexV}`) : warn("没有 Codex CLI（可选）：npm i -g @openai/codex，再运行 codex login 登录这台电脑的订阅");

// 2. dependencies and build
step("安装依赖并构建（第一次要十几分钟）");
run("pnpm", ["install", "--frozen-lockfile"], vendor);
run("pnpm", ["build"], vendor);
run("pnpm", ["install", "--frozen-lockfile"], root);
run("pnpm", ["build"], root);
ok("构建完成");

// 3. Paperclip first-run config (non-interactive defaults: local, embedded database)
step("Paperclip 首次配置");
const configPath = path.join(os.homedir(), ".paperclip", "instances", "default", "config.json");
if (fs.existsSync(configPath)) ok(`已有配置 ${configPath}`);
else {
  // `onboard --yes` writes the default config and then starts Paperclip in the foreground; let it
  // come up once (that also creates the database), then stop it and hand over to the supervisor.
  const child = spawn("pnpm", ["paperclipai", "onboard", "--yes", "--no-install-service"], { cwd: vendor, stdio: "inherit", shell: win, windowsHide: true });
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end && !(fs.existsSync(configPath) && (await healthy("http://127.0.0.1:3100/api/health")))) {
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!fs.existsSync(configPath)) throw new Error("Paperclip 首次配置没有完成，请手动运行：cd vendor/paperclip; pnpm paperclipai onboard");
  await stopAgentself(() => {});
  if (child.exitCode === null) child.kill();
  ok("已生成配置");
}

// 4. start
step("启动");
if (await healthy("http://127.0.0.1:3100/api/health")) ok("已经在运行");
else {
  spawn(process.execPath, [path.join(root, "scripts", "start.mjs")], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
  const end = Date.now() + 5 * 60_000;
  while (Date.now() < end && !(await healthy("http://127.0.0.1:3100/api/health"))) await new Promise((r) => setTimeout(r, 3000));
  if (!(await healthy("http://127.0.0.1:3100/api/health"))) throw new Error("Paperclip 5 分钟内没起来，看 ~/.agentself/logs/paperclip.log");
  ok("Paperclip 和本地服务已启动");
}

// 5. team-layer plugin
step("安装团队层插件");
const plugins = await api("GET", "/plugins");
const list = Array.isArray(plugins) ? plugins : (plugins?.items ?? []);
if (list.some((p) => p.pluginKey === "agentself.team-layer")) ok("已安装");
else {
  await api("POST", "/plugins/install", { packageName: path.join(root, "plugins", "team-layer"), isLocalPath: true });
  ok("已安装");
}

// 6. autostart
if (!args.has("--no-autostart")) {
  step("开机自启");
  if (win) run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "install-autostart.ps1")]);
  else warn("开机自启只为 Windows 准备了脚本，其他系统请自己配置");
}

console.log(`
完成。打开 http://127.0.0.1:3100 ，在"主管"旁边的 + 新建第一位主管和员工。
以后更新：设置 → 通用 → 版本与更新（或 node scripts/update.mjs）。`);
