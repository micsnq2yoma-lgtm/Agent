import type React from "react";
// Workbench (DESIGN §2, §4.4–4.8): the three blocks of v0.6 — the input box (fixed at the bottom),
// "待你处理" cards (middle) and the task progress panel (right, grouped by lead).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, Clock, ExternalLink, Pencil, Route, Shield, SlidersHorizontal, TriangleAlert, X, Zap } from "lucide-react";
import { as, pc, type Context, type Issue } from "../lib/api";
import { FRONTDESK, LEAD, countByType, filterCards, relTime, type Card, type Filter } from "../lib/cards";
import { act, dismiss, loadDecisionOptions, snooze, type Feed } from "../lib/feed";
import { loadAcceptance, VERDICT_TEXT, type Acceptance } from "../lib/acceptance";
import { leadOf, progressOf, STAGE_NAMES, type Progress } from "../lib/progress";
import { useSkin } from "../lib/skin";
import { PackIcon } from "../lib/icons";
import { Robot, Wordmark, eyeOf } from "../components/Brand";
import { useDialogActions } from "@/context/DialogContext";
import { SourceSelect } from "../components/SourceSelect";

/** 高级 (P10): opens the full Paperclip new-task form, prefilled with the chosen lead. */
function AdvancedNew({ ctx, to }: { ctx: Context; to: string }) {
  const { openNewIssue } = useDialogActions();
  const agentId = to.startsWith("lead:") ? to.slice(5) : undefined;
  const lead = ctx.agents.find((a) => a.id === agentId);
  const projectId = ctx.departments.find((d) => d.key === lead?.metadata?.agenteam?.department)?.projectId ?? undefined;
  return (
    <button
      type="button"
      className="btn ghost sm"
      title="打开完整的新建任务表单（指定负责人、项目、优先级、附件等）"
      onClick={() => openNewIssue({ ...(agentId ? { assigneeAgentId: agentId } : {}), ...(projectId ? { projectId } : {}), navigateOnCreate: true })}
    >
      <SlidersHorizontal aria-hidden="true" />
      高级
    </button>
  );
}

type FrontdeskResult =
  | { route: "answer"; answer: { answer: string } }
  | { route: "task"; department: string | null; assigneeName?: string | null; issue: { identifier: string; id: string } }
  | { route: "followup"; assigneeName?: string | null; issue: { identifier: string } }
  | { route: "unclear"; title: string; description: string; external: string; candidates: string[] };

function ChipSelect({ icon, label, value, onChange, children }: { icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <span className="chip-select-wrap">
      {icon}
      <select className="chip-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" />
    </span>
  );
}

