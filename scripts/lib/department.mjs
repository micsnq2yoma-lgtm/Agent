// Create a team (one lead + employees) in Paperclip from a pack. Shared by the CLI script and the console server.
// Plan B (docs/v0.6-direction.md): the user names every lead and employee; nothing is preset. A request
// reaches a lead (picked by the router), the lead understands it, picks an employee, verifies the result
// and reports. Leads never do the work: their Claude Code runs with management tools only (see LEAD_TOOLS).
import fs from "node:fs";
import { migrateRuntimeDir } from "./legacy.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api as defaultApi, ensureCompany as defaultEnsureCompany, list } from "./paperclip.mjs";
import { initMemory, removeMemoryEntry } from "./memory.mjs";
import { instructionsPath, writeInstructions } from "./instructions.mjs";
import { ensureProfile, importRef, profilePath } from "./profile.mjs";
import { mergeEnv, resolveSource, sourceOf } from "./providers.mjs";
import { allMcpEnvKeys, claudeMcpEntries, codexMcpEntries, mcpEnvFor as serverEnvFor, tomlArr, tomlStr } from "./mcp-servers.mjs";
import { MAIL_ENV_PREFIX, mailEnv } from "../../apps/console/server/mail.mjs";

/** Secret env bindings an agent needs: its tool servers' secrets and the mailbox app passwords. */
const mcpEnvFor = (agent) => ({ ...serverEnvFor(agent), ...mailEnv() });

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const agenteamHome = () => process.env.AGENTEAM_HOME ?? path.join(os.homedir(), ".agenteam");

// Overridable for Anthropic-compatible providers (e.g. DeepSeek): set AGENTEAM_LEAD_MODEL to the provider's
// model id, or to an alias such as "opus" that Claude Code maps through ANTHROPIC_DEFAULT_OPUS_MODEL.
export const DEFAULT_LEAD_MODEL = process.env.AGENTEAM_LEAD_MODEL || "claude-opus-5-5";

const SKILL_DIRS = { "agenteam-lead": "lead", "agenteam-employee": "employee", "agenteam-memory": "memory" };
// Skills reach agents through their instructions file (see writeAgentRuntime): Paperclip-mounted
// skills did not load on the CLI engine ("Unknown skill"), so nothing depends on them any more.
const LEAD_SKILLS = [];
const EMPLOYEE_SKILLS = [];

/**
 * Super-Agent's lesson: "the lead does not do the work" must be enforced by the architecture, not by a
 * prompt. A lead's Claude Code gets only what managing needs: the AgenTeam team MCP server (every
 * Paperclip action a lead takes), reading files and the web, and editing its own memory. No shell of any
 * kind (Bash or Windows PowerShell), no general file writes, no subagents. Without
 * --dangerously-skip-permissions, anything outside the allow list is denied in non-interactive runs,
 * and the deny list wins over any allow rule from settings files.
 *
 * P1 on Windows taught the second rule: Paperclip runs a child task in its parent's execution
 * workspace, so an employee can run in its lead's directory. Everything that belongs to an agent rides
 * on the agent's own config, never on a working directory: identity, skill and memory location go in
 * `instructionsFilePath` (injected into every run), permissions and the MCP server in CLI args. Both
 * only work on the CLI engine (the ACP engine ignores them), so every Claude agent runs on CLI.
 */
export const LEAD_TOOLS = {
  allowed: ["mcp__agenteam", "Read", "Grep", "Glob", "WebSearch", "WebFetch"],
  disallowed: ["Bash", "PowerShell", "Task", "Agent", "NotebookEdit"],
};

export const TEAM_MCP_SERVER = path.join(repoRoot, "apps", "console", "server", "mcp-team.mjs");

/** Claude Code permission rule for an absolute path: "//abs/path", Windows drives as "//c/Users/…". */
export function absPathRule(tool, dir) {
  const posix = dir.split(path.sep).join("/").replace(/\\/g, "/");
  const win = posix.match(/^([A-Za-z]):\/(.*)$/);
  const p = win ? `/${win[1].toLowerCase()}/${win[2]}` : posix;
  return `${tool}(/${p.replace(/\/+$/, "")}/**)`;
}

