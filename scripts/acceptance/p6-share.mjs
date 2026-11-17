#!/usr/bin/env node
// P6 acceptance: export the research department as a pack from the main instance, import it into a
// fresh Paperclip instance, and check the imported team can do work there.
// Usage: PAPERCLIP_API_URL=http://127.0.0.1:3101 AGENTEAM_HOME=~/.agenteam-p6 node scripts/acceptance/p6-share.mjs <export.json>
import fs from "node:fs";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";
import { createDepartment, repoRoot } from "../lib/department.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const packFile = process.argv[2];
const pack = JSON.parse(fs.readFileSync(packFile, "utf8"));
const results = { target: process.env.PAPERCLIP_API_URL, packMembers: pack.members.map((m) => m.name), packLead: pack.lead?.name ?? null };

// 1. install the team-layer plugin on the fresh instance
let plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agentself.team-layer");
if (!plugin) plugin = await api("POST", "/plugins/install", { packageName: path.join(repoRoot, "plugins", "team-layer"), isLocalPath: true });
results.plugin = plugin.status;

// 2. import the pack
const out = await createDepartment(pack, { key: "research", companyName: "AgenTeam", log });
results.imported = out;
const agents = list(await api("GET", `/companies/${out.companyId}/agents`)).filter((a) => a.metadata?.agenteam?.department === "research");
results.agents = agents.map((a) => `${a.name}:${a.adapterType}:${a.status}`);

// 3. the imported team works: give the imported lead a one-step task it can hand to one employee
const scholar = agents.find((a) => a.metadata.agenteam.memberKey === "scholar");
const issue = await api("POST", `/companies/${out.companyId}/issues`, {
  title: "导入验收：用一句话说明什么是部门包",
  description: "用一句中文说明\"部门包\"是什么（一个可分享的 JSON，描述部门的成员、技能、例行任务和预算）。这是导入验收，保持精简，完成后把任务置为 done。",
  projectId: out.projectId,
  assigneeAgentId: scholar.id,
  status: "todo",
});
log("issue", issue.identifier);
const end = Date.now() + 15 * 60_000;
let final = issue;
while (Date.now() < end) {
  final = await api("GET", `/issues/${issue.id}`);
  if (["done", "in_review"].includes(final.status)) break;
  await sleep(15_000);
}
const comments = list(await api("GET", `/issues/${issue.id}/comments`));
results.taskStatus = final.status;
results.reply = comments.map((c) => c.body).join("\n").slice(0, 300);
const pass = results.plugin === "ready" && agents.length === pack.members.length + (pack.lead ? 1 : 0) && ["done", "in_review"].includes(final.status);
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
