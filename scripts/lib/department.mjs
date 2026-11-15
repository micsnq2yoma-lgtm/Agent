// Create a category of employees in Paperclip from a pack. Shared by the CLI script and the console server.
// Since v0.6 there is no lead per category: every member is an employee who takes tasks from the steward
// and delivers straight to the user. A `lead` in an older pack is created as an ordinary employee.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api as defaultApi, ensureCompany as defaultEnsureCompany, list } from "./paperclip.mjs";
import { initMemory } from "./memory.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const agentselfHome = () => process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");

const SKILL_DIRS = { "agentself-employee": "employee", "agentself-memory": "memory" };

export function validatePack(pack) {
  const errs = [];
  if (!pack || pack.schema !== "agentself.department/1") errs.push("schema 必须是 agentself.department/1");
  if (!pack?.name) errs.push("缺少 name");
  if (!Array.isArray(pack?.members) || pack.members.length === 0) errs.push("至少要有一名成员");
  for (const m of pack?.members ?? []) {
    if (!m.key || !m.name) errs.push("成员缺少 key 或 name");
    if (!["claude_local", "codex_local"].includes(m.adapterType)) errs.push(`成员 ${m.name} 的 adapterType 不支持`);
  }
  return errs;
}

export function slugKey(s) {
  const ascii = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || `dept-${Date.now().toString(36)}`;
}

