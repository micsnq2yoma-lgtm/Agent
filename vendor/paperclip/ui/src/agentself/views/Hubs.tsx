// P10 page integration (PLAN 7.0 merge table): department page, employee full page, and the
// merged 能力与工具 / 用量与预算 / 记录 / 组织图 pages. Paperclip's own page components are
// embedded as tabs, so each object keeps exactly one full page inside the one app.
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "@/lib/router";
import { as, list, pc, type Context, type Issue } from "../lib/api";
import { relTime, type Card } from "../lib/cards";
import { cardsOfLead, progressOf, tasksOfLead } from "../lib/progress";
import { cronText } from "../lib/cron";
import { PackIcon } from "../lib/icons";
import { Skeleton } from "../components/Skeleton";
import { Stages } from "./Home";
import { useSkin } from "../lib/skin";
import { Robot, eyeOf, modelName } from "../components/Brand";
import { Capabilities, Routines, Usage, WATCH_TEMPLATES } from "./Pages";
import { EmployeeHeader, EmployeeMemory, EmployeeProfile } from "./EmployeeDrawer";
import { ToolServers } from "./ToolServers";

const CompanySkills = lazy(() => import("@/pages/CompanySkills").then((m) => ({ default: m.CompanySkills })));
const Browse = lazy(() => import("@/pages/apps/Browse").then((m) => ({ default: m.Browse })));
const AuditHub = lazy(() => import("@/pages/audit/AuditHub").then((m) => ({ default: m.AuditHub })));
const CompanyActivity = lazy(() => import("@/pages/audit/CompanyActivity").then((m) => ({ default: m.CompanyActivity })));
const Artifacts = lazy(() => import("@/pages/Artifacts").then((m) => ({ default: m.Artifacts })));
const Approvals = lazy(() => import("@/pages/Approvals").then((m) => ({ default: m.Approvals })));
const OrgChart = lazy(() => import("@/pages/OrgChart").then((m) => ({ default: m.OrgChart })));

export interface TabDef {
  key: string;
  label: string;
  /** sub-path when it differs from the key */
  path?: string;
}

/** Path-based tabs: `${base}/${key}` (the first tab is also `${base}`). */
export function TabBar({ base, tabs, active, testId }: { base: string; tabs: TabDef[]; active: string; testId?: string }) {
  return (
    <div className="tabbar" role="tablist" data-testid={testId}>
      {tabs.map((tb, i) => (
        <Link key={tb.key} to={i === 0 && !tb.path ? base : `${base}/${tb.path ?? tb.key}`} role="tab" aria-selected={active === tb.key} className={active === tb.key ? "on" : ""}>
          {tb.label}
        </Link>
      ))}
    </div>
  );
}

/** Paperclip page embedded in an Agentself page (its own styles, our frame). */
export function Embedded({ children }: { children: ReactNode }) {
  return (
    <div className="embedded-paperclip" data-embedded-paperclip="">
      <Suspense fallback={<Skeleton />}>{children}</Suspense>
    </div>
  );
}

function activeTab(tabs: TabDef[], tab: string | undefined) {
  return tabs.some((x) => x.key === tab) ? tab! : tabs[0].key;
}

/* ---------------- 主管页（原部门页，DESIGN §4.10）：概览 / 员工 / 例行任务 / 能力 / 预算 ---------------- */
interface RoutineLite {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  assigneeAgentId?: string | null;
}

