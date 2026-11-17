// The user's global profile (v0.6 / plan B): one "about me" plus decision records that every lead reads
// before interpreting a request, and employees read for background. Plain Markdown under
// <AGENTEAM_HOME>/profile, edited by the user in the app; leads only append decisions through the
// local service (they have no general file-write tools).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROFILE_FILES = {
  user: "user.md",
  decisions: "decisions.md",
  declined: "declined.md",
  askfirst: "askfirst.md",
};

const TEMPLATES = {
  user: `# 关于我

（你的课题、正在做的项目、工作习惯、交付偏好。所有主管理解你的话之前都会读这份文件，员工也会参考。）
`,
  decisions: `# 我定过的事

（你在卡片里说过"以后都这样"的决定，由主管追加。每条写明适用范围、日期和出处。主管照做，不再重复问。你可以直接改；改口时改掉原来那条，不要另加一条相反的。）
`,
  declined: `# 我拒绝过的事

（你明确拒绝过的建议和做法，由主管追加。主管和员工不再提同样的建议。）
`,
  askfirst: `# 先问清单

遇到下面这些情况必须先停下来问（员工问主管，主管拿不准再问我），其余的事自己判断、事后在报告里说明。可以随时增删。

- 结果与预期不符：指标明显不对、复现不出论文结果、或结论推翻了原方案
- 要花大钱或很长时间：比如占用显卡十几个小时、调用付费接口、额度快用完
- 要改动重要的东西：改主分支代码、删除或覆盖已有数据和实验结果
- 对外发送任何内容：邮件、发布、推送代码、付款
- 反复失败卡住了：同一个问题换了三种办法还没解决
`,
};

export const profileDir = (home) => path.join(home, "profile");

export function profilePath(home, key) {
  const f = PROFILE_FILES[key];
  if (!f) throw Object.assign(new Error(`未知的档案文件：${key}`), { status: 400 });
  return path.join(profileDir(home), f);
}

/** Create the profile files that do not exist yet; never overwrites. */
export function ensureProfile(home) {
  fs.mkdirSync(profileDir(home), { recursive: true });
  for (const key of Object.keys(PROFILE_FILES)) {
    const p = profilePath(home, key);
    if (!fs.existsSync(p)) fs.writeFileSync(p, TEMPLATES[key]);
  }
}

export function readProfile(home, key, max = 8000) {
  try {
    return fs.readFileSync(profilePath(home, key), "utf8").slice(0, max);
  } catch {
    return "";
  }
}

export function writeProfile(home, key, text) {
  ensureProfile(home);
  fs.writeFileSync(profilePath(home, key), String(text ?? ""));
}

/** One decision line: "- [日期] 内容（适用：范围；出处：来源）". */
export function decisionLine({ text, scope, source }, now = new Date()) {
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const body = clean(text);
  if (!body) throw Object.assign(new Error("决定内容为空"), { status: 400 });
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const meta = [scope && `适用：${clean(scope)}`, source && `出处：${clean(source)}`].filter(Boolean).join("；");
  return `- [${d}] ${body.slice(0, 500)}${meta ? `（${meta}）` : ""}`;
}

/** Append to decisions.md (kind "decision") or declined.md (kind "declined"). */
export function appendDecision(home, input, now = new Date()) {
  ensureProfile(home);
  const key = input.kind === "declined" ? "declined" : "decisions";
  const line = decisionLine(input, now);
  const p = profilePath(home, key);
  const old = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, `${old.trimEnd()}\n${line}\n`);
  return { file: PROFILE_FILES[key], line };
}

/**
 * How a CLAUDE.md should import a file: "~/..." when it lives under the home directory (portable
 * across Windows and Unix), otherwise the absolute path with forward slashes.
 */
export function importRef(p, homedir = os.homedir()) {
  const rel = path.relative(homedir, p);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return `~/${rel.split(path.sep).join("/")}`;
  return p.split(path.sep).join("/");
}

/* ---------------- memory proposals: consolidation proposes, the user confirms ---------------- */
// Written by the team-layer plugin (same format), read and resolved here.

const proposalsFile = (home) => path.join(profileDir(home), "proposals.json");

export function listProposals(home) {
  try {
    const list = JSON.parse(fs.readFileSync(proposalsFile(home), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveProposals(home, list) {
  fs.mkdirSync(profileDir(home), { recursive: true });
  const f = proposalsFile(home);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(list.slice(-200), null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

/** accept → appended to "about me" (optionally edited text); reject → kept as rejected. */
export function resolveProposal(home, id, action, editedText) {
  const list = listProposals(home);
  const p = list.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error("没有这条建议"), { status: 404 });
  if (p.status !== "pending") return p;
  if (action === "accept") {
    ensureProfile(home);
    const text = String(editedText ?? p.text).replace(/\s+/g, " ").trim();
    const file = profilePath(home, "user");
    fs.writeFileSync(file, `${fs.readFileSync(file, "utf8").trimEnd()}\n- ${text}\n`);
    p.status = "accepted";
    p.text = text;
  } else {
    p.status = "rejected";
  }
  p.resolvedAt = new Date().toISOString();
  saveProposals(home, list);
  return p;
}
