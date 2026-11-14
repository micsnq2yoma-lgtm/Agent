#!/usr/bin/env node
// P6 acceptance (skin packs): import a shared skin JSON in Settings, switch to it, terms follow;
// export of a skin downloads valid JSON.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_CONSOLE ?? "http://127.0.0.1:3200";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p));
const { office } = await import(pathToFileURL(path.resolve("packages/skins/src/index.ts")).href);

const lab = {
  ...office,
  id: "lab",
  name: "实验室",
  description: "共享皮肤示例：组长 / 组员 / 周报",
  tokens: { ...office.tokens, accent: "#0f8a8a", accentStrong: "#0b6b6b", sidebar: "#eef5f4" },
  terms: { ...office.terms, lead: "组长", employee: "组员", report: "周报", workbench: "实验台", team: "实验室全景", decide: "等你定夺" },
};
const file = path.join(os.tmpdir(), "agentself-skin-lab.json");
fs.writeFileSync(file, JSON.stringify(lab, null, 2));

const results = {};
const browser = await pw.chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "设置" }).click();
await page.locator("input[type=file]").setInputFiles(file);
await page.waitForTimeout(2500);
const row = page.locator(".section", { hasText: "皮肤" }).locator(".row", { hasText: "实验室" });
results.listed = (await row.count()) > 0;
await row.getByRole("button", { name: "使用" }).click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "实验台" }).first().click();
await page.waitForTimeout(800);
const text = await page.locator("body").innerText();
results.termsApplied = text.includes("实验台") && text.includes("实验室全景");
results.accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--as-accent").trim());
await page.screenshot({ path: "spikes/shots/p6-skin-lab.png" });

// export
await page.getByRole("button", { name: "设置" }).click();
await page.waitForTimeout(500);
const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "导出" }).click()]);
const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
results.exportOk = exported.id === "lab" && exported.terms.lead === "组长";

// persisted on the server -> survives reload
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
results.persisted = (await page.locator("body").innerText()).includes("实验台");

// back to the default skin
await page.getByRole("button", { name: "设置" }).click();
await page.locator(".section", { hasText: "皮肤" }).locator(".row", { hasText: "办公室" }).getByRole("button", { name: "使用" }).click();
await page.waitForTimeout(800);
await browser.close();
results.pageErrors = errors;
const pass = results.listed && results.termsApplied && results.accent === "#0f8a8a" && results.exportOk && results.persisted && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
