#!/usr/bin/env node
// Model sources: Codex employees and API-model employees work like Claude ones (team MCP tools).
// For each source (default: codex if this machine has it, plus every API provider with a key):
//   1. a hire request is approved with that source (the approval card's picker)
//   2. a tiny task goes straight to the new employee: leave a comment with a marker and set the
//      task to done, using the team tools (no curl)
//   3. checks: the comment comes from that employee, the task is done, the run used the source's
//      adapter; then the employee is removed
// Model cost: one short turn per source. ~2–6 min each.
// Usage: node scripts/acceptance/p18-model-sources.mjs [--only codex,api:deepseek]
import { removeTeam } from "../lib/teardown.mjs";
import { api, as, comments, log, researchTeam, runsOf, verdict, waitFor } from "./lib/scenario.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const { companyId, projectId, leadAgentId } = await researchTeam();
const models = await as("GET", "/providers");
const sources = only ?? [...(models.subscriptions.codex ? ["codex"] : []), ...models.providers.filter((p) => p.hasKey).map((p) => `api:${p.id}`)];
if (!sources.length) {
  verdict("p18-model-sources", false, { note: "这台电脑没有 Codex，也没有填过 key 的 API 服务商：先在 设置 → 模型与订阅 里配置" });
  process.exit();
}

const results = {};
for (const source of sources) {
  const mark = `p18-${Date.now().toString(36)}`;
  const r = { source };
  results[source] = r;
  let agentId = null;
  try {
    const hire = await as("POST", "/hire-requests", { leadAgentId, name: `验收${source.replace(/^api:/, "")}`, capabilities: "p18 验收用，跑完删除", reason: "p18", adapterType: source === "codex" ? "codex_local" : "claude_local" });
    const done = await as("POST", `/hire-requests/${hire.id}/approve`, { source });
    agentId = done.agentId;
    const agent = await api("GET", `/agents/${agentId}`);
    r.adapterType = agent.adapterType;
    r.storedSource = agent.metadata?.agentself?.source;
    r.codexMcpArgs = agent.adapterType === "codex_local" ? (agent.adapterConfig?.extraArgs ?? []).some((a) => String(a).includes("mcp_servers.agentself")) : undefined;
    r.apiEnv = source.startsWith("api:") ? !!agent.adapterConfig?.env?.ANTHROPIC_BASE_URL : undefined;
    const issue = await api("POST", `/companies/${companyId}/issues`, {
      title: `[验收 p18] ${source} 团队工具`,
      description: `用你的 agentself 团队工具完成，不要用 curl 或命令行调接口：\n1. 用 comment 工具在这个任务上留言：${mark}\n2. 用 update_task 工具把这个任务置为 done。\n这是验收测试，不要做别的。`,
      projectId,
      assigneeAgentId: agentId,
      status: "todo",
    });
    r.task = issue.identifier;
    await waitFor(
      `${source}: waiting`,
      async () => {
        const i = await api("GET", `/issues/${issue.id}`);
        const runs = await runsOf(issue.id);
        const p = `${i.status}, runs ${runs.map((x) => x.status).join(",") || "none"}`;
        return ["done", "cancelled"].includes(i.status) && runs.every((x) => !["running", "queued"].includes(x.status)) ? { done: true, progress: p } : runs.some((x) => x.status === "failed") ? { done: true, progress: p } : { progress: p };
      },
      { minutes: 12 },
    );
    const final = await api("GET", `/issues/${issue.id}`);
    const cs = await comments(issue.id);
    const runs = await runsOf(issue.id);
    r.status = final.status;
    r.commentByEmployee = cs.some((c) => (c.body ?? "").includes(mark) && c.authorAgentId === agentId);
    r.runs = runs.map((x) => `${x.status}${x.adapterType ? `/${x.adapterType}` : ""}`);
    r.failed = runs.filter((x) => x.status === "failed").map((x) => x.error ?? x.errorCode ?? "failed");
    r.pass = r.status === "done" && r.commentByEmployee && r.storedSource === source && (r.codexMcpArgs ?? true) && (r.apiEnv ?? true);
    if (!["done", "cancelled"].includes(final.status)) await api("PATCH", `/issues/${issue.id}`, { status: "backlog" }).catch(() => {});
  } catch (e) {
    r.error = e.message;
    r.pass = false;
  } finally {
    if (agentId) r.cleanup = await removeTeam({ companyId, projectId: null, members: [agentId] });
  }
  log(source, r.pass ? "PASS" : "FAIL");
}
verdict("p18-model-sources", Object.values(results).every((r) => r.pass), results);
