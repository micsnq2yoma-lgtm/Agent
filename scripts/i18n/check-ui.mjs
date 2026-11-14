#!/usr/bin/env node
// Visit main Paperclip admin pages, screenshot them, and list English text still visible
// (to grow the zh-CN dictionary). Usage: node scripts/i18n/check-ui.mjs [outDir]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const out = process.argv[2] ?? "spikes/shots/paperclip";
fs.mkdirSync(out, { recursive: true });
const base = process.env.PAPERCLIP_UI ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p));
const companies = await (await fetch(`${base}/api/companies`)).json();
const prefix = (companies.find((c) => c.name === "Agentself") ?? companies[0])?.issuePrefix ?? "AGE";
const pages = ["dashboard", "issues", "agents", "projects", "org", "routines", "skills", "costs", "approvals", "settings", "inbox"];

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const english = new Map();
for (const p of pages) {
  await page.goto(`${base}/${prefix}/${p}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${p}.png` });
  const found = await page.evaluate(() => {
    const skip = "code,pre,kbd,textarea,input,[contenteditable='true'],.prose,.markdown-body,.mdxeditor,script,style";
    const res = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = (n.nodeValue ?? "").trim();
      if (!t || !/[A-Za-z]{3}/.test(t) || /[一-鿿]/.test(t)) continue;
      if (n.parentElement?.closest(skip)) continue;
      const r = n.parentElement?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      res.push(t);
    }
    return res;
  });
  for (const t of found) english.set(t, (english.get(t) ?? 0) + 1);
}
await browser.close();
const list = [...english.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
fs.writeFileSync(path.join(out, "untranslated.json"), JSON.stringify(list, null, 1));
console.log(JSON.stringify({ pages: pages.length, untranslated: list.length, sample: list.slice(0, 40), errors }, null, 1));
