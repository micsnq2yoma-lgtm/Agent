#!/usr/bin/env node
// P1 acceptance (no model cost): the team-layer plugin must raise cards for
// (a) the 3rd rework of a child issue and (b) a 9th-level sub-issue.
// Issues are left unassigned so no agent is woken.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { companyId, projectId } = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".agenteam", "department-research.json"), "utf8"));
const results = {};

async function interactions(issueId) {
  return list(await api("GET", `/issues/${issueId}/interactions`)).filter((i) => (i.kind ?? i.type) === "ask_user_questions");
}
async function waitFor(fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(1000);
  }
  return null;
}

// (a) rework x2 (plan B: 2nd send-back asks the user)
const parent = await api("POST", `/companies/${companyId}/issues`, { title: "[验收] 返工计数-父", projectId, status: "backlog" });
const child = await api("POST", `/companies/${companyId}/issues`, { title: "[验收] 返工计数-子", projectId, parentId: parent.id, status: "backlog" });
for (let i = 1; i <= 2; i++) {
  await api("PATCH", `/issues/${child.id}`, { status: "in_review" });
  await sleep(800);
  await api("PATCH", `/issues/${child.id}`, { status: "todo" });
  await sleep(1500);
  const cards = await interactions(parent.id);
  console.log(`rework ${i}: cards on parent = ${cards.length}`);
  results[`rework${i}Cards`] = cards.length;
}
const reworkCard = await waitFor(async () => (await interactions(parent.id))[0]);
const childAfter = await api("GET", `/issues/${child.id}`);
results.rework = { card: !!reworkCard, title: reworkCard?.title, childStatus: childAfter.status };
console.log("rework card:", JSON.stringify(results.rework));

// (b) 9-level chain
let prev = null;
const chain = [];
for (let depth = 1; depth <= 9; depth++) {
  const it = await api("POST", `/companies/${companyId}/issues`, {
    title: `[验收] 跳数 L${depth} ${Date.now().toString(36)}`,
    projectId,
    status: "backlog",
    ...(prev ? { parentId: prev.id } : {}),
  });
  chain.push(it);
  prev = it;
  await sleep(300);
}
const l8 = chain[7];
const l9 = chain[8];
const hopCard = await waitFor(async () => (await interactions(l8.id))[0]);
const l9After = await api("GET", `/issues/${l9.id}`);
const l8After = await api("GET", `/issues/${l8.id}`);
results.hop = { card: !!hopCard, title: hopCard?.title, l9Status: l9After.status, l8Status: l8After.status };
console.log("hop card:", JSON.stringify(results.hop));

const pass =
  results.rework1Cards === 0 && results.rework.card && results.rework.childStatus === "blocked" &&
  results.hop.card && results.hop.l9Status === "blocked" && results.hop.l8Status !== "blocked";
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results));

// cleanup test issues
for (const it of [child, parent, ...chain.reverse()]) {
  try {
    await api("PATCH", `/issues/${it.id}`, { status: "cancelled" });
  } catch {}
}
process.exit(pass ? 0 : 1);
