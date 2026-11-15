#!/usr/bin/env node
// Scenario 2: the whole research loop by one employee — read a paper, judge whether its method
// applies, design a small experiment, run it, analyse, deliver one page with evidence.
// Default paper: Adam (arXiv:1412.6980); the experiment is small enough for a laptop CPU.
// Goes through the router like a real request. Cards the lead raises (a plan to approve, a
// cost check) are answered with the first option, as the user would approve; hire requests are
// declined (the existing employee should do it).
// Expected at the end, like P1 plus content checks:
//   brief + criteria on the task, exactly one subtask, evidence + independent verification on it,
//   a report that cites the paper and gives a measured number, task 待你确认 (in_review).
// Model cost: the largest of the suite. ~30–90 min.
// Usage: node scripts/acceptance/p17-research-full.mjs [--paper 1412.6980] [--keep]
import { answerCard, api, as, cancelTree, childrenOf, docText, log, pendingCards, researchTeam, verdict, waitFor } from "./lib/scenario.mjs";

const args = process.argv.slice(2);
const paper = args.includes("--paper") ? args[args.indexOf("--paper") + 1] : "1412.6980";
const { companyId, leadAgentId } = await researchTeam();
const text = [
  `读一下这篇论文 https://arxiv.org/abs/${paper}，判断它的核心方法能不能直接用到一个小型分类任务上。`,
  "如果能，设计一个在这台电脑 CPU 上 10 分钟内能跑完的小实验来验证论文最关键的一个结论（和一个合理的基线比较），",
  "把实验真正跑起来，最后给我一页结论：论文说了什么、实验怎么做的、实测数字、能不能用、有什么局限。",
  "要有能复现的脚本和运行输出作为证据。",
].join("");
const r = await as("POST", "/frontdesk", { text });
if (r.route !== "task") {
  verdict("p17-research-full", false, { routed: r.route, note: "路由没有把它当成任务" });
  process.exit();
}
const top = r.issue;
log("task", top.identifier, "→", r.assigneeName);
const results = { taskId: top.id, routedToResearchLead: top.assigneeAgentId === leadAgentId, cardsAnswered: [], hiresDeclined: 0 };

await waitFor(
  "waiting for the report",
  async () => {
    // the report's own 确认完成 card is the end state: leave it for the user
    for (const c of (await pendingCards(top.id)).filter((c) => !/汇报待你验收/.test(c.title ?? ""))) {
      results.cardsAnswered.push(c.title);
      log("approving card:", c.title);
      await answerCard(top.id, c);
    }
    for (const h of await as("GET", "/hire-requests?status=pending")) {
      if (h.issueId !== top.id) continue;
      results.hiresDeclined++;
      await as("POST", `/hire-requests/${h.id}/reject`, { reason: "验收：请用现有员工完成" });
    }
    const i = await api("GET", `/issues/${top.id}`);
    const kids = await childrenOf(companyId, top.id);
    const p = `${i.status} | subtasks ${kids.map((k) => `${k.identifier}:${k.status}`).join(", ") || "none"}`;
    return ["in_review", "done"].includes(i.status) ? { done: true, progress: p } : { progress: p };
  },
  { minutes: 90, everyMs: 30_000 },
);

const kids = await childrenOf(companyId, top.id);
const kid = kids.find((k) => k.status !== "cancelled") ?? kids[0];
const report = (await docText(top.id, "report")) ?? "";
const evidence = kid ? ((await docText(kid.id, "evidence")) ?? "") : "";
Object.assign(results, {
  finalStatus: (await api("GET", `/issues/${top.id}`)).status,
  hasBrief: !!(await docText(top.id, "brief")),
  hasCriteria: !!(await docText(top.id, "criteria")),
  subtasks: kids.filter((k) => k.status !== "cancelled").length,
  hasEvidence: !!evidence,
  hasVerification: !!(kid && (await docText(kid.id, "verification"))),
  reportCitesPaper: report.includes(paper) || /Adam|arXiv/i.test(report),
  reportHasNumber: /\d+\.\d+/.test(report),
  evidenceHasScript: /\.py\b|\.ipynb\b|\.mjs\b|\.js\b/.test(evidence),
  reportChars: report.length,
});
if (!args.includes("--keep") && !["in_review", "done"].includes(results.finalStatus)) await cancelTree(companyId, top.id);
const pass =
  results.routedToResearchLead && ["in_review", "done"].includes(results.finalStatus) && results.hasBrief && results.hasCriteria && results.subtasks === 1 &&
  results.hasEvidence && results.hasVerification && results.reportCitesPaper && results.reportHasNumber && results.evidenceHasScript;
verdict("p17-research-full", pass, results);