const runtimeDir = (cwd) => path.join(cwd, ".agenteam");
export { instructionsPath };
const mcpConfigPath = (cwd) => path.join(runtimeDir(cwd), "mcp.json");

/** What the team MCP server needs from the run (Codex forwards only listed variables to MCP servers). */
export const TEAM_MCP_ENV = ["PAPERCLIP_API_URL", "PAPERCLIP_API_KEY", "PAPERCLIP_AGENT_ID", "PAPERCLIP_COMPANY_ID", "PAPERCLIP_RUN_ID", "PAPERCLIP_TASK_ID", "AGENTEAM_HOME"];

/**
 * Codex has no --mcp-config: MCP servers come from config.toml, which `-c` overrides per run. The
 * team server is registered this way so Codex employees get the same tools as Claude employees
 * (submit_evidence, watch_job, comments…) instead of hand-written curl.
 *
 * No argument may contain whitespace (see tomlStr): Windows splits it on the way to Codex. Node's
 * default Windows location ("C:\Program Files\nodejs") has a space, so there the server is started
 * as plain `node` from PATH, which is where that install puts it.
 */
export function codexMcpArgs({ role = "employee", nodePath = process.execPath } = {}) {
  const r = role === "lead" ? "lead" : "employee";
  const node = /\s/.test(nodePath) ? "node" : nodePath;
  return [
    "-c", `mcp_servers.agenteam.command=${tomlStr(node)}`,
    "-c", `mcp_servers.agenteam.args=${tomlArr([TEAM_MCP_SERVER, `--role=${r}`])}`,
    "-c", `mcp_servers.agenteam.env_vars=${tomlArr([...TEAM_MCP_ENV, ...Object.keys(mailEnv())])}`,
    "-c", "mcp_servers.agenteam.startup_timeout_sec=20",
  ];
}

/** Adapter config for one agent. `cwd` is the agent's own home directory (its memory lives there). */
export function agentAdapterConfig({ role, adapterType = "claude_local", cwd, model, workspacesDir, nodePath = process.execPath, agent = null }) {
  const base = { cwd, instructionsFilePath: instructionsPath(cwd), ...(model ? { model } : {}) };
  if (role === "lead") {
    const mem = path.join(cwd, "memory");
    return {
      ...base,
      model: model || DEFAULT_LEAD_MODEL,
      engine: "cli",
      dangerouslySkipPermissions: false,
      extraArgs: [
        "--allowedTools",
        [...LEAD_TOOLS.allowed, absPathRule("Edit", mem), absPathRule("Write", mem)].join(","),
        "--disallowedTools",
        LEAD_TOOLS.disallowed.join(","),
        "--mcp-config",
        mcpConfigPath(cwd),
        "--add-dir",
        workspacesDir,
      ],
    };
  }
  // Employees keep every tool and get the team MCP server (employee role), so they need no curl.
  if (adapterType === "claude_local") return { ...base, engine: "cli", extraArgs: ["--mcp-config", mcpConfigPath(cwd), "--add-dir", cwd] };
  if (adapterType === "codex_local")
    // CLI engine (extraArgs and instructions apply only there); no Codex sandbox: on Windows it fails
    // to start shells (error 1223, PR #4 p13), and employees already work in their own directory.
    return { ...base, engine: "cli", dangerouslyBypassApprovalsAndSandbox: true, extraArgs: [...codexMcpArgs({ role: "employee", nodePath }), ...codexMcpEntries(agent ?? { metadata: { agenteam: { isLead: false } } })] };
  return base;
}


/**
 * An agent's env: its own keys, the model source's (API endpoint + key) and the secrets of the tool
 * servers that apply to it. Keys managed here that no longer apply are dropped.
 */
