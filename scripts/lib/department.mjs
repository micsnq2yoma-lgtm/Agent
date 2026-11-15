// Create a team (one lead + employees) in Paperclip from a pack. Shared by the CLI script and the console server.
// Plan B (docs/v0.6-direction.md): the user names every lead and employee; nothing is preset. A request
// reaches a lead (picked by the router), the lead understands it, picks an employee, verifies the result
// and reports. Leads never do the work: their Claude Code runs with management tools only (see LEAD_TOOLS).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api as defaultApi, ensureCompany as defaultEnsureCompany, list } from "./paperclip.mjs";
import { initMemory } from "./memory.mjs";
import { ensureProfile, importRef, profilePath } from "./profile.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const agentselfHome = () => process.env.AGENTSELF_HOME ?? path.join(os.homedir(), ".agentself");

export const DEFAULT_LEAD_MODEL = "claude-opus-5-5";

const SKILL_DIRS = { "agentself-lead": "lead", "agentself-employee": "employee", "agentself-memory": "memory" };
const LEAD_SKILLS = ["agentself-lead", "agentself-memory"];
const EMPLOYEE_SKILLS = ["agentself-employee", "agentself-memory"];

/**
 * Super-Agent's lesson: "the lead does not do the work" must be enforced by the architecture, not by a
 * prompt. A lead's Claude Code gets only what managing needs: talk to the Paperclip API (curl/jq), read
 * reports and artifacts, search the web, and edit its own memory/ folder. No general file writes, no
 * arbitrary shell, no native subagents. Without --dangerously-skip-permissions, anything outside the
 * allow list is denied in non-interactive runs. Only the CLI engine honours these flags.
 */
export const LEAD_TOOLS = {
  allowed: ["Bash(curl:*)", "Bash(jq:*)", "Read", "Grep", "Glob", "WebSearch", "WebFetch", "Edit(memory/**)", "Write(memory/**)"],
  disallowed: ["Task", "Agent", "NotebookEdit"],
};

export function leadAdapterConfig({ cwd, model, workspacesDir }) {
  return {
    cwd,
    model: model || DEFAULT_LEAD_MODEL,
    engine: "cli",
    dangerouslySkipPermissions: false,
    extraArgs: ["--allowedTools", LEAD_TOOLS.allowed.join(","), "--disallowedTools", LEAD_TOOLS.disallowed.join(","), "--add-dir", workspacesDir],
  };
}

export function validatePack(pack) {
  const errs = [];
  if (!pack || pack.schema !== "agentself.department/1") errs.push("schema 必须是 agentself.department/1");
  if (!pack?.name) errs.push("缺少团队名称");
  if (!pack?.lead) errs.push("每个团队要有一名主管");
  else {
    if (!pack.lead.name) errs.push("主管缺少名字");
    // Tool restriction relies on Claude Code CLI flags; Codex has no equivalent yet.
    if ((pack.lead.adapterType ?? "claude_local") !== "claude_local") errs.push("主管目前只能用 Claude（工具限制依赖 Claude Code）");
  }
  if (!Array.isArray(pack?.members) || pack.members.length === 0) errs.push("至少要有一名员工");
  for (const m of pack?.members ?? []) {
    if (!m.key || !m.name) errs.push("员工缺少 key 或 name");
    if (!["claude_local", "codex_local"].includes(m.adapterType)) errs.push(`员工 ${m.name} 的 adapterType 不支持`);
    if (m.key === (pack.lead?.key ?? "lead")) errs.push(`员工 ${m.name} 的 key 和主管重复`);
  }
  return errs;
}

export function slugKey(s) {
  const ascii = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || `team-${Date.now().toString(36)}`;
}

