#!/usr/bin/env node
// Remove a team (its lead, employees, routines and project) by its name, e.g. test leftovers:
//   node scripts/dev/remove-team.mjs 验收团队
//   node scripts/dev/remove-team.mjs 生活部 --yes
// Without --yes it only lists what it would remove.
import { removeTeam } from "../lib/teardown.mjs";

const base = process.env.AGENTSELF_CONSOLE ?? "http://127.0.0.1:3100";
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
if (!name) {
  console.error("usage: node scripts/dev/remove-team.mjs <团队名> [--yes]");
  process.exit(2);
}
const ctx = await (await fetch(`${base}/agentself/api/context`)).json();
const teams = ctx.departments.filter((d) => d.name === name || d.key === name);
if (!teams.length) {
  console.log(`没有叫「${name}」的团队。现有：${ctx.departments.map((d) => d.name).join("、") || "无"}`);
  process.exit(0);
}
for (const d of teams) {
  const who = d.members.map((id) => ctx.agents.find((a) => a.id === id)?.name ?? id).join("、");
  console.log(`「${d.name}」(${d.key})：成员 ${who || "无"}；项目 ${d.projectId ?? "无"}`);
  if (args.includes("--yes")) for (const line of await removeTeam({ companyId: ctx.company.id, projectId: d.projectId, members: d.members })) console.log("  " + line);
}
if (!args.includes("--yes")) console.log("加 --yes 才会真正删除。");
