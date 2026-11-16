// Project drawer (DESIGN §4.9): floats from the right; progress, acceptance criteria (with the
// employee's evidence and the independent verifier's verdicts), the employee, a timeline, and a
// pill input to say something to the lead or the employee.
import { useEffect, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { list, pc, type Context, type Issue } from "../lib/api";
import { loadAcceptance, VERDICT_TEXT, type Acceptance } from "../lib/acceptance";
import { progressOf, STAGE_NAMES, statusOf } from "../lib/progress";
import { loadWatches, type ReminderView, type WatchView } from "../lib/feed";
import { cronText } from "../lib/cron";
import { useSkin } from "../lib/skin";
import { AGENT_STATUS, Robot, eyeOf, modelName } from "../components/Brand";
import { Stages } from "./Home";
import { Link } from "@/lib/router";
import type { Card } from "../lib/cards";

const STATUS: Record<string, string> = {
  backlog: "已暂停",
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待你确认",
  done: "完成",
  blocked: "等待中",
  cancelled: "已取消",
};

interface Doc {
  key: string;
  title?: string | null;
}
interface Activity {
  id: string;
  action: string;
  createdAt: string;
  details?: Record<string, unknown>;
}
interface Comment {
  id: string;
  body: string;
  createdAt: string;
  authorAgentId?: string | null;
}

/** A subtask is the employee's job: backlog there means "not started", not "paused". */
const SUB_STATUS: Record<string, string> = { ...STATUS, backlog: "未开始", in_review: "已交付", done: "已交付" };

interface RoutineInfo {
  id: string;
  title?: string;
  status?: string;
  triggers?: Array<{ kind?: string; cronExpression?: string | null; nextRunAt?: string | null; lastFiredAt?: string | null; enabled?: boolean }>;
}
/** "今天 14:30" / "明天 09:00" / "11月18日 09:00" */
function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  const t = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (diff === 0) return `今天 ${t}`;
  if (diff === 1) return `明天 ${t}`;
  if (diff === -1) return `昨天 ${t}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${t}`;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function ProjectDrawer({ ctx, issueId, onClose, toast, cards = [] }: { ctx: Context; issueId: string; onClose: () => void; toast: (s: string) => void; cards?: Card[] }) {
  const { t } = useSkin();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [all, setAll] = useState<Issue[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [acc, setAcc] = useState<Acceptance | null>(null);
  const [timeline, setTimeline] = useState<Array<{ at: string; text: string }>>([]);
  const [say, setSay] = useState("");
  const [sayTo, setSayTo] = useState<string>(issueId);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState<{ watches: WatchView[]; reminders: ReminderView[] }>({ watches: [], reminders: [] });
  const [routine, setRoutine] = useState<RoutineInfo | null>(null);

  const agentName = (id: string | null | undefined) => ctx.agents.find((a) => a.id === id)?.name ?? (id ? "系统" : "你");

  async function load() {
    const i = await pc.get<Issue>(`/issues/${issueId}`);
    setIssue(i);
    const everything = list<Issue>(await pc.get(`/companies/${ctx.company!.id}/issues`));
    setAll(everything);
    const kids = everything.filter((x) => x.parentId === issueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setDocs(list<Doc>(await pc.get(`/issues/${issueId}/documents`).catch(() => [])));
    // 盯守: watches / reminders on the task and its subtasks, and the routine that created it
    setWatching(await loadWatches(ctx.company!.id, [issueId, ...kids.map((k) => k.id)]));
    setRoutine(i.originKind === "routine_execution" && i.originId ? await pc.get<RoutineInfo>(`/routines/${i.originId}`).catch(() => null) : null);
    setAcc(await loadAcceptance(issueId, kids[0]?.id ?? null).catch(() => null));
    const comments = list<Comment>(await pc.get(`/issues/${issueId}/comments`).catch(() => []));
    const items = comments.map((c) => ({ at: c.createdAt, text: `${agentName(c.authorAgentId)}：${c.body.replace(/\s+/g, " ").slice(0, 140)}` }));
    for (const k of kids) {
      const acts = list<Activity>(await pc.get(`/issues/${k.id}/activity`).catch(() => []));
      for (const a of acts) {
        const prev = (a.details?._previous as { status?: string } | undefined)?.status;
        const next = a.details?.status as string | undefined;
        if (a.action !== "issue.updated" || !prev || !next || prev === next) continue;
        if (next === "done") items.push({ at: a.createdAt, text: `${agentName(k.assigneeAgentId)}交付「${k.title}」` });
        else if ((prev === "in_review" || prev === "done") && next === "in_progress") items.push({ at: a.createdAt, text: `「${k.title}」被退回${t("rework")}` });
      }
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    setTimeline(items.slice(0, 40));
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [issueId]);

  async function send() {
    if (!say.trim()) return;
    setBusy(true);
    try {
      await pc.post(`/issues/${sayTo}/comments`, { body: say });
      setSay("");
      toast("已发送，对方会被唤醒");
      void load();
    } catch (e) {
      toast(`发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await pc.patch(`/issues/${issueId}`, { status });
      toast("已更新");
      void load();
    } catch (e) {
      toast(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const lead = ctx.agents.find((a) => a.id === issue?.assigneeAgentId);
  const kids = all.filter((x) => x.parentId === issueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const p = issue ? progressOf(issue, all, cards) : null;
  const emp = ctx.agents.find((a) => a.id === p?.employeeId);
  const hasDoc = (k: string) => docs.some((d) => d.key === k);
  const issueLink = (i: Issue | null) => (i ? `/issues/${i.identifier ?? i.id}` : "#");
  const st = issue ? statusOf(issue, p) : null;
  const sub = all.find((x) => x.id === p?.childId) ?? null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${t("project")}详情`}>
        <header>
          <div className="line1">
            <span className="mono">
              {lead?.name ?? t("lead")} · {issue?.identifier ?? ""}
            </span>
            {st && <span className={`status-tag ${st.tone}`}>{st.text}</span>}
            <span className="grow" />
            <button className="icon-btn sm surface" aria-label="关闭" onClick={onClose}>
              <X />
            </button>
          </div>
          <h2>{issue?.title ?? "加载中…"}</h2>
          {issue && (
            <div className="drawer-links">
              {hasDoc("brief") && (
                <Link to={`${issueLink(issue)}#document-brief`} onClick={onClose}>
                  任务书
                </Link>
              )}
              {hasDoc("report") && (
                <Link to={`${issueLink(issue)}#document-report`} onClick={onClose}>
                  {t("report")}
                </Link>
              )}
              <Link to={issueLink(issue)} onClick={onClose}>
                文件 {docs.length}
              </Link>
              <Link to={issueLink(issue)} onClick={onClose} data-testid="open-issue-page">
                完整任务页
              </Link>
            </div>
          )}
        </header>
        <div className="body">
          {p && (
            <section>
              <h3>进度</h3>
              <Stages p={p} large />
              <div className="stage-names">
                {STAGE_NAMES.map((n, i) => (
                  <span key={n} className={i === p.stage ? "on" : ""}>
                    {n}
                    {i === p.stage && p.waiting && issue?.status !== "in_review" ? " · 等你决定" : ""}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3>
              <span>验收标准</span>
              {acc && acc.rows.some((r) => r.verdict) && (
                <span className="tertiary">
                  {acc.passed} / {acc.rows.length} 通过
                </span>
              )}
            </h3>
            {acc && acc.rows.length > 0 ? (
              <>
                <div className="criteria">
                  {acc.rows.map((r) => (
                    <div key={r.id} className="crit">
                      <span className="cid">{r.id}</span>
                      <div>
                        <div className="ctext">{r.text}</div>
                        {(r.evidence || r.wanted) && (
                          <div className="cev">
                            <FileText aria-hidden="true" />
                            <span>{r.evidence ?? `需要：${r.wanted}`}</span>
                          </div>
                        )}
                        {r.dispute && <div className="cev">员工的异议：{r.dispute}</div>}
                        {r.reason && <div className="cev">核查：{r.reason}</div>}
                      </div>
                      <span className={`vtag ${r.verdict ?? ""}`}>{r.verdict ? VERDICT_TEXT[r.verdict] : "未核查"}</span>
                    </div>
                  ))}
                </div>
                {acc.model && (
                  <div className="criteria-foot">
                    独立核查员 · {acc.model}
                    {acc.verifiedAt ? ` · ${new Date(acc.verifiedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </div>
                )}
              </>
            ) : (
              <div className="sub">{t("lead")}还没有登记验收标准。</div>
            )}
          </section>

          {emp && (
            <section>
              <h3>{t("employee")}</h3>
              <div className="member-row">
                <Robot id={emp.id} eye={eyeOf(emp.adapterType)} size={34} />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{emp.name}</div>
                  <div className="sub">
                    {[modelName(emp), AGENT_STATUS[emp.status ?? ""] ?? emp.status, sub ? `子任务${SUB_STATUS[sub.status] ?? sub.status}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Link to={`/agents/${emp.id}/runs`} onClick={onClose}>
                  运行记录
                  <ChevronRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </section>
          )}

          {(routine || watching.watches.length > 0 || watching.reminders.length > 0) && (
            <section data-testid="drawer-watch">
              <h3>盯守</h3>
              <div className="watch-list">
                {routine &&
                  (routine.triggers ?? [])
                    .filter((tr) => tr.kind === "schedule" || tr.cronExpression)
                    .map((tr, k) => (
                      <div key={`r${k}`} className="watch-row">
                        <span className="wkind">{t("routine")}</span>
                        <div className="grow">
                          <div>
                            {routine.title ?? "定时任务"} · {cronText(tr.cronExpression)}
                            {routine.status && routine.status !== "active" ? "（已停用）" : ""}
                          </div>
                          <div className="sub">
                            {[tr.nextRunAt ? `下次 ${when(tr.nextRunAt)}` : null, tr.lastFiredAt ? `上次 ${when(tr.lastFiredAt)}` : null].filter(Boolean).join(" · ") || "这一次由它生成"}
                          </div>
                        </div>
                        <Link to="/agentself/routines" onClick={onClose}>
                          管理
                        </Link>
                      </div>
                    ))}
                {watching.watches.map((w) => (
                  <div key={w.id} className="watch-row">
                    <span className="wkind">实验</span>
                    <div className="grow">
                      <div>
                        {agentName(w.agentId)}每 {w.everyMinutes} 分钟探测一次{w.note ? `：${w.note}` : ""}
                      </div>
                      <div className="sub">
                        已查 {w.checks} 次 · 下次 {when(w.nextAt)} · {when(w.expiresAt)} 前结束
                      </div>
                      <div className="sub mono watch-cmd" title={w.command}>
                        {w.command}
                      </div>
                    </div>
                  </div>
                ))}
                {watching.reminders.map((r, k) => (
                  <div key={`m${k}`} className="watch-row">
                    <span className="wkind">提醒</span>
                    <div className="grow">
                      <div>
                        {when(r.dueAt)} 叫醒{agentName(r.agentId)}
                      </div>
                      {r.note && <div className="sub">{r.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3>时间线</h3>
            <ul className="timeline">
              {timeline.map((x, i) => (
                <li key={i}>
                  <time>{hhmm(x.at)}</time>
                  <span>{x.text}</span>
                </li>
              ))}
              {timeline.length === 0 && <li className="sub">暂无</li>}
            </ul>
          </section>
        </div>
        <footer>
          <div className="say-pill">
            <input placeholder="插一句话" aria-label="插一句话" value={say} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void send()} />
            <span className="chip-select-wrap">
              <span />
              <select className="chip-select" value={sayTo} onChange={(e) => setSayTo(e.target.value)} aria-label="发给">
                <option value={issueId}>发给：{lead?.name ?? t("lead")}</option>
                {kids
                  .filter((c) => c.assigneeAgentId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      发给：{agentName(c.assigneeAgentId)}
                    </option>
                  ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
            <button className="icon-btn sm send" style={{ width: 36, height: 36 }} aria-label="发送" disabled={busy || !say.trim()} onClick={() => void send()}>
              <ArrowUp />
            </button>
          </div>
          {issue && !["done", "cancelled"].includes(issue.status) && (
            <div className="under">
              <button className="btn ghost xs" disabled={busy} onClick={() => void setStatus("backlog")}>
                暂停
              </button>
              <button className="btn danger xs" disabled={busy} onClick={() => confirm(`取消这个${t("project")}？`) && void setStatus("cancelled")}>
                取消{t("project")}
              </button>
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}