function agentEnv(cur, run, agent) {
  const mcpKeys = new Set(allMcpEnvKeys());
  // mailbox bindings are all re-added below; any left from a removed account goes
  const own = Object.fromEntries(Object.entries(cur ?? {}).filter(([k]) => !mcpKeys.has(k) && !k.startsWith(MAIL_ENV_PREFIX)));
  return { ...(run ? mergeEnv(own, run.env) : own), ...mcpEnvFor(agent) };
}

/** Add a source's env bindings (API models) to an adapter config; nothing for subscriptions. */
function withEnv(config, env) {
  return env && Object.keys(env).length ? { ...config, env } : config;
}

/**
 * Write the agent's runtime files into its own home directory (rewritten on every sync, so skill and
 * tool updates reach existing agents):
 *  - .agenteam/instructions.md: skill + profile and memory contents (adapter instructionsFilePath;
 *    regenerated whenever memory or the profile changes, see scripts/lib/instructions.mjs)
 *  - .agenteam/mcp.json: the team MCP server for Claude agents
 * and clean up what older versions left in the directory: the identity block in CLAUDE.md / AGENTS.md,
 * and for leads a .claude/settings.local.json that widened or (later) narrowed permissions for whoever
 * runs there. The replaced settings file is kept as .bak.
 */
export function writeAgentRuntime(cwd, { role, adapterType = "claude_local", home = agenteamHome(), nodePath = process.execPath, agent = null }) {
  migrateRuntimeDir(cwd);
  fs.mkdirSync(runtimeDir(cwd), { recursive: true });
  // Skill + the *contents* of the global profile and of the agent's memory (P4: paths alone get skipped).
  writeInstructions({ role, cwd, home, adapterType, repoRoot });
  if (adapterType === "claude_local") {
    // the team server, plus the tool servers installed for this employee (capabilities → 工具服务)
    const extra = role === "lead" ? {} : claudeMcpEntries(agent ?? { metadata: { agenteam: { isLead: false } } });
    fs.writeFileSync(mcpConfigPath(cwd), JSON.stringify({ mcpServers: { ...extra, agenteam: { command: nodePath, args: [TEAM_MCP_SERVER, `--role=${role === "lead" ? "lead" : "employee"}`] } } }, null, 2));
  }
  removeMemoryEntry(cwd);
  for (const stale of ["lead-skill.md"]) fs.rmSync(path.join(runtimeDir(cwd), stale), { force: true });
  if (role === "lead") {
    const local = path.join(cwd, ".claude", "settings.local.json");
    const neutral = JSON.stringify({ _agenteam: "managed by AgenTeam: permissions live in the agent's own config, not in this directory" }, null, 2);
    if (fs.existsSync(local)) {
      const old = fs.readFileSync(local, "utf8");
      if (!old.includes('"_agenteam"')) fs.writeFileSync(`${local}.bak`, old);
      fs.writeFileSync(local, neutral);
    }
  }
}

/** Bring an existing AgenTeam agent (lead or employee) up to date: runtime files and adapter config. */
export async function syncAgentRuntime(agent, { api = defaultApi, workspacesDir = path.join(agenteamHome(), "workspaces"), log = console.log } = {}) {
  const meta = agent.metadata?.agenteam;
  const cwd = agent.adapterConfig?.cwd;
  if (!meta || !cwd) return false;
  const role = meta.isLead ? "lead" : "employee";
  fs.mkdirSync(cwd, { recursive: true });
  const home = agenteamHome();
  ensureProfile(home);
  writeAgentRuntime(cwd, { role, adapterType: agent.adapterType, home, agent });
  // API models: provider settings (endpoint, model, key) may have changed since the agent was made
  let run = null;
  try {
    run = resolveSource(sourceOf(agent), home, { model: meta.model ?? null });
  } catch (e) {
    log(`${role} ${agent.name}: ${e.message}`);
  }
  const apiModel = run && Object.keys(run.env).length ? run.model : undefined;
  const want = agentAdapterConfig({ role, adapterType: agent.adapterType, cwd, model: apiModel ?? agent.adapterConfig?.model, workspacesDir, agent });
  const cur = agent.adapterConfig ?? {};
  const env = agentEnv(cur.env, run, agent);
  if (Object.keys(env).length || Object.keys(cur.env ?? {}).length) want.env = env;
  if (JSON.stringify({ ...cur, ...want }) !== JSON.stringify(cur)) {
    // full config (cur + want) replaces the stored one, so env keys we dropped really go away
    await api("PATCH", `/agents/${agent.id}`, { adapterConfig: { ...cur, ...want }, replaceAdapterConfig: true });
    log(`${role} ${agent.name}: runtime updated`);
  }
  return true;
}
/** @deprecated kept for callers of the previous release */
export const syncLeadRuntime = syncAgentRuntime;

