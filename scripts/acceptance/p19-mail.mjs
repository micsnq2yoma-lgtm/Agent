#!/usr/bin/env node
// Mailboxes: an employee reads the configured mailbox with the team mail tools.
// Needs one mailbox in 设置 → 邮箱. The script reads the newest subject itself (same machine,
// apps/console/server/mail.mjs) and expects the employee to report the same subject. The app
// password is in Paperclip's secret store and cannot be read back: pass it for this check as
// AGENTSELF_MAIL_PASSWORD=<授权码>. Without it the script only checks that the employee read the
// mailbox (a subject reported, no error) — which already proves the secret reached the run.
//   --draft   also have the employee save a draft (to your own address) into the Drafts folder;
//             delete it afterwards. Nothing is ever sent.
// Model cost: one short employee turn (two with --draft). ~2–5 min.
// Usage: node scripts/acceptance/p19-mail.mjs [--draft]
import { listAccounts, mailEnvName, recentMail } from "../../apps/console/server/mail.mjs";
import { api, cancelTree, comments, log, researchTeam, runsOf, verdict, waitFor } from "./lib/scenario.mjs";

const draft = process.argv.includes("--draft");
const accounts = listAccounts();
if (!accounts.length) {
  console.log(`RESULT p19-mail SKIP ${JSON.stringify({ note: "这台电脑还没有配置邮箱（设置 → 邮箱），跳过" })}`);
  process.exit(0);
}
const acc = accounts[0];
if (process.env.AGENTSELF_MAIL_PASSWORD) process.env[mailEnvName(acc.id)] = process.env.AGENTSELF_MAIL_PASSWORD;
const canRead = !acc.inSecretStore || !!process.env.AGENTSELF_MAIL_PASSWORD;
const newest = canRead ? ((await recentMail({ account: acc.id, days: 7, max: 1 })).messages[0] ?? null) : undefined;
log("mailbox", acc.address, "newest:", newest === undefined ? "(授权码在密钥库里，脚本不读；设 AGENTSELF_MAIL_PASSWORD 可对比主题)" : (newest?.subject ?? "(最近 7 天没有邮件)"));

const { companyId, projectId, employee } = await researchTeam();
const mark = `p19-${Date.now().toString(36)}`;
const issue = await api("POST", `/companies/${companyId}/issues`, {
  title: `[验收 p19] 邮箱 ${mark}`,
  description: [
    `用你的 mail_recent 工具看邮箱 ${acc.address} 最近 7 天的邮件（不要读全文）。`,
    `用 comment 工具在这个任务上留一条评论，第一行是 ${mark}，第二行写"最新一封：<主题原文>"（没有邮件就写"最新一封：无"）。`,
    draft ? `然后用 mail_draft 给 ${acc.address} 写一封草稿，主题"${mark} 草稿测试"，正文"这是验收测试，可以删除"。只存草稿，不发送。` : "",
    "最后用 update_task 把任务置为 done。这是验收测试，不要做别的。",
  ]
    .filter(Boolean)
    .join("\n"),
  projectId,
  assigneeAgentId: employee.id,
  status: "todo",
});
log("task", issue.identifier, "→", employee.name);
await waitFor(
  "waiting",
  async () => {
    const i = await api("GET", `/issues/${issue.id}`);
    const runs = await runsOf(issue.id);
    const p = `${i.status}, runs ${runs.map((r) => r.status).join(",") || "none"}`;
    return ["done", "cancelled"].includes(i.status) && runs.every((r) => !["running", "queued"].includes(r.status)) ? { done: true, progress: p } : { progress: p };
  },
  { minutes: 12 },
);
const c = (await comments(issue.id)).find((x) => (x.body ?? "").includes(mark) && x.authorAgentId === employee.id);
const reported = c?.body.match(/最新一封[:：]\s*(.+)/)?.[1]?.trim() ?? null;
const results = {
  account: acc.address,
  newest: newest === undefined ? "(未对比)" : (newest?.subject ?? null),
  reported,
  sameSubject: newest === undefined ? null : newest ? !!reported && (reported.includes(newest.subject.trim().slice(0, 20)) || newest.subject.includes(reported.slice(0, 20))) : reported === "无",
  status: (await api("GET", `/issues/${issue.id}`)).status,
};
if (draft) results.draftCheck = `请在 ${acc.address} 的草稿箱里找主题 "${mark} 草稿测试" 的草稿，确认后删除`;
// always: a finished task left behind piles up in Paperclip
await cancelTree(companyId, issue.id).catch(() => {});
// without the password: the employee reading anything (not an error) proves the secret binding works
const read = results.sameSubject ?? (!!reported && !/失败|错误|error|授权码/i.test(reported));
verdict("p19-mail", read && results.status === "done", results);
