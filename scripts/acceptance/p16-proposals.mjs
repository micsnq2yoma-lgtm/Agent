#!/usr/bin/env node
// Scenario 9 (memory review step): what the memory job learns about the user is only a proposal
// until the user confirms it. No model cost, ~10 s.
// Puts two proposals where the memory job writes them (profile/proposals.json), then:
//   accept #1 with edited wording → it lands in profile/user.md (edited text) and in every
//                                   agent's instructions file (inlined, refreshed on change)
//   reject #2                     → it lands nowhere and is kept as rejected
// Restores user.md and proposals.json afterwards.
// Usage: node scripts/acceptance/p16-proposals.mjs
import fs from "node:fs";
import path from "node:path";
import { as, home, researchTeam, verdict } from "./lib/scenario.mjs";

const { employee, leadAgentId, ctx } = await researchTeam();
const profileDir = path.join(home, "profile");
const userFile = path.join(profileDir, "user.md");
const propFile = path.join(profileDir, "proposals.json");
const backup = { user: fs.existsSync(userFile) ? fs.readFileSync(userFile, "utf8") : null, props: fs.existsSync(propFile) ? fs.readFileSync(propFile, "utf8") : null };
const MARK = Date.now().toString(36);
const now = new Date().toISOString();
const mine = [
  { id: `p16a-${MARK}`, text: `用户做实验习惯先跑小规模冒烟测试（p16-${MARK}）`, from: "p16 验收", status: "pending", createdAt: now },
  { id: `p16b-${MARK}`, text: `用户喜欢长篇大论的汇报（p16-reject-${MARK}）`, from: "p16 验收", status: "pending", createdAt: now },
];
const results = {};
try {
  const existing = backup.props ? JSON.parse(backup.props) : [];
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(propFile, JSON.stringify([...existing, ...mine], null, 2));

  const pending = await as("GET", "/profile/proposals?status=pending");
  results.listed = mine.every((m) => pending.some((p) => p.id === m.id));

  const EDITED = `用户做实验习惯先跑一轮小规模冒烟测试再放大（p16-${MARK}）`;
  await as("POST", `/profile/proposals/${mine[0].id}/accept`, { text: EDITED });
  await as("POST", `/profile/proposals/${mine[1].id}/reject`, {});
  const user = fs.readFileSync(userFile, "utf8");
  results.acceptedWithEdit = user.includes(EDITED) && !user.includes(mine[0].text);
  results.rejectedKeptOut = !user.includes(`p16-reject-${MARK}`);
  const all = await as("GET", "/profile/proposals");
  results.statuses = mine.map((m) => all.find((p) => p.id === m.id)?.status);

  // inlined into the agents' instructions (refreshed when the profile changes)
  const instr = (agent) => {
    const cwd = agent?.adapterConfig?.cwd;
    const f = cwd && path.join(cwd, ".agenteam", "instructions.md");
    return f && fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  };
  const lead = ctx.agents.find((a) => a.id === leadAgentId);
  results.inLeadInstructions = instr(lead).includes(EDITED);
  results.inEmployeeInstructions = instr(employee).includes(EDITED);
} finally {
  if (backup.user === null) fs.rmSync(userFile, { force: true });
  else fs.writeFileSync(userFile, backup.user);
  if (backup.props === null) fs.rmSync(propFile, { force: true });
  else fs.writeFileSync(propFile, backup.props);
  await as("PUT", "/profile/user", { text: backup.user ?? "" }).catch(() => {}); // refresh instructions back
}
verdict(
  "p16-proposals",
  results.listed && results.acceptedWithEdit && results.rejectedKeptOut && results.statuses?.join() === "accepted,rejected" && results.inLeadInstructions && results.inEmployeeInstructions,
  results,
);
