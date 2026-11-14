#!/usr/bin/env node
// Extract user-visible English UI strings from vendor/paperclip/ui/src for the zh-CN dictionary.
// Usage: node scripts/i18n/extract.mjs > scripts/i18n/strings.json
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("vendor/paperclip/ui/src");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (["__tests__", "stories", "fixtures", "test", "tests", "mocks"].includes(e.name)) continue;
      walk(p);
    } else if (/\.(tsx|ts)$/.test(e.name) && !/\.(test|spec|stories)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) files.push(p);
  }
})(root);

const out = new Map();
const add = (s, file) => {
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 160) return;
  if (!/[A-Za-z]{2}/.test(s)) return;
  if (/[{}<>`$;\[\]]|=>|&&|\|\||\?\?|\?\.|^\s*[-+*/=!&%"(]/.test(s)) return;
  if (/\b(const|let|return|function|import|export|useState|useMemo|useRef|null|undefined|typeof|Partial|Pick|Omit|ReadonlyArray)\b|\w\(|\s=\s|\w\.\w+\(/.test(s)) return;
  if (/^[A-Z][a-zA-Z]+$/.test(s) && /[a-z][A-Z]/.test(s)) return; // PascalCase component names
  if (/\((canonical|with|story)/i.test(s)) return; // storybook-ish labels
  if (/^[)\]:,.]|\?\s*\(|\/\/|\/\*|\s:\s*\(|^\)|\)\s*:/.test(s)) return; // ternaries / comments
  if (/^[a-z0-9_.\-/:#@]+$/.test(s)) return; // identifiers, keys, paths, css classes
  if (/^[A-Z0-9_]+$/.test(s) && s.length > 4 && s.includes("_")) return; // CONSTANTS
  if (/^(https?:|\/|\.\/|#|--)/.test(s)) return;
  if (/\b(className|onClick|aria-|data-|px|rem|var\()\b/.test(s)) return;
  if (/^[a-z]+([A-Z][a-z0-9]+)+$/.test(s)) return; // camelCase
  if (!/^[A-Z0-9"'(]/.test(s) && !s.includes(" ")) return;
  if (!out.has(s)) out.set(s, path.relative(root, file).split(path.sep).join("/"));
};

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // JSX text: >Some text<
  for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) add(m[1], f);
  // JSX text lines inside elements (multi-line)
  for (const m of src.matchAll(/^\s{2,}([A-Z][A-Za-z0-9 ,.'’:;!?()\-–—/&%+]+[A-Za-z.!?)])\s*$/gm)) add(m[1], f);
  // common props / object keys with user-facing strings
  for (const m of src.matchAll(/\b(?:placeholder|title|label|aria-label|description|tooltip|emptyMessage|heading|subtitle|helperText|confirmLabel|cancelLabel|buttonLabel|text|message|hint|summary|caption)\s*[:=]\s*\{?\s*(["'])((?:(?!\1)[^\\\n]|\\.)+)\1/g)) add(m[2], f);
  // toasts / errors shown to users
  for (const m of src.matchAll(/\b(?:toast(?:\.\w+)?|pushToast|showToast|notify|setError|throw new Error)\(\s*(["'])((?:(?!\1)[^\\\n]|\\.)+)\1/g)) add(m[2], f);
}

const sorted = [...out.keys()].sort();
process.stdout.write(JSON.stringify(sorted, null, 0));
console.error(`files=${files.length} strings=${sorted.length}`);
