#!/usr/bin/env node
// P4 acceptance:
//  (a) an employee uses, in project B, a preference it learned in project A (via memory files, new session);
//  (b) after being idle, memory is consolidated automatically and committed to git.
// Usage: node scripts/acceptance/p4-memory.mjs [--skip-a]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const { companyId, projectId } = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".agenteam", "department-research.json"), "utf8"));
const agents = list(await api("GET", `/companies/${companyId}/agents`));
const scholar = agents.find((a) => a.metadata?.agenteam?.memberKey === "scholar");
const memDir = path.join(scholar.adapterConfig.cwd, "memory");
const plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agentself.team-layer");
const results = {};
const MARK = "【科研部速递】";

async function runIssue(title, description) {
  const issue = await api("POST", `/companies/${companyId}/issues`, { title, description, projectId, assigneeAgentId: scholar.id, status: "todo" });
  log("issue", issue.identifier);
  const end = Date.now() + 20 * 60_000;
  while (Date.now() < end) {
    const i = await api("GET", `/issues/${issue.id}`);
    const runs = list(await api("GET", `/issues/${issue.id}/runs`));
    if (["done", "in_review"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status))) break;
    await sleep(15_000);
  }
  const comments = list(await api("GET", `/issues/${issue.id}/comments`));
  const runs = list(await api("GET", `/issues/${issue.id}/runs`));
  return { issue, comments, runs };
}

if (!process.argv.includes("--skip-a")) {
  // Project A: teach a preference
  const a = await runIssue(
    "用三句话解释什么是 Transformer",
    `请用三句话解释 Transformer。\n\n另外记住我的一个长期偏好：以后你给我的所有总结，第一行都单独写「${MARK}」。请把这个偏好记进你的记忆，以后的任务都照做。`,
  );
  const userMd = fs.readFileSync(path.join(memDir, "user.md"), "utf8") + fs.readFileSync(path.join(memDir, "notes.md"), "utf8");
  results.preferenceSaved = userMd.includes(MARK) || userMd.includes("科研部速递");
  log("A done; preference saved in memory:", results.preferenceSaved);

  // Project B: unrelated task, new issue => new session; no mention of the preference
  const b = await runIssue("用三句话解释什么是扩散模型", "请用三句话解释扩散模型（diffusion model）。");
  const sessA = new Set(a.runs.map((r) => r.sessionIdAfter).filter(Boolean));
  const bRun = await api("GET", `/heartbeat-runs/${b.runs[b.runs.length - 1].runId}`).catch(() => ({}));
  results.newSession = !sessA.has(bRun.sessionIdBefore);
  const bText = b.comments.map((c) => c.body).join("\n");
  const docs = list(await api("GET", `/issues/${b.issue.id}/documents`).catch(() => []));
  results.preferenceUsedInB = bText.includes("科研部速递") || docs.some((d) => (d.body ?? "").includes("科研部速递"));
  results.bExcerpt = bText.slice(0, 300);
  log("B used preference:", results.preferenceUsedInB);
}

if (process.argv.includes("--only-b")) {
  // Re-run only project B (the preference is already in memory from project A).
  const b = await runIssue("用三句话解释什么是强化学习", "请用三句话解释强化学习（reinforcement learning）。");
  const bText = b.comments.map((c) => c.body).join("\n");
  results.preferenceUsedInB = bText.includes("科研部速递");
  results.bExcerpt = bText.slice(0, 400);
  console.log("RESULT", results.preferenceUsedInB ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  process.exit(results.preferenceUsedInB ? 0 : 1);
}

// (b) idle consolidation -> git commit. Shorten idle threshold to 1 minute for the test.
const before = spawnSync("git", ["log", "--oneline"], { cwd: memDir, encoding: "utf8" }).stdout;
await api("POST", `/plugins/${plugin.id}/config`, { companyId, configJson: { idleMinutes: 1 } });
log("waiting for memory-idle job (runs every 5 minutes)…");
let after = before;
const end = Date.now() + 12 * 60_000;
while (Date.now() < end) {
  await sleep(30_000);
  after = spawnSync("git", ["log", "--oneline"], { cwd: memDir, encoding: "utf8" }).stdout;
  if (after.includes("整理记忆") && after !== before) break;
}
await api("POST", `/plugins/${plugin.id}/config`, { companyId, configJson: { idleMinutes: 30 } });
results.consolidationCommit = after !== before && after.includes("整理记忆");
results.gitLog = after.split("\n").slice(0, 5);

const pass = (process.argv.includes("--skip-a") || (results.preferenceUsedInB && results.newSession)) && results.consolidationCommit;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
