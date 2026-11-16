#!/usr/bin/env node
// Acceptance watcher for a maintainer machine (Windows, with Codex CLI and gh logged in).
// Each pass: find open PRs labelled 待验收 whose current commit this machine has not verified →
// back up, switch this install to the PR's commit, build, restart, health check → run the local
// agent (Codex by default) with docs/acceptance/MAINTAINER.md → read its result comment on the PR
// → label 已验收 / 需修改 → switch the install back to where it was. See docs/acceptance/MAINTAINER.md.
//
//   node scripts/dev/acceptance-watch.mjs                 # one pass (what the scheduled task runs)
//   node scripts/dev/acceptance-watch.mjs --dry-run       # only say what it would verify
//   node scripts/dev/acceptance-watch.mjs --pr 12         # verify PR 12 now (ignores label and history)
//   node scripts/dev/acceptance-watch.mjs --install [--machine B] [--every 10]   # Windows scheduled task
//   node scripts/dev/acceptance-watch.mjs --uninstall
// Options / env: --machine <name> (AGENTEAM_MACHINE; default the computer name), --repo owner/name,
//   --no-backup, AGENTEAM_ACCEPT_AGENT (agent command; the prompt goes to its stdin;
//   default "codex exec --dangerously-bypass-approvals-and-sandbox -"),
//   AGENTEAM_ACCEPT_TIMEOUT_MIN (default 120).
// Logs: ~/.agentself/logs/acceptance-watch.log; history: ~/.agentself/acceptance-watch.json.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LABELS = { todo: "待验收", ok: "已验收", fix: "需修改" };
export const REQUEST_HEADING = "## 验收请求";

/* ---------------- pure helpers (unit-tested) ---------------- */
/** The first line of a result comment from `machine` for commit `sha`. */
export const resultHeading = (machine, pr, sha) => `## [验收机 ${machine}] PR #${pr} @ ${String(sha).slice(0, 7)}`;
/** "pass" | "fix" | null from a result comment's 结论 line (the last one counts). */
export function parseVerdict(body) {
  const all = [...String(body ?? "").matchAll(/结论[:：]\s*\**\s*(通过|需修改)/g)];
  if (!all.length) return null;
  return all[all.length - 1][1] === "通过" ? "pass" : "fix";
}
/** This machine's result comment for this commit, posted after `since` (ISO), or null. */
export function findResult(comments, { machine, pr, sha, since }) {
  const head = resultHeading(machine, pr, sha);
  return [...comments].reverse().find((c) => String(c.body ?? "").trimStart().startsWith(head) && (!since || c.created_at >= since)) ?? null;
}
/** The newest "## 验收请求" comment (the checklist for this round), or null. */
export function findRequest(comments) {
  return [...comments].reverse().find((c) => String(c.body ?? "").trimStart().startsWith(REQUEST_HEADING)) ?? null;
}
/** owner/name from a GitHub remote URL. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
/** The prompt handed to the maintainer agent. */
export function buildPrompt({ machine, repo, pr, sha, request }) {
  return [
    `你是 AgenTeam 仓库（${repo}）在「${machine}」这台电脑上的验收维护者。先完整读一遍仓库里的 docs/acceptance/MAINTAINER.md，然后照它做这一轮验收。`,
    "",
    `本轮：PR #${pr.number}《${pr.title}》 ${pr.url}`,
    `这台电脑的 AgenTeam 已经切到这个 PR 的提交 ${sha.slice(0, 7)}，构建完成并重启，http://127.0.0.1:3100 健康检查通过。`,
    "不要切分支、拉代码、重新构建或提交推送；这一轮结束后，轮询脚本会把这台电脑切回原来的版本。",
    "",
    "这一轮的验收请求（来自 PR 评论）：",
    "-----",
    request ? request.trim() : "（这一轮没有单独的验收请求：跑 MAINTAINER.md 里的默认清单。）",
    "-----",
    "",
    "做完后在 PR 上发一条评论（正文先写进一个临时文件，再用下面的命令发）：",
    `  gh pr comment ${pr.number} --repo ${repo} --body-file <文件>`,
    `评论第一行必须一字不差是：${resultHeading(machine, pr.number, sha)}`,
    "最后一行必须是「结论：通过」或「结论：需修改」。只要有一项没过就写需修改。",
    "评论里不要出现邮箱地址、API key、授权码、token。",
  ].join("\n");
}

