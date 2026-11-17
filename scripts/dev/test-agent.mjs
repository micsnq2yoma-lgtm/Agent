#!/usr/bin/env node
// Run Paperclip's environment test (the same "hello probe" new agents must pass) for one agent, and
// print every check. With --compare it runs a second time without the AgenTeam MCP `-c` overrides,
// to tell an AgenTeam setting apart from the CLI / login / machine.
//   node scripts/dev/test-agent.mjs <agent name or id> [--compare]
import { api, list } from "../lib/paperclip.mjs";
import { codexConfigProblems, explainCodexError } from "../lib/codex-check.mjs";

const args = process.argv.slice(2);
const who = args.find((a) => !a.startsWith("--"));
if (!who) {
  console.error("usage: node scripts/dev/test-agent.mjs <agent name or id> [--compare]");
  process.exit(2);
}
const companies = list(await api("GET", "/companies")).filter((c) => c.status !== "archived");
let agent = null;
for (const c of companies) {
  agent = list(await api("GET", `/companies/${c.id}/agents`)).find((a) => a.id === who || a.name === who) ?? null;
  if (agent) break;
}
if (!agent) {
  console.error(`没有叫 ${who} 的智能体`);
  process.exit(1);
}
console.log(`${agent.name}（${agent.adapterType}）lifecycle=${agent.lifecycleState ?? "?"} status=${agent.status}`);
console.log("extraArgs:", JSON.stringify(agent.adapterConfig?.extraArgs ?? []));

async function run(label, adapterConfig) {
  const t0 = Date.now();
  const r = await api("POST", `/companies/${agent.companyId}/adapters/${agent.adapterType}/test-environment`, { agentId: agent.id, adapterConfig }).catch((e) => ({ status: "error", checks: [{ level: "error", code: "request_failed", message: e.message }] }));
  console.log(`\n== ${label}: ${r.status}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  for (const c of r.checks ?? []) {
    console.log(`  [${c.level}] ${c.code}: ${c.message}${c.detail ? `\n      ${String(c.detail).replace(/\s+/g, " ").slice(0, 600)}` : ""}${c.hint ? `\n      提示：${c.hint}` : ""}`);
    const why = c.level === "error" && agent.adapterType === "codex_local" ? explainCodexError(`${c.message} ${c.detail ?? ""}`) : null;
    if (why) console.log(`      ⇒ ${why}`);
  }
  return r;
}

if (agent.adapterType === "codex_local")
  for (const p of codexConfigProblems()) console.log(`\n⚠ ${p.file}：${p.message}。${p.fix}（AgenTeam 不会改这个文件）`);
await run("当前配置", agent.adapterConfig);
if (args.includes("--compare") && agent.adapterType === "codex_local") {
  const strip = [];
  const ex = agent.adapterConfig?.extraArgs ?? [];
  for (let i = 0; i < ex.length; i++) {
    if (ex[i] === "-c" && /^mcp_servers\./.test(ex[i + 1] ?? "")) i++;
    else strip.push(ex[i]);
  }
  await run("去掉 mcp_servers 参数", { ...agent.adapterConfig, extraArgs: strip });
}
