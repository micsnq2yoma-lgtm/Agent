// Long-running experiment watcher (plan B step 2, after agent-autoloop's "probe script" pattern).
// An employee registers a probe command; the plugin runs it on a schedule without calling any model,
// and wakes the employee only when the probe says the job finished, failed, or the watch expired.
// Probe contract: exit 0 = finished, exit 1 = still running, anything else = error.
// Pure functions only (the worker does the spawning), so they can be unit-tested.

export interface Watch {
  id: string;
  companyId: string;
  issueId: string;
  agentId: string;
  command: string;
  cwd: string | null;
  everyMinutes: number;
  /** ISO time when the watch gives up and wakes the employee. */
  expiresAt: string;
  nextAt: string;
  note: string;
  checks: number;
}

export const WATCH_LIMITS = { minEveryMinutes: 2, maxEveryMinutes: 240, defaultEveryMinutes: 10, maxHours: 72, defaultHours: 24, maxPerCompany: 50 };

export function newWatch(
  input: { issueId?: unknown; command?: unknown; everyMinutes?: unknown; maxHours?: unknown; note?: unknown },
  ctx: { companyId: string; agentId: string; cwd: string | null; now: number; id: string },
): Watch {
  const issueId = String(input.issueId ?? "").trim();
  const command = String(input.command ?? "").trim();
  if (!issueId) throw new Error("缺少 issueId");
  if (!command) throw new Error("缺少探测命令 command");
  if (command.length > 2000) throw new Error("探测命令太长");
  const L = WATCH_LIMITS;
  const every = Math.min(L.maxEveryMinutes, Math.max(L.minEveryMinutes, Math.round(Number(input.everyMinutes) || L.defaultEveryMinutes)));
  const hours = Math.min(L.maxHours, Math.max(0.1, Number(input.maxHours) || L.defaultHours));
  return {
    id: ctx.id,
    companyId: ctx.companyId,
    issueId,
    agentId: ctx.agentId,
    command,
    cwd: ctx.cwd,
    everyMinutes: every,
    expiresAt: new Date(ctx.now + hours * 3600_000).toISOString(),
    nextAt: new Date(ctx.now + every * 60_000).toISOString(),
    note: String(input.note ?? "").slice(0, 500),
    checks: 0,
  };
}

export type ProbeOutcome = "finished" | "running" | "error";

/** exit 0 → finished, exit 1 → running, timeout / spawn error / other codes → error. */
export function classifyProbe(r: { code: number | null; timedOut?: boolean; spawnError?: string | null }): ProbeOutcome {
  if (r.spawnError || r.timedOut) return "error";
  if (r.code === 0) return "finished";
  if (r.code === 1) return "running";
  return "error";
}

export function dueWatches(list: Watch[], now: number): Watch[] {
  return list.filter((w) => Date.parse(w.nextAt) <= now);
}

/** After one check: either keep the watch (rescheduled) or end it with a reason to wake the employee. */
export function afterCheck(w: Watch, outcome: ProbeOutcome, now: number): { keep: Watch | null; wake: null | "finished" | "error" | "expired" } {
  if (outcome === "finished") return { keep: null, wake: "finished" };
  if (outcome === "error") return { keep: null, wake: "error" };
  if (now >= Date.parse(w.expiresAt)) return { keep: null, wake: "expired" };
  return { keep: { ...w, checks: w.checks + 1, nextAt: new Date(now + w.everyMinutes * 60_000).toISOString() }, wake: null };
}

const WAKE_TEXT = { finished: "已结束", error: "出错了", expired: "到了最长等待时间仍未结束" } as const;

export function wakeComment(w: Watch, wake: "finished" | "error" | "expired", output: string): string {
  const tail = output.replace(/\r\n/g, "\n").trim().slice(-1500);
  return [
    `⏱ 看守${WAKE_TEXT[wake]}${w.note ? `：${w.note}` : ""}`,
    `探测命令：\`${w.command.slice(0, 300)}\`（共检查 ${w.checks + 1} 次）`,
    tail ? `最后输出：\n\`\`\`\n${tail}\n\`\`\`` : "",
    wake === "finished" ? "接着分析结果。" : wake === "error" ? "先查日志判断是任务失败还是探测命令本身有问题。" : "查一下任务是否还在正常运行，决定继续等还是停下。",
  ]
    .filter(Boolean)
    .join("\n\n");
}
