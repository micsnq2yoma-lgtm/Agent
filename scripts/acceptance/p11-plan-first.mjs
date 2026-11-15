#!/usr/bin/env node
// Scenario 1 (docs/v0.6-direction.md): "丢一句话就走" — a big job gets a plan first.
// The research lead receives a large, expensive request. Expected: a card asking the user to
// approve a plan appears on the task BEFORE any subtask exists; after the user approves, the lead
// delegates (a subtask appears). The run is then cancelled so nothing expensive actually starts.
// Model cost: the lead's planning turns plus one delegation turn. ~5–20 min.
// Usage: node scripts/acceptance/p11-plan-first.mjs
import { answerCard, api, cancelTree, childrenOf, log, pendingCards, researchTeam, verdict, waitFor } from "./lib/scenario.mjs";

const { companyId, projectId, leadAgentId } = await researchTeam();
const top = await api("POST", `/companies/${companyId}/issues`, {
  title: "[验收 p11] 本地大模型中文能力横评",
  description: [
    "帮我把 2024–2025 年开源的、参数量 7B 以下的中文大模型（至少 6 个）都下载到这台电脑上，",
    "每个在 C-Eval 全量和 CMMLU 全量上跑一遍，最后出一份对比报告和推荐。",
    "模型加起来大概要下载 60 GB 以上，跑完估计要一整晚、会一直占满显卡。",
  ].join("\n"),
  projectId,
  assigneeAgentId: leadAgentId,
  status: "todo",
});
log("task", top.identifier, top.id);

const results = { taskId: top.id };
// 1. a plan card before any subtask
const first = await waitFor(
  "waiting for a plan card or a subtask",
  async () => {
    const [cards, kids] = await Promise.all([pendingCards(top.id), childrenOf(companyId, top.id)]);
    if (cards.length || kids.length) return { done: true, progress: `cards ${cards.length}, subtasks ${kids.length}`, value: { cards, kids } };
    const issue = await api("GET", `/issues/${top.id}`);
    return { progress: `status ${issue.status}` };
  },
  { minutes: 25 },
);
results.planCard = !!first?.cards.length;
results.subtasksBeforeCard = first ? first.kids.length : null;
results.planTitle = first?.cards[0]?.title ?? null;

// 2. approve the plan → the lead delegates
if (results.planCard && results.subtasksBeforeCard === 0) {
  await answerCard(top.id, first.cards[0]);
  log("approved:", results.planTitle);
  const kids = await waitFor(
    "waiting for delegation after approval",
    async () => {
      const k = await childrenOf(companyId, top.id);
      const more = await pendingCards(top.id);
      // a second card (e.g. confirming cost) is fine: approve it too
      if (!k.length && more.length) {
        log("another card:", more[0].title);
        await answerCard(top.id, more[0]);
      }
      return k.length ? { done: true, progress: `subtasks ${k.length}`, value: k } : { progress: "no subtask yet" };
    },
    { minutes: 15 },
  );
  results.delegatedAfterApproval = !!kids?.length;
}

await cancelTree(companyId, top.id);
results.cancelled = true;
verdict("p11-plan-first", results.planCard && results.subtasksBeforeCard === 0 && results.delegatedAfterApproval, results);
