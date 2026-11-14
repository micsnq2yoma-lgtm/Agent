import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { as, pc, type Context } from "../lib/api";
import { countByType, filterCards, type Card, type Filter } from "../lib/cards";
import { act, dismiss, loadDecisionOptions, snooze, type Feed } from "../lib/feed";
import { useSkin } from "../lib/skin";
import { Wordmark } from "../components/Brand";

type FrontdeskResult =
  | { route: "answer"; answer: { answer: string } }
  | { route: "task"; department: string | null; issue: { identifier: string; id: string } }
  | { route: "followup"; issue: { identifier: string } }
  | { route: "unclear"; title: string; description: string; external: string; candidates: string[] };

export function Composer({ ctx, onDone }: { ctx: Context; onDone: () => void }) {
  const { t } = useSkin();
  const [text, setText] = useState("");
  const [to, setTo] = useState("auto");
  const [external, setExternal] = useState<"ask" | "direct">(ctx.settings.externalDefault ?? "ask");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FrontdeskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const deptName = (key: string | null) => ctx.departments.find((d) => d.key === key)?.name ?? key ?? "";

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

  async function pick(dept: string) {
    if (result?.route !== "unclear") return;
    setBusy(true);
    try {
      const r = await as.post<FrontdeskResult>("/frontdesk/assign", { department: dept, title: result.title, description: result.description, external });
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
    <div className="composer">
      <textarea
        aria-label="交给团队一件事"
        placeholder="交给团队一件事"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="composer-bar">
        <select className="chip-select" aria-label="交给" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="auto">交给：{t("frontdesk")}自动分派</option>
          {ctx.departments
            .filter((d) => !d.archived)
            .map((d) => (
              <option key={d.key} value={`department:${d.key}`}>
                交给：{d.name}
              </option>
            ))}
          {ctx.agents
            .filter((a) => a.metadata?.agentself)
            .map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                交给：{a.name}（{a.metadata?.agentself?.departmentName}）
              </option>
            ))}
        </select>
        <select className="chip-select" aria-label="对外动作" value={external} onChange={(e) => setExternal(e.target.value as "ask" | "direct")}>
          <option value="ask">对外动作：先问我</option>
          <option value="direct">对外动作：直接做</option>
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? "处理中…" : "发送"}
        </button>
      </div>
      <div className="hint">
        即时问题{t("frontdesk")}直接回答；任务会派给对应{t("department")}的{t("lead")}，完成后以{t("card")}回到这里。Ctrl+Enter 发送。
      </div>
      {err && <div className="notice" style={{ color: "var(--as-high)" }}>{err}</div>}
      {result?.route === "answer" && <div className="notice">{result.answer.answer}</div>}
      {result?.route === "task" && (
        <div className="notice">
          已交给{deptName(result.department)}（{result.issue.identifier}），完成后会以{t("card")}回到这里。
        </div>
      )}
      {result?.route === "followup" && <div className="notice">已作为补充发给 {result.issue.identifier} 的负责人。</div>}
      {result?.route === "unclear" && (
        <div className="notice">
          判断不出该交给哪个{t("department")}，请选一个：
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {(result.candidates.length ? result.candidates : ctx.departments.map((d) => d.key)).map((k) => (
              <button key={k} className="btn" disabled={busy} onClick={() => void pick(k)}>
                {deptName(k)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TAG: Record<Card["type"], "decide" | "deliverable" | "instantAnswer"> = { decide: "decide", deliver: "deliverable", failed: "deliverable", answer: "instantAnswer" };

function CardTile({ card, open, onToggle, onPrimary, busy }: { card: Card; open: boolean; onToggle: () => void; onPrimary: () => void; busy: boolean }) {
  const { t } = useSkin();
  return (
    <div className={`card ${card.type} ${open ? "open" : ""}`}>
      <div className="card-meta">
        <span className={`tag ${card.type}`}>{card.type === "failed" ? "运行失败" : t(TAG[card.type])}</span>
        {card.model && <span className="model">{card.model}</span>}
        <span>{card.who}</span>
      </div>
      <div className="card-meta">{[card.department, card.ref].filter(Boolean).join(" · ") || (card.type === "answer" ? "即时问答" : "")}</div>
      <div className="card-title">{card.title}</div>
      <div className="card-actions">
        {card.type !== "answer" && card.type !== "failed" && (card.options.length > 0 || card.type === "deliver") ? (
          <button className="btn primary" disabled={busy} onClick={onPrimary}>
            {card.primary}
          </button>
        ) : card.type === "answer" ? (
          <button className="btn" disabled={busy} onClick={onPrimary}>
            {card.primary}
          </button>
        ) : null}
        <button className="btn ghost" onClick={onToggle}>
          {open ? "收起" : "展开"}
        </button>
      </div>
    </div>
  );
}

function CardDetail({ card, ctx, onAct, onOpenProject, busy }: { card: Card; ctx: Context; onAct: (opt: string, extra?: { comment?: string }) => void; onOpenProject: (issueId: string) => void; busy: boolean }) {
  const { t } = useSkin();
  const [report, setReport] = useState<string | null>(null);
  const [decisionOpts, setDecisionOpts] = useState<Array<{ id: string; label: string }>>([]);
  const [comment, setComment] = useState("");
  const [showRework, setShowRework] = useState(false);
  useEffect(() => {
    setReport(null);
    if (card.type === "deliver" && card.issueId) {
      pc.get<{ body?: string; markdown?: string; latestRevision?: { body?: string } }>(`/issues/${card.issueId}/documents/report`)
        .then((d) => setReport(d.body ?? d.markdown ?? d.latestRevision?.body ?? ""))
        .catch(() => setReport(""));
    }
    if (card.source.kind === "decision") loadDecisionOptions(card.source.decisionId).then((d) => setDecisionOpts(d.options)).catch(() => {});
  }, [card.id]);
  const options = card.source.kind === "decision" ? decisionOpts : card.options;
  const who = ctx.agents.find((a) => a.name === card.who);
  return (
    <div className="detail">
      <div className="who">
        <span>
          {card.who}
          {who?.title ? ` · ${who.title}` : ""}
          {card.department ? ` · ${card.department}` : ""}
        </span>
        {card.issueId && (
          <a href="#" onClick={(e) => (e.preventDefault(), onOpenProject(card.issueId!))}>
            打开{t("project")} {card.ref ?? ""}
          </a>
        )}
      </div>
      <h3 style={{ margin: "8px 0 0" }}>{card.title}</h3>
      {card.explain && <div className="explain">{card.explain}</div>}
      {card.type === "deliver" && (
        <div className="report">{report === null ? "加载汇报…" : report || `（${t("lead")}还没写 ${t("report")} 文档）`}</div>
      )}
      {card.type !== "answer" && (
        <div className="opts">
          {options
            .filter((o) => o.id !== "rework")
            .map((o, i) => (
              <button key={o.id} className={`btn ${i === 0 ? "primary" : ""}`} disabled={busy} onClick={() => onAct(o.id)}>
                {o.label}
              </button>
            ))}
          {card.type === "deliver" && (
            <button className="btn" disabled={busy} onClick={() => setShowRework((v) => !v)}>
              {t("rework")}
            </button>
          )}
        </div>
      )}
      {showRework && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="input" style={{ flex: 1 }} placeholder="哪里要改？" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn primary" disabled={busy} onClick={() => onAct("rework", { comment })}>
            发回{t("rework")}
          </button>
        </div>
      )}
      {card.ifNoReply && <div className="noreply">不回复：{card.ifNoReply}</div>}
    </div>
  );
}

export function Home(props: {
  ctx: Context;
  feed: Feed | null;
  reload: () => void;
  department: string | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  openProject: (issueId: string) => void;
  toast: (s: string) => void;
}) {
  const { t } = useSkin();
  const { ctx, feed } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cards = useMemo(() => filterCards(feed?.cards ?? [], props.filter, props.department), [feed, props.filter, props.department]);
  const counts = countByType(filterCards(feed?.cards ?? [], "all", props.department));

  async function run(card: Card, opt: string, extra?: { comment?: string }) {
    setBusy(true);
    try {
      await act(card, opt, extra);
      props.toast("已处理");
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
      props.reload();
    } catch (e) {
      props.toast(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const rows: React.JSX.Element[] = [];
  cards.forEach((c) => {
    rows.push(
      <CardTile
        key={c.id}
        card={c}
        busy={busy}
        open={openId === c.id}
        onToggle={() => setOpenId(openId === c.id ? null : c.id)}
        onPrimary={() => {
          if (c.type === "answer") return void run(c, "dismiss");
          if (c.type === "deliver") return void run(c, c.options[0]?.id ?? "done");
          if (c.options[0]) return void run(c, c.options[0].id);
          setOpenId(c.id);
        }}
      />,
    );
    if (openId === c.id)
      rows.push(
        <div key={`${c.id}-detail`} className="detail-wrap" style={{ gridColumn: "1 / -1" }}>
          <CardDetail card={c} ctx={ctx} busy={busy} onAct={(o, extra) => void run(c, o, extra)} onOpenProject={props.openProject} />
          {c.type !== "answer" && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="btn ghost" onClick={() => void later(c)}>
                稍后
              </button>
            </div>
          )}
        </div>,
      );
  });

  return (
    <div className="page">
      <div className="hero">
        <Wordmark size={40} />
        <div className="tagline">把注意力放在真正有价值的事情上</div>
        <div className="tagline-en">Put your attention on what truly matters.</div>
      </div>
      <Composer ctx={ctx} onDone={props.reload} />
      <div className="results-head">
        <h2>结果</h2>
        <span style={{ color: "var(--as-muted)" }}>{counts.all}</span>
        <div className="filters">
          {(
            [
              ["all", "全部", counts.all],
              ["decide", t("decide"), counts.decide],
              ["deliver", t("deliverable"), counts.deliver],
              ["answer", t("instantAnswer"), counts.answer],
            ] as Array<[Filter, string, number]>
          ).map(([f, label, n]) => (
            <button key={f} className={`filter ${props.filter === f ? "on" : ""}`} onClick={() => props.setFilter(f)}>
              {label} {f !== "all" ? n : ""}
            </button>
          ))}
        </div>
        {props.department && <span className="tag answer">只看：{props.department}</span>}
      </div>
      {feed === null ? <div className="empty">加载中…</div> : cards.length === 0 ? <div className="empty">没有要处理的{t("card")}，团队在干活。</div> : <div className="cards">{rows}</div>}
      {feed && feed.handled.length > 0 && (
        <details className="handled">
          <summary>已处理（{feed.handled.length}）</summary>
          <div className="cards" style={{ marginTop: 10 }}>
            {feed.handled.map((c) => (
              <div key={c.id} className={`card ${c.type}`} style={{ opacity: 0.7, minHeight: 0 }}>
                <div className="card-meta">
                  <span className={`tag ${c.type}`}>{t(TAG[c.type])}</span>
                  <span>{c.who}</span>
                  <span>{[c.department, c.ref].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="card-title">{c.title}</div>
                {c.issueId && (
                  <a href="#" onClick={(e) => (e.preventDefault(), props.openProject(c.issueId!))}>
                    打开
                  </a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
