#!/usr/bin/env node
// P9 acceptance (PLAN 9, v0.5): one look and one vocabulary for the whole app.
//  - switching office <-> court changes colours and words alike on the workbench, org chart,
//    employee detail and costs pages
//  - default skin: the word 智能体 appears nowhere in the app
//  - every employee avatar is the pixel robot
// Restores the skin that was active before the run.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTEAM_APP ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const j = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}`);
  return r.json();
};
const ctx = await j("GET", "/agenteam/api/context");
const prefix = ctx.company.issuePrefix;
const research = ctx.departments.find((d) => d.key === "research");
const original = ctx.settings.skin;
const SKINS = {
  office: { bg: "#f5f5f5", employee: "员工", user: "我", workbench: "工作台" }, // SETO office skin
  court: { bg: "#f6efe2", employee: "侍郎", user: "朕", workbench: "御书房" },
};
const pages = [
  ["workbench", `/${prefix}/agenteam`],
  ["org", `/${prefix}/agenteam/org`],
  ["employees", `/${prefix}/agents/all`],
  ["employee", `/${prefix}/agents/${research.leadAgentId}/overview`],
  ["costs", `/${prefix}/activity/costs`],
];

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function inspect() {
  return page.evaluate(() => {
    const skip = "code,pre,textarea,input,[contenteditable='true'],.prose,.markdown-body,.mdxeditor,script,style";
    let agentWord = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    const hits = [];
    while ((n = w.nextNode())) {
      const t = n.nodeValue ?? "";
      if (!t.includes("智能体") || n.parentElement?.closest(skip)) continue;
      const r = n.parentElement?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      agentWord++;
      hits.push(t.trim().slice(0, 40));
    }
    for (const el of document.querySelectorAll("[placeholder],[title],[aria-label]"))
      for (const a of ["placeholder", "title", "aria-label"]) if ((el.getAttribute(a) ?? "").includes("智能体")) (agentWord++, hits.push(`@${a}:${el.getAttribute(a)}`));
    const html = getComputedStyle(document.documentElement);
    const imgs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    const sb = document.querySelector("[data-agenteam-sidebar]")?.getBoundingClientRect();
    return {
      background: html.getPropertyValue("--background").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      text: document.body.innerText,
      agentWord,
      hits: hits.slice(0, 5),
      paperclipAvatars: imgs.filter((s) => s.includes("/api/agent-avatars/")).length,
      robotAvatars: imgs.filter((s) => s.startsWith("data:image/svg+xml")).length,
      sidebarX: sb ? Math.round(sb.x) : null,
    };
  });
}

const results = {};
for (const skin of ["office", "court"]) {
  await j("PUT", "/agenteam/api/settings", { ...ctx.settings, skin });
  const rows = [];
  for (const [name, url] of pages) {
    await page.goto(`${base}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-agenteam-sidebar] .nav-item", { timeout: 60_000 });
    await page.waitForTimeout(4500);
    const r = await inspect();
    const want = SKINS[skin];
    rows.push({
      page: name,
      colours: r.background.toLowerCase() === want.bg,
      workbenchTerm: r.text.includes(want.workbench),
      userTerm: r.text.includes(want.user), // informational: the SETO sidebar dropped 我 / 通知, so the user term only shows in a lead's 汇报对象
      employeeTerm: name === "workbench" || name === "org" || r.text.includes(want.employee), // org chart shows names only
      agentWord: r.agentWord,
      hits: r.hits,
      robotAvatars: r.robotAvatars,
      paperclipAvatars: r.paperclipAvatars,
      sidebarRight: r.sidebarX != null && r.sidebarX > 700,
    });
    await page.screenshot({ path: `.agenteam-shots/p9-${skin}-${name}.png` });
  }
  results[skin] = rows;
}
await j("PUT", "/agenteam/api/settings", { ...ctx.settings, skin: original });
await browser.close();

const ok = (rows, skin) =>
  rows.every((r) => r.colours && r.workbenchTerm && r.employeeTerm && r.paperclipAvatars === 0 && r.sidebarRight === (skin === "court"));
results.officeConsistent = ok(results.office, "office");
results.courtConsistent = ok(results.court, "court");
results.noAgentWordInDefaultSkin = results.office.every((r) => r.agentWord === 0);
results.robotAvatarsShown = results.office.some((r) => r.robotAvatars > 0);
results.pageErrors = errors;
const pass = results.officeConsistent && results.courtConsistent && results.noAgentWordInDefaultSkin && results.robotAvatarsShown && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
