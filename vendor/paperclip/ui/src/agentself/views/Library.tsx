// 论文库 (scripts/lib/library.mjs): a folder the user chooses; papers come in by arXiv id / link,
// DOI, PDF link or upload, get their text extracted, and are searched by the user and the agents.
import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { as } from "../lib/api";
import { relTime } from "../lib/cards";
import { Skeleton } from "../components/Skeleton";

export interface PaperBrief {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  tags: string[];
  status: string;
  arxivId?: string | null;
  doi?: string | null;
  addedAt?: string;
  passage?: string;
  fulltext?: { status: string; source?: string; chars?: number; note?: string };
}
interface Paper extends PaperBrief {
  abstract: string;
  notes: string;
  hasPdf: boolean;
  pdfPath: string | null;
  url?: string;
  addedBy?: string;
  fulltextChars: number;
}
export interface LibraryStats {
  root: string;
  defaultRoot: string;
  papers: number;
  unread: number;
  needsText: number;
  tags: string[];
}

export const PAPER_STATUS: Record<string, string> = { unread: "未读", reading: "在读", read: "已读", skipped: "不看" };
const API = "/agentself/api/library";

async function upload(file: File, tags: string[]) {
  const r = await fetch(`${API}/upload?name=${encodeURIComponent(file.name)}&tags=${encodeURIComponent(tags.join(","))}`, { method: "POST", headers: { "content-type": "application/pdf" }, body: file });
  const t = await r.text();
  const j = t ? JSON.parse(t) : {};
  if (!r.ok) throw new Error(j.error ?? `${r.status}`);
  return j as { paper: Paper; existed: boolean };
}

