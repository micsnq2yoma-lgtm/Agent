// team-layer plugin manifest (PLAN 4).
const toolSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

export default {
  id: "agentself.team-layer",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Agentself 团队层",
  description: "主管与员工：返工上限、跳数上限、卡片工具、三档消息流、员工记忆",
  author: "Agentself",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "jobs.schedule",
    "agent.tools.register",
    "plugin.state.read",
    "plugin.state.write",
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.update",
    "issues.wakeup",
    "issue.subtree.read",
    "issue.comments.read",
    "issue.comments.create",
    "issue.interactions.read",
    "issue.interactions.create",
    "issue.interactions.respond",
    "issue.documents.read",
    "issue.documents.write",
    "agents.read",
    "activity.read",
    "costs.read",
    "api.routes.register",
  ],
  entrypoints: { worker: "./dist/worker.js" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      reworkLimit: { type: "integer", default: 2, minimum: 1 },
      maxDepth: { type: "integer", default: 8, minimum: 1 },
      burstMax: { type: "integer", default: 20, minimum: 1 },
      burstWindowMinutes: { type: "integer", default: 10, minimum: 1 },
      boardUserId: { type: "string", default: "local-board" },
      idleMinutes: { type: "integer", default: 30, minimum: 1 },
      consolidationModel: { type: "string", default: "haiku" },
      verifierModel: { type: "string", default: "sonnet", description: "独立核查员：Claude 模型别名或 id（sonnet、opus…），或 codex / codex:<模型> 用本机的 Codex 订阅" },
    },
  },
  jobs: [
    { jobKey: "later-tick", displayName: "稍后提醒检查", schedule: "* * * * *" },
    { jobKey: "memory-idle", displayName: "空闲时整理员工记忆", schedule: "*/5 * * * *" },
    { jobKey: "memory-weekly", displayName: "每周归档记忆", schedule: "0 3 * * 1" },
    { jobKey: "watch-tick", displayName: "长任务看守（不调用模型）", schedule: "* * * * *" },
    { jobKey: "verify-tick", displayName: "记录独立核查结果", schedule: "* * * * *" },
  ],
  tools: [
    {
      name: "ask",
      displayName: "team.ask",
      description:
        "向用户提一个需要拍板的问题（高档卡片）。卡片挂在你负责的 issue 上；用户作答后你会被自动唤醒，答案在 issue 线程里。只在真正需要人决定时使用。",
      parametersSchema: toolSchema(
        {
          issueId: { type: "string", description: "你当前负责的 issue id" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
          ifNoReply: { type: "string", description: "不回复会怎样" },
        },
        ["issueId", "question", "options"],
      ),
    },
    {
      name: "notice",
      displayName: "team.notice",
      description: "只通知用户、不阻塞（低档消息）。",
      parametersSchema: toolSchema({ text: { type: "string" }, issueId: { type: "string" } }, ["text"]),
    },
    {
      name: "resolve",
      displayName: "team.resolve",
      description: "关掉之前发出的卡片（不再需要用户回答）。",
      parametersSchema: toolSchema({ issueId: { type: "string" }, interactionId: { type: "string" }, reason: { type: "string" } }, ["issueId", "interactionId"]),
    },
    {
      name: "later",
      displayName: "team.later",
      description: "到点再把你叫回来处理这个 issue（定时唤醒）。",
      parametersSchema: toolSchema(
        { issueId: { type: "string" }, minutes: { type: "integer", minimum: 1 }, note: { type: "string" } },
        ["issueId", "minutes"],
      ),
    },
    {
      name: "criteria",
      displayName: "team.criteria",
      description: "主管用：为你负责的父任务设定验收标准（3–7 条，每条可核对，写明需要什么证据）。返回编号 c1..cN，把它们写进子任务描述。",
      parametersSchema: toolSchema(
        {
          issueId: { type: "string", description: "你负责的父任务 id" },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "object", properties: { text: { type: "string" }, evidence: { type: "string", description: "需要什么证据" } }, required: ["text"] },
          },
        },
        ["issueId", "items"],
      ),
    },
    {
      name: "evidence",
      displayName: "team.evidence",
      description: "员工用：按验收标准编号逐条提交证据。只交证据，不判定是否通过；没有证据就标 missing。对不合理的标准可以提出异议。",
      parametersSchema: toolSchema(
        {
          issueId: { type: "string", description: "你自己的任务 id" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { criterionId: { type: "string" }, evidence: { type: "string", description: "文件路径、数字、命令输出、链接；截图和文件写明它说明了什么" }, missing: { type: "boolean" } },
              required: ["criterionId"],
            },
          },
          disputes: {
            type: "array",
            items: {
              type: "object",
              properties: { criterionId: { type: "string" }, kind: { type: "string", enum: ["invalid_criterion", "missed_evidence"] }, reason: { type: "string" } },
              required: ["criterionId", "reason"],
            },
          },
        },
        ["issueId", "items"],
      ),
    },
    {
      name: "verify",
      displayName: "team.verify",
      description: "主管用：让一名独立核查员（另一个模型、没有工具）对照验收标准逐条判定员工的交付。第一次调用在后台开始核查并立即返回；完成后会在你的任务上留言叫醒你，再调用一次拿逐条结果。结果是参考，最终由你判定。",
      parametersSchema: toolSchema({ issueId: { type: "string", description: "员工交付的子任务 id" } }, ["issueId"]),
    },
    {
      name: "settle",
      displayName: "team.settle",
      description: "取消一个任务上所有未触发的提醒和看守（汇报时由系统调用）。",
      parametersSchema: toolSchema({ issueId: { type: "string" } }, ["issueId"]),
    },
    {
      name: "watch",
      displayName: "team.watch",
      description:
        "员工用：长时间实验放到后台后，登记一条探测命令。系统定时运行它（不调用模型）：退出码 0 = 结束，1 = 还在跑，其他 = 出错。结束、出错或超时才叫醒你。",
      parametersSchema: toolSchema(
        {
          issueId: { type: "string" },
          command: { type: "string", description: "探测命令，例如 ssh gpu1 'test -f ~/exp/done && exit 0 || (pgrep -f train.py >/dev/null && exit 1 || exit 2)'" },
          everyMinutes: { type: "integer", minimum: 2, maximum: 240 },
          maxHours: { type: "number", minimum: 0.1, maximum: 72 },
          note: { type: "string" },
        },
        ["issueId", "command"],
      ),
    },
  ],
  apiRoutes: [
    { routeKey: "feed", method: "GET", path: "/feed", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
  ],
} as const;
