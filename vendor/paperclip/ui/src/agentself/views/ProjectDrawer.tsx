import { useEffect, useState } from "react";
import { list, pc, type Context, type Issue } from "../lib/api";
import { useSkin } from "../lib/skin";
import { modelName } from "../components/Brand";
import { Link } from "@/lib/router";

const STATUS: Record<string, string> = {
  backlog: "排队",
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "完成",
  blocked: "等待中",
  cancelled: "已取消",
};

interface Doc {
  key: string;
  title?: string | null;
  body?: string;
  updatedAt?: string;
  createdByAgentId?: string | null;
}
interface Activity {
  id: string;
  action: string;
  createdAt: string;
  actorType?: string;
  actorId?: string;
  details?: Record<string, unknown>;
}
interface Comment {
  id: string;
  body: string;
  createdAt: string;
  authorAgentId?: string | null;
}

export function ProjectDrawer({ ctx, issueId, onClose, toast }: { ctx: Context; issueId: string; onClose: () => void; toast: (s: string) => void }) {
  const { t } = useSkin();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [children, setChildren] = useState<Issue[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Array<{ at: string; text: string }>>([]);
  const [reworks, setReworks] = useState<Record<string, number>>({});
  const [say, setSay] = useState("");
  const [sayTo, setSayTo] = useState<string>(issueId);
  const [busy, setBusy] = useState(false);

  const agentName = (id: string | null | undefined) => ctx.agents.find((a) => a.id === id)?.name ?? (id ? "系统" : "你");

  async function load() {
    const i = await pc.get<Issue>(`/issues/${issueId}`);
    setIssue(i);
    const all = list<Issue>(await pc.get(`/companies/${ctx.company!.id}/issues`));
    const kids = all.filter((x) => x.parentId === issueId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setChildren(kids);
    const d = list<Doc>(await pc.get(`/issues/${issueId}/documents`).catch(() => []));
    setDocs(d);
    try {
      const r = await pc.get<{ body?: string; latestRevision?: { body?: string } }>(`/issues/${issueId}/documents/report`);
      setReport(r.body ?? r.latestRevision?.body ?? "");
    } catch {
      setReport(null);
    }
    // timeline: comments on the top issue + status changes of children
    const comments = list<Comment>(await pc.get(`/issues/${issueId}/comments`).catch(() => []));
    const items = comments.map((c) => ({ at: c.createdAt, text: `${agentName(c.authorAgentId)}：${c.body.replace(/\s+/g, " ").slice(0, 140)}` }));
    const rw: Record<string, number> = {};
    for (const k of kids) {
      const acts = list<Activity>(await pc.get(`/issues/${k.id}/activity`).catch(() => []));
      for (const a of acts) {
        const prev = (a.details?._previous as { status?: string } | undefined)?.status;
        const next = a.details?.status as string | undefined;
        if (a.action === "issue.updated" && prev && next && prev !== next) {
          if ((prev === "in_review" || prev === "done") && (next === "in_progress" || next === "todo")) rw[k.id] = (rw[k.id] ?? 0) + 1;
          if (next === "done" || ((prev === "in_review" || prev === "done") && next === "in_progress"))
            items.push({
              at: a.createdAt,
              text: next === "done" ? `${agentName(k.assigneeAgentId)}完成「${k.title}」` : `「${k.title}」被退回${t("rework")}`,
            });
        }
      }
    }
    setReworks(rw);
    items.sort((a, b) => b.at.localeCompare(a.at));
    setTimeline(items.slice(0, 40));
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
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
  const dept = ctx.departments.find((d) => d.projectId === issue?.projectId);
  const doneCount = children.filter((c) => c.status === "done").length;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${t("project")}详情`}>
        <header>
          <button className="close-x" aria-label="关闭" onClick={onClose}>
            ×
          </button>
          <div style={{ fontSize: 12, color: "var(--as-muted)" }}>
            {issue?.identifier} · {STATUS[issue?.status ?? ""] ?? issue?.status}
            {children.length ? ` · ${doneCount}/${children.length}` : ""} · {dept?.name ?? ""}
          </div>
          <h2>{issue?.title ?? "加载中…"}</h2>
          <div style={{ fontSize: 13, color: "var(--as-muted)" }}>
            {t("lead")} {lead?.name ?? "—"} · {issue ? new Date(issue.createdAt).toLocaleString("zh-CN") : ""} 开始
          </div>
          {issue && (
            <div className="drawer-links">
              <Link to={`/issues/${issue.identifier ?? issue.id}`} onClick={onClose} data-testid="open-issue-page">
                完整页（运行记录、评论、文件）→
              </Link>
            </div>
          )}
        </header>
        <div className="body">
          {children.length > 0 && (
            <section>
              <h3>
                <span>{t("subtask")}</span>
                <span style={{ fontWeight: 400 }}>全部完成后才唤醒{t("lead")}汇总</span>
              </h3>
              {children.map((c, i) => {
                const a = ctx.agents.find((x) => x.id === c.assigneeAgentId);
                return (
                  <div key={c.id} className="subtask">
                    <span className="n">{i + 1}</span>
                    <div>
                      <div>
                        <Link to={`/issues/${c.identifier ?? c.id}`} onClick={onClose}>
                          {c.title}
                        </Link>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--as-muted)" }}>
                        {a?.name ?? "未分配"} · {modelName(a)}
                        {reworks[c.id] ? ` · ${t("rework")} ${reworks[c.id]}/3` : ""}
                      </div>
                    </div>
                    <span className={`st ${c.status}`}>{STATUS[c.status] ?? c.status}</span>
                  </div>
                );
              })}
            </section>
          )}
          <section>
            <h3>{t("report")}</h3>
            <div className="report" style={{ background: "var(--as-surface)", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 13 }}>
              {report === null ? `完成后由${lead?.name ?? t("lead")}写入` : report}
            </div>
          </section>
          {docs.length > 0 && (
            <section>
              <h3>文件</h3>
              {docs.map((d) => (
                <div key={d.key} style={{ fontSize: 13, padding: "4px 0" }}>
                  {d.key}.md <span style={{ color: "var(--as-muted)" }}>{d.title ?? ""}</span>
                </div>
              ))}
            </section>
          )}
          {issue?.description && (
            <section>
              <h3>任务说明</h3>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{issue.description}</div>
            </section>
          )}
          <section>
            <h3>时间线</h3>
            <ul className="timeline">
              {timeline.map((x, i) => (
                <li key={i}>
                  <time>{new Date(x.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                  {x.text}
                </li>
              ))}
              {timeline.length === 0 && <li style={{ color: "var(--as-muted)" }}>暂无</li>}
            </ul>
          </section>
        </div>
        <footer>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="插一句话" value={say} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
            <button className="btn primary" disabled={busy || !say.trim()} onClick={() => void send()}>
              发送
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--as-muted)" }}>
            <select className="chip-select" value={sayTo} onChange={(e) => setSayTo(e.target.value)} aria-label="发给">
              <option value={issueId}>发给：{lead?.name ?? t("lead")}（{t("lead")}）</option>
              {children
                .filter((c) => c.assigneeAgentId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    发给：{agentName(c.assigneeAgentId)}（{c.title.slice(0, 12)}）
                  </option>
                ))}
            </select>
            <span>会作为评论写进{t("project")}并唤醒对方</span>
            <span style={{ flex: 1 }} />
            {issue && !["done", "cancelled"].includes(issue.status) && (
              <>
                <button className="btn ghost" disabled={busy} onClick={() => void setStatus("backlog")}>
                  暂停{t("project")}
                </button>
                <button className="btn ghost danger" disabled={busy} onClick={() => confirm(`取消这个${t("project")}？`) && void setStatus("cancelled")}>
                  取消
                </button>
              </>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}
