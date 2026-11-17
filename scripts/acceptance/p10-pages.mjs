#!/usr/bin/env node
// P10 acceptance, updated for the v0.6 SETO interface (docs/handoff/design/DESIGN.md):
//  - every sidebar item opens inside the one app, with the Agentself sidebar and skin, no 404, no 智能体
//  - the sidebar offers no duplicate entries (no inbox / dashboard / tasks list / costs / activity / skills / apps)
//  - sidebar (§4.1): 工作台 / 项目 / 主管 rows / 管理 / 设置 only; line icons, no text glyphs; "我 / 通知" gone
//  - top bar (§4.2): no pending badge; workbench (§2): progress panel on the right, composer docked at the bottom
//  - skin (§3): office tokens applied (ink-black accent, cool grey page), bundled serif loads
//  - lead page (§4.10): header chips, 概览 / 员工 N / 例行任务 / 能力 / 预算, side cards
//  - employee full page: drawer → 完整页 → 档案 / 记忆 / Paperclip tabs
//  - 能力与工具, 用量与预算, 记录, 组织图, 例行任务, 设置 (tabs incl. 关于我 and 高级)
//  - project drawer (§4.9) floats with stages and criteria (when a project exists)
//  - 像素团队 stats bar, composer and 高级 (opens Paperclip's full form)
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
const research = ctx.departments.find((d) => d.key === "research") ?? ctx.departments[0];
const office = ctx.settings.skin !== "court";
const skinBg = office ? "#f5f5f5" : "#f6efe2";

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
    // Navigation sidebars only: the workbench progress panel and drawers are <aside> too.
    const navAsides = [...document.querySelectorAll("aside")].filter((a) => a.getBoundingClientRect().width > 0 && !a.matches(".progress, .drawer"));
    return {
      path: location.pathname + location.search,
      origin: location.origin,
      sidebars: document.querySelectorAll("[data-agentself-sidebar]").length,
      asides: navAsides.length,
      skinBg: getComputedStyle(document.documentElement).getPropertyValue("--background").trim().toLowerCase(),
      notFound: /页面未找到|Page not found|API route not found/.test(text),
      pendingBadge: document.querySelectorAll(".pending-badge").length,
      agentWord,
    };
  });
}
const good = (s) => s.origin === new URL(base).origin && s.sidebars === 1 && s.asides === 1 && s.skinBg === skinBg && !s.notFound && s.agentWord === 0 && s.pendingBadge === 0;

// 0. sidebar structure, skin tokens, workbench layout (§2, §3, §4.1, §4.2)
await page.goto(`${base}/${prefix}/agentself`, { waitUntil: "domcontentloaded" });
await state();
const side = page.locator("[data-agentself-sidebar]");
const sideText = await side.innerText();
results.sidebarItems = {
  workbench: (await page.getByTestId("nav-workbench").count()) === 1,
  projects: (await page.getByTestId("nav-projects").count()) === 1,
  library: (await page.getByTestId("nav-library").count()) === 1,
  leadSection: (await side.locator(".nav-section").first().innerText()).includes(office ? "主管" : "尚书"),
  manage: (await page.getByTestId("nav-manage").count()) === 1,
  settings: (await page.getByTestId("nav-settings").count()) === 1,
  noMeOrNotify: (await side.locator(".nav-me").count()) === 0 && !/通知/.test(sideText),
  lineIcons: (await side.locator("svg.lucide").count()) >= 5,
  noGlyphIcons: !/[⌕▾▸＋]/.test(sideText),
};
results.sidebarStructure = Object.values(results.sidebarItems).every(Boolean);
results.tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return { accent: cs.getPropertyValue("--as-accent").trim().toLowerCase(), bg: cs.getPropertyValue("--as-bg").trim().toLowerCase(), subtle: cs.getPropertyValue("--as-surface-subtle").trim().toLowerCase() };
});
results.officeTokens = !office || (results.tokens.accent === "#0c151d" && results.tokens.bg === "#f5f5f5" && results.tokens.subtle === "#edefef");
results.serifLoaded = await page.evaluate(async () => {
  await document.fonts.load('500 28px "Cormorant Garamond"');
  return document.fonts.check('500 28px "Cormorant Garamond"');
});
results.workbenchLayout = {
  progressPanel: await page.locator("aside.progress").isVisible(),
  composerDocked: (await page.locator(".composer-dock .composer").count()) === 1,
  filtersSegmented: (await page.locator(".filters .filter").count()) === 4,
  wordmark: (await page.locator(".hero .wordmark").count()) === 1,
};
results.workbenchOk = Object.values(results.workbenchLayout).every(Boolean);

