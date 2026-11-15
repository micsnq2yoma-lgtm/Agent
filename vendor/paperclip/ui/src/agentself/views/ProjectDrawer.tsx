// Project drawer (DESIGN §4.9): floats from the right; progress, acceptance criteria (with the
// employee's evidence and the independent verifier's verdicts), the employee, a timeline, and a
// pill input to say something to the lead or the employee.
import { useEffect, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { list, pc, type Context, type Issue } from "../lib/api";
import { loadAcceptance, VERDICT_TEXT, type Acceptance } from "../lib/acceptance";
import { progressOf, STAGE_NAMES } from "../lib/progress";
import { useSkin } from "../lib/skin";
import { Robot, eyeOf, modelName } from "../components/Brand";
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

  const agentName = (id: string | null | undefined) => ctx.agents.find((a) => a.id === id)?.name ?? (id ? "系统" : "你");

  async function load() {
    const i = await pc.get<Issue>(`/issues/${issueId}`);
    setIssue(i);
    const everything = list<Issue>(await pc.get(`/companies/${ctx.company!.id}/issues`));
    setAll(everything);
    const kids = everything.filter((x) => x.parentId === issueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setDocs(list<Doc>(await pc.get(`/issues/${issueId}/documents`).catch(() => [])));
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
  const statusClass = issue?.status === "in_review" ? "good" : p?.bad ? "hot" : "";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${t("project")}详情`}>
        <header>
          <div className="line1">
            <span className="mono">
              {lead?.name ?? t("lead")} · {issue?.identifier ?? ""}
            </span>
            {issue && <span className={`status-tag ${statusClass}`}>{STATUS[issue.status] ?? issue.status}</span>}
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
                    {modelName(emp)} · {STATUS[kids[0]?.status ?? ""] ?? ""}
                  </div>
                </div>
                <Link to={`/agents/${emp.id}/runs`} onClick={onClose}>
                  运行记录
                  <ChevronRight size={14} aria-hidden="true" />
                </Link>
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
