#!/usr/bin/env node
// P2 acceptance through the browser (Playwright): from the console page only —
// front-desk instant answer, answer a card, "later" (snooze), confirm a lead report.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, list } from "../lib/paperclip.mjs";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const base = process.env.AGENTSELF_CONSOLE ?? "http://127.0.0.1:3200";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const { companyId, projectId } = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".agentself", "department-research.json"), "utf8"));
const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: "networkidle" });

// 1. front desk instant answer from the composer
await page.getByLabel("交给团队一件事").fill("1 公里等于多少米？只回答数字。");
await page.getByRole("button", { name: "发送" }).click();
await page.waitForSelector(".notice", { timeout: 150_000 });
const answerText = await page.locator(".notice").first().innerText();
results.instantAnswer = /1000|1,000|一千/.test(answerText);
await page.waitForTimeout(6000);
const answerCard = page.locator("#results .card.answer").filter({ hasText: /1000|1,000|一千/ }).first();
results.answerCardShown = (await answerCard.count()) > 0;
if (results.answerCardShown) {
  await answerCard.getByRole("button", { name: "知道了" }).click();
  await page.waitForTimeout(6000);
  results.answerCardDismissed = (await page.locator("#results .card.answer").filter({ hasText: /1000|1,000|一千/ }).count()) === 0;
}

// 2. answer an ask card + 3. snooze another (probe issues are unassigned, so nobody is woken)
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
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(6000);

const cardA = page.locator("#results .card.decide").filter({ hasText: "请选 A 还是 B" }).first();
results.askCardShown = (await cardA.count()) > 0;
if (results.askCardShown) {
  await cardA.getByRole("button", { name: "选 A" }).click();
  await page.waitForTimeout(3000);
  const inter = list(await api("GET", `/issues/${probeAnswer.id}/interactions`))[0];
  results.askAnswered = inter?.status !== "pending";
}

const cardL = page.locator("#results .card.decide").filter({ hasText: "这张卡稍后再说" }).first();
if (await cardL.count()) {
  await cardL.getByRole("button", { name: "展开" }).click();
  await page.getByRole("button", { name: "稍后" }).click();
  await page.waitForTimeout(7000);
  results.snoozed = (await page.locator("#results .card.decide").filter({ hasText: "这张卡稍后再说" }).count()) === 0;
}

// 4. confirm a lead report (if one is waiting)
const deliver = page.locator("#results .card.deliver").first();
if (await deliver.count()) {
  const title = await deliver.locator(".card-title").innerText();
  const btn = deliver.getByRole("button").first();
  const label = await btn.innerText();
  await btn.click();
  await page.waitForTimeout(4000);
  results.reportConfirmed = { title, clicked: label };
} else results.reportConfirmed = "no report waiting";

await page.screenshot({ path: "spikes/shots/p2-after.png" });
await browser.close();
for (const it of [probeAnswer, probeLater]) await api("PATCH", `/issues/${it.id}`, { status: "cancelled" }).catch(() => {});
results.pageErrors = errors;
const pass = results.instantAnswer && results.answerCardShown && results.answerCardDismissed && results.askAnswered && results.snoozed && errors.length === 0;
console.log("RESULT", pass ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
process.exit(pass ? 0 : 1);