// 1. every sidebar item, clicked from the sidebar
if ((await page.getByTestId("nav-manage").getAttribute("aria-expanded")) !== "true") await page.getByTestId("nav-manage").click();
const hrefs = await page.locator("[data-agentself-sidebar] a").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
results.sidebarLinks = hrefs;
const forbidden = ["/inbox", "/dashboard", "/issues", "/costs", "/activity", "/skills", "/apps", "/approvals", "/goals", "/cases", "/chats", "/companies"];
results.duplicateEntries = hrefs.filter((h) => forbidden.some((f) => h === `/${prefix}${f}` || h.startsWith(`/${prefix}${f}/`)));
const visits = [];
for (const href of hrefs) {
  if (!(await page.locator(`[data-agentself-sidebar] a[href="${href}"]`).first().count())) {
    if ((await page.getByTestId("nav-manage").getAttribute("aria-expanded")) !== "true") await page.getByTestId("nav-manage").click();
  }
  await page.locator(`[data-agentself-sidebar] a[href="${href}"]`).first().click();
  const s = await state();
  visits.push({ href, ...s, ok: good(s) });
}
results.sidebarVisits = visits.filter((v) => !v.ok);
results.everySidebarItemInApp = visits.length > 8 && visits.every((v) => v.ok);

// 2. lead page (§4.10): header, five tabs, side cards
const deptTabs = {};
for (const tab of ["", "/members", "/routines", "/capabilities", "/budget"]) {
  await page.goto(`${base}/${prefix}/agentself/departments/${research.key}${tab}`, { waitUntil: "domcontentloaded" });
  const s = await state();
  const activeTab = await page.locator("[data-testid=department-tabs] [aria-selected=true]").innerText().catch(() => "");
  deptTabs[tab || "/overview"] = { ok: good(s), activeTab };
}
results.departmentTabs = deptTabs;
const tabLabels = office ? ["概览", "员工", "例行任务", "能力", "预算"] : ["概览", "侍郎", "常例", "能力", "预算"];
results.departmentPage = Object.values(deptTabs).every((x) => x.ok) && tabLabels.every((l) => Object.values(deptTabs).some((x) => x.activeTab.startsWith(l)));
await page.goto(`${base}/${prefix}/agentself/departments/${research.key}`, { waitUntil: "domcontentloaded" });
await state();
results.leadHeader = {
  title: (await page.locator(".lead-head h1").count()) === 1,
  managementOnlyChip: (await page.locator(".lead-head .chip", { hasText: "只用管理工具" }).count()) === 1,
  sideCards: (await page.locator(".two-col .side-card").count()) >= 3,
  stats: (await page.locator(".two-col .stats > div").count()) === 5,
};
results.leadPageOk = Object.values(results.leadHeader).every(Boolean);
await page.goto(`${base}/${prefix}/agentself/departments/${research.key}/members`, { waitUntil: "domcontentloaded" });
await state();
results.membersListed = await page.locator("[data-testid=department-page] table.data tbody tr").count(); // lead + employees

