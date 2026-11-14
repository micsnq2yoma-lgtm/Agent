#!/usr/bin/env node
// Dev helper: screenshot console pages with Playwright (from vendor/paperclip's install).
// Usage: node scripts/dev/screenshot.mjs <outDir> [baseUrl]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
let pw;
try { pw = require("playwright"); } catch { pw = require(path.resolve("vendor/paperclip/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright")); }
const out = process.argv[2] ?? "spikes/shots";
const base = process.argv[3] ?? "http://127.0.0.1:3200";
fs.mkdirSync(out, { recursive: true });
const exe = process.env.AGENTSELF_CHROME ?? fs.readdirSync(path.join(process.env.LOCALAPPDATA, 'ms-playwright')).filter((d) => d.startsWith('chromium-')).map((d) => path.join(process.env.LOCALAPPDATA, 'ms-playwright', d, 'chrome-win64', 'chrome.exe')).find((p) => fs.existsSync(p));
const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/home.png` });
const expand = page.getByRole("button", { name: "展开" }).first();
if (await expand.count()) { await expand.click(); await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/home-expanded.png` }); }
await page.getByRole("tab", { name: "像素团队" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/team.png` });
await page.getByRole("tab", { name: "工作台" }).click();
for (const [name, label] of [["settings", "设置"], ["usage", "用量"], ["projects", "项目"], ["new-dept", "＋"]]) {
  const btn = name === "new-dept" ? page.getByTitle("新建部门") : page.getByRole("button", { name: label, exact: false }).first();
  await btn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
}
await page.getByRole("button", { name: "项目" }).first().click();
await page.waitForTimeout(800);
const row = page.locator("table.data tbody tr").first();
if (await row.count()) { await row.click(); await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/project-drawer.png` }); }
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