export async function createDepartment(pack, { key, companyName = "Agentself", api = defaultApi, ensureCompany = defaultEnsureCompany, log = console.log } = {}) {
  const errs = validatePack(pack);
  if (errs.length) throw Object.assign(new Error(errs.join("；")), { status: 400 });
  const lead = { key: "lead", role: "pm", adapterType: "claude_local", ...pack.lead };
  const deptKey = key ?? pack.key ?? slugKey(pack.name);
  const home = agentselfHome();
  const workspacesDir = path.join(home, "workspaces");
  ensureProfile(home);
  const profile = Object.fromEntries(["user", "decisions", "declined", "askfirst"].map((k) => [k, importRef(profilePath(home, k))]));
  const company = await ensureCompany(companyName);
  log(`company ${company.name} ${company.id}`);

  // 1. skills (always the lead / employee / memory skills, whatever the pack lists)
  const existingSkills = list(await api("GET", `/companies/${company.id}/skills`));
  const skillKeys = {};
  for (const name of Object.keys(SKILL_DIRS)) {
    const file = path.join(repoRoot, "skills", SKILL_DIRS[name], "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const markdown = fs.readFileSync(file, "utf8");
    let skill = existingSkills.find((s) => s.slug === name || s.name === name);
    if (!skill) skill = await api("POST", `/companies/${company.id}/skills`, { name, slug: name, markdown, idempotencyKey: `agentself:${name}` });
    else if (skill.markdown !== undefined && skill.markdown !== markdown) {
      // keep the company skill in sync with skills/<dir>/SKILL.md
      await api("PATCH", `/companies/${company.id}/skills/${skill.id}`, { markdown }).catch((e) => log(`skill ${name} update skipped: ${String(e).slice(0, 120)}`));
    }
    skillKeys[name] = skill.key ?? skill.slug ?? name;
  }
  const skillsFor = (isLead) => (isLead ? LEAD_SKILLS : EMPLOYEE_SKILLS).map((n) => skillKeys[n]).filter(Boolean);

  // 2. project (the team's tasks live here)
  const projects = list(await api("GET", `/companies/${company.id}/projects`));
  const project =
    projects.find((p) => p.name === pack.name) ?? (await api("POST", `/companies/${company.id}/projects`, { name: pack.name, description: pack.description ?? "" }));
  log(`project ${project.name} ${project.id}`);

  // 3. agents
  const agents = list(await api("GET", `/companies/${company.id}/agents`));
  const perHead = pack.budgetMonthlyCents ? Math.floor(pack.budgetMonthlyCents / (pack.members.length + 1)) : 0;

  async function ensureAgent(member, isLead, reportsTo) {
    const cwd = path.join(workspacesDir, deptKey, member.key);
    fs.mkdirSync(cwd, { recursive: true });
    initMemory(cwd, {
      role: isLead ? "lead" : "employee",
      profile,
      name: member.name,
      title: member.title ?? (isLead ? "主管" : ""),
      department: pack.name,
      reportsTo: isLead ? "用户" : lead.name,
      capabilities: member.capabilities ?? "",
      identity: member.identity ?? "",
    });
    const adapterConfig = isLead
      ? leadAdapterConfig({ cwd, model: member.model, workspacesDir })
      : { cwd, ...(member.model ? { model: member.model } : {}) };
    const metadata = { agentself: { department: deptKey, departmentName: pack.name, isLead, memberKey: member.key, projectId: project.id } };
    let agent = agents.find((a) => a.metadata?.agentself?.department === deptKey && a.metadata?.agentself?.memberKey === member.key);
    if (!agent) {
      agent = await api("POST", `/companies/${company.id}/agents`, {
        name: member.name,
        title: member.title ?? null,
        role: member.role ?? (isLead ? "pm" : "general"),
        icon: isLead ? "crown" : (pack.icon ?? "bot"),
        reportsTo: reportsTo ?? null,
        capabilities: member.capabilities ?? null,
        adapterType: member.adapterType,
        adapterConfig,
        budgetMonthlyCents: member.budgetMonthlyCents ?? perHead,
        permissions: { canCreateAgents: false },
        desiredSkills: skillsFor(isLead),
        metadata,
      });
    } else {
      await api("POST", `/agents/${agent.id}/skills/sync`, { mode: "add", desiredSkills: skillsFor(isLead) }).catch((e) => log(`skills sync skipped: ${String(e).slice(0, 120)}`));
      // Re-apply the lead's tool restriction in case it was created before plan B or edited by hand.
      if (isLead) await api("PATCH", `/agents/${agent.id}`, { adapterConfig: { ...(agent.adapterConfig ?? {}), ...adapterConfig } }).catch((e) => log(`lead config update skipped: ${String(e).slice(0, 120)}`));
    }
    log(`${isLead ? "lead" : "agent"} ${member.name} (${member.adapterType}) ${agent.id}`);
    return agent;
  }

  const leadAgent = await ensureAgent(lead, true, null);
  const memberAgents = [];
  for (const m of pack.members) memberAgents.push(await ensureAgent(m, false, leadAgent.id));

  // 4. routines (agent-autoloop rules -> Paperclip routines)
  const routineIds = [];
  for (const r of pack.routines ?? []) {
    // Event / schedule work goes straight to an employee (entry 2 of plan B); "lead" is still accepted.
    const assignee = r.to === "lead" ? leadAgent : (memberAgents[pack.members.findIndex((m) => m.key === r.to)] ?? memberAgents[0]);
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

  const out = { companyId: company.id, projectId: project.id, leadAgentId: leadAgent.id, department: deptKey, routineIds };
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

/**
 * Add one employee under an existing lead (plan B step 2: the lead proposes, the user approves,
 * this creates it). The employee joins the lead's team, project, skills and memory layout.
 */
export async function addEmployee(leadAgentId, member, { api = defaultApi, log = console.log } = {}) {
  const lead = await api("GET", `/agents/${leadAgentId}`);
  const m = lead?.metadata?.agentself;
  if (!m?.isLead) throw Object.assign(new Error("只能加到主管的团队里"), { status: 400 });
  const name = String(member.name ?? "").trim();
  if (!name) throw Object.assign(new Error("新员工要有名字"), { status: 400 });
  const adapterType = member.adapterType === "codex_local" ? "codex_local" : "claude_local";
  const companyId = lead.companyId;
  const home = agentselfHome();
  ensureProfile(home);
  const profile = Object.fromEntries(["user", "decisions", "declined", "askfirst"].map((k) => [k, importRef(profilePath(home, k))]));
  const skills = list(await api("GET", `/companies/${companyId}/skills`));
  const desiredSkills = EMPLOYEE_SKILLS.map((n) => skills.find((s) => s.slug === n || s.name === n)).filter(Boolean).map((s) => s.key ?? s.slug);
  const memberKey = `${slugKey(name).replace(/^team-/, "m-")}-${Date.now().toString(36)}`;
  const cwd = path.join(home, "workspaces", m.department, memberKey);
  fs.mkdirSync(cwd, { recursive: true });
  initMemory(cwd, {
    role: "employee",
    profile,
    name,
    title: member.title ?? "",
    department: m.departmentName ?? m.department,
    reportsTo: lead.name,
    capabilities: member.capabilities ?? "",
    identity: member.identity ?? `你是用户的员工「${name}」，在${lead.name}的团队里负责：${member.capabilities ?? ""}`,
  });
  const agent = await api("POST", `/companies/${companyId}/agents`, {
    name,
    title: member.title ?? null,
    role: "general",
    icon: "bot",
    reportsTo: lead.id,
    capabilities: member.capabilities ?? null,
    adapterType,
    adapterConfig: { cwd, ...(member.model ? { model: member.model } : {}) },
    budgetMonthlyCents: member.budgetMonthlyCents ?? 0,
    permissions: { canCreateAgents: false },
    desiredSkills,
    metadata: { agentself: { department: m.department, departmentName: m.departmentName, isLead: false, memberKey, projectId: m.projectId } },
  });
  log(`agent ${name} (${adapterType}) ${agent.id} under ${lead.name}`);
  return agent;
}
