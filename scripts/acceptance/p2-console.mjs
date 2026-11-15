#!/usr/bin/env node
// P2 acceptance through the browser (Playwright), v0.6 SETO workbench (docs/handoff/design/DESIGN.md):
// from the single app on :3100 only —
//  1. the composer is fixed at the bottom; an instant answer comes back and lands as a card you can dismiss
//  2. cards are whole-card buttons; answering an ask card happens in the expanded detail
//  3. "稍后提醒" snoozes a card
//  4. a hire request appears as a "新建员工" card counted under 要你拍板, and can be declined
//  5. a lead report can be confirmed from the expanded deliver card (if one is waiting)
//  6. the task progress panel is on the right; the filter switches to 要你拍板
// Probe issues are unassigned and the hire request is declined, so nobody is woken and no agent is created.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_CONSOLE ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const { companyId, projectId, leadAgentId } = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".agentself", "department-research.json"), "utf8"));
const results = {};
const as = async (method, p, body) => {
  const r = await fetch(`${base}/agentself/api${p}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".agentself .composer", { timeout: 60_000 });
await page.waitForTimeout(3000);

/** Click a card (whole-card button) by its text and return the expanded detail. */
async function openCard(selector, text) {
  const card = page.locator(`#results ${selector}`).filter({ hasText: text }).first();
  if (!(await card.count())) return null;
  await card.click();
  const detail = page.locator("#results .detail-wrap .detail").first();
  await detail.waitFor({ timeout: 10_000 });
  return detail;
}

// 0. layout: composer at the bottom of the viewport, progress panel on the right, no top-bar pending badge
const dock = await page.locator(".composer-dock").boundingBox();
results.composerAtBottom = !!dock && dock.y + dock.height <= 1000 + 1 && dock.y > 500;
results.progressPanel = (await page.locator("aside.progress").isVisible()) && (await page.locator("aside.progress h2").innerText()).includes("任务进展");
results.noTopbarBadge = (await page.locator(".pending-badge").count()) === 0;

// 1. instant answer from the composer
await page.getByLabel("交给团队一件事").fill("1 公里等于多少米？只回答数字。");
await page.getByRole("button", { name: "发送" }).click();
await page.waitForSelector(".notice", { timeout: 150_000 });
results.instantAnswer = /1000|1,000|一千/.test(await page.locator(".notice").first().innerText());
await page.waitForTimeout(6000);
const answerDetail = await openCard(".card.answer", /1000|1,000|一千/);
results.answerCardShown = !!answerDetail;
if (answerDetail) {
  await answerDetail.getByRole("button", { name: "知道了" }).click();
  await page.waitForTimeout(6000);
  results.answerCardDismissed = (await page.locator("#results .card.answer").filter({ hasText: /1000|1,000|一千/ }).count()) === 0;
}

// 2. answer an ask card + 3. snooze another
const mkProbe = async (title, prompt) => {
  const issue = await api("POST", `/companies/${companyId}/issues`, { title, projectId, status: "backlog" });
  await api("POST", `/issues/${issue.id}/interactions`, {
    kind: "ask_user_questions",
    title: prompt,
    continuationPolicy: "none",
    payload: { version: 1, questions: [{ id: "choice", prompt, selectionMode: "single", options: [{ id: "a", label: "选 A" }, { id: "b", label: "选 B" }] }] },
  });
  return issue;
};
const probeAnswer = await mkProbe("[验收] 答卡片", "验收：请选 A 还是 B？");
const probeLater = await mkProbe("[验收] 稍后", "验收：这张卡稍后再说？");
// 4. a hire request (declined below, so no agent is created)
const hire = leadAgentId ? await as("POST", "/hire-requests", { leadAgentId, name: "验收员工", capabilities: "验收用，不会被创建", reason: "P2 验收" }) : null;
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-agentself-sidebar] .nav-item", { timeout: 60_000 });
await page.waitForTimeout(6000);

const askDetail = await openCard(".card.decide", "请选 A 还是 B");
results.askCardShown = !!askDetail;
if (askDetail) {
  results.rememberOption = (await askDetail.getByText("以后同类直接这样做").count()) === 1; // present, deliberately not ticked
  await askDetail.getByRole("button", { name: "选 A" }).click();
  await page.waitForTimeout(3000);
  const inter = list(await api("GET", `/issues/${probeAnswer.id}/interactions`))[0];
  results.askAnswered = inter?.status !== "pending";
}

const laterDetail = await openCard(".card.decide", "这张卡稍后再说");
if (laterDetail) {
  await laterDetail.getByRole("button", { name: "稍后提醒" }).click();
  await page.waitForTimeout(7000);
  results.snoozed = (await page.locator("#results .card.decide").filter({ hasText: "这张卡稍后再说" }).count()) === 0;
}

if (hire) {
  // counted under 要你拍板, shown only there and under 全部
  await page.locator(".filters .filter", { hasText: "要你拍板" }).click();
  await page.waitForTimeout(800);
  const kinds = await page.locator("#results .card .card-kind").allInnerTexts();
  results.decideFilter = kinds.length > 0 && kinds.every((k) => /要你拍板|新建员工|待朱批/.test(k));
  const hireDetail = await openCard(".card.hire", "验收员工");
  results.hireCardShown = !!hireDetail;
  if (hireDetail) {
    await hireDetail.getByRole("button", { name: "不同意" }).click();
    await page.waitForTimeout(3000);
    const left = await as("GET", "/hire-requests?status=pending");
    results.hireDeclined = !left.some((h) => h.id === hire.id);
  }
  await page.locator(".filters .filter", { hasText: "全部" }).click();
} else results.hireCardShown = "skipped: no leadAgentId in department-research.json";

// 5. confirm a lead report (if one is waiting)
const deliverCard = page.locator("#results .card.deliver").first();
if (await deliverCard.count()) {
  const title = await deliverCard.locator(".card-title").innerText();
  await deliverCard.click();
  const d = page.locator("#results .detail-wrap .detail").first();
  results.verdictSummary = await d.locator(".verdicts .verdict").count();
  await d.getByRole("button", { name: "确认完成" }).click();
  await page.waitForTimeout(4000);
  results.reportConfirmed = { title };
} else results.reportConfirmed = "no report waiting";

fs.mkdirSync("spikes/shots", { recursive: true });
await page.screenshot({ path: "spikes/shots/p2-after.png" });
await browser.close();
for (const it of [probeAnswer, probeLater]) await api("DELETE", `/issues/${it.id}`).catch(() => {}); // leave no test data
results.pageErrors = errors;
const pass =
  results.composerAtBottom &&
  results.progressPanel &&
  results.noTopbarBadge &&
  results.instantAnswer &&
  results.answerCardShown &&
  results.answerCardDismissed &&
  results.askAnswered &&
  results.rememberOption &&
  results.snoozed &&
  (hire ? results.hireCardShown === true && results.hireDeclined && results.decideFilter : true) &&
  errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
