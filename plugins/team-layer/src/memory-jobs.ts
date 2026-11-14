// Memory jobs (PLAN 5): append run log, idle consolidation, weekly archive.
// Pure helpers are exported for unit tests; I/O lives in the functions that take `deps`.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/* git + file helpers used by the worker                               */
/* ------------------------------------------------------------------ */

export function gitCommit(memDir: string, message: string): string | null {
  if (!fs.existsSync(memDir)) return null;
  const git = (args: string[]) => spawnSync("git", args, { cwd: memDir, encoding: "utf8", windowsHide: true });
  if (!fs.existsSync(path.join(memDir, ".git"))) {
    git(["init", "-q"]);
    git(["config", "user.name", "Agentself Memory"]);
    git(["config", "user.email", "memory@agentself.local"]);
    git(["config", "core.autocrlf", "false"]);
  }
  git(["add", "-A"]);
  if (!git(["status", "--porcelain"]).stdout.trim()) return null;
  if (git(["commit", "-q", "-m", message]).status !== 0) return null;
  return git(["rev-parse", "--short", "HEAD"]).stdout.trim();
}

export function todayLog(memDir: string, now = new Date()) {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return path.join(memDir, "log", `${d}.md`);
}

export function appendRunLog(memDir: string, line: string, now = new Date()) {
  const file = todayLog(memDir, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${path.basename(file, ".md")} 工作日志\n\n`);
  fs.appendFileSync(file, redactSecrets(line) + "\n");
}

const readFile = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

export async function consolidate(memDir: string, run: (prompt: string) => Promise<string>) {
  const prompt = consolidationPrompt({
    identity: readFile(path.join(memDir, "identity.md")),
    style: readFile(path.join(memDir, "style.md")),
    notes: readFile(path.join(memDir, "notes.md")),
    user: readFile(path.join(memDir, "user.md")),
    logs: recentLogs(memDir),
  });
  const parsed = parseConsolidation(await run(prompt));
  if (!parsed) return { ok: false as const, reason: "模型输出无法解析", suggestions: [] as string[] };
  fs.writeFileSync(path.join(memDir, "notes.md"), capNotes(redactSecrets(parsed.notes)).trimEnd() + "\n");
  fs.writeFileSync(path.join(memDir, "user.md"), redactSecrets(parsed.user).trimEnd() + "\n");
  const commit = gitCommit(memDir, "整理记忆：提炼最近日志到 notes/user");
  return { ok: true as const, commit, suggestions: parsed.suggestions };
}

export function weeklyArchive(memDir: string, now = new Date(), logDays = 14, topicDays = 60) {
  const moved: string[] = [];
  const logDir = path.join(memDir, "log");
  if (fs.existsSync(logDir)) {
    for (const f of fs.readdirSync(logDir)) {
      const m = f.match(/^(\d{4})-(\d{2})-\d{2}\.md$/);
      if (!m || now.getTime() - Date.parse(f.slice(0, 10)) < logDays * 86400_000) continue;
      const dst = path.join(memDir, "archive", `${m[1]}-${m[2]}.md`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.appendFileSync(dst, `\n\n${fs.readFileSync(path.join(logDir, f), "utf8")}`);
      fs.rmSync(path.join(logDir, f));
      moved.push(`log/${f}`);
    }
  }
  const topics = path.join(memDir, "topics");
  if (fs.existsSync(topics)) {
    for (const f of fs.readdirSync(topics)) {
      const p = path.join(topics, f);
      if (!f.endsWith(".md") || now.getTime() - fs.statSync(p).mtimeMs < topicDays * 86400_000) continue;
      const dst = path.join(memDir, "archive", "topics", f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(p, dst);
      moved.push(`topics/${f}`);
    }
  }
  const commit = moved.length ? gitCommit(memDir, `每周归档：${moved.length} 个文件`) : null;
  return { moved, commit };
}

export const DEFAULT_IDLE_MINUTES = 30;
export const NOTES_MAX_CHARS = 6000;

export function logLine(input: { at: Date; issue?: string | null; title?: string | null; status: string; costUsd?: number | null; summary?: string | null }) {
  const hhmm = input.at.toTimeString().slice(0, 5);
  const cost = input.costUsd != null ? ` · $${input.costUsd.toFixed(3)}` : "";
  const issue = input.issue ? `${input.issue} ` : "";
  const summary = input.summary ? `\n  ${input.summary.replace(/\s+/g, " ").slice(0, 300)}` : "";
  return `- ${hhmm} ${issue}${input.title ?? "（无标题）"} — ${input.status}${cost}${summary}`;
}

/** Should we consolidate now? Only when idle long enough and there are new log entries. */
export function shouldConsolidate(input: { lastRunAt: number | null; lastConsolidatedAt: number | null; lastLogWriteAt: number | null; now: number; idleMinutes?: number }) {
  const idleMs = (input.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000;
  if (input.lastLogWriteAt == null) return false;
  if (input.lastConsolidatedAt != null && input.lastLogWriteAt <= input.lastConsolidatedAt) return false;
  if (input.lastRunAt != null && input.now - input.lastRunAt < idleMs) return false;
  return true;
}

export function consolidationPrompt(input: { notes: string; user: string; identity: string; style: string; logs: string; maxChars?: number }) {
  return `你在整理一名 AI 员工的长期记忆。根据最近的工作日志，更新它的经验笔记和用户偏好。

规则：
- notes.md：长期有用的经验和事实，一条一行（"- " 开头），合并重复、删除过时，总长度不超过 ${input.maxChars ?? NOTES_MAX_CHARS} 字符。保留原有仍然有效的条目。
- user.md：用户明确表达过的偏好和背景，同样合并去重。没有新信息就原样返回。
- 不要编造日志里没有的东西；不要写入任何密钥、令牌、密码。
- identity.md / style.md 不能改；如果日志显示需要调整，写进 suggestions（每条一句话），否则返回空数组。

只输出一个 JSON 对象：{"notes": "<完整的新 notes.md>", "user": "<完整的新 user.md>", "suggestions": ["..."]}

## identity.md
${input.identity}

## style.md
${input.style}

## 当前 notes.md
${input.notes}

## 当前 user.md
${input.user}

## 最近日志
${input.logs}`;
}

export function parseConsolidation(raw: string): { notes: string; user: string; suggestions: string[] } | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(raw.slice(s, e + 1));
    if (typeof o.notes !== "string" || typeof o.user !== "string") return null;
    return { notes: o.notes, user: o.user, suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String) : [] };
  } catch {
    return null;
  }
}

/** Keep notes under the cap by dropping the oldest bullet lines (after the header). */
export function capNotes(text: string, max = NOTES_MAX_CHARS) {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const header = lines.filter((l) => !l.startsWith("- "));
  const bullets = lines.filter((l) => l.startsWith("- "));
  while (bullets.length && [...header, ...bullets].join("\n").length > max) bullets.shift();
  return [...header, ...bullets].join("\n");
}

const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
export function redactSecrets(text: string) {
  return text.replace(SECRET_RE, "[已隐去]");
}

/* ------------------------------------------------------------------ */

export function recentLogs(memDir: string, days = 7, now = new Date()): string {
  const dir = path.join(memDir, "log");
  if (!fs.existsSync(dir)) return "";
  const cutoff = now.getTime() - days * 86400_000;
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && Date.parse(f.slice(0, 10)) >= cutoff - 86400_000)
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n")
    .slice(-20000);
}

export function runClaudeJson(prompt: string, model = "haiku", timeoutMs = 180_000, bin = process.env.AGENTSELF_CLAUDE_BIN ?? "claude"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-p", "--model", model, "--output-format", "json"], { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("consolidation timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      try {
        resolve(JSON.parse(out).result ?? "");
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(prompt);
  });
}
