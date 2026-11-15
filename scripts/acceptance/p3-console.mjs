#!/usr/bin/env node
// P3 acceptance: skins switch terminology; wizard creates a working department; usage shows departments;
// pixel office reflects agent states.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_CONSOLE ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p));
const j = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
const results = {};
const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 1. skins: office -> court -> office, terminology follows
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".agentself .composer", { timeout: 60_000 });
await page.getByRole("link", { name: "设置", exact: true }).click();
await page.getByRole("tab", { name: "皮肤", exact: true }).click(); // settings are tabbed (SETO)
await page.locator(".section", { hasText: "皮肤" }).locator(".row", { hasText: "朝堂" }).getByRole("button", { name: /^使用/ }).click();
await page.waitForTimeout(800);
await page.getByRole("link", { name: "御书房", exact: true }).first().click();
await page.waitForTimeout(1500);
const courtText = await page.locator("body").innerText();
results.courtTerms = ["御书房", "朝堂", "待朱批", "通政司"].every((w) => courtText.includes(w));
results.courtLayoutRight = (await page.evaluate(() => document.documentElement.dataset.layoutSidebar)) === "right";
await page.screenshot({ path: "spikes/shots/p3-court.png" });
await page.getByRole("link", { name: "设置", exact: true }).click();
await page.getByRole("tab", { name: "皮肤", exact: true }).click(); // settings are tabbed (SETO)
await page.locator(".section", { hasText: "皮肤" }).locator(".row", { hasText: "办公室" }).getByRole("button", { name: /^使用/ }).click();
await page.waitForTimeout(800);
const officeText = await page.locator("body").innerText();
results.backToOffice = officeText.includes("工作台") && !officeText.includes("御书房");

// 2. wizard (plan B / SETO): nothing is preset — name a team, its lead and one employee through the UI
const TEAM = "验收团队";
const before = (await j("GET", "/agentself/api/context")).departments.map((d) => d.name);
if (!before.includes(TEAM)) {
  await page.getByRole("link", { name: "新建主管" }).first().click(); // the + next to 主管 in the sidebar
  await page.getByPlaceholder("团队名称，由你来定").fill(TEAM);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByPlaceholder("主管的名字").fill("验收主管");
  await page.getByRole("button", { name: /员工（Claude）/ }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "创建" }).click();
  await page.waitForTimeout(8000);
}
const ctx = await j("GET", "/agentself/api/context");
const life = ctx.departments.find((d) => d.name === TEAM);
results.wizardCreated = !!life && life.members.length >= 1;
if (life) {
  const agent = ctx.agents.find((a) => life.members.includes(a.id));
  results.wizardAgentReady = { name: agent?.name, status: agent?.status, skills: agent ? (await j("GET", `/api/agents/${agent.id}/skills`)).desiredSkills?.length : 0 };
  const mem = await j("GET", `/agentself/api/memory/${agent.id}`);
  results.wizardIdentityFile = mem.some((f) => f.path === "identity.md");
}

// 3. usage panel groups by department
// P8: usage lives in the collapsed "管理" group of the single sidebar
if ((await page.getByTestId("nav-manage").getAttribute("aria-expanded")) !== "true") await page.getByTestId("nav-manage").click();
await page.getByRole("link", { name: "用量与预算" }).click();
await page.waitForTimeout(2500);
const usageText = await page.locator("body").innerText();
results.usageByDepartment = usageText.includes(ctx.departments.find((d) => d.key === "research")?.name ?? "科研") && usageText.includes("订阅额度");
await page.screenshot({ path: "spikes/shots/p3-usage.png" });

// 4. pixel office: every agent has a nameplate and a mapped state
await page.getByRole("link", { name: "工作台", exact: true }).first().click();
await page.getByRole("tab", { name: "像素团队" }).click();
await page.waitForTimeout(5000);
const office = await j("GET", "/agentself/api/office");
const plates = await page.locator(".nameplate").count();
results.officePeople = { snapshot: office.people.length, nameplates: plates, anims: office.people.map((p) => `${p.name}:${p.anim}`) };
await page.screenshot({ path: "spikes/shots/p3-team.png" });
await page.getByRole("tab", { name: "工作台" }).click();
await browser.close();

results.pageErrors = errors;
const pass =
  results.courtTerms && results.courtLayoutRight && results.backToOffice && results.wizardCreated && results.wizardIdentityFile && results.usageByDepartment &&
  plates === office.people.length && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
