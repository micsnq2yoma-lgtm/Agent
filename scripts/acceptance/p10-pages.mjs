#!/usr/bin/env node
// P10 acceptance (PLAN 9, v0.5): page integration per the 7.0 merge table.
//  - every sidebar item opens inside the one app, with the Agentself sidebar and skin
//  - the sidebar offers no duplicate entries (no inbox / dashboard / tasks list / costs / activity / skills / apps)
//  - department page: 概览 / 成员 / 例行任务 / 能力 / 预算
//  - employee full page: Paperclip detail + 档案 / 记忆 tabs; drawer links to it
//  - 能力与工具 (技能 / 连接器 / 权限), 用量与预算, 记录 (活动 / 运行审计 / 产物 / 审批历史), 设置 with 高级
//  - 像素团队 stats bar; 高级新建 next to the composer opens Paperclip's full form
//  - default skin: no 智能体 on any of these pages
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_APP ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const ctx = await (await fetch(`${base}/agentself/api/context`)).json();
const prefix = ctx.company.issuePrefix;
const research = ctx.departments.find((d) => d.key === "research");
const skinBg = ctx.settings.skin === "court" ? "#f6efe2" : "#faf9f7";

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const results = {};

async function state() {
  await page.waitForSelector("[data-agentself-sidebar] .nav-item", { timeout: 60_000 });
  await page.waitForTimeout(3500);
  return page.evaluate(() => {
    const skip = "code,pre,textarea,input,[contenteditable='true'],.prose,.markdown-body,.mdxeditor,script,style";
    let agentWord = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if ((n.nodeValue ?? "").includes("智能体") && !n.parentElement?.closest(skip) && n.parentElement?.getBoundingClientRect().width) agentWord++;
    const text = document.querySelector("main")?.innerText ?? document.body.innerText;
    return {
      path: location.pathname + location.search,
      origin: location.origin,
      sidebars: document.querySelectorAll("[data-agentself-sidebar]").length,
      asides: [...document.querySelectorAll("aside")].filter((a) => a.getBoundingClientRect().width > 0).length,
      skinBg: getComputedStyle(document.documentElement).getPropertyValue("--background").trim().toLowerCase(),
      notFound: /页面未找到|Page not found|API route not found/.test(text),
      agentWord,
    };
  });
}
const good = (s) => s.origin === new URL(base).origin && s.sidebars === 1 && s.asides === 1 && s.skinBg === skinBg && !s.notFound && s.agentWord === 0;

// 1. every sidebar item, clicked from the sidebar
await page.goto(`${base}/${prefix}/agentself`, { waitUntil: "domcontentloaded" });
await state();
if ((await page.getByTestId("nav-manage").getAttribute("aria-expanded")) !== "true") await page.getByTestId("nav-manage").click();
const hrefs = await page.locator("[data-agentself-sidebar] a").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
results.sidebarLinks = hrefs;
const forbidden = ["/inbox", "/dashboard", "/issues", "/costs", "/activity", "/skills", "/apps", "/approvals", "/goals", "/cases", "/chats", "/companies"];
results.duplicateEntries = hrefs.filter((h) => forbidden.some((f) => h === `/${prefix}${f}` || h.startsWith(`/${prefix}${f}/`)));
const visits = [];
for (const href of hrefs) {
  const link = page.locator(`[data-agentself-sidebar] a[href="${href}"]`).first();
  if (!(await link.count())) {
    if ((await page.getByTestId("nav-manage").getAttribute("aria-expanded")) !== "true") await page.getByTestId("nav-manage").click();
  }
  await page.locator(`[data-agentself-sidebar] a[href="${href}"]`).first().click();
  const s = await state();
  visits.push({ href, ...s, ok: good(s) });
}
results.sidebarVisits = visits.filter((v) => !v.ok);
results.everySidebarItemInApp = visits.length > 8 && visits.every((v) => v.ok);

