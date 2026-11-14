#!/usr/bin/env node
// Create a department in Paperclip from a department pack (PLAN 7.4).
// Usage: node scripts/setup-department.mjs packs/departments/research.json [--company Agentself]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, ensureCompany, list } from "./lib/paperclip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const packPath = args.find((a) => !a.startsWith("--"));
if (!packPath) {
  console.error("usage: setup-department.mjs <pack.json> [--company <name>]");
  process.exit(2);
}
const companyName = args.includes("--company") ? args[args.indexOf("--company") + 1] : "Agentself";
const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
if (pack.schema !== "agentself.department/1") throw new Error(`unsupported pack schema ${pack.schema}`);

const home = process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dept";
const deptKey = path.basename(packPath, ".json");

const company = await ensureCompany(companyName);
console.log(`company ${company.name} ${company.id}`);

// 1. Skills: upsert company skills from skills/<dir>/SKILL.md
const skillDirs = { "agentself-lead": "lead", "agentself-employee": "employee", "agentself-memory": "memory" };
const existingSkills = list(await api("GET", `/companies/${company.id}/skills`));
const skillKeys = {};
for (const name of pack.skills ?? []) {
  const dir = skillDirs[name];
  const file = dir && path.join(repoRoot, "skills", dir, "SKILL.md");
  if (!file || !fs.existsSync(file)) {
    console.warn(`skill ${name}: no source, skipped`);
    continue;
  }
  const markdown = fs.readFileSync(file, "utf8");
  let skill = existingSkills.find((s) => s.slug === name || s.name === name || s.key === name);
  if (!skill) {
    skill = await api("POST", `/companies/${company.id}/skills`, { name, slug: name, markdown, idempotencyKey: `agentself:${name}` });
  }
  skillKeys[name] = skill.key ?? skill.slug ?? name;
  console.log(`skill ${name} -> ${skillKeys[name]}`);
}
const skillsFor = (isLead) =>
  [isLead ? skillKeys["agentself-lead"] : null, skillKeys["agentself-employee"], skillKeys["agentself-memory"]].filter(Boolean);

// 2. Project for the department
const projects = list(await api("GET", `/companies/${company.id}/projects`));
const project =
  projects.find((p) => p.name === pack.name) ??
  (await api("POST", `/companies/${company.id}/projects`, { name: pack.name, description: pack.description }));
console.log(`project ${project.name} ${project.id}`);

// 3. Agents
const agents = list(await api("GET", `/companies/${company.id}/agents`));
function writeIdentity(cwd, member, isLead, leadName) {
  const mem = path.join(cwd, "memory");
  fs.mkdirSync(path.join(mem, "topics"), { recursive: true });
  fs.mkdirSync(path.join(mem, "log"), { recursive: true });
  const identity = path.join(mem, "identity.md");
  if (!fs.existsSync(identity)) {
    fs.writeFileSync(
      identity,
      `# ${member.name}\n\n- 角色：${member.title}\n- 部门：${pack.name}\n- 汇报对象：${isLead ? "用户" : leadName}\n- 能力：${member.capabilities ?? ""}\n\n${member.identity ?? ""}\n`,
    );
  }
  for (const f of ["style.md", "user.md", "notes.md"]) {
    const p = path.join(mem, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, `# ${f.replace(".md", "")}\n\n`);
  }
}

async function ensureAgent(member, isLead, reportsTo) {
  const cwd = path.join(home, "workspaces", deptKey, member.key);
  fs.mkdirSync(cwd, { recursive: true });
  writeIdentity(cwd, member, isLead, pack.lead?.name ?? "主管");
  const metadata = { agentself: { department: deptKey, departmentName: pack.name, isLead, memberKey: member.key, projectId: project.id } };
  let agent = agents.find((a) => a.metadata?.agentself?.department === deptKey && a.metadata?.agentself?.memberKey === member.key);
  if (!agent) {
    agent = await api("POST", `/companies/${company.id}/agents`, {
      name: member.name,
      title: member.title,
      role: member.role,
      icon: isLead ? "crown" : pack.icon,
      reportsTo: reportsTo ?? null,
      capabilities: member.capabilities ?? null,
      adapterType: member.adapterType,
      adapterConfig: { cwd, ...(member.model ? { model: member.model } : {}) },
      budgetMonthlyCents: member.budgetMonthlyCents ?? 0,
      permissions: { canCreateAgents: false },
      desiredSkills: skillsFor(isLead),
      metadata,
    });
  }
  console.log(`agent ${member.name} (${member.adapterType}) ${agent.id}`);
  return agent;
}

const lead = pack.lead ? await ensureAgent(pack.lead, true, null) : null;
for (const m of pack.members) await ensureAgent(m, false, lead?.id ?? null);

const out = { companyId: company.id, projectId: project.id, leadAgentId: lead?.id ?? null, department: deptKey };
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, `department-${deptKey}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
