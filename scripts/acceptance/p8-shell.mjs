#!/usr/bin/env node
// P8 acceptance (PLAN 9, v0.5): one app on :3100.
//  1. every request the browser makes goes to :3100 (the :3200 frontend is gone)
//  2. exactly one sidebar (the Agentself one) on Agentself pages and Paperclip admin pages
//  3. card -> project drawer -> task full page -> run record, never leaving the app
//  4. hidden Paperclip pages (inbox, dashboard, chats, cases, goals, companies) still open by URL
// Creates one small real task for an employee (to get a run record) and deletes it afterwards.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_APP ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

const ctx = await (await fetch(`${base}/agentself/api/context`)).json();
const prefix = ctx.company.issuePrefix;
const research = ctx.departments.find((d) => d.key === "research");
const member = ctx.agents.find((a) => research.members.includes(a.id) && a.id !== research.leadAgentId);

// a small real task so the issue has a run record
const issue = await api("POST", `/companies/${ctx.company.id}/issues`, {
  title: "[验收] P8 运行记录",
  description: "只回复一句“收到”，然后把任务标记为完成。不要做别的。",
  projectId: research.projectId,
  assigneeAgentId: member.id,
  status: "todo",
});
let runId = null;
for (let i = 0; i < 90 && !runId; i++) {
  await sleep(4000);
  const runs = list(await api("GET", `/companies/${ctx.company.id}/heartbeat-runs?agentId=${member.id}&limit=10`).catch(() => []));
  const run = runs.find((r) => (r.contextSnapshot?.issueId ?? r.issueId) === issue.id && ["succeeded", "failed", "cancelled", "timed_out"].includes(r.status));
  if (run) runId = run.id;
}
results.runRecorded = !!runId;
// then a decision card on that task (reopen it first; interactions need an open issue)
await api("PATCH", `/issues/${issue.id}`, { status: "backlog" });
await api("POST", `/issues/${issue.id}/interactions`, {
  kind: "ask_user_questions",
  title: "验收：P8 链路卡片",
  continuationPolicy: "none",
  payload: { version: 1, questions: [{ id: "c", prompt: "验收：P8 链路卡片", selectionMode: "single", options: [{ id: "a", label: "好" }] }] },
});

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const foreignRequests = new Set();
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("request", (r) => {
  const u = new URL(r.url());
  if (/^https?:$/.test(u.protocol) && u.origin !== new URL(base).origin && /^(127\.0\.0\.1|localhost)$/.test(u.hostname)) foreignRequests.add(u.origin);
});
const sidebarCheck = async (label) => {
  await page.waitForSelector("[data-agentself-sidebar] .nav-item", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  return {
    page: label,
    path: new URL(page.url()).pathname,
    agentselfSidebars: await page.locator("[data-agentself-sidebar]").count(),
    // navigation sidebars only: the workbench progress panel and the drawers are <aside> too
    asides: await page.evaluate(() => [...document.querySelectorAll("aside")].filter((a) => a.getBoundingClientRect().width > 0 && !a.matches(".progress, .drawer")).length),
    paperclipNewTask: await page.getByRole("button", { name: /New issue|新建任务/ }).count(),
  };
};

// 1 + 2. home is the workbench, one sidebar everywhere
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".agentself .composer", { timeout: 60_000 });
results.homeIsWorkbench = new URL(page.url()).pathname === `/${prefix}/agentself`;
const pages = [];
pages.push(await sidebarCheck("工作台"));
for (const p of ["agentself/projects", `agentself/departments/research`, "agentself/settings", "org", "agents/all", "routines", "activity", "costs", "company/settings", "company/settings/instance/plugins", `agents/${member.id}`]) {
  await page.goto(`${base}/${prefix}/${p}`, { waitUntil: "domcontentloaded" });
  pages.push(await sidebarCheck(p));
}
results.sidebars = pages;
results.singleSidebarEverywhere = pages.every((p) => p.agentselfSidebars === 1 && p.asides === 1);
const navText = await page.locator("[data-agentself-sidebar]").innerText();
results.hiddenFromNav = ["收件箱", "仪表盘", "Inbox", "Dashboard", "Cases", "Goals", "目标", "聊天"].filter((w) => navText.includes(w));

// 3. card -> drawer -> task page -> run record
await page.goto(`${base}/${prefix}/agentself`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".agentself .composer", { timeout: 60_000 });
await page.waitForTimeout(6000);
const card = page.locator("#results .card.decide").filter({ hasText: "P8 链路卡片" }).first();
results.cardShown = (await card.count()) > 0;
await card.click(); // SETO: the whole card is the button that expands it
await page.locator(".detail a", { hasText: /打开/ }).first().click();
await page.waitForSelector(".drawer", { timeout: 15_000 });
results.drawerOpened = await page.locator(".drawer h2", { hasText: "P8 运行记录" }).waitFor({ timeout: 20_000 }).then(() => true, () => false);
await page.getByTestId("open-issue-page").click();
await page.waitForTimeout(4000);
results.taskPage = new URL(page.url()).pathname;
results.taskPageInApp = results.taskPage.startsWith(`/${prefix}/issues/`) && (await page.locator("[data-agentself-sidebar]").count()) === 1;
// task page -> its assignee (property panel link) -> the employee's runs -> this run
await page.locator(`a[href*="/agents/${member.id}"]`).first().click();
await page.waitForTimeout(3000);
results.viaAgentPage = new URL(page.url()).pathname;
await page.waitForTimeout(3000);
// latest runs are on the overview; otherwise the employee page's 运行记录 tab lists them all
if (!(await page.locator(`a[href*="/runs/${runId}"]`).count())) {
  await page.locator("[data-testid=employee-page] a[role=tab]", { hasText: "运行记录" }).click().catch(() => {});
  await page.waitForTimeout(4000);
}
const runLink = page.locator(`a[href*="/runs/${runId}"]`).first();
results.runReachedFromTaskPage = (await runLink.count()) > 0;
if (results.runReachedFromTaskPage) {
  await runLink.click();
  await page.waitForTimeout(4000);
}
results.runPage = new URL(page.url()).pathname;
results.runPageInApp = results.runPage.includes(`/runs/${runId}`) && (await page.locator("[data-agentself-sidebar]").count()) === 1;
await page.screenshot({ path: "spikes/shots/p8-run.png" });

// 4. hidden pages still open by URL
const hidden = {};
for (const p of ["inbox", "dashboard", "chats", "cases", "goals", "companies"]) {
  await page.goto(`${base}/${prefix}/${p}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const text = await page.locator("main, #main-content, body").first().innerText();
  hidden[p] = { path: new URL(page.url()).pathname, notFound: /页面未找到|Page not found|404/.test(text) };
}
results.hiddenByUrl = hidden;
results.hiddenStillOpen = Object.values(hidden).every((h) => !h.notFound);

await browser.close();
if (!process.env.P8_KEEP) await api("DELETE", `/issues/${issue.id}`).catch(() => {});
results.foreignRequests = [...foreignRequests];
results.pageErrors = errors;
const pass =
  results.homeIsWorkbench && results.singleSidebarEverywhere && results.hiddenFromNav.length === 0 && results.runRecorded && results.cardShown && results.runReachedFromTaskPage &&
  results.drawerOpened && results.taskPageInApp && results.runPageInApp && results.hiddenStillOpen && results.foreignRequests.length === 0 && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