export function Composer({ ctx, onDone }: { ctx: Context; onDone: () => void }) {
  const { t } = useSkin();
  const [text, setText] = useState("");
  const [to, setTo] = useState("auto");
  const [external, setExternal] = useState<"ask" | "direct">(ctx.settings.externalDefault ?? "ask");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FrontdeskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const deptName = (key: string | null) => ctx.departments.find((d) => d.key === key)?.name ?? key ?? "";
  // Plan B: everything from the input box goes to a lead; employees only get work from their lead.
  const leads = ctx.agents.filter((a) => a.metadata?.agenteam?.isLead);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const [kind, id] = to.split(":");
      const body = { text, external, to: kind === "auto" ? { kind: "auto" } : { kind, id } };
      const r = await as.post<FrontdeskResult>("/frontdesk", body);
      setResult(r);
      if (r.route !== "unclear") setText("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(agentId: string) {
    if (result?.route !== "unclear") return;
    setBusy(true);
    try {
      const r = await as.post<FrontdeskResult>("/frontdesk/assign", { agentId, title: result.title, description: result.description, external });
      setResult(r);
      setText("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {err && <div className="notice" style={{ color: "var(--as-high)", marginBottom: 10 }}>{err}</div>}
      {result?.route === "answer" && <div className="notice" style={{ marginBottom: 10 }}>{result.answer.answer}</div>}
      {result?.route === "task" && (
        <div className="notice" style={{ marginBottom: 10 }}>
          已交给{result.assigneeName ?? deptName(result.department)}（{result.issue.identifier}），完成后会回到"待你处理"。
        </div>
      )}
      {result?.route === "followup" && (
        <div className="notice" style={{ marginBottom: 10 }}>
          已作为补充发给 {result.issue.identifier} 的{result.assigneeName ?? t("lead")}。
        </div>
      )}
      {result?.route === "unclear" && (
        <div className="notice" style={{ marginBottom: 10 }}>
          判断不出该交给哪位{t("lead")}，请选一位：
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {(result.candidates.length ? result.candidates : leads.map((a) => a.id)).map((k) => (
              <button key={k} className="btn sm" disabled={busy} onClick={() => void pick(k)}>
                {leads.find((a) => a.id === k)?.name ?? k}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="composer">
        <div className="composer-input">
          <Zap aria-hidden="true" />
          <textarea
            aria-label="交给团队一件事"
            placeholder="交给团队一件事，说完就可以离开"
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <div className="composer-bar">
          <ChipSelect icon={<Route aria-hidden="true" />} label="交给" value={to} onChange={setTo}>
            <option value="auto">交给：自动选{t("lead")}</option>
            {leads.map((a) => (
              <option key={a.id} value={`lead:${a.id}`}>
                交给：{a.name}
              </option>
            ))}
          </ChipSelect>
          <ChipSelect icon={<Shield aria-hidden="true" />} label="对外动作" value={external} onChange={(v) => setExternal(v as "ask" | "direct")}>
            <option value="ask">对外动作：先问我</option>
            <option value="direct">对外动作：直接做</option>
          </ChipSelect>
          <AdvancedNew ctx={ctx} to={to} />
          <span style={{ flex: 1 }} />
          <button className="icon-btn send" aria-label="发送" disabled={busy || !text.trim()} onClick={() => void send()}>
            <ArrowUp />
          </button>
        </div>
      </div>
      <div className="hint">即时问题直接回答；任务交给{t("lead")}理解、派活、验收后汇报，大事会先给你计划。回车发送，Shift+回车换行。</div>
    </div>
  );
}

/* ---------------- cards (§4.6) ---------------- */

export function whoLabel(who: string, t: (k: "frontdesk" | "lead") => string) {
  return who === FRONTDESK ? t("frontdesk") : who === LEAD ? t("lead") : who;
}

function kindLabel(card: Card, t: ReturnType<typeof useSkin>["t"]) {
  if (card.type === "failed") return "运行失败";
  if (card.type === "hire") return "新建员工";
  if (card.type === "notice") return "通知";
  return t(card.type === "decide" ? "decide" : card.type === "deliver" ? "deliverable" : "instantAnswer");
}

function cardSub(card: Card, t: ReturnType<typeof useSkin>["t"], passed?: string) {
  if (card.type === "answer") return `${t("frontdesk")}直接回答`;
  if (card.source.kind === "hire") return `${card.source.capabilities} · ${card.source.adapterType === "codex_local" ? "Codex" : "Claude"}`;
  return [whoLabel(card.who, t), card.ref, passed].filter(Boolean).join(" · ");
}

/** CSS class for a card type. `notice` would clash with the composer's `.notice` answer box. */
const cardClass = (type: Card["type"]) => (type === "notice" ? "notify" : type);

function CardTile({ card, open, onToggle, passed }: { card: Card; open: boolean; onToggle: () => void; passed?: string }) {
  const { t } = useSkin();
  return (
    <button type="button" className={`card ${cardClass(card.type)} ${open ? "open" : ""}`} aria-expanded={open} onClick={onToggle}>
      <span className="card-head">
        <span className="card-kind">{kindLabel(card, t)}</span>
        <span className="card-time">{relTime(card.createdAt)}</span>
      </span>
      <span className="card-title">{card.title}</span>
      <span className="card-sub">{cardSub(card, t, passed)}</span>
    </button>
  );
}

function CardDetail(props: {
  card: Card;
  ctx: Context;
  issues: Issue[];
  busy: boolean;
  onAct: (opt: string, extra?: { comment?: string; name?: string; source?: string; remember?: string }) => void;
  onLater: () => void;
  onClose: () => void;
  onOpenProject: (issueId: string) => void;
}) {
  const { card, ctx } = props;
  const { t } = useSkin();
  const [report, setReport] = useState<string | null>(null);
  const [acc, setAcc] = useState<Acceptance | null>(null);
  const [decisionOpts, setDecisionOpts] = useState<Array<{ id: string; label: string }>>([]);
  const [comment, setComment] = useState("");
  const [showRework, setShowRework] = useState(false);
  const [remember, setRemember] = useState(false);
  const [hireName, setHireName] = useState(card.source.kind === "hire" ? card.source.name : "");
  const [hireSource, setHireSource] = useState(card.source.kind === "hire" && card.source.adapterType === "codex_local" ? "codex" : "claude");
  useEffect(() => {
    setReport(null);
    setAcc(null);
    if (card.type === "deliver" && card.issueId) {
      pc.get<{ body?: string; markdown?: string; latestRevision?: { body?: string } }>(`/issues/${card.issueId}/documents/report`)
        .then((d) => setReport(d.body ?? d.markdown ?? d.latestRevision?.body ?? ""))
        .catch(() => setReport(""));
      const kids = props.issues.filter((i) => i.parentId === card.issueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      loadAcceptance(card.issueId, kids[0]?.id ?? null).then(setAcc).catch(() => {});
    }
    if (card.source.kind === "decision") loadDecisionOptions(card.source.decisionId).then((d) => setDecisionOpts(d.options)).catch(() => {});
  }, [card.id]);
  const options = card.source.kind === "decision" ? decisionOpts : card.options;
  const agent = ctx.agents.find((a) => a.name === card.who);
  const meta = [whoLabel(card.who, t), card.model ?? (agent ? (agent.adapterType === "codex_local" ? "Codex" : agent.adapterConfig?.model ?? "Claude") : null), card.ref, relTime(card.createdAt)].filter(Boolean).join(" · ");
  const dot = card.type === "decide" || card.type === "failed" || card.type === "hire";
  const act = (o: { id: string; label: string }) =>
    props.onAct(o.id, { comment, name: hireName, ...(card.type === "hire" ? { source: hireSource } : {}), remember: remember ? `「${card.title}」这类事：${o.label}` : undefined });

  return (
    <div className="detail">
      <div className="who">
        <span className={`kind ${dot ? "dot" : ""}`}>{kindLabel(card, t)}</span>
        <span className="meta">{meta}</span>
        <span className="grow" />
        {card.issueId && (
          <a href="#" onClick={(e) => (e.preventDefault(), props.onOpenProject(card.issueId!))}>
            打开{t("project")}
            <ChevronRight aria-hidden="true" />
          </a>
        )}
        <button className="icon-btn xs plain" aria-label="收起" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <h3>{card.title}</h3>
      {card.source.kind === "hire" ? (
        <div className="explain">
          负责：{card.source.capabilities}（{card.source.adapterType === "codex_local" ? "Codex" : "Claude"}）
          {card.source.reason ? `\n理由：${card.source.reason}` : ""}
        </div>
      ) : (
        card.explain && <div className="explain">{card.explain}</div>
      )}

      {acc && acc.rows.length > 0 && (
        <div className="verdicts" aria-label="验收摘要">
          {acc.rows.map((r) => (
            <div key={r.id} className="verdict">
              <span className="cid">{r.id}</span>
              <span>{r.text}</span>
              <span className={`vtag ${r.verdict ?? ""}`}>{r.verdict ? VERDICT_TEXT[r.verdict] : "未核查"}</span>
            </div>
          ))}
        </div>
      )}
      {card.type === "deliver" && <div className="report">{report === null ? "加载汇报…" : report || `（${t("lead")}还没写${t("report")}）`}</div>}

      {card.type === "hire" && (
        <div className="rework-row">
          <input className="input" style={{ flex: 1 }} aria-label="新员工的名字" value={hireName} onChange={(e) => setHireName(e.target.value)} />
          <SourceSelect value={hireSource} onChange={setHireSource} label="新员工的模型来源" style={{ width: 190 }} />
        </div>
      )}
      {card.type !== "answer" && (
        <div className="opts">
          {options
            .filter((o) => o.id !== "rework")
            .map((o, i) => (
              <button key={o.id} className={`btn sm ${i === 0 ? "primary" : ""}`} disabled={props.busy} onClick={() => act(o)}>
                {o.label}
              </button>
            ))}
          {card.type === "deliver" && (
            <button className="btn ghost sm" disabled={props.busy} onClick={() => setShowRework((v) => !v)}>
              <Pencil aria-hidden="true" />
              {t("rework")}
            </button>
          )}
          <span className="grow" />
          {card.type !== "hire" && card.type !== "notice" && (
            <button className="btn ghost sm" onClick={props.onLater}>
              <Clock aria-hidden="true" />
              稍后提醒
            </button>
          )}
        </div>
      )}
      {card.type === "answer" && (
        <div className="opts">
          <button className="btn sm primary" disabled={props.busy} onClick={() => props.onAct("dismiss")}>
            {card.primary}
          </button>
        </div>
      )}
      {showRework && (
        <div className="rework-row">
          <input className="input" style={{ flex: 1 }} placeholder="哪里要改？" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn primary sm" disabled={props.busy} onClick={() => props.onAct("rework", { comment })}>
            发回{t("rework")}
          </button>
        </div>
      )}
      {(card.ifNoReply || card.type === "decide") && (
        <div className="foot">
          <span>{card.ifNoReply ? `不回复：${card.ifNoReply}` : ""}</span>
          <span className="grow" />
          {card.type === "decide" && (
            <label>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              以后同类直接这样做
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- task progress (§4.8) ---------------- */

export function Stages({ p, large }: { p: Pick<Progress, "stage" | "bad">; large?: boolean }) {
  return (
    <span className={`stages ${large ? "lg" : ""}`} role="img" aria-label={`阶段：${STAGE_NAMES[p.stage]}`}>
      {STAGE_NAMES.map((_, i) => (
        <i key={i} className={i < p.stage ? "done" : i === p.stage && p.bad ? "bad" : i === p.stage ? "done" : ""} />
      ))}
    </span>
  );
}

export function ProgressPanel({ ctx, feed, openProject, onAll }: { ctx: Context; feed: Feed | null; openProject: (id: string) => void; onAll: () => void }) {
  const { t } = useSkin();
  const issues = feed?.issues ?? [];
  const tops = issues.filter((i) => !i.parentId && !["done", "cancelled", "backlog"].includes(i.status));
  const groups = new Map<string, Issue[]>();
  for (const i of tops) {
    const lead = leadOf(ctx, i);
    const key = lead?.id ?? "_";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return (
    <aside className="progress" aria-label="任务进展">
      <h2>任务进展</h2>
      <div className="legend">{STAGE_NAMES.join(" · ")}</div>
      {tops.length === 0 && <div className="sub" style={{ padding: "12px 0" }}>没有进行中的{t("project")}。</div>}
      {[...groups.entries()].map(([leadId, list]) => {
        const lead = ctx.agents.find((a) => a.id === leadId);
        const dept = ctx.departments.find((d) => d.leadAgentId === leadId);
        return (
          <section key={leadId}>
            <div className="group-head">
              <span className="ico">
                <PackIcon name={dept?.icon} size={16} />
              </span>
              <b>{lead?.name ?? "未分配"}</b>
              <span>{list.length} 项</span>
            </div>
            {list.map((top) => {
              const p = progressOf(top, issues, feed?.cards ?? []);
              const emp = ctx.agents.find((a) => a.id === p.employeeId);
              return (
                <button key={top.id} className="row-link" onClick={() => openProject(top.id)}>
                  <span className="r1">
                    <span className="mono">{top.identifier}</span>
                    <Stages p={p} />
                  </span>
                  <span className="r2">{top.title}</span>
                  <span className="r3">
                    {emp ? (
                      <>
                        <Robot id={emp.id} eye={eyeOf(emp.adapterType, emp.adapterConfig?.model)} size={22} />
                        <span>{emp.name}</span>
                      </>
                    ) : (
                      <span>{t("lead")}处理中</span>
                    )}
                    <span className={`status ${p.bad ? "hot" : ""}`}>
                      {p.bad && <TriangleAlert aria-hidden="true" />}
                      {p.text}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
      <div className="footer">
        <button className="btn primary sm" onClick={onAll}>
          查看全部{t("project")}
        </button>
      </div>
    </aside>
  );
}

/* ---------------- workbench ---------------- */

export function Home(props: {
  ctx: Context;
  feed: Feed | null;
  reload: () => void;
  department: string | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  openProject: (issueId: string) => void;
  openAllProjects?: () => void;
  toast: (s: string) => void;
}) {
  const { t } = useSkin();
  const { ctx, feed } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  // keep the opened detail clear of the fixed composer (scroll-margin-bottom in styles.css);
  // only when a card is opened, not on every feed refresh
  const detailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openId) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [openId]);
  const cards = useMemo(() => filterCards(feed?.cards ?? [], props.filter, props.department), [feed, props.filter, props.department]);
  const counts = countByType(filterCards(feed?.cards ?? [], "all", props.department));

  async function run(card: Card, opt: string, extra?: { comment?: string; name?: string; source?: string; remember?: string }) {
    setBusy(true);
    try {
      await act(card, opt, extra);
      if (extra?.remember) await as.post("/profile/decisions", { kind: "decision", text: extra.remember, scope: card.department ?? "", source: card.ref ?? card.title }).catch(() => {});
      props.toast(extra?.remember ? "已处理，以后同类直接这样做" : "已处理");
      setOpenId(null);
      props.reload();
    } catch (e) {
      props.toast(`处理失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function later(card: Card) {
    if (!ctx.company) return;
    const until = new Date(Date.now() + 3 * 3600_000);
    try {
      const r = await snooze(card, ctx.company.id, until);
      if (r === null) await dismiss(card, ctx.company.id);
      props.toast(r === null ? "已收起" : "3 小时后再提醒你");
      setOpenId(null);
      props.reload();
    } catch (e) {
      props.toast(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const rows: React.JSX.Element[] = [];

  // The clicked card opens in place across the whole row (DESIGN §4.5); the others keep flowing.
  for (const c of cards) {
    if (openId !== c.id) rows.push(<CardTile key={c.id} card={c} open={false} onToggle={() => setOpenId(c.id)} />);
    else
      rows.push(
        <div key={`${c.id}-detail`} className="detail-wrap" ref={detailRef}>
          <CardDetail
            card={c}
            ctx={ctx}
            issues={feed?.issues ?? []}
            busy={busy}
            onAct={(o, extra) => void run(c, o, extra)}
            onLater={() => void later(c)}
            onClose={() => setOpenId(null)}
            onOpenProject={props.openProject}
          />
        </div>,
      );
  }

  const filters: Array<[Filter, string, number | null]> = [
    ["all", "全部", null],
    ["decide", t("decide"), counts.decide],
    ["deliver", t("deliverable"), counts.deliver],
    ["answer", t("instantAnswer"), counts.answer],
  ];

  return (
    <div className="workbench">
      <div className="workbench-main">
        <div className="hero">
          <Wordmark size={56} />
          <div className="tagline-en">Focus your attention on valuable things.</div>
        </div>
        <div className="results-head">
          <div className="filters" role="tablist" aria-label="筛选">
            {filters.map(([f, label, n]) => (
              <button key={f} role="tab" aria-selected={props.filter === f} className={`filter ${props.filter === f ? "on" : ""}`} onClick={() => props.setFilter(f)}>
                {label}
                {n !== null && <span className="n">{n}</span>}
              </button>
            ))}
          </div>
          {props.department && <span className="chip">只看：{props.department}</span>}
          {feed && feed.handled.length > 0 && (
            <button className="handled-link" onClick={() => setShowHandled((v) => !v)} aria-expanded={showHandled}>
              已处理 {feed.handled.length}
              {showHandled ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
          )}
        </div>
        {feed === null ? (
          <div className="cards" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card" style={{ cursor: "default" }}>
                <div className="skeleton">
                  <span style={{ width: "40%" }} />
                  <span style={{ width: "85%", marginTop: 24 }} />
                  <span style={{ width: "55%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="empty">
            <b>没有要你处理的事，团队在干活。</b>
            <span>有需要你拍板或验收的事，会出现在这里。</span>
          </div>
        ) : (
          <div className="cards" id="results">
            {rows}
          </div>
        )}
        {showHandled && feed && (
          <div className="cards" style={{ marginTop: 14 }}>
            {feed.handled.map((c) => (
              <button key={c.id} type="button" className={`card handled ${cardClass(c.type)}`} onClick={() => c.issueId && props.openProject(c.issueId)}>
                <span className="card-head">
                  <span className="card-kind">{kindLabel(c, t)}</span>
                  <span className="card-time">{relTime(c.createdAt)}</span>
                </span>
                <span className="card-title">{c.title}</span>
                <span className="card-sub">
                  {cardSub(c, t)}
                  {c.issueId && <ExternalLink size={12} style={{ marginLeft: 6, verticalAlign: -1 }} aria-hidden="true" />}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-dock">
          <Composer ctx={ctx} onDone={props.reload} />
        </div>
      </div>
      <ProgressPanel ctx={ctx} feed={feed} openProject={props.openProject} onAll={props.openAllProjects ?? (() => {})} />
    </div>
  );
}
