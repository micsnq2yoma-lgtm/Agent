// Small state helpers kept separate so they can be unit-tested without the host.
import type { FeedMessage } from "@agenteam/shared";
import { tierOf } from "./rules/index.js";

export interface Reminder {
  issueId: string;
  agentId: string;
  dueAt: string;
  note: string;
}

export function dueReminders(list: Reminder[], now: number): { due: Reminder[]; rest: Reminder[] } {
  const due: Reminder[] = [];
  const rest: Reminder[] = [];
  for (const r of list) (Date.parse(r.dueAt) <= now ? due : rest).push(r);
  return { due, rest };
}

/** A task in one of these states needs no wake-ups any more: its pending reminders are dropped. */
export const SETTLED_STATUSES = new Set(["in_review", "done", "cancelled"]);

/** Remove reminders for the given issues (P1 run 5: a stale reminder woke the lead after it reported). */
export function dropRemindersFor<T extends { issueId: string }>(list: T[], issueIds: Iterable<string>): { kept: T[]; dropped: T[] } {
  const ids = new Set(issueIds);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const r of list) (ids.has(r.issueId) ? dropped : kept).push(r);
  return { kept, dropped };
}

export const MAX_NOTICES = 200;

export function appendNotice(list: FeedMessage[], msg: FeedMessage, max = MAX_NOTICES): FeedMessage[] {
  return [msg, ...list].slice(0, max);
}

/** Mark one notice handled (the user dismissed it on the workbench). */
export function dismissNotice(list: FeedMessage[], id: string): { list: FeedMessage[]; found: boolean } {
  let found = false;
  const next = list.map((m) => {
    if (m.id !== id) return m;
    found = true;
    return { ...m, status: "handled" as const };
  });
  return { list: next, found };
}

interface StateLike {
  state: {
    get(key: { scopeKind: "company"; scopeId: string; stateKey: string }): Promise<unknown>;
    set(key: { scopeKind: "company"; scopeId: string; stateKey: string }, value: unknown): Promise<void>;
  };
}

export async function addNotice(
  ctx: StateLike,
  companyId: string,
  input: { text: string; issueId: string | null; agentId: string | null },
): Promise<FeedMessage> {
  const key = { scopeKind: "company" as const, scopeId: companyId, stateKey: "notices" };
  const list = ((await ctx.state.get(key)) ?? []) as FeedMessage[];
  const msg: FeedMessage = {
    id: `notice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "task_progress",
    tier: tierOf("task_progress"),
    companyId,
    issueId: input.issueId,
    agentId: input.agentId,
    title: input.text.slice(0, 200),
    body: input.text,
    createdAt: new Date().toISOString(),
    status: "open",
  };
  await ctx.state.set(key, appendNotice(list, msg));
  return msg;
}
