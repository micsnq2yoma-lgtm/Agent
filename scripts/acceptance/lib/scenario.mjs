// Shared helpers for the scenario acceptance scripts (p11–p17). They talk to Paperclip through
// scripts/lib/paperclip.mjs and to the AgenTeam service through the same :3100 origin.
import { resolveHome } from "../../lib/legacy.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list, API } from "../../lib/paperclip.mjs";

export { api, list };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const home = resolveHome();

/** AgenTeam local service (proxied by Paperclip at /agenteam/api). */
export async function as(method, p, body) {
  const r = await fetch(`${API}/agenteam/api${p}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

/** The research team made by `setup-department.mjs scripts/acceptance/fixtures/research.json`. */
export async function researchTeam() {
  const file = path.join(home, "department-research.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const ctx = await as("GET", "/context");
  const dept = ctx.departments.find((d) => d.key === "research") ?? ctx.departments.find((d) => d.leadAgentId === saved.leadAgentId);
  if (!dept) throw new Error("没有 research 团队：先运行 node scripts/setup-department.mjs scripts/acceptance/fixtures/research.json");
  const employees = ctx.agents.filter((a) => dept.members.includes(a.id) && a.id !== dept.leadAgentId && a.status !== "terminated");
  const employee = employees.find((a) => a.id === process.env.AGENTEAM_EMPLOYEE || a.name === process.env.AGENTEAM_EMPLOYEE) ?? employees[0];
  if (!employee) throw new Error("research 团队没有员工");
  return { ctx, companyId: ctx.company.id, projectId: dept.projectId, leadAgentId: dept.leadAgentId, dept, employee, employees };
}

/** Poll `fn` until it returns something truthy, or give up after `minutes`. */
export async function waitFor(label, fn, { minutes = 30, everyMs = 15_000 } = {}) {
  const end = Date.now() + minutes * 60_000;
  let last = "";
  while (Date.now() < end) {
    const v = await fn();
    if (v && v !== true && typeof v === "object" && "progress" in v) {
      if (v.progress !== last) log(label, v.progress);
      last = v.progress;
      if (v.done) return v.value ?? true;
    } else if (v) return v;
    await sleep(everyMs);
  }
  log(label, "timed out");
  return null;
}

export const interactions = async (issueId) => list(await api("GET", `/issues/${issueId}/interactions`).catch(() => []));
export const pendingCards = async (issueId) => (await interactions(issueId)).filter((i) => (i.status ?? "pending") === "pending");
export const comments = async (issueId) => list(await api("GET", `/issues/${issueId}/comments`).catch(() => []));
export const runsOf = async (issueId) => list(await api("GET", `/issues/${issueId}/runs`).catch(() => []));
export const childrenOf = async (companyId, issueId) => list(await api("GET", `/companies/${companyId}/issues`)).filter((i) => i.parentId === issueId);
export async function docText(issueId, key) {
  try {
    const d = await api("GET", `/issues/${issueId}/documents/${key}`);
    return d?.body ?? d?.markdown ?? d?.latestRevision?.body ?? "";
  } catch {
    return null;
  }
}

/** Answer a card the way the user would on the workbench: the first option / 确认. */
export async function answerCard(issueId, card, optionIndex = 0) {
  const kind = card.kind ?? card.type;
  if (kind === "request_confirmation") return api("POST", `/issues/${issueId}/interactions/${card.id}/accept`, {});
  const q = card.payload?.questions?.[0];
  const opt = q?.options?.[optionIndex] ?? q?.options?.[0];
  if (!q || !opt) return api("POST", `/issues/${issueId}/interactions/${card.id}/accept`, {}).catch(() => null);
  return api("POST", `/issues/${issueId}/interactions/${card.id}/respond`, { answers: [{ questionId: q.id, optionIds: [opt.id] }] });
}

/**
 * Cancel a task and all its subtasks so nobody keeps working (and spending) after the check.
 * Never cancels under a running agent: a run stopped mid-way never gets its usage receipt, and
 * Paperclip then hard-pauses that agent's budget for good (PR #4 run: amountObserved 0, paused).
 * So: wait for the tree's runs to finish (up to `waitMinutes`), then cancel. Tasks still running
 * after that are left alone and reported.
 */
export async function cancelTree(companyId, issueId, { waitMinutes = 20 } = {}) {
  const all = list(await api("GET", `/companies/${companyId}/issues`));
  const ids = [issueId];
  for (let i = 0; i < ids.length; i++) for (const c of all.filter((x) => x.parentId === ids[i])) ids.push(c.id);
  const busy = async () => {
    const out = [];
    for (const id of ids) if ((await runsOf(id)).some((r) => ["running", "queued"].includes(r.status))) out.push(id);
    return out;
  };
  // pausing first stops new wakeups while the current turn finishes
  for (const id of ids) await api("PATCH", `/issues/${id}`, { status: "backlog" }).catch(() => {});
  const end = Date.now() + waitMinutes * 60_000;
  let running = await busy();
  while (running.length && Date.now() < end) {
    log(`cleanup: waiting for ${running.length} running task(s) to finish before cancelling`);
    await sleep(20_000);
    running = await busy();
  }
  // cancel, then delete: Paperclip hands back an unfinished task with the same title within 48 h,
  // so a task left behind would be picked up again by the next run of the same script
  let deleted = 0;
  for (const id of [...ids].reverse()) {
    if (running.includes(id)) continue;
    await api("PATCH", `/issues/${id}`, { status: "cancelled" }).catch(() => {});
    if (await api("DELETE", `/issues/${id}`).then(() => true, () => false)) deleted++;
  }
  if (running.length) log(`cleanup: left ${running.length} task(s) paused (backlog) because a run is still going; cancel them by hand later`);
  return { cancelled: ids.length - running.length, deleted, leftRunning: running };
}

/** Notices the team-layer plugin holds (notify_user, memory job). */
export async function notices(companyId) {
  const plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agentself.team-layer");
  if (!plugin) return [];
  const r = await api("POST", `/plugins/${plugin.id}/data/notices`, { companyId, params: { companyId } }).catch(() => null);
  return Array.isArray(r?.data) ? r.data : [];
}
export async function dismissNotice(companyId, id) {
  const plugin = list(await api("GET", "/plugins")).find((p) => p.pluginKey === "agentself.team-layer");
  return api("POST", `/plugins/${plugin.id}/actions/notice-dismiss`, { companyId, params: { companyId, id } });
}

/** A scratch directory outside every agent's workspace. */
export function scratch(name) {
  const dir = path.join(os.tmpdir(), `agenteam-${name}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Print the one-line verdict the PR checklist asks for and set the exit code. */
export function verdict(name, pass, results) {
  console.log(`RESULT ${name} ${pass ? "PASS" : "FAIL"} ${JSON.stringify(results)}`);
  process.exitCode = pass ? 0 : 1;
}
