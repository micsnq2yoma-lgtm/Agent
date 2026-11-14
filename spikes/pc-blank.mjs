import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const msDir = path.join(process.env.LOCALAPPDATA, "ms-playwright");
const exe = fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p));
const browser = await pw.chromium.launch({ executablePath: exe });
for (const locale of ["en", "zh-CN"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((l) => localStorage.setItem("paperclip.locale", l), locale);
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(m.type() + ": " + m.text().slice(0, 150)));
  page.on("pageerror", (e) => logs.push("pageerror: " + String(e).slice(0, 200)));
  await page.goto("http://127.0.0.1:3100/AGE/dashboard", { waitUntil: "load" });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `spikes/shots/paperclip/blank-${locale}.png` });
  const info = await page.evaluate(() => ({ bodyBg: getComputedStyle(document.body).backgroundColor, html: document.documentElement.className, opacity: getComputedStyle(document.body).opacity, rootKids: document.getElementById("root")?.children.length, text: document.body.innerText.slice(0, 200) }));
  console.log(locale, JSON.stringify(info), logs.filter((l) => /error|warn/i.test(l)).slice(0, 5));
  await ctx.close();
}
await browser.close();
