// Employee memory files (PLAN 5): plain Markdown under <cwd>/memory, versioned with git.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CORE_FILES = ["identity.md", "style.md", "user.md", "notes.md"];
export const NOTES_MAX_CHARS = 6000;

export function memoryDir(cwd) {
  return path.join(cwd, "memory");
}

function git(dir, args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
}

export function ensureGit(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.name", "AgenTeam Memory"]);
    git(dir, ["config", "user.email", "memory@agentself.local"]);
    git(dir, ["config", "core.autocrlf", "false"]);
  }
}

/** Commit all changes in the memory dir; returns the short sha or null when nothing changed. */
export function commitMemory(cwd, message) {
  const dir = memoryDir(cwd);
  if (!fs.existsSync(dir)) return null;
  ensureGit(dir);
  git(dir, ["add", "-A"]);
  const st = git(dir, ["status", "--porcelain"]);
  if (!st.stdout.trim()) return null;
  const r = git(dir, ["commit", "-q", "-m", message]);
  if (r.status !== 0) return null;
  return git(dir, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}

const ENTRY_MARK = "<!-- agentself:memory -->";

/**
 * Plan B fix (P1 on Windows): Paperclip runs a child task in its parent's execution workspace, so an
 * employee can run in its lead's directory. Nothing that belongs to an agent may live in a working
 * directory: identity, skill, memory location and permissions all ride on the agent's own config
 * (instructionsFilePath + CLI args, see scripts/lib/department.mjs). This builds the memory part of
 * that instructions file, with absolute paths so it works from any working directory.
 *
 * `profile` = absolute paths of the user's global profile files (see profile.mjs).
 */
export function memoryGuide({ role = "employee", memDir, profile = null }) {
  const p = (f) => path.join(memDir, f).split(path.sep).join("/");
  const isLead = role === "lead";
  const prof = profile
    ? `## 用户的全局档案（所有主管和员工共用，开工先读）

- 关于用户：\`${profile.user}\`
- 用户定过的事（必须照做，不要再问）：\`${profile.decisions}\`
- 用户拒绝过的事（不要再提）：\`${profile.declined}\`
- 先问清单（这些情况必须先停下来问）：\`${profile.askfirst}\`

`
    : "";
  const writeBack = isLead
    ? `- 这个领域里关于用户的了解、派活和验收的经验 → 追加到 \`${p("notes.md")}\`（一条一行，"- " 开头）
- 某个主题的长期背景 → \`${p("topics")}/<主题>.md\`
- 用户说"以后都这样"的决定、明确拒绝的做法 → 不要写进自己的记忆，用 record_decision 记进全局档案`
    : `- 用户明确表达的偏好 → 追加到 \`${p("user.md")}\`
- 以后还用得上的经验 → 追加到 \`${p("notes.md")}\`（一条一行，"- " 开头）
- 某个主题的详细资料 → \`${p("topics")}/<主题>.md\``;
  return `${prof}## 你自己的记忆（开工先读，收工写回）

你的记忆目录是 \`${memDir.split(path.sep).join("/")}\`。它**不一定是你现在的工作目录**：任务可能在别的目录里运行，记忆一律用下面的绝对路径读写。

每次开工先读：

1. \`${p("identity.md")}\`：你是谁、负责什么、向谁汇报
2. \`${p("style.md")}\`：用户要求的工作方式（必须遵守）
3. \`${p("user.md")}\`：你了解到的用户偏好
4. \`${p("notes.md")}\`：以往经验

和任务相关的详细资料在 \`${p("topics")}/\` 下，按需读取。交付时一句话说明用到了哪条记忆。

收工前写回：

${writeBack}
- 不要写密钥、令牌、密码；不要改 identity.md 和 style.md（有建议写在评论里）
`;
}

const ENTRY_RE = new RegExp(`${ENTRY_MARK}[\\s\\S]*?${ENTRY_MARK}\\n?`);

/**
 * Remove the identity / memory block that older versions wrote into a workspace's CLAUDE.md and
 * AGENTS.md. Whoever runs in that directory (an employee in its lead's workspace) would otherwise
 * read another agent's identity. The user's own content in those files is kept.
 */
export function removeMemoryEntry(cwd) {
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const f = path.join(cwd, file);
    if (!fs.existsSync(f)) continue;
    const old = fs.readFileSync(f, "utf8");
    if (!ENTRY_RE.test(old)) continue;
    const next = old.replace(ENTRY_RE, "").trim();
    if (next) fs.writeFileSync(f, `${next}\n`);
    else fs.rmSync(f);
  }
}