/* ---------------- machine side ---------------- */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const historyFile = path.join(home, "acceptance-watch.json");
const lockFile = path.join(home, "run", "acceptance-watch.lock");
const logFile = path.join(home, "logs", "acceptance-watch.log");
const win = process.platform === "win32";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, line + "\n");
}
function run(cmd, argv, { cwd = root, input } = {}) {
  const r = spawnSync(cmd, argv, { cwd, input, encoding: "utf8", shell: win, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} 失败（${r.status ?? r.error?.message}）：${(r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-3).join(" / ")}`);
  return (r.stdout ?? "").trim();
}
const git = (...a) => run("git", a);
const gh = (...a) => run("gh", a);
const ghJson = (...a) => JSON.parse(gh(...a) || "null");

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyFile, "utf8"));
  } catch {
    return { done: {} };
  }
}
function remember(key, value) {
  const h = readHistory();
  h.done = { ...(h.done ?? {}), [key]: { ...value, at: new Date().toISOString() } };
  fs.writeFileSync(historyFile, JSON.stringify(h, null, 2));
}
function machineName() {
  return argValue("--machine") || process.env.AGENTEAM_MACHINE || readHistory().machine || os.hostname();
}

function takeLock() {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    let alive = false;
    try {
      process.kill(cur.pid, 0);
      alive = true;
    } catch {
      /* gone */
    }
    if (alive && Date.now() - Date.parse(cur.at) < 4 * 3600_000) return false;
  } catch {
    /* no lock */
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return true;
}
const releaseLock = () => fs.rmSync(lockFile, { force: true });

function comments(repo, pr) {
  return ghJson("api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments?per_page=100`).flat();
}
function postComment(repo, pr, body) {
  const f = path.join(os.tmpdir(), `agenteam-accept-${process.pid}.md`);
  fs.writeFileSync(f, body);
  try {
    gh("api", "-X", "POST", `repos/${repo}/issues/${pr}/comments`, "-F", `body=@${f}`);
  } finally {
    fs.rmSync(f, { force: true });
  }
}
function setLabels(repo, pr, add, remove = []) {
  for (const l of remove) {
    try {
      gh("api", "-X", "DELETE", `repos/${repo}/issues/${pr}/labels/${encodeURIComponent(l)}`);
    } catch {
      /* not there */
    }
  }
  if (add.length) gh("api", "-X", "POST", `repos/${repo}/issues/${pr}/labels`, ...add.flatMap((l) => ["-f", `labels[]=${l}`]));
}

/** Run the maintainer agent with the prompt on stdin; resolves with the tail of its output. */
function runAgent(prompt) {
  const cmd = process.env.AGENTEAM_ACCEPT_AGENT || "codex exec --dangerously-bypass-approvals-and-sandbox -";
  const minutes = Number(process.env.AGENTEAM_ACCEPT_TIMEOUT_MIN ?? 120);
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const keep = (b) => {
      out = (out + b.toString()).slice(-20_000);
      fs.appendFileSync(logFile, b);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      log(`agent timed out after ${minutes} min`);
      child.kill();
    }, minutes * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, tail: out.split(/\r?\n/).slice(-25).join("\n") });
    });
    child.stdin.end(prompt);
  });
}

/** Back up, switch this install to `sha`, build what changed, start, health check. */
async function deploy(sha, prev, { backupFirst }) {
  const { backup, installAndBuild, startDetached, waitHealthy } = await import("../update.mjs");
  const { stopAgentself } = await import("../stop.mjs");
  if (backupFirst) log(`backup: ${backup().dir}`);
  await stopAgentself(log);
  git("checkout", "--quiet", "--detach", sha);
  installAndBuild(prev, sha);
  startDetached();
  if (!(await waitHealthy())) throw new Error("切到 PR 版本后健康检查没通过（4 分钟内 Paperclip 或本地服务没起来）");
}
/** Put the install back on the branch / commit it was on before the round. */
async function restore(prevRef, prevSha) {
  const { installAndBuild, startDetached, waitHealthy } = await import("../update.mjs");
  const { stopAgentself } = await import("../stop.mjs");
  const now = git("rev-parse", "HEAD");
  await stopAgentself(log);
  git("checkout", "--quiet", prevRef === "HEAD" ? prevSha : prevRef);
  installAndBuild(now, prevSha);
  startDetached();
  log((await waitHealthy()) ? `restored ${prevRef} (${prevSha.slice(0, 7)})` : `restored ${prevRef}, but it did not come up healthy: check ~/.agentself/logs`);
}