// 2. department page: five tabs
const deptTabs = {};
for (const tab of ["", "/members", "/routines", "/capabilities", "/budget"]) {
  await page.goto(`${base}/${prefix}/agentself/departments/${research.key}${tab}`, { waitUntil: "domcontentloaded" });
  const s = await state();
  const activeTab = await page.locator("[data-testid=department-tabs] [aria-selected=true]").innerText().catch(() => "");
  deptTabs[tab || "/overview"] = { ok: good(s), activeTab };
}
results.departmentTabs = deptTabs;
results.departmentPage =
  Object.values(deptTabs).every((x) => x.ok) &&
  ["概览", "成员", "例行任务", "能力", "预算"].every((l) => Object.values(deptTabs).some((x) => x.activeTab === l || (l === "例行任务" && x.activeTab === "常例")));
await page.goto(`${base}/${prefix}/agentself/departments/${research.key}/members`, { waitUntil: "domcontentloaded" });
await state();
results.membersListed = await page.locator("[data-testid=department-page] table.data tbody tr").count();

// 3. employee full page: drawer -> 完整页 -> 档案 / 记忆 / Paperclip tabs
await page.getByRole("button", { name: "快速查看" }).first().click();
await page.getByTestId("open-agent-page").click();
let s = await state();
results.employeeFromDrawer = s.path.endsWith("/profile") && good(s) && (await page.getByText("工作目录").count()) > 0;
await page.locator("[data-testid=employee-page] a[role=tab]", { hasText: "记忆" }).click();
s = await state();
results.employeeMemoryTab = s.path.endsWith("/memory") && (await page.getByText("记忆文件").count()) > 0;
await page.locator("[data-testid=employee-page] a[role=tab]", { hasText: "概览" }).click();
s = await state();
results.employeePaperclipTab = s.path.endsWith("/overview") && good(s) && (await page.locator("[data-testid=employee-page]").count()) === 1;

// 4. merged pages and their tabs
const hubTabs = {};
for (const p of ["capabilities", "capabilities/connectors", "capabilities/permissions", "usage", "usage/budgets", "usage/costs", "records", "records/runs", "records/artifacts", "records/approvals/all", "org", "routines", "settings"]) {
  await page.goto(`${base}/${prefix}/agentself/${p}`, { waitUntil: "domcontentloaded" });
  const st = await state();
  hubTabs[p] = good(st);
}
results.mergedPages = hubTabs;
results.mergedPagesOk = Object.values(hubTabs).every(Boolean);
results.settingsAdvanced = (await page.getByText("高级").count()) > 0 && (await page.locator("a", { hasText: "打开" }).count()) >= 5;

// 5. team stats bar + 高级新建
await page.goto(`${base}/${prefix}/agentself`, { waitUntil: "domcontentloaded" });
await state();
await page.getByRole("tab", { name: /像素团队|朝堂/ }).click();
await page.waitForTimeout(2000);
results.teamStats = (await page.getByTestId("team-stats").count()) === 1 && (await page.getByTestId("team-stats").innerText()).includes("运行中");
results.composerInTeamView = (await page.getByLabel("交给团队一件事").count()) === 1;
await page.getByRole("button", { name: "高级新建" }).click();
await page.waitForTimeout(2000);
results.advancedNewOpensForm = (await page.locator("[role=dialog]").count()) > 0;
await page.keyboard.press("Escape");
await page.getByRole("tab", { name: /工作台|御书房/ }).click();

await browser.close();
results.pageErrors = errors;
const pass =
  results.everySidebarItemInApp && results.duplicateEntries.length === 0 && results.departmentPage && results.membersListed >= 3 &&
  results.employeeFromDrawer && results.employeeMemoryTab && results.employeePaperclipTab && results.mergedPagesOk && results.settingsAdvanced &&
  results.teamStats && results.composerInTeamView && results.advancedNewOpensForm && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
