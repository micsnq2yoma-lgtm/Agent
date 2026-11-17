// 设置 → 通用 → 版本与更新 的“检查并更新”按钮（两条路径，用同一个脚本）。
//
//   node scripts/acceptance/p22-update-button.mjs            # 已是最新：点按钮只显示“已是最新”，不启动更新
//   node scripts/acceptance/p22-update-button.mjs --update   # 真更新：实例要比 origin/main 落后至少一个提交
//
// --update 会真的停止系统、拉取 main、构建、重启，并先备份数据库。scripts/update.mjs、stop.mjs、start.mjs 固定用 3100 / 3200，
// 所以不能在隔离端口上和现用实例并行跑：要在“被更新的那个实例”上跑，也就是验收机这台专用电脑上 3100 的那一套，
// 不要在日常使用的电脑上跑。做出“落后”的状态：把这台机器的克隆切回 main 再 `git reset --hard HEAD~1`（落后一个提交就够），
// 重新构建并启动，再跑本脚本（脚本本身从别的检出目录运行，更新不会把它覆盖）。
//
// 验：没有“每天自动更新”开关；点按钮后依次出现进度文字（正在更新 / 系统正在重启），结束后显示结果和“刷新页面”，
// 刷新后版本变成最新；服务端不再有定时更新任务（设置里没有 autoUpdate）。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("vendor/paperclip/node_modules/.pnpm/node_modules/x.js"));
const pw = require("playwright");
const doUpdate = process.argv.includes("--update");
const base = process.env.AGENTEAM_APP ?? "http://127.0.0.1:3100";
const msDir = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const exe = fs.existsSync(msDir)
  ? fs.readdirSync(msDir).filter((d) => d.startsWith("chromium-")).map((d) => path.join(msDir, d, "chrome-win64", "chrome.exe")).find((p) => fs.existsSync(p))
  : undefined;
const get = async (p) => (await fetch(`${base}/agenteam/api${p}`)).json();

const ctx = await get("/context");
const prefix = ctx.company.issuePrefix;
const before = await get("/update/status?check=1");
const behind = before.lastCheck?.behind ?? 0;
const results = { mode: doUpdate ? "update" : "up-to-date", versionBefore: before.lastCheck?.current ?? before.current, latest: before.lastCheck?.latest, behind };

if (doUpdate && behind < 1) {
  console.log(JSON.stringify({ ...results, RESULT: "FAIL", why: "实例没有落后于 origin/main：按文件头的说明做出“落后”状态，或不带 --update 跑“已是最新”那一条" }, null, 2));
  process.exit(1);
}
if (!doUpdate && behind > 0) {
  console.log(JSON.stringify({ ...results, RESULT: "FAIL", why: "实例落后于 origin/main，点按钮会真的更新；要测更新就加 --update，要测“已是最新”先更新到最新" }, null, 2));
  process.exit(1);
}

const browser = await pw.chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const texts = new Set();
const section = () => page.locator(".section", { has: page.locator("h2", { hasText: "版本与更新" }) });
const snap = async () => {
  try {
    const t = (await section().innerText({ timeout: 2000 })).replace(/\s+/g, " ");
    texts.add(t);
    return t;
  } catch {
    return "";
  }
};

await page.goto(`${base}/${prefix}/agenteam/settings`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".tabbar[aria-label=设置分类]", { timeout: 60_000 });
await page.locator(".tabbar[aria-label=设置分类] [role=tab]", { hasText: "通用" }).click();
await section().waitFor({ timeout: 20_000 });
const first = await snap();
results.noAutoSwitch = !/每天自动更新/.test(first) && (await section().locator("[role=switch]").count()) === 0;
results.noAutoSetting = (await get("/settings")).autoUpdate === undefined || !(await get("/settings")).autoUpdate?.enabled;
const button = section().getByRole("button", { name: "检查并更新" });
results.buttonThere = (await button.count()) === 1;
await button.click();

if (!doUpdate) {
  await page.waitForFunction(() => /已是最新/.test(document.body.innerText), undefined, { timeout: 30_000 }).catch(() => {});
  const t = await snap();
  results.upToDateShown = /已是最新/.test(t);
  results.noUpdateStarted = (await get("/update/status")).status !== "updating";
  results.RESULT = results.noAutoSwitch && results.buttonThere && results.upToDateShown && results.noUpdateStarted && errors.length === 0 ? "PASS" : "FAIL";
} else {
  // 有员工在干活会弹确认：脚本里选“取消”会让更新不开始，所以这里要求实例上没有员工在跑
  page.on("dialog", (d) => {
    results.sawBusyDialog = true;
    void d.accept();
  });
  const deadline = Date.now() + 25 * 60_000;
  let reloadShown = false;
  while (Date.now() < deadline) {
    await snap();
    if ((await section().getByRole("button", { name: "刷新页面" }).count()) > 0) {
      reloadShown = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  const all = [...texts].join(" | ");
  results.sawStarted = /已在后台开始更新|正在更新/.test(all);
  results.sawRestarting = /系统正在重启/.test(all); // 重启的几秒钟里页面请求会失败；时间太短时可能错过，不算失败，但要记录
  results.resultShown = /更新完成|已自动回退|回退后也没起来/.test(all);
  results.reloadShown = reloadShown;
  if (reloadShown) {
    await section().getByRole("button", { name: "刷新页面" }).click();
    await page.waitForSelector(".tabbar[aria-label=设置分类]", { timeout: 60_000 });
    await page.locator(".tabbar[aria-label=设置分类] [role=tab]", { hasText: "通用" }).click();
    await section().waitFor({ timeout: 20_000 });
  }
  const after = await get("/update/status?check=1");
  results.versionAfter = after.lastCheck?.current ?? after.current;
  results.finalStatus = after.status;
  results.nowUpToDate = (after.lastCheck?.behind ?? 1) === 0;
  results.updated = after.status === "updated" && results.versionAfter === results.latest;
  results.RESULT =
    results.noAutoSwitch && results.buttonThere && results.sawStarted && results.resultShown && results.reloadShown && results.updated && results.nowUpToDate && errors.length === 0 ? "PASS" : "FAIL";
}
results.progressTexts = [...texts].slice(-8).map((t) => t.slice(0, 160));
results.pageErrors = errors;
await browser.close();
console.log(JSON.stringify(results, null, 2));
process.exit(results.RESULT === "PASS" ? 0 : 1);
