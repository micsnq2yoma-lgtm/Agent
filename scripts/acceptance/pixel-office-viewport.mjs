#!/usr/bin/env node
// Isolated viewport acceptance for the real Team / SkinProvider / Wordmark components.
// No live console, credentials, employees or mutations: /office is a Playwright fixture.
// Usage: node scripts/acceptance/pixel-office-viewport.mjs [--prepare-only]
// Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ui = path.join(root, "vendor/paperclip/ui");
const out = path.join(root, "work/pixel-office-viewport");
const require = createRequire(path.join(root, "vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const uiRequire = createRequire(path.join(ui, "package.json"));
const { build } = require("esbuild");
fs.mkdirSync(out, { recursive: true });

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, ChevronDown, Route, Shield, SlidersHorizontal, Zap } from 'lucide-react';
import { Team } from '${path.join(ui, "src/agentself/views/Team.tsx").replaceAll("\\", "/")}';
import { SkinProvider } from '${path.join(ui, "src/agentself/lib/skin.tsx").replaceAll("\\", "/")}';
import { Wordmark } from '${path.join(ui, "src/agentself/components/Brand.tsx").replaceAll("\\", "/")}';
import { layoutOffice, SPRITE_WIDTH, SPRITE_HEIGHT } from '@agentself/pixel-office';
const snapshot = window.__snapshot;
window.__officeFixture = { snapshot, layout: layoutOffice(snapshot), spriteWidth: SPRITE_WIDTH, spriteHeight: SPRITE_HEIGHT };
const ctx = { company: { id: 'fixture', name: '演示团队', spentMonthlyCents: 1234, budgetMonthlyCents: 10000 }, departments: snapshot.departments, agents: snapshot.people.map(p => ({ id: p.agentId, name: p.name, status: p.anim === 'working' ? 'running' : 'idle' })), projects: [], settings: { skin: 'office' }, paperclipUrl: '' };
// TeamStats is private to App.tsx. Mirror its markup, using deterministic fixture values;
// its production .stats rules, and the App page/topbar/content hierarchy are unchanged.
function TeamStats() { return <div className="stats" data-testid="team-stats">
  <div><b>{ctx.agents.filter(a => a.status === 'running').length}</b><span>运行中</span></div>
  <div><b>0</b><span>阻塞</span></div><div className="hot"><b>1</b><span>等你拍板</span></div>
  <div><b>$12.34</b><span>本月花费 / $100</span></div>
</div>; }
// Read-only Composer fixture: Home.tsx's idle markup and real CSS, including its
// two-row textarea, controls, hint and App's 14px wrapper margin. It has no handlers.
function FixtureComposer() { return <div data-testid="fixture-composer">
  <div className="composer"><div className="composer-input"><Zap aria-hidden="true" />
    <textarea aria-label="演示输入框（只读）" placeholder="交给团队一件事，说完就可以离开" rows={2} readOnly />
  </div><div className="composer-bar">
    <span className="chip-select-wrap"><Route /><select className="chip-select" aria-label="演示负责人" defaultValue="auto"><option value="auto">交给：自动选主管</option></select><ChevronDown /></span>
    <span className="chip-select-wrap"><Shield /><select className="chip-select" aria-label="演示对外动作" defaultValue="ask"><option value="ask">对外动作：先问我</option></select><ChevronDown /></span>
    <button className="btn ghost sm" type="button"><SlidersHorizontal />高级</button><span style={{ flex: 1 }} />
    <button className="icon-btn send" aria-label="演示发送（禁用）" disabled><ArrowUp /></button>
  </div></div>
  <div className="hint">即时问题直接回答；任务交给主管理解、派活、验收后汇报，大事会先给你计划。回车发送，Shift+回车换行。</div>
</div>; }
const noop = () => {};
createRoot(document.getElementById('root')).render(<SkinProvider initial="office">
  <div className="fixture-shell" data-agentself-row="">
    <div className="fixture-sidebar agentself"><aside className="sidebar" aria-label="AgenTeam 导航">
      <div className="brand"><Wordmark /></div><div className="search-pill">搜索</div>
      <div className="nav-item active">工作台</div><div className="nav-item">项目</div><div className="nav-item">论文库</div>
      <div className="nav-section">主管</div>{snapshot.departments.map(d => <div className="nav-item" key={d.id}>{d.name}</div>)}
      <div className="spacer" /><div className="nav-item">设置</div>
    </aside></div>
    <main className="fixture-main"><div className="agentself as-page">
      <div className="topbar"><nav className="crumbs" aria-label="位置"><b>工作台</b><span className="crumb-meta">· 演示数据</span></nav>
        <div className="toggle" role="tablist"><button role="tab" aria-selected="false">工作台</button><button role="tab" className="on" aria-selected="true">像素团队</button></div><div className="actions" />
      </div>
      <div className="content"><div className="page"><TeamStats />
        <Team ctx={ctx} cards={[]} department={null} openProject={noop} openEmployee={noop} act={noop} />
        <div style={{ marginTop: 14 }}><FixtureComposer /></div>
      </div></div>
    </div></main>
  </div>
</SkinProvider>);
`;
fs.writeFileSync(path.join(out, "fixture.tsx"), entry);
await build({
  stdin: { contents: entry, resolveDir: ui, sourcefile: "pixel-office-viewport-fixture.tsx", loader: "tsx" },
  outfile: path.join(out, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
  alias: {
    "@": path.join(ui, "src"),
    "@agentself/pixel-office": path.join(root, "packages/pixel-office/src/index.ts"),
    "@agentself/shared": path.join(root, "packages/shared/src/index.ts"),
    "@agentself/skins": path.join(root, "packages/skins/src/index.ts"),
    react: path.dirname(uiRequire.resolve("react/package.json")),
    "react-dom": path.dirname(uiRequire.resolve("react-dom/package.json")),
  },
  nodePaths: [path.join(ui, "node_modules"), path.join(root, "vendor/paperclip/node_modules")],
  logLevel: "warning",
});
// Only shell utilities normally supplied by Layout's Tailwind classes are reproduced.
// No office, canvas, label, bubble, page, stats or topbar styles are overridden here.
const shellCss = `html,body,#root{height:100%;margin:0}html{color-scheme:light}html.dark{color-scheme:dark}body{overflow:hidden}button{box-sizing:border-box}.fixture-shell{display:flex;height:100%;min-height:0;overflow:hidden}.fixture-sidebar{width:240px;flex:none;height:100%}.fixture-main{flex:1;min-width:0;min-height:0;height:100%;display:flex;flex-direction:column}.fixture-main>.as-page{width:100%}@media(max-width:760px){.fixture-sidebar{display:none}}`;
if (process.argv.includes("--prepare-only")) {
  console.log(`PREPARED real React fixture: ${out}`);
  process.exit(0);
}

const families = ["codex", "deepseek", "claude", "gemini", "kimi", "glm", "qwen", "minimax", "grok"];
function fixture(departments = 1, staff = 3) {
  const snapshot = { at: "2026-01-01T00:00:00.000Z", departments: [], people: [] };
  for (let d = 0; d < departments; d++) {
    const id = `demo-${d}`;
    snapshot.departments.push({ id, name: d ? "产品部 · 演示" : "研发部 · 演示", icon: "" });
    for (let n = 0; n <= staff; n++) {
      const eye = families[(d * (staff + 1) + n) % families.length];
      snapshot.people.push({ agentId: `${id}-${n}`, departmentId: id, name: n ? `员工${d + 1}-${n}` : `主管${d + 1}`, title: n ? "研发员工" : "主管", model: eye, eye, isLead: n === 0, anim: ["working", "waiting", "delivering", "idle"][n % 4], bubble: "核对本周交付报告的全部证据，并整理需要主管确认的检查项目。", pendingCards: n === 1 ? 1 : 0 });
    }
  }
  return snapshot;
}
let currentFixture = fixture();
const html = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>像素办公室 · 隔离验收</title><link rel="stylesheet" href="/fonts-cjk.css"><link rel="stylesheet" href="/styles.css"><style>${shellCss}</style></head><body><div id="root"></div><script>window.__snapshot=${JSON.stringify(currentFixture).replaceAll("<", "\\u003c")};if(new URLSearchParams(location.search).has('dark'))document.documentElement.classList.add('dark');</script><script src="/fixture.js"></script></body></html>`;
const allowedFiles = new Map([
  ["/fixture.js", [path.join(out, "fixture.js"), "application/javascript"]],
  ["/fonts-cjk.css", [path.join(ui, "src/agentself/fonts-cjk.css"), "text/css"]],
  ["/styles.css", [path.join(ui, "src/agentself/styles.css"), "text/css"]],
]);
const fonts = path.join(ui, "public/fonts");
// Pre-enumerate local files, including the unicode-range slices in noto-serif-sc.
// Request URLs only look up this map; they never become arbitrary filesystem paths.
function allowFontFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) allowFontFiles(file);
    else if (entry.isFile() && entry.name.endsWith(".woff2")) allowedFiles.set(`/fonts/${path.relative(fonts, file).replaceAll("\\", "/")}`, [file, "font/woff2"]);
  }
}
if (fs.existsSync(fonts)) allowFontFiles(fonts);
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.method !== "GET") { res.writeHead(405); return res.end("Read-only fixture"); }
  if (pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html()); }
  if (pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
  const file = allowedFiles.get(pathname);
  if (!file) { res.writeHead(404); return res.end("No live API in this fixture"); }
  res.writeHead(200, { "content-type": file[1] });
  fs.createReadStream(file[0]).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = require("playwright");
const browserDirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"), process.env.USERPROFILE && path.join(process.env.USERPROFILE, "AppData/Local/ms-playwright")].filter(Boolean);
const candidates = browserDirs.flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.startsWith("chromium-")).flatMap(n => [path.join(dir, n, "chrome-win64/chrome.exe"), path.join(dir, n, "chrome-win/chrome.exe"), path.join(dir, n, "chrome-linux/chrome")]) : []);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? candidates.find(p => fs.existsSync(p));
const report = { fixtureOnly: true, realComponents: ["Team.tsx", "SkinProvider", "Wordmark"], shell: "App .topbar/.content/.page/TeamStats hierarchy; default 240px sidebar; actual fonts-cjk.css then styles.css; read-only Composer markup fixture (not Home.Composer), with two-row textarea, controls and hint", visibleScrollbars: true, fontRequests: [], scenarios: [], checks: [], pageErrors: [], windowErrors: [], deniedRequests: [], officeReads: 0 };
const check = (name, pass, detail) => report.checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), ignoreDefaultArgs: ["--hide-scrollbars"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", colorScheme: "light", deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__fixtureErrors = [];
    window.addEventListener("error", event => window.__fixtureErrors.push(event.message));
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === "/agentself/api/office" && request.method() === "GET") {
      report.officeReads++;
      return route.fulfill({ json: currentFixture });
    }
    if (url.origin === origin && request.method() === "GET" && (url.pathname === "/" || url.pathname === "/favicon.ico" || allowedFiles.has(url.pathname))) {
      if (url.pathname.startsWith("/fonts/") && !report.fontRequests.includes(url.pathname)) report.fontRequests.push(url.pathname);
      return route.continue();
    }
    report.deniedRequests.push({ method: request.method(), url: request.url() });
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => report.pageErrors.push(String(error)));

  async function settle() {
    await page.waitForFunction(count => document.querySelectorAll(".nameplate").length === count && document.querySelector("canvas")?.width === window.__officeFixture.layout.width, currentFixture.people.length);
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Office body text uses the skin's system sans stack. Explicitly load a CJK
      // heading sample too, so missing bundled font slices cannot silently pass.
      const faces = await document.fonts.load('500 16px "Noto Serif SC"', "主管研发部");
      if (!faces.length || faces.some(face => face.status !== "loaded")) throw new Error("Bundled Noto Serif SC heading font did not load");
      await document.fonts.ready;
    });
    await page.waitForFunction(() => {
      const r = document.querySelector("canvas").getBoundingClientRect();
      const previous = window.__lastOfficeRect;
      window.__lastOfficeRect = [r.width, r.height, performance.now()];
      return previous && previous[0] === r.width && previous[1] === r.height && performance.now() - previous[2] > 80;
    }, null, { polling: 120 });
  }
  async function measure() {
    return page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const canvas = document.querySelector("canvas"), c = rect(canvas), content = document.querySelector(".content"), scroll = document.querySelector(".office-scroll");
      const scale = c.width / canvas.width;
      const worldRect = (x, y, w, h) => ({ left: c.left + x * scale, top: c.top + y * scale, right: c.left + (x + w) * scale, bottom: c.top + (y + h) * scale, width: w * scale, height: h * scale });
      const clip = { left: Math.max(0, rect(content).left, rect(scroll).left), top: Math.max(0, rect(content).top, rect(scroll).top), right: Math.min(innerWidth, rect(content).right, rect(scroll).right), bottom: Math.min(innerHeight, rect(content).bottom, rect(scroll).bottom) };
      const visible = r => r.left >= clip.left - 1 && r.top >= clip.top - 1 && r.right <= clip.right + 1 && r.bottom <= clip.bottom + 1;
      const objects = window.__officeFixture.layout.seats.map((seat, i) => {
        const actor = worldRect(seat.x, seat.y, window.__officeFixture.spriteWidth, window.__officeFixture.spriteHeight), desk = worldRect(seat.deskX, seat.deskY, 40, 14);
        const speech = rect(document.querySelectorAll(".employee-speech")[i]), name = rect(document.querySelectorAll(".nameplate")[i]);
        const colors = new Set();
        const data = canvas.getContext("2d").getImageData(seat.x, seat.y, 48, 44).data;
        for (let p = 0; p < data.length; p += 4) colors.add(`${data[p]},${data[p + 1]},${data[p + 2]}`);
        return { id: seat.agentId, actor, desk, speech, name, paintedColors: colors.size, visible: [actor, desk, speech, name].every(visible) };
      });
      return { viewport: { width: innerWidth, height: innerHeight }, canvas: { ...c, widthPixels: canvas.width, heightPixels: canvas.height, scale }, clip, header: rect(document.querySelector(".topbar")), stats: rect(document.querySelector(".stats")), composer: rect(document.querySelector(".composer")), pagePaddingBottom: getComputedStyle(document.querySelector(".content > .page")).paddingBottom, content: { ...rect(content), scrollTop: content.scrollTop, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight, clientWidth: content.clientWidth, scrollbarWidth: content.offsetWidth - content.clientWidth, scrollbarGutter: getComputedStyle(content).scrollbarGutter }, officeScroll: { ...rect(scroll), scrollLeft: scroll.scrollLeft, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth }, objects, documentWidth: document.documentElement.scrollWidth };
    });
  }
  async function sampleStability() {
    return page.evaluate(() => new Promise(resolve => {
      const start = performance.now(), samples = [];
      const sample = () => {
        const canvas = document.querySelector("canvas"), content = document.querySelector(".content"), scroll = document.querySelector(".office-scroll");
        const r = canvas.getBoundingClientRect();
        samples.push({ elapsed: Math.round(performance.now() - start), width: r.width, height: r.height, restingTop: r.top + content.scrollTop + window.scrollY, contentWidth: content.clientWidth, officeWidth: scroll.clientWidth, contentHeight: content.scrollHeight });
        if (performance.now() - start < 1000) requestAnimationFrame(sample);
        else resolve({ samples, errors: window.__fixtureErrors.slice() });
      };
      requestAnimationFrame(sample);
    }));
  }
  async function capture(name, firstScreen) {
    await settle();
    const stability = await sampleStability();
    const m = await measure();
    report.scenarios.push({ name, firstScreen, ...m, stability });
    for (const message of stability.errors) if (!report.windowErrors.includes(message)) report.windowErrors.push(message);
    const sizes = new Set(stability.samples.map(s => `${s.width}|${s.height}|${s.restingTop}|${s.contentWidth}|${s.officeWidth}|${s.contentHeight}`));
    check(`${name}: canvas and scroll dimensions stable for one second`, sizes.size === 1, { samples: stability.samples.length, elapsed: stability.samples.at(-1)?.elapsed, distinctSizes: sizes.size });
    check(`${name}: no window error or ResizeObserver loop`, stability.errors.length === 0, stability.errors);
    check(`${name}: topbar is 64px`, Math.abs(m.header.height - 64) < 1, m.header);
    check(`${name}: Composer fixture occupies real composer space`, m.composer.height >= 144 && m.composer.top > m.canvas.bottom);
    check(`${name}: stats precede canvas`, m.canvas.top >= m.stats.bottom - 1, { statsBottom: m.stats.bottom, canvasTop: m.canvas.top });
    check(`${name}: integer 2–4x pixels`, m.canvas.scale >= 2 && m.canvas.scale <= 4 && Math.abs(m.canvas.scale - Math.round(m.canvas.scale)) < 0.001, m.canvas.scale);
    check(`${name}: canvas aspect ratio`, Math.abs(m.canvas.height / m.canvas.heightPixels - m.canvas.scale) < 0.001);
    check(`${name}: every sprite painted`, m.objects.every(o => o.paintedColors > 5));
    check(`${name}: no whole-page horizontal overflow`, m.documentWidth <= m.viewport.width + 1, m.documentWidth);
    if (firstScreen) check(`${name}: all names, speech, characters and desks in first screen`, m.objects.every(o => o.visible), m.objects.filter(o => !o.visible));
    const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    check(`${name}: long speech does not cover characters or nameplates`, m.objects.every(a => m.objects.every(b => !overlap(a.speech, b.actor) && !overlap(a.speech, b.name))));
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    return m;
  }
  async function load(name, viewport, snapshot = fixture(), dark = false, firstScreen = true) {
    currentFixture = snapshot;
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/${dark ? "?dark=1" : ""}`, { waitUntil: "domcontentloaded" });
    return capture(name, firstScreen);
  }
  async function reachEach(name) {
    const reached = [];
    for (let index = 0; index < currentFixture.people.length; index++) {
      await page.evaluate(index => {
        const content = document.querySelector(".content"), scroll = document.querySelector(".office-scroll"), canvas = document.querySelector("canvas");
        const seat = window.__officeFixture.layout.seats[index], scale = canvas.getBoundingClientRect().width / canvas.width;
        scroll.scrollLeft = Math.max(0, (seat.x + 24) * scale - scroll.clientWidth / 2);
        const c = canvas.getBoundingClientRect(), outer = content.getBoundingClientRect();
        content.scrollTop += c.top + (seat.y + 20) * scale - outer.top - content.clientHeight / 2;
      }, index);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const m = await measure();
      reached.push({ id: m.objects[index].id, visible: m.objects[index].visible });
    }
    check(`${name}: every employee is reachable by scrolling`, reached.every(r => r.visible), reached);
    await page.screenshot({ path: path.join(out, `${name}-scrolled.png`) });
    return reached;
  }

  await load("desktop-1440x900", { width: 1440, height: 900 });
  await page.setViewportSize({ width: 1440, height: 650 });
  const short = await capture("resize-1440x650", true);
  await page.setViewportSize({ width: 1100, height: 800 });
  await capture("resize-1100x800", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture("resize-back-1440x900", true);
  await load("dark-long-task-1440x900", { width: 1440, height: 900 }, fixture(), true);
  const narrow = await load("narrow-390x844", { width: 390, height: 844 }, fixture(), false, false);
  check("narrow: internal horizontal scrollbar preserves 2x pixels", narrow.officeScroll.scrollWidth > narrow.officeScroll.clientWidth && narrow.canvas.scale >= 2);
  await reachEach("narrow-390x844");
  await load("two-departments-1440x900", { width: 1440, height: 900 }, fixture(2, 3));
  const multi = await load("multiple-rows-1440x650", { width: 1440, height: 650 }, fixture(2, 7), false, false);
  check("multiple rows: vertical content scrolls", multi.content.scrollHeight > multi.content.clientHeight);
  await reachEach("multiple-rows-1440x650");
  const threshold = await load("threshold-1024x900", { width: 1024, height: 900 });
  check("threshold: 784px content with reserved visible scrollbar", threshold.content.width === 784 && threshold.content.scrollbarWidth > 0 && threshold.content.scrollbarGutter === "stable", threshold.content);
  check("threshold: App page keeps 64px bottom padding", threshold.pagePaddingBottom === "64px", threshold.pagePaddingBottom);
  check("threshold: Composer plus gutter selects stable 2x", threshold.canvas.scale === 2);
  await page.setViewportSize({ width: 1024, height: 920 });
  await capture("threshold-1024x920", true);
  await page.setViewportSize({ width: 1024, height: 936 });
  await capture("threshold-1024x936", true);
  await page.setViewportSize({ width: 1024, height: 900 });
  const thresholdBack = await capture("threshold-back-1024x900", true);
  check("threshold: resize returns to original size", thresholdBack.canvas.width === threshold.canvas.width && thresholdBack.canvas.height === threshold.canvas.height);
  const resting = await load("scroll-resize-before-1440x900", { width: 1440, height: 900 });
  await page.evaluate(() => { const content = document.querySelector(".content"); content.scrollTop = Math.min(180, content.scrollHeight - content.clientHeight); });
  check("scroll-resize: content really scrolled", (await measure()).content.scrollTop > 0);
  await page.setViewportSize({ width: 1440, height: 920 });
  const scrolled = await capture("scroll-resize-1440x920", false);
  check("scroll-resize: scrolling does not enlarge canvas", scrolled.canvas.scale === resting.canvas.scale, { before: resting.canvas.scale, after: scrolled.canvas.scale });
  check("scroll-resize: resting canvas top does not drift", Math.abs(scrolled.canvas.top + scrolled.content.scrollTop - resting.canvas.top) < 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  const scrolledBack = await capture("scroll-resize-back-1440x900", false);
  check("scroll-resize: back to original size and resting position", scrolledBack.canvas.width === resting.canvas.width && scrolledBack.canvas.height === resting.canvas.height && Math.abs(scrolledBack.canvas.top + scrolledBack.content.scrollTop - resting.canvas.top) < 1);
  check("height resize remeasures available canvas height", short.canvas.bottom <= 650);
  check("no browser errors", report.pageErrors.length === 0, report.pageErrors);
  check("no window errors including ResizeObserver loops", report.windowErrors.length === 0, report.windowErrors);
  check("only fixture GET /office and local assets requested", report.deniedRequests.length === 0, report.deniedRequests);
  check("real Team fetched the office fixture", report.officeReads > 0, report.officeReads);
  assert.ok(report.checks.every(c => c.pass), report.checks.filter(c => !c.pass).map(c => c.name).join("; "));
} catch (error) {
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  report.pass = !report.error && report.checks.length > 0 && report.checks.every(c => c.pass);
  fs.writeFileSync(path.join(out, `report-${new Date().toISOString().replaceAll(":", "-")}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.pass ? "PASS" : "FAIL"} ${JSON.stringify({ scenarios: report.scenarios.length, checks: report.checks.length, failed: report.checks.filter(c => !c.pass).map(c => c.name), error: report.error, report: path.join(out, "report.json") }, null, 2)}`);
}