async function verify(repo, machine, pr, { force = false } = {}) {
  const sha = pr.headRefOid;
  const key = `${pr.number}@${sha}`;
  if (!force && readHistory().done?.[key]) return false;
  log(`PR #${pr.number} @ ${sha.slice(0, 7)}: ${pr.title}`);
  if (process.argv.includes("--dry-run")) return true;

  const dirty = git("status", "--porcelain", "--untracked-files=no");
  if (dirty) throw new Error(`安装目录有未提交的改动，不能切到 PR 版本：\n${dirty}`);
  const prevRef = git("rev-parse", "--abbrev-ref", "HEAD");
  const prevSha = git("rev-parse", "HEAD");
  git("fetch", "--quiet", "origin", `pull/${pr.number}/head`);
  if (git("rev-parse", "FETCH_HEAD") !== sha) throw new Error(`PR #${pr.number} 在拉取时又有了新提交，下一轮再验`);

  const since = new Date().toISOString();
  let outcome;
  try {
    await deploy(sha, prevSha, { backupFirst: !process.argv.includes("--no-backup") });
    const all = comments(repo, pr.number);
    const prompt = buildPrompt({ machine, repo, pr, sha, request: findRequest(all)?.body ?? null });
    log(`running the maintainer agent for PR #${pr.number}`);
    const agent = await runAgent(prompt);
    const result = findResult(comments(repo, pr.number), { machine, pr: pr.number, sha, since });
    const verdict = result ? parseVerdict(result.body) : null;
    if (verdict) outcome = verdict;
    else {
      outcome = "fix";
      postComment(
        repo,
        pr.number,
        [
          resultHeading(machine, pr.number, sha),
          "",
          `验收没有完成：维护者没有发出带结论的结果评论（退出码 ${agent.code}）。最后的输出：`,
          "",
          "```",
          agent.tail.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<邮箱>").replace(/\b(sk|ghp|gho|github_pat)[-_][\w-]{10,}/g, "<key>"),
          "```",
          "",
          "结论：需修改",
        ].join("\n"),
      );
    }
  } catch (e) {
    outcome = "fix";
    log(`round failed: ${e.message}`);
    postComment(repo, pr.number, [resultHeading(machine, pr.number, sha), "", `这台电脑没能完成验收：${e.message}`, "", "结论：需修改"].join("\n"));
  } finally {
    await restore(prevRef, prevSha).catch((e) => log(`restore failed: ${e.message}`));
  }
  setLabels(repo, pr.number, [outcome === "pass" ? LABELS.ok : LABELS.fix], [LABELS.todo, outcome === "pass" ? LABELS.fix : LABELS.ok]);
  remember(key, { outcome, machine });
  log(`PR #${pr.number} @ ${sha.slice(0, 7)}: ${outcome === "pass" ? "已验收" : "需修改"}`);
  return true;
}

function install(machine) {
  if (!win) {
    console.log(`不是 Windows：用 cron 每 10 分钟跑一次即可，例如\n*/10 * * * * cd ${root} && ${process.execPath} scripts/dev/acceptance-watch.mjs --machine ${machine} >/dev/null 2>&1`);
    return;
  }
  for (const [cmd, a] of [["gh", ["auth", "status"]], ["codex", ["--version"]]]) {
    const r = spawnSync(cmd, a, { shell: true, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) throw new Error(`${cmd} 不可用或没登录（${cmd} ${a.join(" ")}）：先装好并登录`);
  }
  const every = Number(argValue("--every") ?? 10);
  const wrapper = path.join(home, "acceptance-watch.cmd");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(wrapper, `@echo off\r\ncd /d "${root}"\r\n"${process.execPath}" "${fileURLToPath(import.meta.url)}" --machine "${machine}" >> "${logFile}" 2>&1\r\n`);
  const r = spawnSync("schtasks", ["/Create", "/F", "/SC", "MINUTE", "/MO", String(every), "/TN", "AgenTeam-acceptance", "/TR", `"${wrapper}"`], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`注册计划任务失败：${(r.stderr || r.stdout).trim()}`);
  const h = readHistory();
  fs.writeFileSync(historyFile, JSON.stringify({ ...h, machine }, null, 2));
  console.log(`已注册计划任务 AgenTeam-acceptance：每 ${every} 分钟查一次带「${LABELS.todo}」标签的 PR。验收机名称：${machine}。日志：${logFile}`);
}

async function main() {
  const machine = machineName();
  if (process.argv.includes("--uninstall")) {
    if (win) spawnSync("schtasks", ["/Delete", "/F", "/TN", "AgenTeam-acceptance"], { stdio: "inherit" });
    return;
  }
  if (process.argv.includes("--install")) return install(machine);

  const repo = argValue("--repo") || repoFromRemote(git("remote", "get-url", "origin"));
  if (!repo) throw new Error("认不出 GitHub 仓库：用 --repo owner/name 指定");
  if (!takeLock()) {
    log("another pass is still running; skipping");
    return;
  }
  try {
    const only = argValue("--pr");
    const prs = only
      ? [ghJson("pr", "view", only, "--repo", repo, "--json", "number,title,headRefOid,url")]
      : ghJson("pr", "list", "--repo", repo, "--state", "open", "--label", LABELS.todo, "--json", "number,title,headRefOid,url");
    let n = 0;
    for (const pr of prs ?? []) if (await verify(repo, machine, pr, { force: !!only })) n++;
    if (!n && !process.argv.includes("--quiet-idle")) log(`nothing to verify (${repo}, label ${LABELS.todo})`);
  } finally {
    releaseLock();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    log(`ERROR ${e.message}`);
    process.exitCode = 1;
  });
}
