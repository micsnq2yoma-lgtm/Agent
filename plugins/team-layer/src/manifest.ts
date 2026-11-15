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
    },
  },
  jobs: [
    { jobKey: "later-tick", displayName: "稍后提醒检查", schedule: "* * * * *" },
    { jobKey: "memory-idle", displayName: "空闲时整理员工记忆", schedule: "*/5 * * * *" },
    { jobKey: "memory-weekly", displayName: "每周归档记忆", schedule: "0 3 * * 1" },
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
  ],
  apiRoutes: [
    { routeKey: "feed", method: "GET", path: "/feed", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
  ],
} as const;
