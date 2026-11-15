// Router (plan B): one cheap model call per input. It only answers instant questions, picks the lead
// for a task, or spots a follow-up to an open task. Understanding the request is the lead's job, so the
// task goes to the lead with the user's original words.
// Uses the locally logged-in Claude Code CLI (`claude -p`), so no extra API key is needed.
import { spawn } from "node:child_process";

export const DEFAULT_ROUTER_MODEL = "haiku";

/** `leads`: [{ id, name, team, description }]; `profile`: the user's "about me" (optional). */
export function buildPrompt({ text, leads = [], openIssues = [], now, profile = "" }) {
  const roster = leads.map((l) => `- ${l.id} | ${l.name} | 团队：${l.team ?? ""} | 负责：${l.description ?? ""}`).join("\n") || "- （还没有主管）";
  const issues =
    openIssues
      .slice(0, 30)
      .map((i) => `- ${i.id} | ${i.identifier ?? ""} | ${i.title} | 负责主管：${i.assigneeName ?? ""} | ${i.status}`)
      .join("\n") || "- （无）";
  return `你是一个自动化团队的"路由"。用户只在一个输入框里说话。你不理解细节、不做决定，只判断这句话该怎么走，并只输出一个 JSON 对象，不要输出其他文字。

当前时间：${now}
${profile.trim() ? `\n关于用户：\n${profile.trim().slice(0, 3000)}\n` : ""}
主管（每人带一个团队，负责一个领域）：
${roster}

进行中的任务：
${issues}

怎么走：
1. "answer"：即时问答（查事实、天气、换算、问团队整体进度等，能直接回答、不需要谁花时间去做）。直接给出简洁中文答案。问进度时根据上面的任务列表回答。需要实时信息时可以联网搜索。
2. "task"：需要团队花时间去做的事。按主管负责的领域选一位，并给一个不超过 40 字的任务标题。不要改写用户的要求，主管会读用户的原话。
3. "followup"：明显是在补充或修改上面某个进行中任务的要求。给出该任务 id。
4. "unclear"：是任务，但没有合适的主管，或者几位主管都说得通。给出候选主管 id（可以为空）。

只输出下面几种格式之一：
{"route":"answer","answer":"..."}
{"route":"task","lead":"<主管 id>","title":"...","why":"一句话：为什么交给他"}
{"route":"followup","issueId":"<任务 id>"}
{"route":"unclear","title":"...","candidates":["<主管 id>"]}

用户说：
${text}`;
}

export function parseRoute(raw) {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { route: "answer", answer: text.trim() || "（路由没有给出回答）" };
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!["answer", "task", "followup", "unclear"].includes(obj.route)) throw new Error("bad route");
    return obj;
  } catch {
    return { route: "answer", answer: text.trim() };
  }
}

/** Run `claude -p` with the prompt on stdin; resolves with the model's text result. */
export function runClaude(prompt, { model = DEFAULT_ROUTER_MODEL, timeoutMs = 120_000, claudeBin = process.env.AGENTSELF_CLAUDE_BIN ?? "claude" } = {}) {
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
      reject(new Error("路由模型超时"));
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
