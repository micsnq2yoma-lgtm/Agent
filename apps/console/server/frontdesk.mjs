// Steward ("总管", formerly the front desk): understands each input, then answers / picks an employee
// and a start mode (direct or plan-first) / adds a follow-up.
// Uses the locally logged-in Claude Code CLI (`claude -p`), so no extra API key is needed.
import { spawn } from "node:child_process";

export const DEFAULT_STEWARD_MODEL = "claude-opus-5-5";

/**
 * The steward ("总管") is the user's only counterpart: it answers quick questions itself,
 * picks the employee for a task, decides whether the task is small enough to start right away
 * or needs a plan approved first, and forwards follow-ups. It never does the work or reviews it.
 * `profile` / `rules` are the user's own notes for the steward (~/.agentself/steward/*.md).
 */
export function buildPrompt({ text, employees = [], openIssues = [], now, profile = "", rules = "" }) {
  const staff =
    employees.map((e) => `- ${e.id} | ${e.name} | 分类：${e.category ?? "未分类"} | 擅长：${e.capabilities ?? ""}`).join("\n") || "- （还没有员工）";
  const issues =
    openIssues
      .slice(0, 30)
      .map((i) => `- ${i.id} | ${i.identifier ?? ""} | ${i.title} | 负责人：${i.assigneeName ?? ""} | ${i.status}`)
      .join("\n") || "- （无）";
  return `你是用户的"总管"。用户只在一个输入框里说话，说完就会离开；你要理解他真正想要什么，然后决定怎么办。你自己不干具体的活，也不验收，只负责：直接回答、选人、判断要不要先出计划、转达补充。只输出一个 JSON 对象，不要输出其他文字。

当前时间：${now}
${profile.trim() ? `\n关于用户（必须参考）：\n${profile.trim()}\n` : ""}${rules.trim() ? `\n用户给你定的规则（必须遵守，优先于下面的默认规则）：\n${rules.trim()}\n` : ""}
员工（每人负责一个领域，有自己的记忆和工具；员工由用户自己命名和分类）：
${staff}

进行中的任务：
${issues}

怎么判断：
1. "answer"：即时问答（查事实、换算、问进度等，不需要员工花时间去做）。直接给出简洁中文答案。问进度时根据上面的任务列表回答。需要实时信息时可以联网搜索。
2. "task"：需要员工花时间去做的事。按"分类"和"擅长"选一名最合适的员工，填他的 id。把用户的话整理成任务标题（不超过 40 字）和描述：保留用户的全部要求，并补上你从"关于用户"里推断出的背景（写明哪些是你推断的）。再判断开工方式 mode：
   - "direct"：小事。目标明确、一两个小时内能做完、花费低、不改动重要的东西。员工直接开工。
   - "plan"：大事。目标有多种理解、要做实验或长时间运行、花费高、或会改动重要的东西（主分支代码、已有数据和结果、对外发送）。员工先写一份简短计划交给用户批准，批准后才动手。
   拿不准时选 "plan"。
3. "followup"：明显是在补充或修改上面某个进行中任务的要求。给出该任务 id 和要转达的评论。
4. "unclear"：是任务，但没有合适的员工，或者几名员工都说得通。给出候选员工 id（可以为空）。

只输出下面几种格式之一：
{"route":"answer","answer":"..."}
{"route":"task","employee":"<员工 id>","mode":"direct","title":"...","description":"..."}
{"route":"followup","issueId":"<任务 id>","comment":"..."}
{"route":"unclear","title":"...","description":"...","candidates":["<员工 id>"]}

用户说：
${text}`;
}

export function parseRoute(raw) {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { route: "answer", answer: text.trim() || "（总管没有给出回答）" };
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!["answer", "task", "followup", "unclear"].includes(obj.route)) throw new Error("bad route");
    // When unsure, plan first: only an explicit "direct" skips the plan.
    if (obj.route === "task") obj.mode = obj.mode === "direct" ? "direct" : "plan";
    return obj;
  } catch {
    return { route: "answer", answer: text.trim() };
  }
}

/** Run `claude -p` with the prompt on stdin; resolves with the model's text result. */
export function runClaude(prompt, { model = DEFAULT_STEWARD_MODEL, timeoutMs = 300_000, claudeBin = process.env.AGENTSELF_CLAUDE_BIN ?? "claude" } = {}) {
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
      reject(new Error("总管模型超时"));
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