export function LibraryView({ toast }: { toast: (s: string) => void }) {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [rows, setRows] = useState<PaperBrief[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (query = q) => {
    const params = new URLSearchParams({ ...(query.trim() ? { q: query } : {}), ...(status ? { status } : {}), ...(tag ? { tag } : {}) });
    const [s, r] = await Promise.all([as.get<LibraryStats>("/library/settings"), as.get<{ results: PaperBrief[] }>(`/library/papers?${params}`)]);
    setStats(s);
    setRows(r.results);
  };
  useEffect(() => {
    void load().catch((e) => toast(String(e)));
  }, [status, tag]);

  async function add() {
    if (!ref.trim()) return;
    setBusy(true);
    try {
      const r = await as.post<{ paper: Paper; existed: boolean }>("/library/papers", { ref, tags: tag ? [tag] : [] });
      toast(r.existed ? `已经在库里：${r.paper.title}` : `已收进论文库：${r.paper.title}`);
      setRef("");
      await load();
      setOpenId(r.paper.id);
    } catch (e) {
      toast(`没收进来：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    let n = 0;
    for (const f of Array.from(files)) {
      if (!/\.pdf$/i.test(f.name)) {
        toast(`跳过 ${f.name}：只收 PDF`);
        continue;
      }
      try {
        const r = await upload(f, tag ? [tag] : []);
        if (!r.existed) n++;
      } catch (e) {
        toast(`${f.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    toast(n ? `收进 ${n} 篇` : "没有新论文");
    await load();
  }

  return (
    <div
      className={`page library ${drag ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <h1 className="page-title">论文库</h1>
      <div className="sub" style={{ marginBottom: 14 }}>
        {stats ? (
          <>
            {stats.papers} 篇 · 未读 {stats.unread}
            {stats.needsText ? ` · ${stats.needsText} 篇待员工补全文` : ""} · 存放在 <span className="mono">{stats.root}</span>（在 设置 → 论文库 里改）
          </>
        ) : (
          "…"
        )}
      </div>

      <div className="section">
        <div className="lib-add">
          <input className="input" style={{ flex: 1 }} placeholder="arXiv 编号或链接、DOI、PDF 链接" value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void add()} aria-label="添加论文" />
          <button className="btn primary" disabled={busy || !ref.trim()} onClick={() => void add()}>
            <Plus aria-hidden="true" />
            {busy ? "处理中…" : "收进来"}
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" />
            上传 PDF
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        </div>
        <div className="sub" style={{ marginTop: 6 }}>也可以把 PDF 直接拖进这个页面。员工盯新论文时会先查这里，读过的不再推荐。</div>
      </div>

      <div className="lib-filters">
        <span className="search-pill" style={{ flex: 1 }}>
          <Search aria-hidden="true" />
          <input placeholder="搜标题、作者、摘要、笔记、全文" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load(q)} aria-label="检索论文库" />
          {q && (
            <button className="icon-btn xs plain" aria-label="清空" onClick={() => (setQ(""), void load(""))}>
              <X />
            </button>
          )}
        </span>
        <select className="input" style={{ width: 110 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="阅读状态">
          <option value="">全部状态</option>
          {Object.entries(PAPER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 130 }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="标签">
          <option value="">全部标签</option>
          {(stats?.tags ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {rows === null ? (
        <Skeleton lines={4} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <b>{q ? "没找到" : "论文库还是空的"}</b>
          <span>{q ? "换个说法试试，中文英文都可以。" : "贴一个 arXiv 链接，或者把 PDF 拖进来。"}</span>
        </div>
      ) : (
        <div className="lib-list">
          {rows.map((p) => (
            <button key={p.id} type="button" className={`lib-row ${openId === p.id ? "on" : ""}`} onClick={() => setOpenId(p.id)}>
              <span className="lib-title">{p.title}</span>
              <span className="lib-meta">
                {[p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " 等" : ""), p.year, p.venue].filter(Boolean).join(" · ")}
              </span>
              {p.passage && <span className="lib-passage">{p.passage}</span>}
              <span className="lib-chips">
                <span className={`status-tag ${p.status === "unread" ? "" : "good"}`}>{PAPER_STATUS[p.status] ?? p.status}</span>
                {p.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
                {p.fulltext?.status === "needs_agent" && <span className="chip">待补全文</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {openId && <PaperPanel id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} toast={toast} />}
    </div>
  );
}

function PaperPanel({ id, onClose, onChanged, toast }: { id: string; onClose: () => void; onChanged: () => void; toast: (s: string) => void }) {
  const [p, setP] = useState<Paper | null>(null);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const load = () =>
    as.get<Paper>(`/library/papers/${id}`).then((x) => {
      setP(x);
      setNotes(x.notes);
      setTags(x.tags.join(", "));
    });
  useEffect(() => void load().catch((e) => toast(String(e))), [id]);
  async function patch(body: Record<string, unknown>) {
    await as.put(`/library/papers/${id}`, body);
    await load();
    onChanged();
  }
  if (!p)
    return (
      <aside className="drawer lib-panel" aria-label="论文详情">
        <Skeleton lines={6} />
      </aside>
    );
  const link = p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : p.doi ? `https://doi.org/${p.doi}` : p.url;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer lib-panel" role="dialog" aria-label="论文详情">
        <header>
          <div className="line1">
            <span className="mono">{p.arxivId ? `arXiv ${p.arxivId}` : p.doi ? `DOI ${p.doi}` : "PDF"}</span>
            <span className="grow" />
            <button className="icon-btn sm surface" aria-label="关闭" onClick={onClose}>
              <X />
            </button>
          </div>
          <h2>{p.title}</h2>
          <div className="sub">{[p.authors.join(", "), p.year, p.venue].filter(Boolean).join(" · ")}</div>
          <div className="drawer-links">
            {p.hasPdf && (
              <a href={`${API}/papers/${id}/pdf`} target="_blank" rel="noreferrer">
                <FileText size={14} aria-hidden="true" /> 打开 PDF
              </a>
            )}
            {link && (
              <a href={link} target="_blank" rel="noreferrer">
                原文页面
              </a>
            )}
          </div>
        </header>
        <div className="body">
          <section>
            <h3>状态</h3>
            <div className="row">
              <select className="input" style={{ width: 120 }} value={p.status} onChange={(e) => void patch({ status: e.target.value })} aria-label="阅读状态">
                {Object.entries(PAPER_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input className="input" style={{ flex: 1 }} value={tags} placeholder="标签，逗号分隔" onChange={(e) => setTags(e.target.value)} onBlur={() => void patch({ tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) })} aria-label="标签" />
            </div>
            <div className="sub">
              {p.addedBy ? `${p.addedBy}收入` : ""}
              {p.addedAt ? ` · ${relTime(p.addedAt)}` : ""} ·{" "}
              {p.fulltext?.status === "ok" ? `全文 ${p.fulltextChars.toLocaleString()} 字（${p.fulltext.source === "arxiv-html" ? "arXiv HTML" : p.fulltext.source === "agent" ? "员工补的" : "PDF"}）` : p.fulltext?.status === "needs_agent" ? "PDF 里抽不出文字，让员工读一遍补上" : "没有全文"}
            </div>
          </section>
          {p.abstract && (
            <section>
              <h3>摘要</h3>
              <p className="lib-abstract">{p.abstract}</p>
            </section>
          )}
          <section>
            <h3>
              <span>笔记</span>
              <span className="grow" />
              <button className="btn xs primary" disabled={notes === p.notes} onClick={() => void as.put(`/library/papers/${id}/notes`, { text: notes, mode: "replace" }).then(() => (toast("已保存"), load()))}>
                保存
              </button>
            </h3>
            <textarea className="input" style={{ minHeight: 220 }} value={notes} placeholder="读后的要点、和课题的关系、能不能用……员工的笔记也写在这里" onChange={(e) => setNotes(e.target.value)} aria-label="笔记" />
          </section>
          {p.pdfPath && <div className="sub mono">{p.pdfPath}</div>}
        </div>
        <footer>
          <div className="under">
            <button
              className="btn danger xs"
              onClick={() =>
                confirm(`从论文库删除「${p.title}」？PDF 和笔记也会删掉。`) &&
                void as.del(`/library/papers/${id}`).then(() => {
                  toast("已删除");
                  onChanged();
                  onClose();
                })
              }
            >
              <Trash2 aria-hidden="true" /> 删除
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

/** 设置 → 论文库：存放位置（可以放在任意盘），换位置时可以把已有论文一起搬过去。 */
export function LibrarySettings() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [root, setRoot] = useState("");
  const [move, setMove] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    as.get<LibraryStats>("/library/settings").then((s) => {
      setStats(s);
      setRoot(s.root);
    });
  }, []);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await as.put<LibraryStats & { moved: number }>("/library/settings", { root, move });
      setStats(r);
      setRoot(r.root);
      setMsg(move ? `已换到新位置，搬过去 ${r.moved} 篇。` : `已换到新位置（那里现有 ${r.papers} 篇）。`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section">
      <h2>论文库</h2>
      <p className="hint">论文库就是一个普通文件夹：每篇论文一个子文件夹，里面是 PDF、抽出的全文、元数据和笔记。可以放在任意盘（比如 D:\Papers），也可以放进同步盘自己备份。员工和主管都从这里检索。</p>
      <label className="field">
        存放位置
        <input className="input mono" value={root} onChange={(e) => setRoot(e.target.value)} placeholder={stats?.defaultRoot} />
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 8 }}>
        <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> 把现有的 {stats?.papers ?? 0} 篇论文一起搬过去（不勾就直接用新位置里已有的论文库）
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !root.trim() || root === stats?.root} onClick={() => void save()}>
          {busy ? "处理中…" : "换到这里"}
        </button>
        {stats && root !== stats.defaultRoot && (
          <button className="btn ghost" onClick={() => setRoot(stats.defaultRoot)}>
            用默认位置
          </button>
        )}
      </div>
      {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
