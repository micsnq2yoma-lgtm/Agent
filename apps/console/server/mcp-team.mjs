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
import { listAccounts, newMail, readMail, recentMail, saveDraft } from "./mail.mjs";

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

/**
 * Report on a lead's own top-level task (P1 runs 5 and 6). Order matters:
 *  1. drop pending reminders / watches first, so they go even if a later step fails;
 *  2. create a request_confirmation card on the report revision — Paperclip refuses an agent's move to
 *     in_review unless a review path exists ("invalid_issue_disposition");
 *  3. only then move the task to in_review.
 * Returns { applicable: false } for a child task or someone else's task.
 */
export async function settleReport(issueId, doc) {
  const issue = await pc("GET", `/issues/${issueId}`);
  if (issue.parentId || issue.assigneeAgentId !== env("PAPERCLIP_AGENT_ID")) return { applicable: false };
  const steps = [];
  try {
    await pluginTool("settle", { issueId }, issueId);
    steps.push("提醒已取消");
  } catch (e) {
    steps.push(`取消提醒失败：${e instanceof Error ? e.message : e}`);
  }
  if (["in_review", "done", "cancelled"].includes(issue.status)) return { applicable: true, ok: true, steps };
  const revisionId = doc?.latestRevisionId ?? doc?.latestRevision?.id ?? null;
  await pc("POST", `/issues/${issueId}/interactions`, {
    kind: "request_confirmation",
    idempotencyKey: `agentself:report:${issueId}:${revisionId ?? Date.now()}`,
    title: "汇报待你验收",
    continuationPolicy: "wake_assignee",
    payload: {
      version: 1,
      prompt: "请验收这份汇报：满意就确认完成，不满意写下要改的地方。",
      acceptLabel: "确认完成",
      rejectLabel: "要修改",
      rejectRequiresReason: true,
      rejectReasonLabel: "哪里要改？",
      target: revisionId ? { type: "issue_document", issueId, ...(doc?.id ? { documentId: doc.id } : {}), key: "report", revisionId } : { type: "custom", key: "report" },
    },
  });
  steps.push("确认卡片已发出");
  try {
    await pc("PATCH", `/issues/${issueId}`, { status: "in_review" });
    steps.push("任务已置为待你确认（in_review）");
    return { applicable: true, ok: true, steps };
  } catch (e) {
    return { applicable: true, ok: false, steps, error: e instanceof Error ? e.message : String(e) };
  }
}

const me = () => env("PAPERCLIP_AGENT_ID");
/* ---------- delegation guards (PR #4 p13: rules enforced in code, not only in the skill) ---------- */

/** Codex employees get the team MCP tools through `-c mcp_servers.agentself.*` in their adapter
 * config (scripts/lib/department.mjs codexMcpArgs). One that has not been synced since cannot report
 * back, so delegation to it is refused until the next sync (restart the local service). */
export function codexBlock(employee, allow = process.env.AGENTSELF_ALLOW_CODEX === "1") {
  if (allow || employee?.adapterType !== "codex_local") return null;
  const args = employee.adapterConfig?.extraArgs ?? [];
  if (args.some((a) => String(a).includes("mcp_servers.agentself"))) return null;
  return `「${employee.name}」是 Codex 员工，但还没装上团队工具（交不了证据、也回不了话）。重启 Agentself 本地服务会自动补上；在那之前请派给 Claude 员工。`;
}

/** Words that usually mean an ask-first action (profile/askfirst.md): destroying data or results,
 * sending something out, spending money. A hint, not a classifier: the lead can explain it away. */
export const ASK_FIRST_HINT = /删除|删掉|清理|清空|覆盖|重置|格式化|rm\s+-|发邮件|发送邮件|发给.{0,8}(客户|老师|导师|同事|对方)|发布|推送|push\b|合并到主分支|付款|支付|购买|下单|转账/i;

