#!/usr/bin/env node
// Run the scenario acceptance scripts one after another and print a summary table.
// Cheap ones first, the expensive research run last. Each script's full output goes to
// spikes/acceptance/<name>.log.
// Usage: node scripts/acceptance/run-scenarios.mjs [--only p12,p15] [--skip p17]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ALL = ["p16-proposals", "p1-rules", "p18-model-sources", "p19-mail", "p20-library", "p21-tool-server", "p12-long-run", "p15-watch-routine", "p13-ask-first", "p11-plan-first", "p1-research", "p14-parallel", "p17-research-full"];
const args = process.argv.slice(2);
const pick = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1].split(",") : null);
const only = pick("--only");
const skip = pick("--skip") ?? [];
const names = ALL.filter((n) => (!only || only.some((o) => n.startsWith(o))) && !skip.some((s) => n.startsWith(s)));
const logDir = path.resolve("spikes", "acceptance");
fs.mkdirSync(logDir, { recursive: true });

const rows = [];
for (const name of names) {
  const t0 = Date.now();
  console.log(`\n=== ${name} ===`);
  const out = fs.createWriteStream(path.join(logDir, `${name}.log`));
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join("scripts", "acceptance", `${name}.mjs`)], { stdio: ["ignore", "pipe", "pipe"] });
    let last = "";
    const tee = (d) => {
      out.write(d);
      process.stdout.write(d);
      last = (last + d.toString()).slice(-20000);
    };
    p.stdout.on("data", tee);
    p.stderr.on("data", tee);
    p.on("close", (c) => {
      const line = last.split(/\r?\n/).reverse().find((l) => /RESULT|^\S+ (PASS|FAIL)$|\bPASS\b|\bFAIL\b/.test(l)) ?? "";
      rows.push({ name, code: c, minutes: ((Date.now() - t0) / 60000).toFixed(1), line: line.slice(0, 300) });
      resolve(c);
    });
  });
  out.end();
  void code;
}
console.log("\n| 脚本 | 结果 | 分钟 | 结果行 |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.name} | ${r.code !== 0 ? "❌ FAIL" : / SKIP /.test(r.line) ? "⏭ 跳过" : "✅ PASS"} | ${r.minutes} | \`${r.line.replace(/\|/g, "\\|")}\` |`);
process.exitCode = rows.every((r) => r.code === 0) ? 0 : 1;
