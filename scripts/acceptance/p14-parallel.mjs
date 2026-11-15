#!/usr/bin/env node
// Scenario 6: unrelated jobs run at the same time, each with its own lead and employee.
// Creates a temporary second team (fixtures/writing.json), sends two unrelated requests through
// the router at once, and expects:
//  - the router picks the right lead for each
//  - each lead delegates to its own team's employee (one subtask each)
//  - the two jobs overlap in time (the second did not wait for the first)
//  - both reach 待你确认 (in_review)
// The temporary team and both tasks are removed at the end.
// Model cost: two small P1-style runs + two router calls. ~15–40 min.
// Usage: node scripts/acceptance/p14-parallel.mjs [--keep-team]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDepartment } from "../lib/department.mjs";
import { removeTeam } from "../lib/teardown.mjs";
import { api, as, cancelTree, childrenOf, log, researchTeam, runsOf, verdict, waitFor } from "./lib/scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const research = await researchTeam();
const pack = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "writing.json"), "utf8"));
const ctx0 = await as("GET", "/context");
for (const d of ctx0.departments.filter((d) => d.name === pack.name)) await removeTeam({ companyId: ctx0.company.id, projectId: d.projectId, members: d.members }); // leftovers
const writing = await createDepartment(pack, { key: "acc-writing", companyName: ctx0.company.name, log: () => {} });
log("temporary team", pack.name, writing.leadAgentId);
await as("POST", "/agents/sync").catch(() => {});

const asks = {
  research: "用 Python 写个脚本数一数 1 到 10000 之间有多少个质数，给我脚本、运行输出和一句话结论。这是验收测试，保持精简，不用先给计划。",
  writing: "帮我写一首四行的中文短诗，主题是深夜的实验室，再附一句创作说明。这是验收测试，保持精简，不用先给计划。",
};
const sent = await Promise.all(Object.entries(asks).map(async ([k, text]) => [k, await as("POST", "/frontdesk", { text })]));
const tasks = {};
for (const [k, r] of sent) {
  tasks[k] = r.route === "task" ? r.issue : null;
  log(k, "→", r.route, r.assigneeName ?? "", r.issue?.identifier ?? "");
}
const want = { research: research.leadAgentId, writing: writing.leadAgentId };
const results = {
  routedRight: Object.fromEntries(Object.entries(tasks).map(([k, t]) => [k, t?.assigneeAgentId === want[k]])),
};

const live = Object.values(tasks).filter(Boolean);
await waitFor(
  "waiting for both to be reported",
  async () => {
    const st = await Promise.all(live.map((t) => api("GET", `/issues/${t.id}`)));
    const p = st.map((i) => `${i.identifier}:${i.status}`).join("  ");
    return st.every((i) => ["in_review", "done"].includes(i.status)) ? { done: true, progress: p } : { progress: p };
  },
  { minutes: 45, everyMs: 20_000 },
);

const ctx = await as("GET", "/context");
const teamOf = (agentId) => ctx.departments.find((d) => d.members.includes(agentId))?.leadAgentId ?? null;
const spans = [];
results.ownEmployee = {};
results.finalStatus = {};
for (const [k, t] of Object.entries(tasks)) {
  if (!t) continue;
  const kids = await childrenOf(research.companyId, t.id);
  results.ownEmployee[k] = kids.length === 1 && teamOf(kids[0].assigneeAgentId) === want[k] && kids[0].assigneeAgentId !== want[k];
  results.finalStatus[k] = (await api("GET", `/issues/${t.id}`)).status;
  const runs = [...(await runsOf(t.id)), ...(kids[0] ? await runsOf(kids[0].id) : [])];
  const starts = runs.map((r) => r.startedAt ?? r.createdAt).filter(Boolean).sort();
  const ends = runs.map((r) => r.finishedAt).filter(Boolean).sort();
  if (starts.length) spans.push({ k, from: starts[0], to: ends[ends.length - 1] ?? new Date().toISOString() });
}
// overlap: each job started before the other one finished
results.overlapped = spans.length === 2 && spans[0].from < spans[1].to && spans[1].from < spans[0].to;
results.spans = spans;

for (const t of live) await cancelTree(research.companyId, t.id);
if (!process.argv.includes("--keep-team")) {
  const after = await as("GET", "/context");
  for (const d of after.departments.filter((d) => d.name === pack.name)) results.cleanup = await removeTeam({ companyId: after.company.id, projectId: d.projectId, members: d.members });
}
const pass =
  Object.values(results.routedRight).every(Boolean) &&
  Object.keys(asks).every((k) => results.ownEmployee[k] && ["in_review", "done"].includes(results.finalStatus[k])) &&
  results.overlapped;
verdict("p14-parallel", pass, results);
