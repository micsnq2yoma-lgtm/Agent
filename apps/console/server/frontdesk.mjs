// Front desk (PLAN 4.1): classify each input with a fast model, then answer / create task / add follow-up.
// Uses the locally logged-in Claude Code CLI (`claude -p`), so no extra API key is needed.
import { spawn } from "node:child_process";

export function buildPrompt({ text, departments, openIssues, now }) {
  const depts = departments.map((d) => `- ${d.key}: ${d.name}（${d.description ?? ""}）`).join("\n") || "- （暂无部门）";
  const issues =
    openIssues
      .slice(0, 30)
      .map((i) => `- ${i.id} | ${i.identifier ?? ""} | ${i.title} | ${i.departmentName ?? ""} | ${i.status}`)
      .join("\n") || "- （无）";
  return `你是一个自动化团队的"前台"。用户只在一个输入框里说话。你要判断这句话属于哪一类，并只输出一个 JSON 对象，不要输出其他文字。

当前时间：${now}

部门：
${depts}

进行中的任务：
${issues}

分类规则：
1. "answer"：即时问答（查事实、天气、换算、问团队进度等，能直接回答、不需要部门干活的）。直接给出简洁中文答案。问团队进度时根据上面的任务列表回答。需要实时信息时可以联网搜索。
2. "task"：需要部门花时间去做的事。选出最合适的部门 key，并把用户的话整理成任务标题（不超过 40 字）和描述（保留用户全部要求）。
3. "followup"：明显是在补充 / 修改上面某个进行中任务的要求。给出该任务 id 和要转达的评论。
4. "unclear"：是任务但判断不出归属部门。

只输出下面几种格式之一：
{"route":"answer","answer":"..."}
{"route":"task","department":"<key>","title":"...","description":"..."}
{"route":"followup","issueId":"<id>","comment":"..."}
{"route":"unclear","title":"...","description":"...","candidates":["<key>", "..."]}

用户说：
${text}`;
}

export function parseRoute(raw) {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { route: "answer", answer: text.trim() || "（前台没有给出回答）" };
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!["answer", "task", "followup", "unclear"].includes(obj.route)) throw new Error("bad route");
    return obj;
  } catch {
    return { route: "answer", answer: text.trim() };
  }
}

/** Run `claude -p` with the prompt on stdin; resolves with the model's text result. */
export function runClaude(prompt, { model = "haiku", timeoutMs = 120_000, claudeBin = process.env.AGENTSELF_CLAUDE_BIN ?? "claude" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      claudeBin,
      ["-p", "--model", model, "--output-format", "json", "--allowedTools", "WebSearch,WebFetch"],
      { shell: process.platform === "win32", windowsHide: true },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("前台模型超时"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      try {
        const j = JSON.parse(out);
        resolve({ text: j.result ?? "", costUsd: j.total_cost_usd ?? null });
      } catch {
        resolve({ text: out, costUsd: null });
      }
    });
    child.stdin.end(prompt);
  });
}
