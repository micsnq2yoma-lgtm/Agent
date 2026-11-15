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
    git(dir, ["config", "user.name", "Agentself Memory"]);
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

const WRITE_BACK = `## 收工前写回记忆
- 用户明确表达的偏好 → 追加到 memory/user.md
- 以后还用得上的经验 → 追加到 memory/notes.md（一条一行，"- " 开头）
- 某个主题的详细资料 → memory/topics/<主题>.md
- 不要写密钥、令牌、密码；不要改 identity.md 和 style.md（有建议写在交付评论里）`;

const LEAD_WRITE_BACK = `## 收工前写回记忆
- 这个领域里关于用户的了解、派活和验收的经验 → 追加到 memory/notes.md（一条一行，"- " 开头）
- 某个主题的长期背景 → memory/topics/<主题>.md
- 用户在卡片里说"以后都这样"的决定、明确拒绝的做法 → 不要写进自己的记忆，按主管技能里的方法记进全局决定记录
- 不要写密钥、令牌、密码；不要改 identity.md 和 style.md`;

/**
 * Workspace entry files that make memory load automatically:
 *  - CLAUDE.md (Claude Code reads it from the cwd and resolves @imports)
 *  - AGENTS.md (Codex reads it from the cwd; no imports, so it tells the agent what to read)
 * Existing user content is kept; our block is replaced between markers.
 *
 * `profile` (optional) = { user, decisions, declined } import refs of the user's global profile
 * (see profile.mjs). Leads must follow all three; employees get them as background.
 */
export function ensureMemoryEntry(cwd, { role = "employee", profile = null } = {}) {
  const isLead = role === "lead";
  const profileClaude = profile
    ? `## 关于用户（全局，所有主管和员工共用）

@${profile.user}
@${profile.decisions}
@${profile.declined}

"我定过的事"必须照做，不要再问；"我拒绝过的事"不要再提。

`
    : "";
  const profileCodex = profile
    ? `先读用户的全局档案（所有人共用）："${profile.user}"（关于用户）、"${profile.decisions}"（用户定过的事，必须照做，不要再问）、"${profile.declined}"（用户拒绝过的事，不要再提）。

`
    : "";
  const claude = `${ENTRY_MARK}
# 你的长期记忆（自动加载，必须遵守）

${profileClaude}## 你自己的记忆

以下是你的身份、用户要求的工作方式、用户偏好和以往经验。**每次任务都要照做**；交付时一句话说明用到了哪条。

@memory/identity.md
@memory/style.md
@memory/user.md
@memory/notes.md

和任务相关的详细资料在 memory/topics/ 下，按需读取。

${isLead ? LEAD_WRITE_BACK : WRITE_BACK}
${ENTRY_MARK}
`;
  const codex = `${ENTRY_MARK}
# 你的长期记忆（必须先读，必须遵守）

${profileCodex}开始任何任务前，先完整读取下面四个文件，并在本次任务里遵守其中的偏好和经验；交付时一句话说明用到了哪条：

1. memory/identity.md — 你是谁、负责哪个领域
2. memory/style.md — 用户要求的工作方式
3. memory/user.md — 用户偏好（例如交付格式）
4. memory/notes.md — 以往经验

和任务相关的详细资料在 memory/topics/ 下，按需读取。

${isLead ? LEAD_WRITE_BACK : WRITE_BACK}
${ENTRY_MARK}
`;
  for (const [file, block] of [
    ["CLAUDE.md", claude],
    ["AGENTS.md", codex],
  ]) {
    const p = path.join(cwd, file);
    const old = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    const re = new RegExp(`${ENTRY_MARK}[\\s\\S]*?${ENTRY_MARK}\\n?`);
    const next = re.test(old) ? old.replace(re, block) : (old ? `${old.trimEnd()}\n\n` : "") + block;
    if (next !== old) fs.writeFileSync(p, next);
  }
}

/** info.role: "lead" | "employee"; info.profile: import refs of the global profile (optional). */
export function initMemory(cwd, info) {
  ensureMemoryEntry(cwd, { role: info.role, profile: info.profile ?? null });
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
