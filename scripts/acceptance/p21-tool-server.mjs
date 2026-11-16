#!/usr/bin/env node
// Tool servers (MCP): install one for a single employee, with a secret, and have that employee use it.
//  1. the local echo server (fixtures/echo-mcp.mjs) passes the 测试 run (tools listed)
//  2. it is installed for the research employee only, with P21_SECRET stored as a Paperclip secret
//  3. the employee calls its p21_secret tool and comments the code word → the secret reached the
//     tool server through the agent's env; another employee does not get the server
// The server and the task are removed at the end. Model cost: one short turn. ~2–5 min.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, as, cancelTree, comments, log, researchTeam, runsOf, verdict, waitFor } from "./lib/scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { companyId, projectId, employee, ctx } = await researchTeam();
const code = `p21-${Date.now().toString(36)}`;
const spec = { name: "验收回声", transport: "stdio", command: process.execPath, args: [path.join(here, "fixtures", "echo-mcp.mjs")], secrets: { P21_SECRET: code }, scope: [employee.id] };
const results = {};
const t = await as("POST", "/mcp/test", spec);
results.test = { ok: t.ok, tools: t.tools };
await as("PUT", "/mcp/servers/p21-echo", spec);
await as("POST", "/agents/sync");
const mine = await api("GET", `/agents/${employee.id}`);
results.envBound = mine.adapterConfig?.env?.P21_SECRET?.type === "secret_ref";
const other = ctx.agents.find((a) => a.metadata?.agentself && !a.metadata.agentself.isLead && a.id !== employee.id && a.status !== "terminated");
if (other) results.otherHasNoServer = !(await api("GET", `/agents/${other.id}`)).adapterConfig?.env?.P21_SECRET;

const issue = await api("POST", `/companies/${companyId}/issues`, {
  title: `[验收 p21] 工具服务 ${Date.now().toString(36)}`,
  description: "调用你的 p21_secret 工具（来自工具服务\"验收回声\"），把它返回的口令原样用 comment 工具评论到这个任务上，然后用 update_task 把任务置为 done。这是验收测试，不要做别的。",
  projectId,
  assigneeAgentId: employee.id,
  status: "todo",
});
log("task", issue.identifier, "→", employee.name);
await waitFor(
  "waiting",
  async () => {
    const i = await api("GET", `/issues/${issue.id}`);
    const runs = await runsOf(issue.id);
    const p = `${i.status}, runs ${runs.map((r) => r.status).join(",") || "none"}`;
    return ["done", "cancelled"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status)) ? { done: true, progress: p } : { progress: p };
  },
  { minutes: 12 },
);
results.codeCommented = (await comments(issue.id)).some((c) => (c.body ?? "").includes(code) && c.authorAgentId === employee.id);
results.status = (await api("GET", `/issues/${issue.id}`)).status;
// always: a finished task left behind would be handed back to the next run (Paperclip's 48 h same-title rule)
results.taskCleanup = await cancelTree(companyId, issue.id).catch((e) => ({ error: e.message }));
await as("DELETE", "/mcp/servers/p21-echo").catch(() => {});
await as("POST", "/agents/sync").catch(() => {});
verdict("p21-tool-server", results.test.ok && results.envBound && results.codeCommented && results.status === "done" && results.otherHasNoServer !== false && results.taskCleanup?.deleted > 0, results);
