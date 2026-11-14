#!/usr/bin/env node
// Translate extracted Paperclip UI strings to zh-CN with the local Claude Code CLI (Haiku).
// Resumable: existing entries in the dictionary are skipped.
// Usage: node scripts/i18n/translate.mjs [--batch 150] [--parallel 4]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const BATCH = opt("--batch", 150);
const PARALLEL = opt("--parallel", 4);
const strings = JSON.parse(fs.readFileSync("scripts/i18n/strings.json", "utf8"));
const DICT = path.resolve("vendor/paperclip/ui/src/i18n/zh-CN-dom.json");
const dict = fs.existsSync(DICT) ? JSON.parse(fs.readFileSync(DICT, "utf8")) : {};
const todo = strings.filter((s) => !(s in dict));
console.log(`total=${strings.length} done=${Object.keys(dict).length} todo=${todo.length}`);

const GLOSSARY = `术语表（必须统一）：
Issue/Issues=任务；Sub-issue=子任务；Agent=智能体；Company=公司；Project=项目；Goal=目标；Routine=例行任务；
Approval=审批；Skill=技能；Plugin=插件；Run=运行；Heartbeat=心跳；Inbox=收件箱；Decision=决策；Adapter=适配器；
Workspace=工作区；Budget=预算；Board=管理台；Connection=连接；Connector=连接器；Secret=密钥；Environment=环境；
Assignee=负责人；Comment=评论；Document=文档；Attachment=附件；Attention=待处理；Dashboard=仪表盘；Settings=设置；
Org chart=组织图；Instance=实例；Member=成员；Invite=邀请；Snooze=稍后提醒；Dismiss=忽略；Archive=归档；
Paperclip、Claude、Codex、OpenAI、GitHub、Slack、Discord、MCP、API、URL、JSON 等专有名词保持英文。`;

function prompt(batch) {
  return `把下面 Paperclip（AI 智能体管理后台）界面上的英文文案翻译成简体中文，用于软件界面。
要求：
- 简洁、自然、符合中文软件习惯；按钮和标签用短语，不加句号；句子保留原有标点风格。
- 保留占位符、数字、单位、快捷键、代码、命令行、变量名、文件名原样不动。
- 如果某条看起来是代码片段、内部标识或不该翻译的内容，原样返回英文。
${GLOSSARY}

只输出一个 JSON 对象，键为原文（逐字不改），值为译文。不要输出其他内容。

${JSON.stringify(batch, null, 0)}`;
}

function runClaude(text) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", "haiku", "--output-format", "json"], { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => (child.kill(), reject(new Error("timeout"))), 300_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`exit ${code} ${err.slice(0, 200)}`));
      try {
        resolve(JSON.parse(out).result ?? "");
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(text);
  });
}

function parse(raw) {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
}

const batches = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let next = 0;
let done = 0;
function save() {
  const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(DICT, JSON.stringify(sorted, null, 1) + "\n");
}
async function worker() {
  while (next < batches.length) {
    const i = next++;
    const batch = batches[i];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const map = parse(await runClaude(prompt(batch)));
        if (!map) throw new Error("unparseable output");
        let n = 0;
        for (const s of batch) {
          const v = map[s];
          if (typeof v === "string" && v.trim() && v !== s) {
            dict[s] = v.trim();
            n++;
          }
        }
        done++;
        save();
        console.log(`batch ${i + 1}/${batches.length}: ${n}/${batch.length} translated (${done} batches done)`);
        break;
      } catch (e) {
        console.log(`batch ${i + 1} attempt ${attempt} failed: ${e.message}`);
      }
    }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
save();
console.log(`dictionary entries: ${Object.keys(dict).length}`);
