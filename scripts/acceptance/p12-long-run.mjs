#!/usr/bin/env node
// Scenario 3: a long experiment is watched without a model, and the employee comes back by itself.
// The research employee gets a fake experiment that runs for EXPERIMENT_SECONDS (default 240) in
// the background and then writes result.json. Expected:
//  - the employee starts it, registers a probe with watch_job and ENDS its turn (no busy waiting)
//  - the plugin's probe sees the end and wakes the employee ("⏱ 看守结束" comment)
//  - a later run reads the result and finishes the task with the number in it
// Model cost: two short employee turns. ~8–15 min.
// Usage: node scripts/acceptance/p12-long-run.mjs [--seconds 240]
import fs from "node:fs";
import path from "node:path";
import { api, cancelTree, comments, log, researchTeam, runsOf, scratch, verdict, waitFor } from "./lib/scenario.mjs";

const args = process.argv.slice(2);
const seconds = Number(args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : 240);
const { companyId, projectId, employee } = await researchTeam();
const dir = scratch("long-run");
const ACC = "0.9137";
const exp = path.join(dir, "experiment.mjs");
const probe = path.join(dir, "probe.mjs");
// `node experiment.mjs --start` detaches itself and returns at once, on Windows and elsewhere.
fs.writeFileSync(
  exp,
  `import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const dir = ${JSON.stringify(dir)};
if (process.argv.includes("--start")) {
  spawn(process.execPath, [process.argv[1]], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  console.log("started in the background; log: " + path.join(dir, "progress.log"));
  process.exit(0);
}
const t0 = Date.now();
const timer = setInterval(() => fs.appendFileSync(path.join(dir, "progress.log"), "epoch " + Math.round((Date.now() - t0) / 1000) + "s\\n"), 20000);
setTimeout(() => { clearInterval(timer); fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ accuracy: ${ACC}, seconds: ${seconds} })); }, ${seconds * 1000});
`,
);
fs.writeFileSync(probe, `import fs from "node:fs";\nprocess.exit(fs.existsSync(${JSON.stringify(path.join(dir, "result.json"))}) ? 0 : 1);\n`);

const issue = await api("POST", `/companies/${companyId}/issues`, {
  title: "[验收 p12] 长实验看守",
  description: [
    `这是一个要跑约 ${Math.round(seconds / 60)} 分钟的实验，请按下面做：`,
    `1. 运行 \`node "${exp}" --start\`。它会自己转到后台并立刻返回，不要等它跑完，也不要 sleep 或循环检查。`,
    `2. 用 watch_job 登记看守：探测命令 \`node "${probe}"\`（退出码 0 = 结束，1 = 还在跑），everyMinutes 2，maxHours 1。`,
    "3. 登记完就结束这一轮。",
    `4. 被看守叫醒后，读 ${path.join(dir, "result.json")}，把 accuracy 的数值写进一条评论，然后把任务置为 done。`,
    "这是验收测试，不要做别的。",
  ].join("\n"),
  projectId,
  assigneeAgentId: employee.id,
  status: "todo",
});
log("task", issue.identifier, "→", employee.name, "dir", dir);

const results = { taskId: issue.id, employee: employee.name, seconds };
const resultFile = path.join(dir, "result.json");
let finishedAt = null;
const end = await waitFor(
  "waiting for the task to finish",
  async () => {
    const i = await api("GET", `/issues/${issue.id}`);
    if (!finishedAt && fs.existsSync(resultFile)) finishedAt = fs.statSync(resultFile).mtime.toISOString();
    const runs = await runsOf(issue.id);
    const p = `status ${i.status}, runs ${runs.length} (${runs.map((r) => r.status).join(",")}), experiment ${finishedAt ? "finished" : fs.existsSync(path.join(dir, "progress.log")) ? "running" : "not started"}`;
    return ["done", "in_review"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status)) ? { done: true, progress: p, value: i } : { progress: p };
  },
  { minutes: 30 + seconds / 60, everyMs: 20_000 },
);

const runs = (await runsOf(issue.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const cs = await comments(issue.id);
const wake = cs.find((c) => /⏱ 看守结束/.test(c.body ?? ""));
results.experimentStarted = fs.existsSync(path.join(dir, "progress.log"));
results.experimentFinishedAt = finishedAt;
// the first turn ended while the experiment was still running (no busy waiting)
results.firstTurnEndedEarly = !!(finishedAt && runs[0] && (runs[0].finishedAt ?? runs[0].updatedAt) < finishedAt);
results.watchWoke = !!wake;
results.runAfterWake = !!(wake && runs.some((r) => r.createdAt >= wake.createdAt));
results.reportedNumber = cs.some((c) => (c.body ?? "").includes(ACC));
results.finalStatus = end?.status ?? (await api("GET", `/issues/${issue.id}`)).status;
results.runs = runs.map((r) => `${r.createdAt.slice(11, 19)} ${r.status}`);

if (!["done", "in_review"].includes(results.finalStatus)) await cancelTree(companyId, issue.id);
verdict("p12-long-run", results.experimentStarted && results.firstTurnEndedEarly && results.watchWoke && results.runAfterWake && results.reportedNumber && ["done", "in_review"].includes(results.finalStatus), results);
