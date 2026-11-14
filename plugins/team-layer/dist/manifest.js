// src/manifest.ts
var toolSchema = (properties, required) => ({ type: "object", properties, required });
var manifest_default = {
  id: "agentself.team-layer",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Agentself \u56E2\u961F\u5C42",
  description: "\u90E8\u95E8\u3001\u524D\u53F0\u3001Studio \u95F8\u95E8\u515C\u5E95\u3001\u8FD4\u5DE5\u8BA1\u6570\u3001\u8DF3\u6570\u4E0A\u9650\u3001\u5361\u7247\u5DE5\u5177\u3001\u4E09\u6863\u6D88\u606F\u6D41",
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
    "api.routes.register"
  ],
  entrypoints: { worker: "./dist/worker.js" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      reworkLimit: { type: "integer", default: 3, minimum: 1 },
      maxDepth: { type: "integer", default: 8, minimum: 1 },
      burstMax: { type: "integer", default: 20, minimum: 1 },
      burstWindowMinutes: { type: "integer", default: 10, minimum: 1 },
      boardUserId: { type: "string", default: "local-board" },
      idleMinutes: { type: "integer", default: 30, minimum: 1 },
      consolidationModel: { type: "string", default: "haiku" }
    }
  },
  jobs: [
    { jobKey: "later-tick", displayName: "\u7A0D\u540E\u63D0\u9192\u68C0\u67E5", schedule: "* * * * *" },
    { jobKey: "memory-idle", displayName: "\u7A7A\u95F2\u65F6\u6574\u7406\u5458\u5DE5\u8BB0\u5FC6", schedule: "*/5 * * * *" },
    { jobKey: "memory-weekly", displayName: "\u6BCF\u5468\u5F52\u6863\u8BB0\u5FC6", schedule: "0 3 * * 1" }
  ],
  tools: [
    {
      name: "ask",
      displayName: "team.ask",
      description: "\u5411\u7528\u6237\u63D0\u4E00\u4E2A\u9700\u8981\u62CD\u677F\u7684\u95EE\u9898\uFF08\u9AD8\u6863\u5361\u7247\uFF09\u3002\u5361\u7247\u6302\u5728\u4F60\u8D1F\u8D23\u7684 issue \u4E0A\uFF1B\u7528\u6237\u4F5C\u7B54\u540E\u4F60\u4F1A\u88AB\u81EA\u52A8\u5524\u9192\uFF0C\u7B54\u6848\u5728 issue \u7EBF\u7A0B\u91CC\u3002\u53EA\u5728\u771F\u6B63\u9700\u8981\u4EBA\u51B3\u5B9A\u65F6\u4F7F\u7528\u3002",
      parametersSchema: toolSchema(
        {
          issueId: { type: "string", description: "\u4F60\u5F53\u524D\u8D1F\u8D23\u7684 issue id" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
          ifNoReply: { type: "string", description: "\u4E0D\u56DE\u590D\u4F1A\u600E\u6837" }
        },
        ["issueId", "question", "options"]
      )
    },
    {
      name: "notice",
      displayName: "team.notice",
      description: "\u53EA\u901A\u77E5\u7528\u6237\u3001\u4E0D\u963B\u585E\uFF08\u4F4E\u6863\u6D88\u606F\uFF09\u3002",
      parametersSchema: toolSchema({ text: { type: "string" }, issueId: { type: "string" } }, ["text"])
    },
    {
      name: "resolve",
      displayName: "team.resolve",
      description: "\u5173\u6389\u4E4B\u524D\u53D1\u51FA\u7684\u5361\u7247\uFF08\u4E0D\u518D\u9700\u8981\u7528\u6237\u56DE\u7B54\uFF09\u3002",
      parametersSchema: toolSchema({ issueId: { type: "string" }, interactionId: { type: "string" }, reason: { type: "string" } }, ["issueId", "interactionId"])
    },
    {
      name: "later",
      displayName: "team.later",
      description: "\u5230\u70B9\u518D\u628A\u4F60\u53EB\u56DE\u6765\u5904\u7406\u8FD9\u4E2A issue\uFF08\u5B9A\u65F6\u5524\u9192\uFF09\u3002",
      parametersSchema: toolSchema(
        { issueId: { type: "string" }, minutes: { type: "integer", minimum: 1 }, note: { type: "string" } },
        ["issueId", "minutes"]
      )
    }
  ],
  apiRoutes: [
    { routeKey: "feed", method: "GET", path: "/feed", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } }
  ]
};
export {
  manifest_default as default
};
//# sourceMappingURL=manifest.js.map
