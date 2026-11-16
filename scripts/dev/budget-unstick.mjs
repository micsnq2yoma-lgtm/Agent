#!/usr/bin/env node
// Un-stick budgets hard-paused by runs whose usage was never recorded (typically a run that was
// cancelled mid-way: Paperclip keeps it "accounting pending" forever and blocks every budget it
// touches, even with 0 spent). Lists them; with --yes writes each one off as an estimated cost
// (the captured usage, or 0) with a reason, then resumes the paused budgets at their old limit.
//   node scripts/dev/budget-unstick.mjs            # dry run: what is stuck
//   node scripts/dev/budget-unstick.mjs --yes      # write off and resume
import { api, list } from "../lib/paperclip.mjs";

const yes = process.argv.includes("--yes");
const reason = "Agentself budget-unstick：运行被中途取消，用量回执一直没有到；按已采集的用量（没有则 0）记为估算";
const companies = list(await api("GET", "/companies")).filter((c) => c.status !== "archived");
for (const c of companies) {
  const health = await api("GET", `/companies/${c.id}/accounting/health`);
  const stuck = (health.items ?? []).filter((i) => i.state === "waiting_for_receipt" || i.state === "retryable");
  const overview = await api("GET", `/companies/${c.id}/budgets/overview`);
  const incidents = (overview.activeIncidents ?? []).filter((i) => i.status === "open");
  if (!stuck.length && !incidents.length) continue;
  console.log(`公司「${c.name}」：待记账运行 ${stuck.length} 条，预算暂停 ${incidents.length} 个`);
  for (const r of stuck) {
    console.log(`  运行 ${r.runId}（${r.state}，自 ${r.since}${r.lastError ? `，上次错误：${r.lastError}` : ""}）`);
    if (yes) console.log("    →", JSON.stringify(await api("POST", `/companies/${c.id}/accounting/runs/${r.runId}/write-off`, { reason }).catch((e) => ({ error: e.message }))));
  }
  for (const i of incidents) {
    console.log(`  暂停：${i.scopeType} ${i.scopeName}（限额 ${i.amountLimit}，已用 ${i.amountObserved}）`);
    if (yes) {
      const amount = Math.max(i.amountLimit, Math.ceil(Number(i.amountObserved ?? 0)) + 1);
      console.log("    →", JSON.stringify(await api("POST", `/companies/${c.id}/budget-incidents/${i.id}/resolve`, { action: "raise_budget_and_resume", amount, decisionNote: reason }).then((x) => x.status).catch((e) => ({ error: e.message }))));
    }
  }
}
if (!yes) console.log("加 --yes 才会真正记账并恢复。");
