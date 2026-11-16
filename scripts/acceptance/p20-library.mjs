#!/usr/bin/env node
// Paper library: intake from arXiv (real network), full-text search, an employee uses it.
//  1. the library folder can be read; Adam (arXiv 1412.6980) is added through the local service:
//     metadata, PDF and full text arrive
//  2. search finds it by a phrase from the body text
//  3. an employee finds it with library_search and writes a note with library_note
// The paper is removed at the end only if this run added it. Model cost: one short turn. ~3–6 min.
// Usage: node scripts/acceptance/p20-library.mjs [--paper 1412.6980]
import { api, as, cancelTree, log, researchTeam, runsOf, verdict, waitFor } from "./lib/scenario.mjs";

const args = process.argv.slice(2);
const arxiv = args.includes("--paper") ? args[args.indexOf("--paper") + 1] : "1412.6980";
const results = {};
const settings = await as("GET", "/library/settings");
results.root = settings.root;
const added = await as("POST", "/library/papers", { ref: `https://arxiv.org/abs/${arxiv}`, tags: ["p20"] });
const paper = added.paper;
results.added = { id: paper.id, existed: added.existed, title: paper.title, authors: paper.authors?.length, hasPdf: paper.hasPdf, fulltext: paper.fulltext };
results.intakeOk = !!paper.title && paper.authors?.length > 0 && paper.hasPdf && paper.fulltext?.status === "ok" && paper.fulltextChars > 5000;

const hits = (await as("GET", `/library/papers?q=${encodeURIComponent("bias correction moment estimates")}`)).results;
results.searchFindsBody = hits[0]?.id === paper.id;

const { companyId, projectId, employee } = await researchTeam();
const mark = `p20-${Date.now().toString(36)}`;
const issue = await api("POST", `/companies/${companyId}/issues`, {
  title: `[验收 p20] 论文库 ${mark}`,
  description: `用 library_search 在论文库里找讲"一阶梯度随机优化、自适应矩估计"的那篇论文，用 library_read 读开头一段，然后用 library_note 给它写一条笔记：第一行 ${mark}，第二行一句话说这篇论文的核心方法。最后用 update_task 把任务置为 done。这是验收测试，不要做别的。`,
  projectId,
  assigneeAgentId: employee.id,
  status: "todo",
});
log("task", issue.identifier, "→", employee.name);
await waitFor(
  "waiting",
  async () => {
    const i = await api("GET", `/issues/${issue.id}`);
    const runs = await runsOf(issue.id);
    const p = `${i.status}, runs ${runs.map((r) => r.status).join(",") || "none"}`;
    return ["done", "cancelled"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status)) ? { done: true, progress: p } : { progress: p };
  },
  { minutes: 12 },
);
const after = await as("GET", `/library/papers/${paper.id}`);
results.employeeNote = after.notes.includes(mark);
results.status = (await api("GET", `/issues/${issue.id}`)).status;
if (results.status !== "done") await cancelTree(companyId, issue.id);
if (!added.existed) await as("DELETE", `/library/papers/${paper.id}`).catch(() => {});
verdict("p20-library", results.intakeOk && results.searchFindsBody && results.employeeNote && results.status === "done", results);