export async function createDepartment(pack, { key, companyName = "Agentself", api = defaultApi, ensureCompany = defaultEnsureCompany, log = console.log } = {}) {
  const errs = validatePack(pack);
  if (errs.length) throw Object.assign(new Error(errs.join("；")), { status: 400 });
  // Flatten: an old-style lead becomes one more employee.
  if (pack.lead) pack = { ...pack, members: [pack.lead, ...pack.members], lead: null };
  const deptKey = key ?? pack.key ?? slugKey(pack.name);
  const home = agentselfHome();
  const company = await ensureCompany(companyName);
  log(`company ${company.name} ${company.id}`);

  // 1. skills
  const existingSkills = list(await api("GET", `/companies/${company.id}/skills`));
  const skillKeys = {};
  for (const name of pack.skills ?? []) {
    const dir = SKILL_DIRS[name];
    const file = dir && path.join(repoRoot, "skills", dir, "SKILL.md");
    if (!file || !fs.existsSync(file)) continue;
    const markdown = fs.readFileSync(file, "utf8");
    let skill = existingSkills.find((s) => s.slug === name || s.name === name);
    if (!skill) skill = await api("POST", `/companies/${company.id}/skills`, { name, slug: name, markdown, idempotencyKey: `agentself:${name}` });
    else if (skill.markdown !== undefined && skill.markdown !== markdown) {
      // keep the company skill in sync with skills/<dir>/SKILL.md
      await api("PATCH", `/companies/${company.id}/skills/${skill.id}`, { markdown }).catch((e) => log(`skill ${name} update skipped: ${String(e).slice(0, 120)}`));
    }
    skillKeys[name] = skill.key ?? skill.slug ?? name;
  }
  const desiredSkills = [skillKeys["agentself-employee"], skillKeys["agentself-memory"]].filter(Boolean);

  // 2. project
  const projects = list(await api("GET", `/companies/${company.id}/projects`));
  const project =
    projects.find((p) => p.name === pack.name) ?? (await api("POST", `/companies/${company.id}/projects`, { name: pack.name, description: pack.description ?? "" }));
  log(`project ${project.name} ${project.id}`);

  // 3. agents
  const agents = list(await api("GET", `/companies/${company.id}/agents`));
  const perHead = pack.budgetMonthlyCents ? Math.floor(pack.budgetMonthlyCents / pack.members.length) : 0;

  async function ensureAgent(member) {
    const cwd = path.join(home, "workspaces", deptKey, member.key);
    fs.mkdirSync(cwd, { recursive: true });
    initMemory(cwd, {
      name: member.name,
      title: member.title ?? "",
      department: pack.name,
      reportsTo: "用户（任务由总管转交）",
      capabilities: member.capabilities ?? "",
      identity: member.identity ?? "",
    });
    const metadata = { agentself: { department: deptKey, departmentName: pack.name, isLead: false, memberKey: member.key, projectId: project.id } };
    let agent = agents.find((a) => a.metadata?.agentself?.department === deptKey && a.metadata?.agentself?.memberKey === member.key);
    if (!agent) {
      agent = await api("POST", `/companies/${company.id}/agents`, {
        name: member.name,
        title: member.title ?? null,
        role: member.role ?? "general",
        icon: pack.icon ?? "bot",
        reportsTo: null,
        capabilities: member.capabilities ?? null,
        adapterType: member.adapterType,
        adapterConfig: { cwd, ...(member.model ? { model: member.model } : {}) },
        budgetMonthlyCents: member.budgetMonthlyCents ?? perHead,
        permissions: { canCreateAgents: false },
        desiredSkills,
        metadata,
      });
    } else {
      await api("POST", `/agents/${agent.id}/skills/sync`, { mode: "add", desiredSkills }).catch((e) => log(`skills sync skipped: ${String(e).slice(0, 120)}`));
    }
    log(`agent ${member.name} (${member.adapterType}) ${agent.id}`);
    return agent;
  }

  const memberAgents = [];
  for (const m of pack.members) memberAgents.push(await ensureAgent(m));

  // 4. routines (agent-autoloop rules -> Paperclip routines)
  const routineIds = [];
  for (const r of pack.routines ?? []) {
    const assignee = memberAgents[pack.members.findIndex((m) => m.key === r.to)] ?? memberAgents[0];
    try {
      const routine = await api("POST", `/companies/${company.id}/routines`, {
        title: r.title,
        description: r.prompt,
        projectId: project.id,
        assigneeAgentId: assignee.id,
        ...(r.maxActive ? { concurrencyPolicy: "skip_if_active" } : {}),
      });
      if (r.cron) await api("POST", `/routines/${routine.id}/triggers`, { kind: "schedule", cronExpression: r.cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      routineIds.push(routine.id);
      log(`routine ${r.title} ${routine.id}`);
    } catch (e) {
      log(`routine ${r.title} skipped: ${String(e).slice(0, 200)}`);
    }
  }

  await registerWithTeamLayer(company.id, { api, log });

  const out = { companyId: company.id, projectId: project.id, leadAgentId: null, department: deptKey, routineIds };
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, `department-${deptKey}.json`), JSON.stringify(out, null, 2));
  return out;
}

/**
 * Plugin jobs (memory, later reminders) run without a company scope; Paperclip only lets the
 * plugin act proactively on companies that have a config row for it. Create one and tell the
 * plugin about the company.
 */
export async function registerWithTeamLayer(companyId, { api = defaultApi, log = console.log } = {}) {
  const plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agentself.team-layer");
  if (!plugin) return log("team-layer plugin not installed; skipped registration");
  const existing = await api("GET", `/plugins/${plugin.id}/config?companyId=${companyId}`).catch(() => null);
  if (!existing?.configJson) await api("POST", `/plugins/${plugin.id}/config`, { companyId, configJson: {} });
  await api("POST", `/plugins/${plugin.id}/bridge/action`, { key: "register", companyId, params: { companyId } });
  log(`team-layer registered for company ${companyId}`);
}

export function listTemplates() {
  const dir = path.join(repoRoot, "packs", "departments");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { key: path.basename(f, ".json"), name: p.name, icon: p.icon, description: p.description };
    });
}

export function readTemplate(key) {
  if (!/^[a-z0-9-]+$/.test(key)) throw Object.assign(new Error("bad key"), { status: 400 });
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "packs", "departments", `${key}.json`), "utf8"));
}
