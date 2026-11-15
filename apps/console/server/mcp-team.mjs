#!/usr/bin/env node
// Agentself team MCP server (plan B, step 2 fix). Gives a lead every action it needs as MCP tools, so its
// Claude Code needs no shell at all: on Windows Claude Code runs commands through PowerShell, where a
// Bash(curl:*) allow rule never matches, and a shell is exactly what a lead must not have anyway.
//
// Launched by Claude Code over stdio (see leadRuntimeFiles in scripts/lib/department.mjs). It inherits the
// run's environment: PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_AGENT_ID, PAPERCLIP_COMPANY_ID,
// PAPERCLIP_RUN_ID. Zero dependencies: newline-delimited JSON-RPC 2.0 on stdin/stdout, logs on stderr.
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const env = (k) => process.env[k] ?? "";
const PLUGIN = "agentself.team-layer";

/* ---------------- HTTP helpers ---------------- */

async function call(base, method, p, body, auth = true) {
  const url = `${env("PAPERCLIP_API_URL").replace(/\/$/, "")}${base}${p}`;
  const headers = { "content-type": "application/json" };
  if (auth && env("PAPERCLIP_API_KEY")) headers.authorization = `Bearer ${env("PAPERCLIP_API_KEY")}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${base}${p} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const pc = (m, p, b) => call("/api", m, p, b);
const as = (m, p, b) => call("/agentself/api", m, p, b, false);
const arr = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

/** The plugin returns { content, data } somewhere inside the gateway's response. */
function pluginText(r) {
  const seen = new Set();
  const find = (x) => {
    if (!x || typeof x !== "object" || seen.has(x)) return null;
    seen.add(x);
    if (typeof x.content === "string") return x.content;
    for (const v of Object.values(x)) {
      const t = find(v);
      if (t) return t;
    }
    return null;
  };
  return find(r) ?? JSON.stringify(r);
}

async function pluginTool(name, parameters, issueId) {
  let projectId = null;
  if (issueId) projectId = (await pc("GET", `/issues/${issueId}`).catch(() => null))?.projectId ?? null;
  const r = await pc("POST", "/plugins/tools/execute", {
    tool: `${PLUGIN}:${name}`,
    parameters,
    runContext: { agentId: env("PAPERCLIP_AGENT_ID"), runId: env("PAPERCLIP_RUN_ID"), companyId: env("PAPERCLIP_COMPANY_ID"), projectId },
  });
  return pluginText(r);
}

const companyId = () => env("PAPERCLIP_COMPANY_ID");
const me = () => env("PAPERCLIP_AGENT_ID");
const brief = (i) => ({ id: i.id, identifier: i.identifier ?? null, title: i.title, status: i.status, assigneeAgentId: i.assigneeAgentId ?? null, parentId: i.parentId ?? null });

/* ---------------- tools ---------------- */

const S = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });

export const TOOLS = {
  team_overview: {
    roles: ["lead"],
    description: "看你的员工（reportsTo 是你）和其他主管。选人、转交前先看这个。",
    inputSchema: S({}),
    run: async () => {
      const agents = arr(await pc("GET", `/companies/${companyId()}/agents`)).filter((a) => a.metadata?.agentself && a.status !== "terminated");
      const mine = agents.filter((a) => a.reportsTo === me());
      const leads = agents.filter((a) => a.metadata.agentself.isLead && a.id !== me());
      return {
        myEmployees: mine.map((a) => ({ id: a.id, name: a.name, capabilities: a.capabilities ?? "", agent: a.adapterType === "codex_local" ? "Codex" : "Claude", status: a.status })),
        otherLeads: leads.map((a) => ({ id: a.id, name: a.name, team: a.metadata.agentself.departmentName ?? "", capabilities: a.capabilities ?? "" })),
      };
    },
  },
  get_task: {
    roles: ["lead", "employee"],
    description: "读一个任务：标题、状态、描述、负责人、父任务、子任务、文档列表和最近的评论。",
    inputSchema: S({ issueId: str("任务 id") }, ["issueId"]),
    run: async ({ issueId }) => {
      const issue = await pc("GET", `/issues/${issueId}`);
      const [comments, docs, all] = await Promise.all([
        pc("GET", `/issues/${issueId}/comments`).catch(() => []),
        pc("GET", `/issues/${issueId}/documents`).catch(() => []),
        pc("GET", `/companies/${issue.companyId ?? companyId()}/issues`).catch(() => []),
      ]);
      return {
        ...brief(issue),
        projectId: issue.projectId ?? null,
        description: issue.description ?? "",
        blockedByIssueIds: issue.blockedByIssueIds ?? [],
        children: arr(all).filter((i) => i.parentId === issueId).map(brief),
        documents: arr(docs).map((d) => d.key),
        comments: arr(comments)
          .slice(-30)
          .map((c) => ({ id: c.id, author: c.authorAgentId ?? c.authorUserId ?? "", body: String(c.body ?? "").slice(0, 3000), at: c.createdAt })),
      };
    },
  },
  read_document: {
    roles: ["lead", "employee"],
    description: "读任务上的一份文档（brief、criteria、report、evidence、verification 等）。",
    inputSchema: S({ issueId: str("任务 id"), key: str("文档 key") }, ["issueId", "key"]),
    run: async ({ issueId, key }) => {
      const d = await pc("GET", `/issues/${issueId}/documents/${encodeURIComponent(key)}`);
      return { key, title: d?.title ?? null, body: d?.body ?? "" };
    },
  },
  write_document: {
    roles: ["lead", "employee"],
    description: "在任务上写或覆盖一份 Markdown 文档（主管写 brief、report；员工写 report）。",
    inputSchema: S({ issueId: str("任务 id"), key: str("文档 key，例如 brief 或 report"), body: str("Markdown 正文"), title: str("标题（可选）") }, ["issueId", "key", "body"]),
    run: async ({ issueId, key, body, title }) => {
      await pc("PUT", `/issues/${issueId}/documents/${encodeURIComponent(key)}`, { format: "markdown", body, ...(title ? { title } : {}) });
      return `已写入文档 ${key}`;
    },
  },
  comment: {
    roles: ["lead", "employee"],
    description: "在任务上评论。评论会叫醒这个任务的负责人（员工在父任务上评论 = 问主管；主管在子任务上评论 = 回答员工）。",
    inputSchema: S({ issueId: str("任务 id"), body: str("评论内容") }, ["issueId", "body"]),
    run: async ({ issueId, body }) => {
      await pc("POST", `/issues/${issueId}/comments`, { body });
      return "已评论";
    },
  },
  update_task: {
    roles: ["lead", "employee"],
    description: "改任务的状态、负责人或等待关系。员工只能改自己任务的状态。",
    inputSchema: S({
      issueId: str("任务 id"),
      status: { type: "string", enum: ["todo", "in_progress", "in_review", "done", "blocked", "cancelled"] },
      assigneeAgentId: str("改派给谁（主管用：转交给别的主管、子任务换人）"),
      blockedByIssueIds: { type: "array", items: { type: "string" }, description: "这个任务在等哪些任务（主管用）" },
    }, ["issueId"]),
    run: async (args, role) => {
      const patch = {};
      if (args.status) patch.status = args.status;
      if (role === "lead") {
        if (args.assigneeAgentId) patch.assigneeAgentId = args.assigneeAgentId;
        if (Array.isArray(args.blockedByIssueIds)) patch.blockedByIssueIds = args.blockedByIssueIds;
      } else {
        const issue = await pc("GET", `/issues/${args.issueId}`);
        if (issue.assigneeAgentId !== me()) throw new Error("员工只能改自己任务的状态");
      }
      if (Object.keys(patch).length === 0) throw new Error("没有要改的内容");
      const r = await pc("PATCH", `/issues/${args.issueId}`, patch);
      return brief(r ?? { id: args.issueId, ...patch });
    },
  },
  create_subtask: {
    roles: ["lead"],
    description:
      "派活：在你负责的父任务下建一个子任务交给你的一名员工，并让父任务等它（父任务置为 blocked）。描述里放完整任务书和带编号的验收标准。一次只派一名员工。",
    inputSchema: S({ parentId: str("你负责的父任务 id"), assigneeAgentId: str("员工 id（必须是你的员工）"), title: str("子任务标题"), description: str("任务书全文") }, [
      "parentId",
      "assigneeAgentId",
      "title",
      "description",
    ]),
    run: async ({ parentId, assigneeAgentId, title, description }) => {
      const [parent, employee] = await Promise.all([pc("GET", `/issues/${parentId}`), pc("GET", `/agents/${assigneeAgentId}`)]);
      if (employee?.reportsTo !== me()) throw new Error("只能派给你自己的员工（先用 team_overview 看）");
      const child = await pc("POST", `/companies/${parent.companyId ?? companyId()}/issues`, {
        title: String(title).slice(0, 200),
        description,
        parentId,
        projectId: parent.projectId ?? undefined,
        assigneeAgentId,
        status: "todo",
      });
      const waiting = [...new Set([...(parent.blockedByIssueIds ?? []), child.id])];
      await pc("PATCH", `/issues/${parentId}`, { blockedByIssueIds: waiting, status: "blocked" });
      return { child: brief(child), parentWaitsFor: waiting };
    },
  },
  ask_user: {
    roles: ["lead", "employee"],
    description: "发一张卡片让用户拍板（作答后你会被叫醒）。员工只能在没有父任务的任务（定时 / 事件任务）上用，其余情况问主管。",
    inputSchema: S({
      issueId: str("挂卡片的任务 id"),
      question: str("问题：一句话背景 + 要决定什么"),
      options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      ifNoReply: str("不回复会怎样"),
    }, ["issueId", "question", "options"]),
    run: async (args, role) => {
      if (role === "employee") {
        const issue = await pc("GET", `/issues/${args.issueId}`);
        if (issue.parentId) throw new Error("主管派的任务不能直接问用户：在父任务上评论问主管");
      }
      return pluginTool("ask", args, args.issueId);
    },
  },
  notify_user: {
    roles: ["lead", "employee"],
    description: "只通知用户、不阻塞。员工只能在没有父任务的任务上用。",
    inputSchema: S({ text: str("一两句话"), issueId: str("相关任务 id（可选）") }, ["text"]),
    run: async (args, role) => {
      if (role === "employee" && args.issueId) {
        const issue = await pc("GET", `/issues/${args.issueId}`);
        if (issue.parentId) throw new Error("主管派的任务不直接通知用户：交付后由主管汇报");
      }
      return pluginTool("notice", args, args.issueId);
    },
  },
  remind_me: {
    roles: ["lead", "employee"],
    description: "N 分钟后叫你回来处理这个任务（短时间等待用）。",
    inputSchema: S({ issueId: str("任务 id"), minutes: { type: "integer", minimum: 1 }, note: str("回来时要做什么") }, ["issueId", "minutes"]),
    run: async (args) => pluginTool("later", args, args.issueId),
  },
  close_card: {
    roles: ["lead", "employee"],
    description: "关掉你之前发的卡片（不再需要用户回答）。",
    inputSchema: S({ issueId: str("任务 id"), interactionId: str("卡片 id"), reason: str("原因") }, ["issueId", "interactionId"]),
    run: async (args) => pluginTool("resolve", args, args.issueId),
  },
  set_criteria: {
    roles: ["lead"],
    description: "为你负责的父任务登记验收标准（3–7 条，每条写明需要什么证据）。返回编号 c1..cN，把它们写进子任务的任务书。",
    inputSchema: S({
      issueId: str("你负责的父任务 id"),
      items: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", properties: { text: { type: "string" }, evidence: { type: "string" } }, required: ["text"] } },
    }, ["issueId", "items"]),
    run: async (args) => pluginTool("criteria", args, args.issueId),
  },
  verify: {
    roles: ["lead"],
    description:
      "请独立核查员（另一个模型、没有工具）逐条判定子任务的交付。第一次调用会在后台开始核查并立即返回：结束本轮，核查完成后你会被叫醒，再调用一次拿结果。",
    inputSchema: S({ issueId: str("员工交付的子任务 id") }, ["issueId"]),
    run: async (args) => pluginTool("verify", args, args.issueId),
  },
  submit_evidence: {
    roles: ["employee"],
    description: "按验收标准编号逐条提交证据。只交证据、不判定是否通过；没有证据标 missing；不合理的标准写进 disputes。",
    inputSchema: S({
      issueId: str("你自己的任务 id"),
      items: { type: "array", items: { type: "object", properties: { criterionId: { type: "string" }, evidence: { type: "string" }, missing: { type: "boolean" } }, required: ["criterionId"] } },
      disputes: { type: "array", items: { type: "object", properties: { criterionId: { type: "string" }, kind: { type: "string", enum: ["invalid_criterion", "missed_evidence"] }, reason: { type: "string" } }, required: ["criterionId", "reason"] } },
    }, ["issueId", "items"]),
    run: async (args) => pluginTool("evidence", args, args.issueId),
  },
  watch_job: {
    roles: ["employee"],
    description: "长时间实验的看守：登记一条探测命令（退出码 0 = 结束，1 = 还在跑，其他 = 出错），系统定时运行它、不调用模型，结束、出错或超时才叫醒你。",
    inputSchema: S({ issueId: str("任务 id"), command: str("探测命令"), everyMinutes: { type: "integer", minimum: 2, maximum: 240 }, maxHours: { type: "number" }, note: str("在等什么") }, [
      "issueId",
      "command",
    ]),
    run: async (args) => pluginTool("watch", args, args.issueId),
  },
  propose_hire: {
    roles: ["lead"],
    description: "没有合适的员工时，提议新建一名。用户在首页批准后系统自动建好，并在你的任务上留言叫醒你。",
    inputSchema: S({
      issueId: str("你负责的父任务 id"),
      name: str("名字"),
      capabilities: str("负责什么"),
      adapterType: { type: "string", enum: ["claude_local", "codex_local"], description: "写代码、跑实验为主的可以用 codex_local" },
      reason: str("为什么现有员工不合适"),
    }, ["issueId", "name", "capabilities"]),
    run: async (args) => as("POST", "/hire-requests", { ...args, leadAgentId: me() }),
  },
  record_decision: {
    roles: ["lead"],
    description: "用户明确说\"以后都这样\"或明确拒绝某种做法时，记进全局档案，所有主管和员工以后都会照做。只对这一次的同意不要记。",
    inputSchema: S({ kind: { type: "string", enum: ["decision", "declined"] }, text: str("决定内容"), scope: str("适用范围"), source: str("出处，例如任务编号") }, ["kind", "text"]),
    run: async (args) => as("POST", "/profile/decisions", args),
  },
};

export const toolsFor = (role) => Object.entries(TOOLS).filter(([, t]) => t.roles.includes(role));

/* ---------------- MCP stdio protocol ---------------- */

export async function handle(msg, role) {
  const { id, method, params } = msg;
  if (method === "initialize")
    return { jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agentself", version: "0.2.0" } } };
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list")
    return { jsonrpc: "2.0", id, result: { tools: toolsFor(role).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } };
  if (method === "tools/call") {
    const entry = toolsFor(role).find(([name]) => name === params?.name);
    if (!entry) return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `没有这个工具：${params?.name}` }] } };
    try {
      const out = await entry[1].run(params?.arguments ?? {}, role);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] } };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] } };
    }
  }
  if (id === undefined || id === null) return null; // notifications
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const role = process.argv.includes("--role=employee") ? "employee" : "lead";
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const reply = await handle(msg, role);
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
}
