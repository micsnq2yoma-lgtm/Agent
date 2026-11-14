export default {
  id: "agentself.p0-spike",
  apiVersion: 1,
  version: "0.0.1",
  displayName: "Agentself P0 Spike",
  description: "Phase 0 minimal plugin: event, job, tool, full page",
  author: "Agentself",
  categories: ["automation"],
  capabilities: ["events.subscribe", "jobs.schedule", "agent.tools.register", "plugin.state.read", "plugin.state.write", "ui.page.register", "ui.sidebar.register"],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  jobs: [{ jobKey: "tick", displayName: "P0 tick", schedule: "* * * * *" }],
  tools: [{ name: "p0_echo", displayName: "P0 Echo", description: "Echo text back (Phase 0 test)", parametersSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }],
  ui: {
    slots: [
      { type: "page", id: "console", displayName: "Agentself", exportName: "ConsolePage", routePath: "agentself" },
      { type: "sidebar", id: "nav", displayName: "Agentself", exportName: "NavLink" }
    ]
  }
} as const;
