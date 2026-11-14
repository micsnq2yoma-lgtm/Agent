import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("issue.created", async (event) => {
      ctx.logger.info("P0 issue.created", { issueId: event.entityId, companyId: event.companyId });
      const prev = (await ctx.state.get({ scopeKind: "instance", stateKey: "issuesSeen" })) as number | null;
      await ctx.state.set({ scopeKind: "instance", stateKey: "issuesSeen" }, (prev ?? 0) + 1);
    });
    ctx.jobs.register("tick", async () => {
      const prev = (await ctx.state.get({ scopeKind: "instance", stateKey: "ticks" })) as number | null;
      await ctx.state.set({ scopeKind: "instance", stateKey: "ticks" }, (prev ?? 0) + 1);
      ctx.logger.info("P0 tick", { n: (prev ?? 0) + 1 });
    });
    ctx.tools.register("p0_echo", { displayName: "P0 Echo", description: "Echo text back", parametersSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      async (params) => ({ content: `echo: ${(params as { text: string }).text}` }));
    ctx.data.register("stats", async () => ({
      issuesSeen: await ctx.state.get({ scopeKind: "instance", stateKey: "issuesSeen" }),
      ticks: await ctx.state.get({ scopeKind: "instance", stateKey: "ticks" }),
    }));
  },
});
export default plugin;
runWorker(plugin, import.meta.url);
