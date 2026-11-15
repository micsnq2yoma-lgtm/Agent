import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { BUILTIN_SKINS, registerSkin, skins, type Skin } from "@agentself/skins";
import { as, list, pc, usePoll, type Context, type Issue, type Settings } from "../lib/api";
import { useSkin } from "../lib/skin";
import { Robot, eyeOf, modelName } from "../components/Brand";
import { Link } from "@/lib/router";

const STATUS: Record<string, string> = { backlog: "排队", todo: "待开始", in_progress: "进行中", in_review: "待验收", done: "完成", blocked: "等待中", cancelled: "已取消" };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/* ---------------- Projects ---------------- */
export function Projects({ ctx, issues, openProject, departmentKey, embedded = false }: { ctx: Context; issues: Issue[]; openProject: (id: string) => void; departmentKey?: string; embedded?: boolean }) {
  const { t } = useSkin();
  const [showDone, setShowDone] = useState(false);
  const dept = departmentKey ? ctx.departments.find((d) => d.key === departmentKey) : null;
  const deptIndex = (i: Issue) => {
    const k = ctx.departments.findIndex((d) => d.projectId === i.projectId);
    return k < 0 ? 999 : k;
  };
  // top-level tasks grouped by department (PLAN 7.0), newest first inside a department
  const tops = issues
    .filter((i) => !i.parentId && (showDone || !["done", "cancelled"].includes(i.status)) && (!dept || i.projectId === dept.projectId))
    .sort((a, b) => deptIndex(a) - deptIndex(b) || b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className={embedded ? "" : "page"}>
      {!embedded && <h1 className="page-title">{t("project")}</h1>}
      <label style={{ fontSize: 13 }}>
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 显示已完成
      </label>
      <table className="data" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>编号</th>
            <th>标题</th>
            <th>{t("department")}</th>
            <th>{t("subtask")}</th>
            <th>状态</th>
            <th>更新</th>
          </tr>
        </thead>
        <tbody>
          {tops.map((i) => {
            const kids = issues.filter((k) => k.parentId === i.id);
            return (
              <tr key={i.id} style={{ cursor: "pointer" }} onClick={() => openProject(i.id)}>
                <td>{i.identifier}</td>
                <td>{i.title}</td>
                <td>{ctx.departments.find((d) => d.projectId === i.projectId)?.name ?? "—"}</td>
                <td>{kids.length ? `${kids.filter((k) => k.status === "done").length}/${kids.length}` : "—"}</td>
                <td>{STATUS[i.status] ?? i.status}</td>
                <td>{new Date(i.updatedAt).toLocaleString("zh-CN")}</td>
              </tr>
            );
          })}
          {tops.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--as-muted)" }}>
                没有进行中的{t("project")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Routines ---------------- */
interface Routine {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  triggers?: Array<{ kind?: string; cronExpression?: string }>;
}
export function Routines({ ctx, departmentKey, embedded = false }: { ctx: Context; departmentKey?: string; embedded?: boolean }) {
  const { t } = useSkin();
  const [all] = usePoll(async () => list<Routine>(await pc.get(`/companies/${ctx.company!.id}/routines`)), 15000, [ctx.company?.id]);
  const dept = departmentKey ? ctx.departments.find((d) => d.key === departmentKey) : null;
  const deptIndex = (r: Routine) => {
    const k = ctx.departments.findIndex((d) => d.projectId === r.projectId);
    return k < 0 ? 999 : k;
  };
  const routines = all ? all.filter((r) => !dept || r.projectId === dept.projectId).sort((x, y) => deptIndex(x) - deptIndex(y)) : null;
  return (
    <div className={embedded ? "" : "page"}>
      {!embedded && <h1 className="page-title">{t("routine")}</h1>}
      <p className="hint">定时、Webhook 或接口触发，每次生成一个任务，交给指定的{t("employee")}。在新建{t("department")}向导里添加，或在高级设置里调整。</p>
      <table className="data">
        <thead>
          <tr>
            <th>名称</th>
            <th>{t("department")}</th>
            <th>触发</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {(routines ?? []).map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/routines/${r.id}`}>{r.title ?? r.name}</Link>
              </td>
              <td>{ctx.departments.find((d) => d.projectId === r.projectId)?.name ?? "—"}</td>
              <td>{(r.triggers ?? []).map((x) => x.cronExpression ?? x.kind).join(", ") || "—"}</td>
              <td>{r.status ?? ""}</td>
            </tr>
          ))}
          {routines?.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "var(--as-muted)" }}>
                还没有{t("routine")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Capabilities ---------------- */
interface Skill {
  id: string;
  key?: string;
  name: string;
  slug?: string;
  description?: string | null;
}
export function Capabilities({ ctx, agentIds, permissionsOnly = false, embedded = false }: { ctx: Context; agentIds?: string[]; permissionsOnly?: boolean; embedded?: boolean }) {
  const { t } = useSkin();
  const [all] = usePoll(
    async () => {
      const company = list<Skill>(await pc.get(`/companies/${ctx.company!.id}/skills`));
      if (!agentIds) return company;
      // department view: only the skills its members actually use
      const used = new Set<string>();
      for (const id of agentIds) {
        const s = await pc.get<{ desiredSkills?: string[] }>(`/agents/${id}/skills`).catch(() => ({ desiredSkills: [] }));
        for (const k of s.desiredSkills ?? []) used.add(k.split("/").pop() ?? k);
      }
      return company.filter((s) => used.has(s.slug ?? s.key ?? s.name) || used.has(s.name));
    },
    30000,
    [ctx.company?.id, (agentIds ?? []).join(",")],
  );
  const skillsList = all;
  return (
    <div className={embedded ? "" : "page"}>
      {!embedded && <h1 className="page-title">能力与工具</h1>}
      {!permissionsOnly && (
      <div className="section">
        <h2>能力包（技能）</h2>
        <table className="data">
          <tbody>
            {(skillsList ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td style={{ color: "var(--as-muted)" }}>{s.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {!agentIds && (
      <div className="section">
        <h2>对外动作权限</h2>
        <p className="hint">发邮件、发布、推代码、花钱等不可撤回的动作，默认「先问我」：{t("employee")}只做到草稿就绪，再用{t("card")}请你确认。连接器的 Allowed / Ask first / Off 在高级设置里调整。</p>
        <Link className="btn" to="/agentself/capabilities/connectors">
          打开连接器设置
        </Link>
        <p className="hint">单个{t("employee")}的权限与信任级别在其完整页的「权限」标签里调整。</p>
      </div>
      )}
    </div>
  );
}

/* ---------------- Usage (PLAN 7.3) ---------------- */
interface WindowSpend {
  provider: string;
  window: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
}
interface QuotaWindow {
  provider: string;
  ok: boolean;
  error?: string;
  windows: Array<{ label?: string; usedPercent?: number; resetsAt?: string }>;
}
export function Usage({ ctx, departmentKey, embedded = false }: { ctx: Context; departmentKey?: string; embedded?: boolean }) {
  const { t } = useSkin();
  const cid = ctx.company!.id;
  const [data] = usePoll(
    async () => {
      const [byAgent, windows, quota] = await Promise.all([
        pc.get<Array<{ agentId: string; costCents: number }>>(`/companies/${cid}/costs/by-agent`).catch(() => []),
        pc.get<WindowSpend[]>(`/companies/${cid}/costs/window-spend`).catch(() => []),
        pc.get<QuotaWindow[]>(`/companies/${cid}/costs/quota-windows`).catch(() => []),
      ]);
      return { byAgent: list<{ agentId: string; costCents: number }>(byAgent), windows: list<WindowSpend>(windows), quota: list<QuotaWindow>(quota) };
    },
    20000,
    [cid],
  );
  const agentCost = (id: string) => data?.byAgent.find((x) => x.agentId === id)?.costCents ?? ctx.agents.find((a) => a.id === id)?.spentMonthlyCents ?? 0;
  const depts = departmentKey ? ctx.departments.filter((d) => d.key === departmentKey) : ctx.departments;
  return (
    <div className={embedded ? "" : "page"}>
      {!embedded && <h1 className="page-title">用量</h1>}
      <div className="section">
        <h2>按{t("department")}（本月 API 折算花费 / 预算）</h2>
        <table className="data">
          <thead>
            <tr>
              <th>{t("department")} / {t("employee")}</th>
              <th>模型</th>
              <th>本月</th>
              <th>预算</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => {
              const members = ctx.agents.filter((a) => d.members.includes(a.id));
              const spent = members.reduce((s, a) => s + agentCost(a.id), 0);
              const budget = members.reduce((s, a) => s + (a.budgetMonthlyCents ?? 0), 0);
              return [
                <tr key={d.key} style={{ fontWeight: 600 }}>
                  <td>{d.name}</td>
                  <td />
                  <td>{money(spent)}</td>
                  <td>{budget ? money(budget) : "—"}</td>
                  <td>
                    {budget > 0 && (
                      <div className="bar">
                        <span style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
                      </div>
                    )}
                  </td>
                </tr>,
                ...members.map((a) => (
                  <tr key={a.id}>
                    <td style={{ paddingLeft: 20 }}>{a.name}</td>
                    <td>{modelName(a)}</td>
                    <td>{money(agentCost(a.id))}</td>
                    <td>{a.budgetMonthlyCents ? money(a.budgetMonthlyCents) : "—"}</td>
                    <td />
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
        <p className="hint">订阅内的运行不实际计费；这里是按 API 价格折算的参考值。</p>
      </div>
      {!departmentKey && (
      <div className="section">
        <h2>订阅额度（Claude / Codex 套餐窗口）</h2>
        {(data?.quota ?? []).map((q) => (
          <div key={q.provider} className="row">
            <span className="label">{q.provider === "anthropic" ? "Claude" : q.provider === "openai" ? "Codex / ChatGPT" : q.provider}</span>
            <span>
              {q.ok
                ? q.windows.map((w, i) => (
                    <span key={i} style={{ marginLeft: 10 }}>
                      {w.label}: {w.usedPercent ?? "?"}%
                    </span>
                  ))
                : "未绑定订阅账号，以下为估算"}
            </span>
          </div>
        ))}
        <table className="data" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>提供方</th>
              <th>窗口</th>
              <th>输入</th>
              <th>缓存输入</th>
              <th>输出</th>
            </tr>
          </thead>
          <tbody>
            {(data?.windows ?? [])
              .filter((w) => w.provider !== "unknown")
              .map((w) => (
                <tr key={`${w.provider}-${w.window}`}>
                  <td>{w.provider === "anthropic" ? "Claude" : "Codex"}</td>
                  <td>{w.window}</td>
                  <td>{w.inputTokens.toLocaleString()}</td>
                  <td>{w.cachedInputTokens.toLocaleString()}</td>
                  <td>{w.outputTokens.toLocaleString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="hint">估算：按 5 小时 / 24 小时 / 7 天窗口汇总 token 用量。要看官方剩余额度，在高级设置的 AI connections 里绑定订阅账号。</p>
      </div>
      )}
    </div>
  );
}

/* ---------------- Global profile (plan B): read by every lead ---------------- */
const PROFILE_SECTIONS = [
  { key: "user", label: "关于我", sub: "你的课题、项目、习惯和偏好。所有主管理解你的话之前都会读，员工也会参考" },
  { key: "decisions", label: "我定过的事", sub: "你在卡片里说过\"以后都这样\"的决定，由主管追加。主管照做，不再重复问" },
  { key: "declined", label: "我拒绝过的事", sub: "你明确拒绝过的建议和做法，不会再被提起" },
  { key: "askfirst", label: "先问清单", sub: "遇到这些情况，员工必须先停下来问主管，主管拿不准再问你。其余的事他们自己判断" },
] as const;

interface Proposal {
  id: string;
  text: string;
  from: string;
  createdAt: string;
}

/** Memory consolidation proposes; nothing enters "about me" until you accept it here. */
function ProfileProposals({ onAccepted }: { onAccepted: () => void }) {
  const [list, setList] = useState<Proposal[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const load = () => as.get<Proposal[]>("/profile/proposals?status=pending").then(setList).catch(() => setList([]));
  useEffect(() => void load(), []);
  async function resolve(p: Proposal, action: "accept" | "reject") {
    await as.post(`/profile/proposals/${p.id}/${action}`, action === "accept" ? { text: edits[p.id] ?? p.text } : {});
    await load();
    if (action === "accept") onAccepted();
  }
  if (list.length === 0) return null;
  return (
    <div className="section">
      <h2>
        待确认的记忆提议 <span className="status-tag hot">{list.length}</span>
      </h2>
      <div className="sub" style={{ marginBottom: 6 }}>记忆整理时从工作日志里提炼出来的。确认后才会写进"关于我"，可以先改措辞。</div>
      {list.map((p) => (
        <div key={p.id} className="proposal">
          <div className="grow">
            <input className="input" style={{ width: "100%", height: 40 }} aria-label="提议内容" value={edits[p.id] ?? p.text} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })} />
            <div className="sub" style={{ marginTop: 4 }}>来自 {p.from} 的工作日志</div>
          </div>
          <button className="btn primary xs" onClick={() => void resolve(p, "accept")}>
            写入
          </button>
          <button className="btn ghost xs" onClick={() => void resolve(p, "reject")}>
            忽略
          </button>
        </div>
      ))}
    </div>
  );
}

function ProfileEditor() {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<string>("");
  const [sel, setSel] = useState<(typeof PROFILE_SECTIONS)[number]["key"]>("user");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saved, setSaved] = useState(false);
  const loadTexts = () => {
    for (const { key } of PROFILE_SECTIONS) {
      as.get<{ text: string }>(`/profile/${key}`)
        .then((r) => setTexts((t) => ({ ...t, [key]: r.text })))
        .catch(() => {});
    }
  };
  useEffect(loadTexts, []);
  useEffect(() => setDraft(texts[sel] ?? ""), [sel, texts[sel]]);
  async function save() {
    await as.put(`/profile/${sel}`, { text: draft });
    setTexts((t) => ({ ...t, [sel]: draft }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  const current = PROFILE_SECTIONS.find((x) => x.key === sel)!;
  return (
    <div className="profile-grid">
      <div className="profile-list" role="tablist" aria-label="档案">
        {PROFILE_SECTIONS.map(({ key, label, sub }) => (
          <button key={key} role="tab" aria-selected={sel === key} className={sel === key ? "on" : ""} onClick={() => setSel(key)}>
            <b>{label}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div>
        <ProfileProposals onAccepted={loadTexts} />
        <div className="section">
          <h2>
            <span style={{ flex: 1 }}>{current.label}</span>
            <span className="seg" role="tablist" aria-label="编辑或预览">
              <button role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
                编辑
              </button>
              <button role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>
                预览
              </button>
            </span>
            <button className="btn primary xs" disabled={draft === (texts[sel] ?? "")} onClick={() => void save()}>
              {saved ? "已保存" : "保存"}
            </button>
          </h2>
          {mode === "edit" ? (
            <textarea className="input" style={{ minHeight: 320 }} aria-label={current.label} value={draft} onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <div className="md-preview">{draft || "（空）"}</div>
          )}
          <div className="sub mono" style={{ marginTop: 8 }}>
            ~/.agentself/profile/{sel}.md
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
const SETTINGS_TABS = [
  ["general", "通用"],
  ["router", "路由"],
  ["feishu", "飞书"],
  ["budget", "预算"],
  ["external", "对外动作"],
  ["skin", "皮肤"],
  ["profile", "关于我"],
  ["advanced", "高级"],
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number][0];

export function SettingsPage({ ctx, onSaved }: { ctx: Context; onSaved: () => void }) {
  const { t, setSkinId } = useSkin();
  const [s, setS] = useState<Settings>(ctx.settings);
  const [saved, setSaved] = useState(false);
  const [feishuStatus, setFeishuStatus] = useState<string | null>(null);
  const [tab, setTabState] = useState<SettingsTab>(() => {
    const h = typeof location !== "undefined" ? location.hash.slice(1) : "";
    return (SETTINGS_TABS.some(([k]) => k === h) ? h : "general") as SettingsTab;
  });
  const setTab = (k: SettingsTab) => {
    setTabState(k);
    try {
      history.replaceState(null, "", `#${k}`);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => setS(ctx.settings), [ctx.settings]);
  useEffect(() => {
    as.get<{ status: string }>("/feishu/status").then((r) => setFeishuStatus(r.status)).catch(() => setFeishuStatus(null));
  }, []);
  async function save(next: Partial<Settings>) {
    const merged = { ...s, ...next, feishu: { ...s.feishu, ...(next.feishu ?? {}) } };
    setS(merged);
    await as.put("/settings", merged);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onSaved();
  }
  async function setCompanyBudget(cents: number) {
    if (!ctx.company) return;
    await pc.patch(`/companies/${ctx.company.id}`, { budgetMonthlyCents: cents });
    onSaved();
  }
  return (
    <div className="page" style={{ maxWidth: tab === "profile" ? 1180 : 820 }}>
      <h1 className="page-title">
        设置 {saved && <span style={{ fontSize: 13, color: "var(--as-success)", fontFamily: "var(--as-font-body)" }}>已保存</span>}
      </h1>
      <div className="tabbar" role="tablist" aria-label="设置分类">
        {SETTINGS_TABS.map(([key, label]) => (
          <a
            key={key}
            href={`#${key}`}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "on" : ""}
            onClick={(e) => {
              e.preventDefault();
              setTab(key);
            }}
          >
            {label}
          </a>
        ))}
      </div>
      {tab === "general" && (
        <>
      <div className="section">
        <h2>通用</h2>
        <div className="row">
          <div>
            <div className="label">团队名称</div>
            <div className="sub">显示在通知和飞书卡片里</div>
          </div>
          <input className="input" defaultValue={s.companyName} onBlur={(e) => e.target.value !== s.companyName && void save({ companyName: e.target.value })} />
        </div>
      </div>
        </>
      )}
      {tab === "router" && (
        <>
      <div className="section">
        <h2>路由</h2>
        <div className="row">
          <div>
            <div className="label">路由用的模型</div>
            <div className="sub">只负责即时回答和选{t("lead")}，理解你的意思是{t("lead")}的事，用便宜的模型就够</div>
          </div>
          <select className="input" value={s.frontdeskModel} onChange={(e) => void save({ frontdeskModel: e.target.value })}>
            <option value="haiku">Claude Haiku（推荐）</option>
            <option value="sonnet">Claude Sonnet</option>
            <option value="claude-opus-5-5">Claude Opus 5.5</option>
          </select>
        </div>
        <div className="row">
          <div className="label">判断不出交给哪位{t("lead")}时先问我</div>
          <input type="checkbox" checked={s.askWhenUnclear} onChange={(e) => void save({ askWhenUnclear: e.target.checked })} />
        </div>
      </div>
        </>
      )}
      {tab === "feishu" && (
        <>
      <div className="section">
        <h2>飞书</h2>
        <div className="row">
          <div>
            <div className="label">连接</div>
            <div className="sub">长连接模式，本机不用暴露公网地址</div>
          </div>
          <span>{feishuStatus ?? (s.feishu.enabled ? "未连接" : "未启用")}</span>
        </div>
        <div className="row">
          <span className="label">App ID</span>
          <input className="input" value={s.feishu.appId} onChange={(e) => setS({ ...s, feishu: { ...s.feishu, appId: e.target.value } })} onBlur={() => void save({})} />
        </div>
        <div className="row">
          <div>
            <div className="label">App Secret</div>
            <div className="sub">存在环境变量 AGENTSELF_FEISHU_APP_SECRET，不写进配置文件</div>
          </div>
          <span className="sub">{s.feishu.secretRef || "AGENTSELF_FEISHU_APP_SECRET"}</span>
        </div>
        <div className="row">
          <span className="label">推送哪些</span>
          <span style={{ display: "flex", gap: 10 }}>
            {(
              [
                ["high", t("decide")],
                ["medium", t("deliverable")],
                ["low", "进展动态"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={s.feishu.pushTiers.includes(k)}
                  onChange={(e) => void save({ feishu: { ...s.feishu, pushTiers: e.target.checked ? [...s.feishu.pushTiers, k] : s.feishu.pushTiers.filter((x) => x !== k) } })}
                />{" "}
                {label}
              </label>
            ))}
          </span>
        </div>
        <div className="row">
          <div>
            <div className="label">谁能给机器人下任务</div>
            <div className="sub">飞书 open_id 白名单，逗号分隔</div>
          </div>
          <input
            className="input"
            value={s.feishu.allowUserIds.join(",")}
            onChange={(e) => setS({ ...s, feishu: { ...s.feishu, allowUserIds: e.target.value.split(/[,，\s]+/).filter(Boolean) } })}
            onBlur={() => void save({})}
          />
        </div>
        <div className="row">
          <span className="label">启用</span>
          <input type="checkbox" checked={s.feishu.enabled} onChange={(e) => void save({ feishu: { ...s.feishu, enabled: e.target.checked } })} />
        </div>
      </div>
        </>
      )}
      {tab === "budget" && (
        <>
      <div className="section">
        <h2>预算</h2>
        <div className="row">
          <div>
            <div className="label">全局月预算</div>
            <div className="sub">到线后所有{t("employee")}停下，并发一张{t("card")}</div>
          </div>
          <span>
            $
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              min={0}
              defaultValue={((ctx.company?.budgetMonthlyCents ?? 0) / 100).toString()}
              onBlur={(e) => void setCompanyBudget(Math.round(Number(e.target.value || 0) * 100))}
            />
          </span>
        </div>
        {ctx.departments.map((d) => {
          const budget = ctx.agents.filter((a) => d.members.includes(a.id)).reduce((x, a) => x + (a.budgetMonthlyCents ?? 0), 0);
          return (
            <div key={d.key} className="row">
              <span>{d.name}</span>
              <span>{budget ? money(budget) : "不限"}</span>
            </div>
          );
        })}
      </div>
        </>
      )}
      {tab === "external" && (
        <>
      <div className="section">
        <h2>对外动作</h2>
        <div className="row">
          <div>
            <div className="label">默认规则</div>
            <div className="sub">发邮件、发布、推代码、花钱</div>
          </div>
          <select className="input" value={s.externalDefault} onChange={(e) => void save({ externalDefault: e.target.value as "ask" | "direct" })}>
            <option value="ask">先问我</option>
            <option value="direct">直接做</option>
          </select>
        </div>
      </div>
        </>
      )}
      {tab === "skin" && (
        <>
      <div className="section">
        <h2>皮肤</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label className="btn">
            导入皮肤包…
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const skin = JSON.parse(await file.text()) as Skin;
                  await as.post("/skins", skin);
                  registerSkin(skin);
                  onSaved();
                  alert(`已导入皮肤「${skin.name}」`);
                } catch (err) {
                  alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {Object.values(skins).map((sk) => (
          <div key={sk.id} className="row">
            <div>
              <div className="label">{sk.name}</div>
              <div className="sub">
                {sk.description}
                {s.skin === sk.id ? " · 当前使用" : ""}
              </div>
            </div>
            <button
              className={`btn ${s.skin === sk.id ? "primary" : ""}`}
              onClick={() => {
                setSkinId(sk.id);
                void save({ skin: sk.id });
              }}
            >
              {s.skin === sk.id ? "使用中" : "使用"}
            </button>
            <button
              className="btn ghost"
              title="导出为皮肤包（JSON）"
              onClick={() => {
                const blob = new Blob([JSON.stringify(sk, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `agentself-skin-${sk.id}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              导出
            </button>
            {!BUILTIN_SKINS.includes(sk.id) && <span className="sub">共享皮肤</span>}
          </div>
        ))}
      </div>
        </>
      )}
      {tab === "advanced" && (
        <>
      <div className="section">
        <h2>高级</h2>
        <p className="hint">低频的高级设置沿用 Paperclip 原页面，在本应用内打开。</p>
        {ADVANCED_LINKS.map(([to, label, sub]) => (
          <div className="row" key={to}>
            <div>
              <div className="label">{label}</div>
              <div className="sub">{sub}</div>
            </div>
            <Link className="btn" to={to}>
              打开
            </Link>
          </div>
        ))}
        <div className="row">
          <span className="label">版本</span>
          <span className="sub">Paperclip 源码内置（vendor/paperclip，基线 d69631b）</span>
        </div>
      </div>
        </>
      )}
      {tab === "profile" && <ProfileEditor />}
    </div>
  );
}

const ADVANCED_LINKS: Array<[string, string, string]> = [
  ["/company/settings", "公司设置", "名称、品牌、心跳等公司级设置"],
  ["/company/settings/secrets", "密钥", "API key 等密钥的存放与引用"],
  ["/company/settings/instance/adapters", "适配器", "Claude Code / Codex 等运行方式"],
  ["/company/settings/instance/plugins", "插件", "团队层等插件的安装与配置"],
  ["/company/settings/instance/experimental", "实验功能", "实例级开关"],
  ["/company/settings/instance/access", "实例访问", "登录与访问控制"],
  ["/apps", "连接器", "外部应用连接与权限"],
];

/* ---------------- Archived ---------------- */
export function Archived({ ctx, onChange }: { ctx: Context; onChange: () => void }) {
  const { t } = useSkin();
  const archived = ctx.departments.filter((d) => d.archived);
  const active = ctx.departments.filter((d) => !d.archived);
  async function setArchived(projectId: string | null, v: boolean) {
    if (!projectId) return;
    await pc.patch(`/projects/${projectId}`, { archivedAt: v ? new Date().toISOString() : null });
    onChange();
  }
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="page-title">已归档</h1>
      {archived.length === 0 && <div className="empty">没有归档的{t("department")}</div>}
      {archived.map((d) => (
        <div key={d.key} className="row">
          <span>{d.name}</span>
          <button className="btn" onClick={() => void setArchived(d.projectId, false)}>
            恢复
          </button>
        </div>
      ))}
      <h2 style={{ fontSize: 15, marginTop: 24 }}>归档一个{t("department")}</h2>
      {active.map((d) => (
        <div key={d.key} className="row">
          <span>{d.name}</span>
          <button className="btn" onClick={() => confirm(`归档${d.name}？`) && void setArchived(d.projectId, true)}>
            归档
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- New department wizard (PLAN 7.4) ---------------- */
interface PackMember {
  key: string;
  name: string;
  title: string;
  role: string;
  adapterType: "claude_local" | "codex_local";
  capabilities: string;
  budgetMonthlyCents: number;
  identity: string;
}
interface Template {
  key: string;
  name: string;
  icon: string;
  description: string;
}
// Plan B entry 2: scheduled watching goes straight to an employee; the lead is not woken.
export const WATCH_TEMPLATES = [
  { label: "新论文", cron: "30 8 * * *", prompt: "检索过去 24 小时与我课题相关的新论文（arXiv、主要会议和期刊），只挑真正值得我看的 0–3 篇，每篇一句话说明为什么值得看并附链接；没有就写\"无事\"。关键词和课题见全局档案\"关于我\"。" },
  { label: "邮件", cron: "0 8 * * 1-5", prompt: "整理过去 24 小时的未读邮件：标出需要我回复或决定的，写好回复草稿但不要发送；其余的一句话归类。没有需要我处理的就写\"无事\"。" },
  { label: "新闻", cron: "0 19 * * *", prompt: "汇总今天与我关注领域相关的重要新闻和动态（关注点见全局档案\"关于我\"），只保留真正重要的 0–5 条，每条一句话加来源链接；没有就写\"无事\"。" },
];

// Plan B: nothing is preset. These only differ by the agent they run on; the user names everyone.
const ROLE_TEMPLATES: Array<Omit<PackMember, "key">> = [
  { name: "新员工", title: "", role: "general", adapterType: "claude_local", capabilities: "", budgetMonthlyCents: 1500, identity: "" },
  { name: "新员工", title: "", role: "general", adapterType: "codex_local", capabilities: "", budgetMonthlyCents: 1500, identity: "" },
];

export function NewDepartment({ ctx, onCreated }: { ctx: Context; onCreated: (key: string) => void }) {
  const { t } = useSkin();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("sparkles");
  const [description, setDescription] = useState("");
  const withLead = true; // plan B: every team has a lead
  const [leadName, setLeadName] = useState("");
  const [leadFocus, setLeadFocus] = useState("");
  const [leadModel, setLeadModel] = useState("claude-opus-5-5");
  const [members, setMembers] = useState<PackMember[]>([]);
  const [routineCron, setRoutineCron] = useState("");
  const [routinePrompt, setRoutinePrompt] = useState("");
  const [budget, setBudget] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);

  useEffect(() => {
    as.get<Template[]>("/departments/templates").then(setTemplates).catch(() => {});
  }, []);

  async function fromTemplate(key: string) {
    const pack = await as.get<{ name: string; icon: string; description: string; lead: PackMember | null; members: PackMember[]; budgetMonthlyCents?: number }>(`/departments/templates/${key}`);
    setName(pack.name);
    setIcon(pack.icon);
    setDescription(pack.description);
    if (pack.lead) {
      setLeadName(pack.lead.name);
      setLeadFocus(pack.lead.capabilities);
    }
    setMembers(pack.members);
    setBudget((pack.budgetMonthlyCents ?? 5000) / 100);
    setTemplateKey(ctx.departments.some((d) => d.key === key) ? null : key);
  }
  const addMember = (tpl: Omit<PackMember, "key">) => setMembers([...members, { ...tpl, key: `m${Date.now().toString(36)}` }]);
  const allSame = (adapterType: PackMember["adapterType"]) => setMembers(members.map((m) => ({ ...m, adapterType })));

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const pack = {
        schema: "agentself.department/1",
        ...(templateKey ? { key: templateKey } : {}),
        name,
        icon,
        description,
        budgetMonthlyCents: Math.round(budget * 100),
        lead: {
          key: "lead",
          name: leadName.trim() || `${name}${t("lead")}`,
          title: t("lead"),
          role: "pm",
          adapterType: "claude_local",
          model: leadModel,
          capabilities: leadFocus || description,
          budgetMonthlyCents: Math.round(budget * 25),
          identity: `你是用户的${t("lead")}，负责「${name}」。${description}`,
        },
        members: members.map((m) => ({ ...m, identity: m.identity || `你是${name}的${m.name}，负责${m.title}。` })),
        skills: ["agentself-lead", "agentself-employee", "agentself-memory"],
        routines: routineCron && routinePrompt ? [{ key: "r1", title: routinePrompt.slice(0, 30), cron: routineCron, to: members[0]?.key, prompt: routinePrompt }] : [],
      };
      const r = await as.post<{ department: string }>("/departments", pack);
      onCreated(r.department);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const steps = ["基本信息", "人员", "工具和数据源", "预算", "预览并创建"];
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="page-title">新建{t("lead")}</h1>
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <span key={s} className={i <= step ? "on" : ""} title={s} />
        ))}
      </div>
      <div className="section">
        <h2>
          {step + 1}. {steps[step]}
        </h2>
        {step === 0 && (
          <>
            {templates.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                从示例开始：
                {templates.map((tp) => (
                  <button key={tp.key} className="btn" onClick={() => void fromTemplate(tp.key)}>
                    {tp.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid2">
              <label className="field">
                名称
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称，由你来定" />
              </label>
              <label className="field">
                图标
                <select className="input" value={icon} onChange={(e) => setIcon(e.target.value)}>
                  {["microscope", "rocket", "heart", "code", "globe", "mail", "sparkles", "target"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field" style={{ marginTop: 10 }}>
              职责说明
              <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <Robot id="lead-preview" size={26} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="input" style={{ width: 140 }} placeholder={`${t("lead")}的名字`} value={leadName} onChange={(e) => setLeadName(e.target.value)} />
                  <input className="input" style={{ flex: 1 }} placeholder={`负责什么（路由靠它把事交给这位${t("lead")}）`} value={leadFocus} onChange={(e) => setLeadFocus(e.target.value)} />
                  <select className="input" value={leadModel} onChange={(e) => setLeadModel(e.target.value)}>
                    <option value="claude-opus-5-5">Opus 5.5</option>
                    <option value="sonnet">Sonnet</option>
                  </select>
                </div>
                <span className="sub">{t("lead")}只管理不干活：理解你的意思、写验收标准、派{t("employee")}、验收、汇报。只能用 Claude。</span>
              </div>
            </div>
            {members.map((m, i) => (
              <div key={m.key} className="row">
                <Robot id={m.key} eye={eyeOf(m.adapterType)} size={22} />
                <input className="input" style={{ width: 100 }} value={m.name} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" style={{ flex: 1 }} value={m.capabilities} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, capabilities: e.target.value } : x)))} />
                <select className="input" value={m.adapterType} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, adapterType: e.target.value as PackMember["adapterType"] } : x)))}>
                  <option value="claude_local">Claude</option>
                  <option value="codex_local">Codex</option>
                </select>
                <button className="btn ghost" onClick={() => setMembers(members.filter((_, j) => j !== i))}>
                  删除
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {ROLE_TEMPLATES.map((r) => (
                <button key={r.adapterType} className="btn" onClick={() => addMember(r)}>
                  <Plus aria-hidden="true" /> {t("employee")}（{r.adapterType === "codex_local" ? "Codex" : "Claude"}）
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => allSame("claude_local")}>
                全部用 Claude
              </button>
              <button className="btn ghost" onClick={() => allSame("codex_local")}>
                全部用 Codex
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              常用盯守（交给第一名{t("employee")}，有情况才通知你）：
              {WATCH_TEMPLATES.map((w) => (
                <button key={w.label} className="btn" onClick={() => { setRoutineCron(w.cron); setRoutinePrompt(w.prompt); }}>
                  {w.label}
                </button>
              ))}
            </div>
            <p className="hint">默认给{t("lead")}装上「{t("lead")}技能 / 记忆技能」，给{t("employee")}装上「{t("employee")}通用技能 / 记忆技能」。连接器在高级设置里绑定，对外动作默认先问你。</p>
            <div className="grid2">
              <label className="field">
                {t("routine")}（cron，可选）
                <input className="input" placeholder="0 9 * * 1-5" value={routineCron} onChange={(e) => setRoutineCron(e.target.value)} />
              </label>
              <label className="field">
                每次要做什么
                <input className="input" placeholder="整理昨天的邮件并汇报" value={routinePrompt} onChange={(e) => setRoutinePrompt(e.target.value)} />
              </label>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <label className="field">
              {t("department")}月预算（美元，按 API 价折算）
              <input className="input" type="number" min={0} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
            </label>
            <p className="hint">
              平均分给每个人：约 ${(budget / Math.max(1, members.length + (withLead ? 1 : 0))).toFixed(2)} / 人。到线自动停下并发{t("card")}。
            </p>
          </>
        )}
        {step === 4 && (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end", padding: 16, background: "var(--as-bg)", borderRadius: 8 }}>
              {withLead && (
                <div style={{ textAlign: "center", fontSize: 12 }}>
                  <Robot id="lead-preview" size={40} />
                  {leadName || t("lead")}
                </div>
              )}
              {members.map((m) => (
                <div key={m.key} style={{ textAlign: "center", fontSize: 12 }}>
                  <Robot id={m.key} eye={eyeOf(m.adapterType)} size={32} />
                  {m.name}
                  <div style={{ color: "var(--as-muted)" }}>{modelName(m)}</div>
                </div>
              ))}
            </div>
            <p className="hint">
              将创建：{t("project")}「{name}」、{withLead ? `1 名${t("lead")} + ` : ""}
              {members.length} 名{t("employee")}
              {routineCron ? `、1 个${t("routine")}` : ""}，并为每人生成 memory/identity.md。
            </p>
            {err && <div className="notice" style={{ color: "var(--as-high)" }}>{err}</div>}
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
          上一步
        </button>
        {step < 4 ? (
          <button className="btn primary" disabled={(step === 0 && !name.trim()) || (step === 1 && members.length === 0)} onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : (
          <button className="btn primary" disabled={busy || !name.trim() || members.length === 0} onClick={() => void create()}>
            {busy ? "创建中…" : "创建"}
          </button>
        )}
      </div>
    </div>
  );
}