/** null = OK to delegate; otherwise the reason it is refused. */
export async function askFirstGate(parent, description, askFirst, notAskFirstReason, { interactions } = {}) {
  if (askFirst === "approved") {
    const list = interactions ?? arr(await pc("GET", `/issues/${parent.id}/interactions`).catch(() => []));
    const answered = list.some((i) => i.status && i.status !== "pending" && !/reject|cancel|expired|failed/.test(String(i.status)));
    return answered ? null : "askFirst 写的是 approved，但父任务上还没有用户回答过的卡片。先用 ask_user 问用户，等回答后再派活。";
  }
  if (askFirst !== "none") return "askFirst 必须是 none 或 approved。";
  const text = [parent.title, parent.description, description].filter(Boolean).join("\n");
  const hit = text.match(ASK_FIRST_HINT);
  if (hit && !String(notAskFirstReason ?? "").trim())
    return `这件事看起来命中"先问清单"（出现了「${hit[0]}」）：删除或覆盖数据和结果、对外发送、花钱之前要先问用户。先用 ask_user 在父任务上问（说明要动什么、影响多大），用户同意后再派活并把 askFirst 设为 approved。确实不涉及的话，在 notAskFirstReason 里写明为什么，再派一次。`;
  return null;
}

const brief = (i) => ({ id: i.id, identifier: i.identifier ?? null, title: i.title, status: i.status, assigneeAgentId: i.assigneeAgentId ?? null, parentId: i.parentId ?? null });

/* ---------------- tools ---------------- */

const S = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });

