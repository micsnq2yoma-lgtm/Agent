#!/usr/bin/env node
// P1 acceptance (plan B): give the research lead a small research task, then watch until the lead
// reports (top-level issue in_review) or timeout. Expected path: brief + criteria on the top issue,
// one child for one employee, evidence, an independent verification, a report.
// Usage: node scripts/acceptance/p1-research.mjs [existingTopIssueId]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dept = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".agenteam", "department-research.json"), "utf8"));
const { companyId, projectId, leadAgentId } = dept;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const existingId = process.argv[2];
const top = existingId
  ? await api("GET", `/issues/${existingId}`)
  : await api("POST", `/companies/${companyId}/issues`, {
      title: "小调研：Python 列表推导式与生成器表达式的性能对比",
      description: [
        "我想知道这两种写法在性能上到底差多少，以后写代码时该怎么选。",
        "要有一个能运行的脚本 bench.py（用 timeit 对 100 万个整数求平方和，比较两种写法）和它的运行输出，再加一段不超过 300 字的中文结论。",
        "这是验收测试，请保持精简，不用先给我计划。",
      ].join("\n"),
      projectId,
      assigneeAgentId: leadAgentId,
      status: "todo",
    });
log("top issue", top.identifier, top.id);

const deadline = Date.now() + 45 * 60_000;
let last = "";
while (Date.now() < deadline) {
  const issue = await api("GET", `/issues/${top.id}`);
  const all = list(await api("GET", `/companies/${companyId}/issues`));
  const children = all.filter((i) => i.parentId === top.id);
  const runs = list(await api("GET", `/issues/${top.id}/runs`));
  const state = `${issue.status} | children: ${children.map((c) => `${c.identifier}:${c.status}`).join(", ")} | lead runs on top: ${runs.length}`;
  if (state !== last) log(state);
  last = state;
  if (issue.status === "in_review" || issue.status === "done") break;
  await sleep(20_000);
}

// Summarise lead wakes on the top issue.
const runs = list(await api("GET", `/issues/${top.id}/runs`));
const reasons = [];
for (const r of runs) {
  const d = await api("GET", `/heartbeat-runs/${r.runId ?? r.id}`);
  const m = JSON.stringify(d).match(/"wakeReason":"([^"]*)"/);
  reasons.push({ at: r.createdAt, status: r.status, agent: r.agentId === leadAgentId ? "lead" : r.agentId, wakeReason: m?.[1] });
}
reasons.sort((a, b) => a.at.localeCompare(b.at));
log("runs on top issue:", JSON.stringify(reasons, null, 1));
const gateWakes = reasons.filter((r) => r.wakeReason === "issue_children_completed").length;
log("gate wakes (issue_children_completed):", gateWakes);
let report = null;
try {
  report = await api("GET", `/issues/${top.id}/documents/report`);
} catch (e) {
  log("no report document:", String(e).slice(0, 120));
}
log("report:", report ? (report.body ?? report.markdown ?? JSON.stringify(report)).slice(0, 1500) : null);
const final = await api("GET", `/issues/${top.id}`);
const doc = async (issueId, key) => api("GET", `/issues/${issueId}/documents/${key}`).then((d) => !!d?.body).catch(() => false);
const kids = (await api("GET", `/companies/${companyId}/issues`)).filter((i) => i.parentId === top.id);
const kid = kids[0];
const result = {
  topStatus: final.status,
  gateWakes,
  hasBrief: await doc(top.id, "brief"),
  hasCriteria: await doc(top.id, "criteria"),
  children: kids.length,
  childHasEvidence: kid ? await doc(kid.id, "evidence") : false,
  childHasVerification: kid ? await doc(kid.id, "verification") : false,
  hasReport: !!report,
  topIssueId: top.id,
};
log("RESULT", JSON.stringify(result));
const pass = ["in_review", "done"].includes(result.topStatus) && result.hasBrief && result.hasCriteria && result.children === 1 && result.childHasEvidence && result.childHasVerification && result.hasReport;
log(pass ? "PASS" : "FAIL");
process.exitCode = pass ? 0 : 1;