export function validatePack(pack) {
  const errs = [];
  if (!pack || !["agenteam.department/1", "agentself.department/1"].includes(pack.schema)) errs.push("schema 必须是 agenteam.department/1");
  if (!pack?.name) errs.push("缺少团队名称");
  if (!pack?.lead) errs.push("每个团队要有一名主管");
  else {
    if (!pack.lead.name) errs.push("主管缺少名字");
    // Tool restriction relies on Claude Code CLI flags: a lead runs on Claude Code (subscription or an API).
    if ((pack.lead.adapterType ?? "claude_local") !== "claude_local" || pack.lead.source === "codex") errs.push("主管只能用 Claude Code（Claude 订阅或 API 模型）：工具限制依赖它");
  }
  if (!Array.isArray(pack?.members) || pack.members.length === 0) errs.push("至少要有一名员工");
  for (const m of pack?.members ?? []) {
    if (!m.key || !m.name) errs.push("员工缺少 key 或 name");
    if (!m.source && !["claude_local", "codex_local"].includes(m.adapterType)) errs.push(`员工 ${m.name} 的 adapterType 不支持`);
    if (m.source && !/^(claude|codex|api:[a-z0-9-]+)$/.test(m.source)) errs.push(`员工 ${m.name} 的模型来源不支持：${m.source}`);
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

export async function createDepartment(pack, { key, companyName = "AgenTeam", api = defaultApi, ensureCompany = defaultEnsureCompany, log = console.log } = {}) {
  const errs = validatePack(pack);
  if (errs.length) throw Object.assign(new Error(errs.join("；")), { status: 400 });
  const lead = { key: "lead", role: "pm", adapterType: "claude_local", ...pack.lead };
  const deptKey = key ?? pack.key ?? slugKey(pack.name);
  const home = agenteamHome();
  const workspacesDir = path.join(home, "workspaces");
  const company = await ensureCompany(companyName);
  log(`company ${company.name} ${company.id}`);

  // Register the company before creating anything belonging to the team. An unavailable
  // worker used to fail only after the agents existed, inviting a duplicate creation retry.
  try {
    await registerWithTeamLayer(company.id, { api, log });
  } catch (cause) {
    throw Object.assign(new Error("团队插件尚未就绪，本次未创建主管或员工。请先检查插件启动错误并恢复服务，再重试。", { cause }), { status: 503 });
  }
  ensureProfile(home);

  // 1. skills (always the lead / employee / memory skills, whatever the pack lists)
  const existingSkills = list(await api("GET", `/companies/${company.id}/skills`));
  const skillKeys = {};
  for (const name of Object.keys(SKILL_DIRS)) {
    const file = path.join(repoRoot, "skills", SKILL_DIRS[name], "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const markdown = fs.readFileSync(file, "utf8");
    let skill = existingSkills.find((s) => s.slug === name || s.name === name);
    if (!skill) skill = await api("POST", `/companies/${company.id}/skills`, { name, slug: name, markdown, idempotencyKey: `agenteam:${name}` });
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
      name: member.name,
      title: member.title ?? (isLead ? "主管" : ""),
      department: pack.name,
      reportsTo: isLead ? "用户" : lead.name,
      capabilities: member.capabilities ?? "",
      identity: member.identity ?? "",
    });
    const role = isLead ? "lead" : "employee";
    const source = member.source ?? (member.adapterType === "codex_local" ? "codex" : "claude");
    const run = resolveSource(source, home, { model: member.sourceModel ?? null });
    writeAgentRuntime(cwd, { role, adapterType: run.adapterType, home });
    const fresh = { metadata: { agenteam: { isLead } } }; // tool servers for "all" employees apply from the start
    const adapterConfig = withEnv(agentAdapterConfig({ role, adapterType: run.adapterType, cwd, model: run.model ?? member.model, workspacesDir, agent: fresh }), { ...run.env, ...mcpEnvFor(fresh) });
    const metadata = { agenteam: { department: deptKey, departmentName: pack.name, isLead, memberKey: member.key, projectId: project.id, source } };
    let agent = agents.find((a) => a.metadata?.agenteam?.department === deptKey && a.metadata?.agenteam?.memberKey === member.key);
    if (!agent) {
      agent = await api("POST", `/companies/${company.id}/agents`, {
        name: member.name,
        title: member.title ?? null,
        role: member.role ?? (isLead ? "pm" : "general"),
        icon: isLead ? "crown" : (pack.icon ?? "bot"),
        reportsTo: reportsTo ?? null,
        capabilities: member.capabilities ?? null,
        adapterType: run.adapterType,
        adapterConfig,
        budgetMonthlyCents: member.budgetMonthlyCents ?? perHead,
        permissions: { canCreateAgents: false },
        desiredSkills: skillsFor(isLead),
        metadata,
      });
    } else {
      await api("POST", `/agents/${agent.id}/skills/sync`, { mode: "add", desiredSkills: skillsFor(isLead) }).catch((e) => log(`skills sync skipped: ${String(e).slice(0, 120)}`));
    }
    // Existing agents (re-running setup) get the current runtime config too.
    await syncAgentRuntime({ ...agent, adapterType: agent.adapterType ?? member.adapterType, metadata: agent.metadata ?? metadata, adapterConfig: { ...(agent.adapterConfig ?? {}), cwd } }, { api, workspacesDir, log }).catch((e) =>
      log(`runtime sync skipped for ${member.name}: ${String(e).slice(0, 160)}`),
    );
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
  const plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agenteam.team-layer");
  if (!plugin) throw new Error("团队插件未安装");
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
  const m = lead?.metadata?.agenteam;
  if (!m?.isLead) throw Object.assign(new Error("只能加到主管的团队里"), { status: 400 });
  const name = String(member.name ?? "").trim();
  if (!name) throw Object.assign(new Error("新员工要有名字"), { status: 400 });
  const home = agenteamHome();
  const source = member.source ?? (member.adapterType === "codex_local" ? "codex" : "claude");
  const run = resolveSource(source, home, { model: member.sourceModel ?? null });
  const adapterType = run.adapterType;
  const companyId = lead.companyId;
  ensureProfile(home);
  const desiredSkills = [];
  const memberKey = `${slugKey(name).replace(/^team-/, "m-")}-${Date.now().toString(36)}`;
  const cwd = path.join(home, "workspaces", m.department, memberKey);
  fs.mkdirSync(cwd, { recursive: true });
  initMemory(cwd, {
    role: "employee",
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
    adapterConfig: (writeAgentRuntime(cwd, { role: "employee", adapterType, home }), withEnv(agentAdapterConfig({ role: "employee", adapterType, cwd, model: run.model ?? member.model, workspacesDir: path.join(home, "workspaces") }), { ...run.env, ...mcpEnvFor({ metadata: { agenteam: { isLead: false } } }) })),
    budgetMonthlyCents: member.budgetMonthlyCents ?? 0,
    permissions: { canCreateAgents: false },
    desiredSkills,
    metadata: { agenteam: { department: m.department, departmentName: m.departmentName, isLead: false, memberKey, projectId: m.projectId, source } },
  });
  log(`agent ${name} (${source}) ${agent.id} under ${lead.name}`);
  return agent;
}

/**
 * Move an existing agent to another model source (Claude / Codex subscription, or an API model).
 * Rewrites its runtime files and adapter config from scratch for the new adapter; keeps unrelated
 * adapter settings (timeouts…) and env keys this module does not manage.
 */
export async function setAgentSource(agentId, source, { api = defaultApi, log = console.log } = {}) {
  const agent = await api("GET", `/agents/${agentId}`);
  const meta = agent?.metadata?.agenteam;
  const cwd = agent?.adapterConfig?.cwd;
  if (!meta || !cwd) throw Object.assign(new Error("只能改 AgenTeam 建的主管和员工"), { status: 400 });
  const role = meta.isLead ? "lead" : "employee";
  const home = agenteamHome();
  // a model picked for the old source does not carry over to another provider
  const keepModel = sourceOf(agent) === source ? (meta.model ?? null) : null;
  const run = resolveSource(source, home, { model: keepModel });
  if (role === "lead" && run.adapterType !== "claude_local") throw Object.assign(new Error("主管只能用 Claude Code（Claude 订阅或 API 模型）"), { status: 400 });
  writeAgentRuntime(cwd, { role, adapterType: run.adapterType, home, agent });
  const cur = agent.adapterConfig ?? {};
  const keep = Object.fromEntries(Object.entries(cur).filter(([k]) => !["model", "engine", "extraArgs", "env", "dangerouslyBypassApprovalsAndSandbox", "dangerouslySkipPermissions", "instructionsFilePath"].includes(k)));
  // a subscription after an API model starts from the CLI's default model (leads: Opus)
  const model = run.model ?? (sourceOf(agent) === source ? cur.model : undefined);
  const adapterConfig = { ...keep, ...agentAdapterConfig({ role, adapterType: run.adapterType, cwd, model, workspacesDir: path.join(home, "workspaces"), agent }) };
  const env = agentEnv(cur.env, run, agent);
  if (Object.keys(env).length) adapterConfig.env = env;
  // replaceAdapterConfig: Paperclip merges adapter configs by default, which would keep the old
  // adapter's flags (e.g. Claude --mcp-config on a Codex agent)
  const updated = await api("PATCH", `/agents/${agent.id}`, { adapterType: run.adapterType, adapterConfig, replaceAdapterConfig: true, metadata: { ...agent.metadata, agenteam: { ...meta, source, model: keepModel } } });
  log(`${role} ${agent.name}: source ${sourceOf(agent)} → ${source}`);
  return updated;
}

/**
 * Pick the model an agent runs on within its source (empty = the source's default: the provider's
 * main model, or the CLI's default for a subscription; leads default to Opus).
 */
export async function setAgentModel(agentId, model, { api = defaultApi, log = console.log } = {}) {
  const agent = await api("GET", `/agents/${agentId}`);
  const meta = agent?.metadata?.agenteam;
  if (!meta || !agent.adapterConfig?.cwd) throw Object.assign(new Error("只能改 AgenTeam 建的主管和员工"), { status: 400 });
  const m = String(model ?? "").trim();
  if (m && !/^[\w.:/@-]{1,120}$/.test(m)) throw Object.assign(new Error("模型名不对"), { status: 400 });
  const source = sourceOf(agent);
  const role = meta.isLead ? "lead" : "employee";
  const home = agenteamHome();
  const run = resolveSource(source, home, { model: m || null });
  const cur = agent.adapterConfig ?? {};
  const next = { ...cur };
  if (run.model) next.model = run.model;
  else if (role === "lead") next.model = DEFAULT_LEAD_MODEL;
  else delete next.model;
  const env = agentEnv(cur.env, run, agent);
  if (Object.keys(env).length) next.env = env;
  const updated = await api("PATCH", `/agents/${agent.id}`, { adapterConfig: next, replaceAdapterConfig: true, metadata: { ...agent.metadata, agenteam: { ...meta, model: m || null } } });
  log(`${role} ${agent.name}: model → ${next.model ?? "(默认)"}`);
  return updated;
}
