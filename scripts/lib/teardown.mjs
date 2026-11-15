// Remove a team made by the wizard or a test: its agents, their routines and the team project.
// Deletes where Paperclip allows it and falls back to terminate / archive when history (runs,
// issues) keeps a row alive; either way the team leaves the sidebar and the counts.
import { api, list } from "./paperclip.mjs";

/** @param {{ companyId: string, projectId?: string | null, members: string[] }} team */
export async function removeTeam(team, { call = api } = {}) {
  const done = [];
  const routines = list(await call("GET", `/companies/${team.companyId}/routines`).catch(() => []));
  for (const r of routines.filter((r) => team.members.includes(r.assigneeAgentId) || (team.projectId && r.projectId === team.projectId))) {
    // Paperclip has no routine delete; archived routines never fire
    await call("PATCH", `/routines/${r.id}`, { status: "archived" })
      .then(() => done.push(`routine ${r.id} archived`))
      .catch((e) => done.push(`routine ${r.id} kept: ${e.message}`));
  }
  for (const id of team.members) {
    await call("DELETE", `/agents/${id}`)
      .then(() => done.push(`agent ${id} deleted`))
      .catch(() => call("POST", `/agents/${id}/terminate`, {}).then(() => done.push(`agent ${id} terminated`)))
      .catch((e) => done.push(`agent ${id} kept: ${e.message}`));
  }
  if (team.projectId) {
    await call("DELETE", `/projects/${team.projectId}`)
      .then(() => done.push(`project ${team.projectId} deleted`))
      .catch(() => call("PATCH", `/projects/${team.projectId}`, { archivedAt: new Date().toISOString() }).then(() => done.push(`project ${team.projectId} archived`)))
      .catch((e) => done.push(`project ${team.projectId} kept: ${e.message}`));
  }
  return done;
}