/** Create the memory files (never overwrites) and drop any identity block an older version left in the cwd. */
export function initMemory(cwd, info) {
  removeMemoryEntry(cwd);
  const dir = memoryDir(cwd);
  for (const sub of ["topics", "log", "archive"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const write = (f, text) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, text);
  };
  write(
    "identity.md",
    `# ${info.name}\n\n- 角色：${info.title}\n- 团队：${info.department}\n- 汇报对象：${info.reportsTo}\n- 能力：${info.capabilities}\n\n${info.identity}\n`,
  );
  write("style.md", "# 工作方式\n\n（交付习惯、语气等，由用户填写；整理任务只提建议）\n");
  write("user.md", "# 关于用户\n\n");
  write("notes.md", "# 经验与事实\n\n（长期有用的经验，保持精简；详细内容放 topics/）\n");
  for (const sub of ["topics", "log", "archive"]) write(path.join(sub, ".keep"), "");
  commitMemory(cwd, "init memory");
}

/** Safe path inside memory/; throws on traversal. */
export function resolveMemoryPath(cwd, rel) {
  const dir = path.resolve(memoryDir(cwd));
  const p = path.resolve(dir, rel);
  if (p !== dir && !p.startsWith(dir + path.sep)) throw Object.assign(new Error("路径不在记忆目录内"), { status: 400 });
  if (!p.endsWith(".md")) throw Object.assign(new Error("只能读写 .md 文件"), { status: 400 });
  return p;
}

export function listMemory(cwd) {
  const dir = memoryDir(cwd);
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const st = fs.statSync(p);
        out.push({ path: path.relative(dir, p).split(path.sep).join("/"), size: st.size, updatedAt: st.mtime.toISOString() });
      }
    }
  };
  walk(dir);
  const rank = (p) => {
    const i = CORE_FILES.indexOf(p);
    return i >= 0 ? i : p.startsWith("topics/") ? 10 : p.startsWith("log/") ? 20 : 30;
  };
  return out.sort((a, b) => rank(a.path) - rank(b.path) || b.path.localeCompare(a.path));
}

export function todayLogName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `log/${y}-${m}-${d}.md`;
}

export function appendLog(cwd, entry, date = new Date()) {
  const p = resolveMemoryPath(cwd, todayLogName(date));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, `# ${todayLogName(date).slice(4, 14)} 工作日志\n\n`);
  fs.appendFileSync(p, entry.endsWith("\n") ? entry : `${entry}\n`);
  return p;
}

/** Logs older than `days` are concatenated into archive/YYYY-MM.md and removed. */
export function archiveOldLogs(cwd, days = 14, now = new Date()) {
  const logDir = path.join(memoryDir(cwd), "log");
  if (!fs.existsSync(logDir)) return [];
  const cutoff = now.getTime() - days * 86400_000;
  const moved = [];
  for (const f of fs.readdirSync(logDir)) {
    const m = f.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
    if (!m) continue;
    if (Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) >= cutoff) continue;
    const src = path.join(logDir, f);
    const dst = path.join(memoryDir(cwd), "archive", `${m[1]}-${m[2]}.md`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.appendFileSync(dst, `\n\n${fs.readFileSync(src, "utf8")}`);
    fs.rmSync(src);
    moved.push(f);
  }
  return moved;
}

/** Topics not modified for `days` move to archive/topics/. */
export function archiveStaleTopics(cwd, days = 60, now = new Date()) {
  const dir = path.join(memoryDir(cwd), "topics");
  if (!fs.existsSync(dir)) return [];
  const moved = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(dir, f);
    if (now.getTime() - fs.statSync(p).mtimeMs < days * 86400_000) continue;
    const dst = path.join(memoryDir(cwd), "archive", "topics", f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(p, dst);
    moved.push(f);
  }
  return moved;
}
