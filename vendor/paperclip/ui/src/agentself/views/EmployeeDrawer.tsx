// Employee quick view (drawer) + the 档案 / 记忆 panels reused by the employee full page (P10).
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { as, list, pc, type Agent, type Context } from "../lib/api";
import { useSkin } from "../lib/skin";
import { AGENT_STATUS, Robot, eyeOf, modelName } from "../components/Brand";
import { Link } from "@/lib/router";
import { SourceSelect } from "../components/SourceSelect";
import { modelChoices, priceOf, priceText, sourceLabel, sourceOfAgent, useModels } from "../lib/models";

interface MemoryFile {
  path: string;
  size: number;
  updatedAt: string;
}

function useEmployee(agentId: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const reload = useCallback(async () => {
    setAgent(await pc.get<Agent>(`/agents/${agentId}`));
    const s = await pc.get<{ desiredSkills?: string[] }>(`/agents/${agentId}/skills`).catch(() => ({ desiredSkills: [] }));
    setSkills((s.desiredSkills ?? []).map((k) => k.split("/").pop() ?? k));
  }, [agentId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { agent, skills, reload };
}

/** 档案：部门、汇报对象、能力、状态（暂停 / 恢复）、工作目录、模型、技能、花费 */
export function EmployeeProfile({ ctx, agentId, toast }: { ctx: Context; agentId: string; toast: (s: string) => void }) {
  const { t } = useSkin();
  const { agent, skills, reload } = useEmployee(agentId);
  const [busy, setBusy] = useState(false);
  const models = useModels();
  async function changeSource(source: string) {
    if (!agent || source === sourceOfAgent(agent)) return;
    if (!confirm(`把「${agent.name}」换成 ${sourceLabel(source, models)}？`)) return;
    setBusy(true);
    try {
      await as.post(`/agents/${agent.id}/source`, { source });
      toast(`已换成 ${sourceLabel(source, models)}`);
      await reload();
    } catch (e) {
      toast(`没换成：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function togglePause() {
    if (!agent) return;
    setBusy(true);
    try {
      await pc.post(`/agents/${agent.id}/${agent.status === "paused" ? "resume" : "pause"}`, {});
      await reload();
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
      <section>
        <h3>档案</h3>
        <div className="row">
          <span className="label">{t("department")}</span>
          <span>{m?.departmentName ?? "—"}</span>
        </div>
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
            {AGENT_STATUS[agent?.status ?? ""] ?? agent?.status}{" "}
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
          <span className="label">模型来源</span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {agent && (
              <SourceSelect
                lead={!!m?.isLead}
                value={sourceOfAgent(agent)}
                label="模型来源"
                style={{ width: 190 }}
                onChange={(v) => void changeSource(v)}
              />
            )}
          </span>
        </div>
        <div className="row">
          <span className="label">模型</span>
          {agent ? <ModelPicker agent={agent} onChanged={reload} toast={toast} /> : <span className="mono">—</span>}
        </div>
        <div className="sub">换来源后，下一次运行起生效：记忆、技能和团队工具都保留。正在进行的任务会在下一轮用新模型。</div>
      </section>
      <section>
        <h3>技能</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {skills.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
          {skills.length === 0 && <span className="sub">—</span>}
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
    </>
  );
}

/** 记忆：记忆目录里的文件，可查看、编辑（保存即提交到记忆的 git 历史） */
export function EmployeeMemory({ agentId, toast }: { agentId: string; toast: (s: string) => void }) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => setFiles(list<MemoryFile>(await as.get(`/memory/${agentId}`).catch(() => []))))();
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
  return (
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
          <textarea className="input" style={{ width: "100%", minHeight: 260, fontFamily: "monospace", fontSize: 12 }} value={open.text} onChange={(e) => setOpen({ ...open, text: e.target.value })} />
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
  );
}

export function EmployeeHeader({ ctx, agentId, size = 44 }: { ctx: Context; agentId: string; size?: number }) {
  const { t } = useSkin();
  const agent = ctx.agents.find((a) => a.id === agentId);
  const m = agent?.metadata?.agentself;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Robot id={agentId} eye={eyeOf(agent?.adapterType)} size={size} grey={agent?.status === "paused"} />
      <div>
        <h2 style={{ margin: "2px 0" }}>{agent?.name ?? "…"}</h2>
        <div style={{ fontSize: 13, color: "var(--as-muted)" }}>
          {m?.isLead ? t("lead") : agent?.title} · {m?.departmentName ?? ""} · {modelName(agent ?? undefined)}
        </div>
      </div>
    </div>
  );
}

export function EmployeeDrawer({ ctx, agentId, onClose, toast }: { ctx: Context; agentId: string; onClose: () => void; toast: (s: string) => void }) {
  const { t } = useSkin();
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${t("employee")}档案`}>
        <header>
          <div className="line1">
            <span className="mono">{t("employee")}档案</span>
            <span className="grow" />
            <button className="icon-btn sm surface" aria-label="关闭" onClick={onClose}>
              <X />
            </button>
          </div>
          <EmployeeHeader ctx={ctx} agentId={agentId} />
          <div className="drawer-links">
            <Link to={`/agents/${agentId}/profile`} onClick={onClose} data-testid="open-agent-page">
              完整页（档案、记忆、配置、运行记录、预算）
            </Link>
          </div>
        </header>
        <div className="body">
          <EmployeeProfile ctx={ctx} agentId={agentId} toast={toast} />
          <EmployeeMemory agentId={agentId} toast={toast} />
        </div>
      </aside>
    </>
  );
}

/** Model within the agent's source: the provider's models (API) or the subscription CLI's aliases. */
function ModelPicker({ agent, onChanged, toast }: { agent: Agent; onChanged: () => Promise<void> | void; toast: (s: string) => void }) {
  const models = useModels();
  const source = sourceOfAgent(agent);
  const current = agent.adapterConfig?.model ?? "";
  const [v, setV] = useState(current);
  useEffect(() => setV(current), [current]);
  const listId = `agent-models-${agent.id}`;
  async function apply() {
    try {
      await as.post(`/agents/${agent.id}/model`, { model: v });
      toast(v ? `已换成 ${v}` : "已恢复默认模型");
      await onChanged();
    } catch (e) {
      toast(`没换成：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input className="input mono" style={{ width: 190 }} list={listId} value={v} placeholder={source === "codex" ? "Codex 默认" : source.startsWith("api:") ? "服务商默认" : "Claude 默认"} onChange={(e) => setV(e.target.value)} aria-label="模型" />
      <datalist id={listId}>
        {modelChoices(source, models).map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <button className="btn sm" disabled={v === current} onClick={() => void apply()}>
        应用
      </button>
      {source.startsWith("api:") && (
        <span className="sub" data-testid="model-price">
          {priceText(priceOf(models, source, v || models?.providers.find((x) => `api:${x.id}` === source)?.model)) || "还没填价格"}
        </span>
      )}
    </span>
  );
}
