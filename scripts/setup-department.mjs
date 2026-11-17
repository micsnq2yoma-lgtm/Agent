#!/usr/bin/env node
// Create a department in Paperclip from a department pack (PLAN 7.4).
// Usage: node scripts/setup-department.mjs scripts/acceptance/fixtures/research.json [--company AgenTeam]
import fs from "node:fs";
import path from "node:path";
import { createDepartment } from "./lib/department.mjs";

const args = process.argv.slice(2);
const packPath = args.find((a) => !a.startsWith("--"));
if (!packPath) {
  console.error("usage: setup-department.mjs <pack.json> [--company <name>]");
  process.exit(2);
}
const companyName = args.includes("--company") ? args[args.indexOf("--company") + 1] : "AgenTeam";
const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
const out = await createDepartment(pack, { key: path.basename(packPath, ".json"), companyName });
console.log(JSON.stringify(out));