export const TOOLS = {
  /* ---- mailboxes (settings → 邮箱; IMAP, read-only outside: drafts are saved, never sent) ---- */
  mail_new: {
    roles: ["employee"],
    description: "看邮箱里自上次检查以来的新邮件（第一次是最近一天），只返回发件人、主题、时间和 uid，不会标为已读。检查一次就会往前推进，不会重复返回同一封。",
    inputSchema: S({ account: str("邮箱地址（不填用第一个）"), max: { type: "integer", minimum: 1, maximum: 100 } }),
    run: async (a) => newMail({ account: a.account, max: a.max ?? 30 }),
  },
  mail_recent: {
    roles: ["employee"],
    description: "最近几天的邮件列表（不推进'新邮件'的进度），可按发件人或主题里的文字筛选、只看未读。",
    inputSchema: S({ account: str("邮箱地址（不填用第一个）"), days: { type: "integer", minimum: 1, maximum: 60 }, query: str("发件人或主题里包含的文字"), unreadOnly: { type: "boolean" } }),
    run: async (a) => recentMail({ account: a.account, days: a.days ?? 3, query: a.query ?? "", unreadOnly: !!a.unreadOnly }),
  },
  mail_read: {
    roles: ["employee"],
    description: "读一封邮件的全文（附件只列名字），不会标为已读。",
    inputSchema: S({ account: str("邮箱地址（不填用第一个）"), uid: { type: "integer" } }, ["uid"]),
    run: async (a) => readMail({ account: a.account, uid: a.uid }),
  },
  mail_draft: {
    roles: ["employee"],
    description: "写一封回复或新邮件，存进邮箱的草稿箱，由用户自己检查后发送。不会发送（发送邮件是先问清单里的对外动作）。回复时给 replyToUid，主题可以不填。",
    inputSchema: S({ account: str("邮箱地址（不填用第一个）"), to: str("收件人"), cc: str("抄送"), subject: str("主题"), body: str("正文（纯文本）"), replyToUid: { type: "integer" } }, ["to", "body"]),
    run: async (a) => saveDraft({ account: a.account, to: a.to, cc: a.cc ?? "", subject: a.subject ?? "", body: a.body, replyToUid: a.replyToUid ?? null }),
  },
  mail_accounts: {
    roles: ["employee", "lead"],
    description: "列出配置好的邮箱（不含密码）。",
    inputSchema: S({}),
    run: async () => listAccounts(),
  },

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
    run: async ({ issueId, key, body, title }, role) => {
      const doc = await pc("PUT", `/issues/${issueId}/documents/${encodeURIComponent(key)}`, { format: "markdown", body, ...(title ? { title } : {}) });
      // A lead writing the report on its own top-level task is reporting: settle the task in code,
      // not by the skill's wording (P1 run 5: the lead wrote the report and left the task in_progress).
      if (role === "lead" && key === "report") {
        const r = await settleReport(issueId, doc);
        if (r.applicable && r.ok) return `已写入汇报：${r.steps.join("；")}`;
        if (r.applicable) throw new Error(`汇报已写入，但没能置为待确认：${r.error}（${r.steps.join("；")}）`);
      }
      return `已写入文档 ${key}`;
    },
  },
  submit_report: {
    roles: ["lead"],
    description: "向用户汇报：在你负责的父任务上写 report 文档、发一张验收卡片、把任务置为待用户确认（in_review），并取消未触发的提醒。汇报一律用这个工具，不要另外发确认卡片。",
    inputSchema: S({ issueId: str("你负责的父任务 id"), body: str("一页以内的汇报（Markdown）") }, ["issueId", "body"]),
    run: async ({ issueId, body }) => {
      const doc = await pc("PUT", `/issues/${issueId}/documents/report`, { format: "markdown", title: "汇报", body });
      const r = await settleReport(issueId, doc);
      if (!r.applicable) throw new Error("report 已写入，但这不是你负责的顶层任务，状态没有改");
      if (!r.ok) throw new Error(`report 已写入，但 Paperclip 没有接受"待确认"状态：${r.error}。已做：${r.steps.join("；")}。不要重复发卡片，在任务上评论说明情况后结束本轮。`);
      await pc("POST", `/issues/${issueId}/comments`, { body: "已汇报，等你确认。" }).catch(() => {});
      return `已汇报：report 已写入；${r.steps.join("；")}。结束本轮。`;
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
      "派活：在你负责的父任务下建一个子任务交给你的一名员工，并让父任务等它（父任务置为 blocked）。描述里放完整任务书和带编号的验收标准。父任务还没有 brief 文档时，会把这份任务书同时存为父任务的 brief。一次只派一名员工。",
    inputSchema: S({
      parentId: str("你负责的父任务 id"),
      assigneeAgentId: str("员工 id（必须是你的员工）"),
      title: str("子任务标题"),
      description: str("任务书全文"),
      askFirst: { type: "string", enum: ["none", "approved"], description: "对照先问清单：none = 这件事不涉及清单里的情况；approved = 涉及，且用户已经在父任务的卡片上同意了" },
      notAskFirstReason: str("仅当系统认为可能命中先问清单、而你确认不涉及时填写：为什么不涉及"),
    }, ["parentId", "assigneeAgentId", "title", "description", "askFirst"]),
    run: async ({ parentId, assigneeAgentId, title, description, askFirst, notAskFirstReason }) => {
      const [parent, employee] = await Promise.all([pc("GET", `/issues/${parentId}`), pc("GET", `/agents/${assigneeAgentId}`)]);
      if (employee?.reportsTo !== me()) throw new Error("只能派给你自己的员工（先用 team_overview 看）");
      const codex = codexBlock(employee);
      if (codex) throw new Error(codex);
      const gate = await askFirstGate(parent, description, askFirst, notAskFirstReason);
      if (gate) throw new Error(gate);
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
      // The brief is what the verifier and the user read as the goal: never leave the parent without one.
      const existing = await pc("GET", `/issues/${parentId}/documents/brief`).catch(() => null);
      let briefSaved = false;
      if (!existing?.body) {
        await pc("PUT", `/issues/${parentId}/documents/brief`, { format: "markdown", title: "任务书", body: description });
        briefSaved = true;
      }
      return { child: brief(child), parentWaitsFor: waiting, briefSaved };
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
    roles: ["lead"], // employees wait on programs with watch_job (no model calls), on people via replies (PR #4 p12)
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