// 3. employee full page: drawer -> 完整页 -> 档案 / 记忆 / Paperclip tabs
await page.getByRole("button", { name: "快速查看" }).nth(1).click(); // row 0 is the lead
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
for (const p of ["capabilities", "capabilities/skills", "capabilities/connectors", "capabilities/permissions", "usage", "usage/budgets", "usage/costs", "records", "records/runs", "records/artifacts", "records/approvals/all", "org", "routines", "settings"]) {
  await page.goto(`${base}/${prefix}/agentself/${p}`, { waitUntil: "domcontentloaded" });
  hubTabs[p] = good(await state());
}
results.mergedPages = hubTabs;
results.mergedPagesOk = Object.values(hubTabs).every(Boolean);

// settings (§4.13): tabs; 关于我 is two columns with the profile list and an editor; 高级 links out
const settingsTabs = await page.locator(".tabbar[aria-label=设置分类] [role=tab]").allInnerTexts();
results.settingsTabs = settingsTabs;
await page.locator(".tabbar[aria-label=设置分类] [role=tab]", { hasText: "关于我" }).click();
await page.waitForTimeout(1500);
results.settingsProfile = (await page.locator(".profile-list [role=tab]").count()) === 4 && (await page.locator(".profile-grid textarea").count()) === 1;
await page.locator(".tabbar[aria-label=设置分类] [role=tab]", { hasText: "高级" }).click();
await page.waitForTimeout(800);
results.settingsAdvanced = (await page.locator("a", { hasText: "打开" }).count()) >= 5;
results.settingsOk = ["通用", "路由", "模型与订阅", "邮箱", "论文库", "飞书", "预算", "对外动作", "皮肤", "关于我", "高级"].every((l) => settingsTabs.includes(l)) && results.settingsProfile && results.settingsAdvanced;

// 5. project drawer (§4.9), when there is a project to open
await page.goto(`${base}/${prefix}/agentself`, { waitUntil: "domcontentloaded" });
await state();
const row = page.locator("aside.progress .row-link").first();
if (await row.count()) {
  await row.click();
  await page.waitForSelector(".drawer", { timeout: 10_000 });
  results.drawer = await page.evaluate(() => {
    const d = document.querySelector(".drawer");
    const cs = getComputedStyle(d);
    return { radius: cs.borderTopLeftRadius, top: cs.top, stages: !!d.querySelector(".stages.lg"), criteria: !!d.querySelector(".criteria") || /还没有登记验收标准/.test(d.textContent ?? ""), pill: !!d.querySelector(".say-pill") };
  });
  results.drawerOk = results.drawer.radius === "24px" && results.drawer.top === "12px" && results.drawer.stages && results.drawer.criteria && results.drawer.pill;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
} else results.drawerOk = "skipped: no project in progress";

// 6. team stats bar + composer + 高级
await page.getByRole("tab", { name: /像素团队|朝堂/ }).click();
await page.waitForTimeout(2000);
results.teamStats = (await page.getByTestId("team-stats").count()) === 1 && (await page.getByTestId("team-stats").innerText()).includes("运行中");
results.composerInTeamView = (await page.getByLabel("交给团队一件事").count()) === 1;
await page.getByRole("button", { name: "高级", exact: true }).click();
await page.waitForTimeout(2000);
results.advancedNewOpensForm = (await page.locator("[role=dialog]").count()) > 0;
await page.keyboard.press("Escape");
await page.getByRole("tab", { name: /工作台|御书房/ }).click();

fs.mkdirSync("spikes/shots", { recursive: true });
await page.screenshot({ path: "spikes/shots/p10-workbench.png" });
await browser.close();
results.pageErrors = errors;
const pass =
  results.sidebarStructure &&
  results.officeTokens &&
  results.serifLoaded &&
  results.workbenchOk &&
  results.everySidebarItemInApp &&
  results.duplicateEntries.length === 0 &&
  results.departmentPage &&
  results.leadPageOk &&
  results.membersListed >= 2 &&
  results.employeeFromDrawer &&
  results.employeeMemoryTab &&
  results.employeePaperclipTab &&
  results.mergedPagesOk &&
  results.settingsOk &&
  results.drawerOk !== false &&
  results.teamStats &&
  results.composerInTeamView &&
  results.advancedNewOpensForm &&
  errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