function WatchCard({ ctx, dept, employees, toast }: { ctx: Context; dept: Context["departments"][number]; employees: Context["agents"]; toast: (s: string) => void }) {
  const [routines, setRoutines] = useState<RoutineLite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    pc
      .get<RoutineLite[]>(`/companies/${ctx.company!.id}/routines`)
      .then((r) => setRoutines(list<RoutineLite>(r)))
      .catch(() => setRoutines([]));
  useEffect(() => void load(), [ctx.company?.id]);
  const titleOf = (w: (typeof WATCH_TEMPLATES)[number]) => `${w.label}盯守`;
  async function enable(w: (typeof WATCH_TEMPLATES)[number]) {
    const to = employees[0];
    if (!to) return toast("先给这位主管加一名员工");
    setBusy(w.label);
    try {
      const r = await pc.post<{ id: string }>(`/companies/${ctx.company!.id}/routines`, { title: titleOf(w), description: w.prompt, projectId: dept.projectId ?? undefined, assigneeAgentId: to.id });
      await pc.post(`/routines/${r.id}/triggers`, { kind: "schedule", cronExpression: w.cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      toast(`已开启：${titleOf(w)}，交给${to.name}`);
      void load();
    } catch (e) {
      toast(`开启失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="section side-card">
      <h2>盯守</h2>
      <div className="sub" style={{ marginBottom: 6 }}>定时派给员工，有情况才通知你；不叫醒主管。</div>
      {WATCH_TEMPLATES.map((w) => {
        const on = (routines ?? []).some((r) => (r.title ?? r.name) === titleOf(w) && r.status !== "archived");
        return (
          <div key={w.label} className="row">
            <div>
              <div className="label">{w.label}</div>
              <div className="sub" title={w.cron}>{cronText(w.cron)}</div>
            </div>
            <button
              className={`switch ${on ? "on" : ""}`}
              role="switch"
              aria-checked={on}
              aria-label={titleOf(w)}
              disabled={busy === w.label || routines === null}
              title={on ? "已开启；在「例行任务」标签里暂停或删除" : "开启"}
              onClick={() => (on ? toast("在「例行任务」标签里暂停或删除") : void enable(w))}
            />
          </div>
        );
      })}
    </div>
  );
}

function MemoryCard({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<Array<{ path: string; updatedAt: string }> | null>(null);
  useEffect(() => {
    as.get<Array<{ path: string; updatedAt: string }>>(`/memory/${agentId}`)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [agentId]);
  return (
    <div className="section side-card">
      <h2>记忆</h2>
      {files === null ? (
        <Skeleton lines={3} />
      ) : files.length === 0 ? (
        <div className="sub">还没有记忆文件。</div>
      ) : (
        files
          .filter((f) => !f.path.startsWith("log/") && !f.path.startsWith("archive/"))
          .slice(0, 8)
          .map((f) => (
            <div key={f.path} className="row">
              <span className="mono" style={{ fontSize: 12 }}>
                {f.path}
              </span>
              <span className="sub">{relTime(f.updatedAt)}</span>
            </div>
          ))
      )}
      <Link to={`/agents/${agentId}/memory`} className="btn ghost sm" style={{ marginTop: 8 }}>
        打开记忆
      </Link>
    </div>
  );
}

export function DepartmentPage(props: {
  ctx: Context;
  issues: Issue[];
  cards: Card[];
  openProject: (id: string) => void;
  openEmployee: (id: string) => void;
  act: (c: Card, o: string) => void;
  toast?: (s: string) => void;
}) {
  const { t } = useSkin();
  const { departmentKey, tab } = useParams<{ departmentKey: string; tab?: string }>();
  const { ctx } = props;
  const toast = props.toast ?? (() => {});
  const dept = ctx.departments.find((d) => d.key === departmentKey);
  if (!dept)
    return (
      <div className="page">
        <div className="empty">
          <b>没有这位{t("lead")}</b>
        </div>
      </div>
    );
  const lead = ctx.agents.find((a) => a.id === dept.leadAgentId);
  const employees = ctx.agents.filter((a) => dept.members.includes(a.id) && a.id !== dept.leadAgentId);
  const tabs: TabDef[] = [
    { key: "overview", label: "概览" },
    { key: "members", label: `${t("employee")} ${employees.length}` },
    { key: "routines", label: t("routine") },
    { key: "capabilities", label: "能力" },
    { key: "budget", label: "预算" },
  ];
  const active = activeTab(tabs, tab);
  // same membership rules as the sidebar count and the workbench progress panel
  const tops = tasksOfLead(ctx, props.issues, dept);
  const decide = cardsOfLead(ctx, props.issues, props.cards, dept);
  const hires = decide.filter((c) => c.type === "hire");
  const spent = [lead, ...employees].reduce((n, a) => n + (a?.spentMonthlyCents ?? 0), 0) / 100;
  const budget = [lead, ...employees].reduce((n, a) => n + (a?.budgetMonthlyCents ?? 0), 0) / 100;
  return (
    <div className="page" data-testid="department-page">
      <div className="lead-head">
        <span className="ico">
          <PackIcon name={dept.icon} size={26} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1>{lead?.name ?? dept.name}</h1>
          <div className="chips">
            {lead && <span className="chip mono">{modelName(lead)}</span>}
            <span className="chip">只用管理工具</span>
            <span className="chip">
              {employees.length} 名{t("employee")}
            </span>
            {(lead?.capabilities || dept.description) && <span className="chip">{lead?.capabilities || dept.description}</span>}
          </div>
        </div>
      </div>
      <TabBar base={`/agentself/departments/${dept.key}`} tabs={tabs} active={active} testId="department-tabs" />
      {active === "overview" && (
        <div className="two-col">
          <div>
            <div className="stats">
              <div>
                <b>{tops.length}</b>
                <span>进行中</span>
              </div>
              <div className={decide.length ? "hot" : ""}>
                <b>{decide.length}</b>
                <span>等你决定</span>
              </div>
              <div>
                <b>{tops.filter((i) => progressOf(i, props.issues, props.cards).stage === 1).length}</b>
                <span>{t("employee")}在做</span>
              </div>
              <div>
                <b>${spent.toFixed(2)}</b>
                <span>本月</span>
              </div>
              <div>
                <b>{budget ? `$${budget.toFixed(0)}` : "—"}</b>
                <span>预算</span>
              </div>
            </div>
            <div className="section">
              <h2>{t("project")}</h2>
              {tops.length === 0 ? (
                <div className="sub">没有进行中的{t("project")}。</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("project")}</th>
                      <th>{t("employee")}</th>
                      <th>阶段</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tops.map((i) => {
                      const p = progressOf(i, props.issues, props.cards);
                      const emp = ctx.agents.find((a) => a.id === p.employeeId);
                      return (
                        <tr key={i.id} onClick={() => props.openProject(i.id)} style={{ cursor: "pointer" }}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{i.title}</div>
                            <div className="sub mono">{i.identifier}</div>
                          </td>
                          <td>
                            {emp ? (
                              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                                <Robot id={emp.id} eye={eyeOf(emp.adapterType, emp.adapterConfig?.model)} size={22} />
                                {emp.name}
                              </span>
                            ) : (
                              <span className="sub">—</span>
                            )}
                          </td>
                          <td>
                            <Stages p={p} />
                          </td>
                          <td style={{ color: p.bad ? "var(--as-high)" : undefined }}>{p.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div>
            <div className="section side-card">
              <h2>{t("employee")}</h2>
              {employees.map((a) => (
                <div key={a.id} className="row" style={{ cursor: "pointer" }} onClick={() => props.openEmployee(a.id)}>
                  <span style={{ display: "inline-flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                    <Robot id={a.id} eye={eyeOf(a.adapterType, a.adapterConfig?.model)} size={28} grey={a.status === "paused"} />
                    <span style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div className="sub">{a.capabilities || modelName(a)}</div>
                    </span>
                  </span>
                </div>
              ))}
              {employees.length === 0 && <div className="sub">还没有{t("employee")}。</div>}
              {hires.length > 0 && (
                <div className="warn">
                  <span style={{ flex: 1 }}>有 {hires.length} 个新建{t("employee")}的提议等你批准</span>
                  <Link to="/agentself" className="btn xs">
                    去工作台处理
                  </Link>
                </div>
              )}
            </div>
            <WatchCard ctx={ctx} dept={dept} employees={employees} toast={toast} />
            {lead && <MemoryCard agentId={lead.id} />}
          </div>
        </div>
      )}
      {active === "members" && (
        <table className="data">
          <thead>
            <tr>
              <th>{t("employee")}</th>
              <th>负责</th>
              <th>模型</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...(lead ? [lead] : []), ...employees].map((a) => (
              <tr key={a.id}>
                <td>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {a.id === dept.leadAgentId ? <PackIcon name={dept.icon} /> : <Robot id={a.id} eye={eyeOf(a.adapterType, a.adapterConfig?.model)} size={22} grey={a.status === "paused"} />}
                    {a.name}
                  </span>
                </td>
                <td>{a.id === dept.leadAgentId ? t("lead") : (a.capabilities ?? a.title ?? "")}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {modelName(a)}
                </td>
                <td>{a.status}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn ghost xs" onClick={() => props.openEmployee(a.id)}>
                    快速查看
                  </button>
                  <Link className="btn ghost xs" to={`/agents/${a.id}/profile`}>
                    完整页
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {active === "routines" && <Routines ctx={ctx} departmentKey={dept.key} embedded />}
      {active === "capabilities" && <Capabilities ctx={ctx} agentIds={[...(lead ? [lead.id] : []), ...employees.map((m) => m.id)]} embedded />}
      {active === "budget" && <Usage ctx={ctx} departmentKey={dept.key} embedded />}
    </div>
  );
}

/* ---------------- 能力与工具：技能 / 连接器 / 权限 ---------------- */
export function CapabilitiesHub({ ctx }: { ctx: Context }) {
  const { tab } = useParams<{ tab?: string }>();
  const tabs: TabDef[] = [
    { key: "tools", label: "工具服务" },
    { key: "skills", label: "技能" },
    { key: "connectors", label: "连接器" },
    { key: "permissions", label: "权限" },
  ];
  const active = activeTab(tabs, tab);
  return (
    <div className="page wide">
      <h1 className="page-title">能力与工具</h1>
      <TabBar base="/agentself/capabilities" tabs={tabs} active={active} testId="capabilities-tabs" />
      {active === "tools" && <ToolServers ctx={ctx} />}
      {active === "skills" && (
        <Embedded>
          <CompanySkills />
        </Embedded>
      )}
      {active === "connectors" && (
        <Embedded>
          <Browse />
        </Embedded>
      )}
      {active === "permissions" && <Capabilities ctx={ctx} permissionsOnly embedded />}
    </div>
  );
}

/* ---------------- 用量与预算：用量 / 预算规则 / 费用明细 ---------------- */
export function UsageHub({ ctx }: { ctx: Context }) {
  const { tab } = useParams<{ tab?: string }>();
  const tabs: TabDef[] = [
    { key: "usage", label: "用量" },
    { key: "budgets", label: "预算规则" },
    { key: "costs", label: "费用明细" },
  ];
  const active = activeTab(tabs, tab);
  return (
    <div className="page wide">
      <h1 className="page-title">用量与预算</h1>
      <TabBar base="/agentself/usage" tabs={tabs} active={active} testId="usage-tabs" />
      {active === "usage" && <Usage ctx={ctx} embedded />}
      {active === "budgets" && (
        <Embedded>
          <AuditHub section="budgets" />
        </Embedded>
      )}
      {active === "costs" && (
        <Embedded>
          <AuditHub section="costs" />
        </Embedded>
      )}
    </div>
  );
}

/* ---------------- 记录：活动 / 运行审计 / 产物 / 审批历史 ---------------- */
export function RecordsHub() {
  const { tab } = useParams<{ tab?: string }>();
  const tabs: TabDef[] = [
    { key: "activity", label: "活动" },
    { key: "runs", label: "运行审计" },
    { key: "artifacts", label: "产物" },
    { key: "approvals", label: "审批历史", path: "approvals/all" },
  ];
  const active = activeTab(tabs, tab);
  return (
    <div className="page wide">
      <h1 className="page-title">记录</h1>
      <TabBar base="/agentself/records" tabs={tabs} active={active} testId="records-tabs" />
      {active === "activity" && (
        <Embedded>
          <CompanyActivity />
        </Embedded>
      )}
      {active === "runs" && (
        <Embedded>
          <AuditHub section="runs" />
        </Embedded>
      )}
      {active === "artifacts" && (
        <Embedded>
          <Artifacts />
        </Embedded>
      )}
      {active === "approvals" && (
        // Approvals reads "all" from the last path segment: /agentself/records/approvals/all
        <Embedded>
          <Approvals />
        </Embedded>
      )}
    </div>
  );
}

/* ---------------- 组织图 ---------------- */
export function OrgPage() {
  return (
    <div className="page wide">
      <h1 className="page-title">组织图</h1>
      <Embedded>
        <OrgChart />
      </Embedded>
    </div>
  );
}

/* ---------------- 员工完整页：档案 / 记忆 + Paperclip 员工详情 ---------------- */
const EMPLOYEE_TABS: Array<{ key: string; label: string; to: (id: string) => string }> = [
  { key: "profile", label: "档案", to: (id) => `/agents/${id}/profile` },
  { key: "memory", label: "记忆", to: (id) => `/agents/${id}/memory` },
  { key: "overview", label: "概览", to: (id) => `/agents/${id}/overview` },
  { key: "instructions", label: "指令", to: (id) => `/agents/${id}/instructions` },
  { key: "skills", label: "技能", to: (id) => `/agents/${id}/skills` },
  { key: "runtime", label: "运行时（模型）", to: (id) => `/agents/${id}/runtime` },
  { key: "secrets", label: "密钥", to: (id) => `/agents/${id}/secrets` },
  { key: "tools", label: "工具", to: (id) => `/agents/${id}/tools` },
  { key: "permissions", label: "权限", to: (id) => `/agents/${id}/permissions` },
  { key: "runs", label: "运行记录", to: (id) => `/activity/runs?agentId=${id}` },
  { key: "budget", label: "预算", to: (id) => `/activity/budgets?agentId=${id}` },
];

export function EmployeePage({ ctx, toast, detail }: { ctx: Context | null; toast: (s: string) => void; detail: ReactNode }) {
  const { agentId, tab } = useParams<{ agentId: string; tab?: string }>();
  const location = useLocation();
  const isRun = /\/runs\//.test(location.pathname);
  const active = isRun ? "runs" : (tab ?? "overview");
  const ours = active === "profile" || active === "memory";
  const known = ctx?.agents.some((a) => a.id === agentId);
  return (
    <>
      <div className="agentself" data-testid="employee-page">
        <div className="employee-head">
          {ctx && agentId && known && <EmployeeHeader ctx={ctx} agentId={agentId} size={36} />}
          <div className="tabbar" role="tablist">
            {EMPLOYEE_TABS.map((x) => (
              <Link key={x.key} to={x.to(agentId!)} role="tab" aria-selected={active === x.key} className={active === x.key ? "on" : ""}>
                {x.label}
              </Link>
            ))}
          </div>
        </div>
        {ours && ctx && agentId && (
          <div className="page" style={{ paddingTop: 8 }}>
            <div className="drawer-like">{active === "profile" ? <EmployeeProfile ctx={ctx} agentId={agentId} toast={toast} /> : <EmployeeMemory agentId={agentId} toast={toast} />}</div>
          </div>
        )}
      </div>
      {!ours && <div style={{ padding: "0 24px 24px" }}>{detail}</div>}
    </>
  );
}
