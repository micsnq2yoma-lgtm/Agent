// Sharing (PLAN 7.4 / P6): export a live department as a department pack; import = createDepartment.
import fs from "node:fs";
import path from "node:path";
import { api as defaultApi, list } from "./paperclip.mjs";

function readIdentity(cwd) {
  try {
    const text = fs.readFileSync(path.join(cwd, "memory", "identity.md"), "utf8");
    // keep only the free-text part after the bullet header
    const parts = text.split(/\n\n/);
    return parts.slice(2).join("\n\n").trim();
  } catch {
    return "";
  }
}

export async function exportDepartment(key, { api = defaultApi, companyId } = {}) {
  if (!key) throw Object.assign(new Error("缺少部门 key"), { status: 400 });
  const companies = list(await api("GET", "/companies")).filter((c) => c.status !== "archived");
  const company = companyId ? companies.find((c) => c.id === companyId) : companies.find((c) => c.name === "AgenTeam" || c.name === "Agentself") ?? companies[0];
  if (!company) throw Object.assign(new Error("没有 company"), { status: 404 });
  const agents = list(await api("GET", `/companies/${company.id}/agents`)).filter((a) => a.metadata?.agenteam?.department === key);
  if (agents.length === 0) throw Object.assign(new Error(`部门 ${key} 不存在`), { status: 404 });
  const projectId = agents[0].metadata.agenteam.projectId;
  const project = list(await api("GET", `/companies/${company.id}/projects`)).find((p) => p.id === projectId);
  const routines = list(await api("GET", `/companies/${company.id}/routines`).catch(() => [])).filter((r) => r.projectId === projectId);

  const toMember = (a) => ({
    key: a.metadata.agenteam.memberKey,
    name: a.name,
    title: a.title ?? "",
    role: a.role,
    adapterType: a.adapterType,
    ...(a.adapterConfig?.model ? { model: a.adapterConfig.model } : {}),
    capabilities: a.capabilities ?? "",
    budgetMonthlyCents: a.budgetMonthlyCents ?? 0,
    identity: readIdentity(a.adapterConfig?.cwd ?? ""),
  });
  const lead = agents.find((a) => a.metadata.agenteam.isLead);
  const pack = {
    schema: "agenteam.department/1",
    name: project?.name ?? agents[0].metadata.agenteam.departmentName ?? key,
    icon: agents.find((a) => !a.metadata.agenteam.isLead)?.icon ?? "bot",
    description: project?.description ?? "",
    budgetMonthlyCents: agents.reduce((s, a) => s + (a.budgetMonthlyCents ?? 0), 0),
    lead: lead ? toMember(lead) : null,
    members: agents.filter((a) => !a.metadata.agenteam.isLead).map(toMember),
    skills: ["agenteam-lead", "agenteam-employee", "agenteam-memory"],
    routines: [],
  };
  for (const r of routines) {
    const triggers = list(await api("GET", `/routines/${r.id}/triggers`).catch(() => r.triggers ?? []));
    const cron = triggers.find((t) => t.cronExpression)?.cronExpression;
    const assignee = agents.find((a) => a.id === r.assigneeAgentId);
    pack.routines.push({
      key: `r-${pack.routines.length + 1}`,
      title: r.title ?? r.name ?? "routine",
      ...(cron ? { cron } : { webhook: true }),
      to: assignee?.metadata.agenteam.isLead ? "lead" : (assignee?.metadata.agenteam.memberKey ?? "lead"),
      prompt: r.description ?? r.title ?? "",
    });
  }
  return pack;
}
