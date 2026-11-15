#!/usr/bin/env node
// Scenario 8: scheduled watches go straight to an employee and notify the user only when there
// is something to say.
// A routine (like the 新论文 / 邮件 / 新闻 templates) is assigned to the research employee and run
// twice by hand:
//   run 1 — the inbox file is empty → the employee finishes with "无事" and sends NO notice
//   run 2 — the inbox has a line    → the employee sends a notice containing it
// Also checks: the lead is never woken by either run; the notice shows up in the plugin's notices
// (the workbench 通知 card) and can be dismissed.
// Model cost: two short employee turns. ~5–15 min.
// Usage: node scripts/acceptance/p15-watch-routine.mjs
import fs from "node:fs";
import path from "node:path";
import { api, cancelTree, dismissNotice, list, log, notices, researchTeam, runsOf, scratch, verdict, waitFor } from "./lib/scenario.mjs";

const { companyId, projectId, leadAgentId, employee } = await researchTeam();
const dir = scratch("watch");
const inbox = path.join(dir, "inbox.txt");
fs.writeFileSync(inbox, "");
const MARK = `p15-${Date.now().toString(36)}`;

const routine = await api("POST", `/companies/${companyId}/routines`, {
  title: `[验收 p15] 收件箱盯守 ${MARK}`,
  description: [
    `检查文件 ${inbox}。`,
    "- 文件为空：在任务里评论\"无事\"，把任务置为 done，不要通知用户。",
    "- 有内容：用 notify_user 把第一行原文通知用户（issueId 填这个任务），然后把任务置为 done。",
    "这是验收测试，不要做别的。",
  ].join("\n"),
  projectId,
  assigneeAgentId: employee.id,
});
log("routine", routine.id, "→", employee.name);

async function runOnce(label) {
  const before = new Set(list(await api("GET", `/companies/${companyId}/issues`)).map((i) => i.id));
  await api("POST", `/routines/${routine.id}/run`, { source: "manual" });
  const issue = await waitFor(
    `${label}: waiting for the routine's task`,
    async () => {
      const fresh = list(await api("GET", `/companies/${companyId}/issues`)).find((i) => !before.has(i.id) && (i.originId === routine.id || (i.title ?? "").includes(MARK) || i.assigneeAgentId === employee.id));
      return fresh ? { done: true, progress: `${fresh.identifier} ${fresh.status}`, value: fresh } : { progress: "no task yet" };
    },
    { minutes: 3, everyMs: 5_000 },
  );
  if (!issue) return { issue: null };
  const final = await waitFor(
    `${label}: waiting for the employee`,
    async () => {
      const i = await api("GET", `/issues/${issue.id}`);
      const runs = await runsOf(issue.id);
      const p = `${i.status}, runs ${runs.map((r) => r.status).join(",") || "none"}`;
      return ["done", "in_review", "cancelled"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status)) ? { done: true, progress: p, value: i } : { progress: p };
    },
    { minutes: 15 },
  );
  const runs = await runsOf(issue.id);
  return { issue, status: final?.status ?? null, leadRuns: runs.filter((r) => r.agentId === leadAgentId).length, employeeRuns: runs.filter((r) => r.agentId === employee.id).length };
}

const results = { employee: employee.name };
const n0 = (await notices(companyId)).length;
const quiet = await runOnce("run 1 (empty inbox)");
const n1 = await notices(companyId);
results.quiet = { status: quiet.status, leadRuns: quiet.leadRuns, employeeRuns: quiet.employeeRuns, newNotices: n1.length - n0 };

const LINE = `新论文 ${MARK}：一篇关于稀疏注意力的工作，值得看`;
fs.writeFileSync(inbox, `${LINE}\n第二行不用管\n`);
const loud = await runOnce("run 2 (inbox has a line)");
const n2 = await notices(companyId);
const notice = n2.find((n) => (n.body ?? n.title ?? "").includes(MARK));
results.loud = { status: loud.status, leadRuns: loud.leadRuns, employeeRuns: loud.employeeRuns, noticed: !!notice, noticeText: notice?.title ?? null };
if (notice) {
  await dismissNotice(companyId, notice.id);
  results.dismissed = (await notices(companyId)).find((n) => n.id === notice.id)?.status === "handled";
}

await api("PATCH", `/routines/${routine.id}`, { status: "archived" }).catch(() => {});
for (const r of [quiet, loud]) if (r.issue && !["done", "in_review"].includes(r.status)) await cancelTree(companyId, r.issue.id);
const pass =
  quiet.status === "done" && quiet.leadRuns === 0 && results.quiet.newNotices === 0 &&
  loud.status === "done" && loud.leadRuns === 0 && results.loud.noticed && results.dismissed;
verdict("p15-watch-routine", pass, results);
