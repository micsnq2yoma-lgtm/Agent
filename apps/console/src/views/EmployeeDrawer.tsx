import { useEffect, useState } from "react";
import { as, list, pc, type Agent, type Context } from "../lib/api";
import { useSkin } from "../lib/skin";
import { Robot, eyeOf, modelName } from "../components/Brand";

interface MemoryFile {
  path: string;
  size: number;
  updatedAt: string;
}

export function EmployeeDrawer({ ctx, agentId, onClose, toast }: { ctx: Context; agentId: string; onClose: () => void; toast: (s: string) => void }) {
  const { t } = useSkin();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setAgent(await pc.get<Agent>(`/agents/${agentId}`));
      const s = await pc.get<{ desiredSkills?: string[] }>(`/agents/${agentId}/skills`).catch(() => ({ desiredSkills: [] }));
      setSkills((s.desiredSkills ?? []).map((k) => k.split("/").pop() ?? k));
      setFiles(list<MemoryFile>(await as.get(`/memory/${agentId}`).catch(() => [])));
    })();
  }, [agentId]);

  async function openFile(p: string) {
    const r = await as.get<{ text: string }>(`/memory/${agentId}/file?path=${encodeURIComponent(p)}`);
    setOpen({ path: p, text: r.text });
  }
  async function saveFile() {
    if (!open) return;
    setBusy(true);
    try {
      await as.put(`/memory/${agentId}/file?path=${encodeURIComponent(open.path)}`, { text: open.text });
      toast("已保存（已提交到记忆的 git 历史）");
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function togglePause() {
    if (!agent) return;
    setBusy(true);
    try {
      await pc.post(`/agents/${agent.id}/${agent.status === "paused" ? "resume" : "pause"}`, {});
      setAgent(await pc.get<Agent>(`/agents/${agentId}`));
    } catch (e) {
      toast(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const m = agent?.metadata?.agentself;
  const lead = ctx.agents.find((a) => a.id === agent?.reportsTo);
  const spent = (agent?.spentMonthlyCents ?? 0) / 100;
  const budget = (agent?.budgetMonthlyCents ?? 0) / 100;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${t("employee")}档案`}>
        <header>
          <button className="close-x" aria-label="关闭" onClick={onClose}>
            ×
          </button>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Robot id={agentId} eye={eyeOf(agent?.adapterType)} size={44} grey={agent?.status === "paused"} />
            <div>
              <h2>{agent?.name ?? "…"}</h2>
              <div style={{ fontSize: 13, color: "var(--as-muted)" }}>
                {m?.isLead ? t("lead") : agent?.title} · {m?.departmentName ?? ""} · {modelName(agent ?? undefined)}
              </div>
            </div>
          </div>
        </header>
        <div className="body">
          <section>
            <h3>档案</h3>
            <div className="row">
              <span className="label">汇报对象</span>
              <span>{m?.isLead ? t("user") : (lead?.name ?? "—")}</span>
            </div>
            <div className="row">
              <span className="label">能力标签</span>
              <span>{agent?.capabilities ?? "—"}</span>
            </div>
            <div className="row">
              <span className="label">状态</span>
              <span>
                {agent?.status}{" "}
                <button className="btn" disabled={busy} onClick={() => void togglePause()}>
                  {agent?.status === "paused" ? "恢复" : "暂停"}
                </button>
              </span>
            </div>
            <div className="row">
              <span className="label">工作目录</span>
              <code style={{ fontSize: 12 }}>{agent?.adapterConfig?.cwd ?? "—"}</code>
            </div>
          </section>
          <section>
            <h3>模型</h3>
            <div className="row">
              <span>{agent?.adapterType}</span>
              <span>{modelName(agent ?? undefined)}（一个{t("employee")}始终用同一个模型）</span>
            </div>
          </section>
          <section>
            <h3>技能</h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {skills.map((s) => (
                <span key={s} className="tag answer">
                  {s}
                </span>
              ))}
            </div>
          </section>
          <section>
            <h3>花费</h3>
            <div className="row">
              <span>本月</span>
              <span>
                ${spent.toFixed(2)}
                {budget ? ` / $${budget.toFixed(2)}` : "（无预算上限）"}
              </span>
            </div>
            {budget > 0 && (
              <div className="bar">
                <span style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
              </div>
            )}
          </section>
          <section>
            <h3>记忆文件</h3>
            {files.length === 0 && <div style={{ color: "var(--as-muted)", fontSize: 13 }}>还没有记忆文件</div>}
            {files.map((f) => (
              <div key={f.path} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <a href="#" onClick={(e) => (e.preventDefault(), void openFile(f.path))}>
                  {f.path}
                </a>
                <span style={{ color: "var(--as-muted)" }}>{new Date(f.updatedAt).toLocaleDateString("zh-CN")}</span>
              </div>
            ))}
            {open && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "var(--as-muted)" }}>{open.path}</div>
                <textarea className="input" style={{ width: "100%", minHeight: 220, fontFamily: "monospace", fontSize: 12 }} value={open.text} onChange={(e) => setOpen({ ...open, text: e.target.value })} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                  <button className="btn ghost" onClick={() => setOpen(null)}>
                    关闭
                  </button>
                  <button className="btn primary" disabled={busy} onClick={() => void saveFile()}>
                    保存
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
