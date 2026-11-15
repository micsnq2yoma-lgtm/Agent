// P10 page integration (PLAN 7.0 merge table): department page, employee full page, and the
// merged 能力与工具 / 用量与预算 / 记录 / 组织图 pages. Paperclip's own page components are
// embedded as tabs, so each object keeps exactly one full page inside the one app.
import { lazy, Suspense, type ReactNode } from "react";
import { Link, useLocation, useParams } from "@/lib/router";
import type { Context } from "../lib/api";
import type { Card } from "../lib/cards";
import { useSkin } from "../lib/skin";
import { Robot, eyeOf, modelName } from "../components/Brand";
import { Capabilities, Projects, Routines, Usage } from "./Pages";
import { Team } from "./Team";
import { EmployeeHeader, EmployeeMemory, EmployeeProfile } from "./EmployeeDrawer";

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
      <Suspense fallback={<div className="hint">加载中…</div>}>{children}</Suspense>
    </div>
  );
}

function activeTab(tabs: TabDef[], tab: string | undefined) {
  return tabs.some((x) => x.key === tab) ? tab! : tabs[0].key;
}

/* ---------------- 部门页：概览 / 成员 / 例行任务 / 能力 / 预算 ---------------- */
export function DepartmentPage(props: {
  ctx: Context;
  issues: Parameters<typeof Projects>[0]["issues"];
  cards: Card[];
  openProject: (id: string) => void;
  openEmployee: (id: string) => void;
  act: (c: Card, o: string) => void;
}) {
  const { t } = useSkin();
  const { departmentKey, tab } = useParams<{ departmentKey: string; tab?: string }>();
  const { ctx } = props;
  const dept = ctx.departments.find((d) => d.key === departmentKey);
  if (!dept) return <div className="page"><div className="empty">没有这个{t("department")}</div></div>;
  const tabs: TabDef[] = [
    { key: "overview", label: "概览" },
    { key: "members", label: "成员" },
    { key: "routines", label: t("routine") },
    { key: "capabilities", label: "能力" },
    { key: "budget", label: "预算" },
  ];
  const active = activeTab(tabs, tab);
  const members = ctx.agents.filter((a) => dept.members.includes(a.id) || a.id === dept.leadAgentId);
  const lead = ctx.agents.find((a) => a.id === dept.leadAgentId);
  const decide = props.cards.filter((c) => c.type === "decide" && c.department === dept.name);
  return (
    <div className="page" data-testid="department-page">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Robot id={lead?.id ?? dept.key} eye={eyeOf(lead?.adapterType)} size={36} />
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{dept.name}</h1>
          <div className="sub">{dept.description}</div>
        </div>
      </div>
      <TabBar base={`/agentself/departments/${dept.key}`} tabs={tabs} active={active} testId="department-tabs" />
      {active === "overview" && (
        <>
          <Team ctx={ctx} cards={props.cards} department={dept.name} openProject={props.openProject} openEmployee={props.openEmployee} act={props.act} />
          <div className="section" style={{ marginTop: 14 }}>
            <h2>
              {t("decide")}（{decide.length}）
            </h2>
            {decide.length === 0 && <div className="sub">没有等你拍板的事</div>}
            {decide.map((c) => (
              <div key={c.id} className="row">
                <span>{c.title}</span>
                {c.issueId && (
                  <button className="btn" onClick={() => props.openProject(c.issueId!)}>
                    打开
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="section">
            <h2>进行中的{t("project")}</h2>
            <Projects ctx={ctx} issues={props.issues} openProject={props.openProject} departmentKey={dept.key} embedded />
          </div>
        </>
      )}
      {active === "members" && (
        <table className="data">
          <thead>
            <tr>
              <th>{t("employee")}</th>
              <th>职位</th>
              <th>模型</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((a) => (
              <tr key={a.id}>
                <td>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <Robot id={a.id} eye={eyeOf(a.adapterType)} size={20} grey={a.status === "paused"} />
                    {a.name}
                  </span>
                </td>
                <td>{a.id === dept.leadAgentId ? t("lead") : (a.title ?? "")}</td>
                <td>{modelName(a)}</td>
                <td>{a.status}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn ghost" onClick={() => props.openEmployee(a.id)}>
                    快速查看
                  </button>
                  <Link className="btn" to={`/agents/${a.id}/profile`}>
                    完整页
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {active === "routines" && <Routines ctx={ctx} departmentKey={dept.key} embedded />}
      {active === "capabilities" && <Capabilities ctx={ctx} agentIds={members.map((m) => m.id)} embedded />}
      {active === "budget" && <Usage ctx={ctx} departmentKey={dept.key} embedded />}
    </div>
  );
}

/* ---------------- 能力与工具：技能 / 连接器 / 权限 ---------------- */
export function CapabilitiesHub({ ctx }: { ctx: Context }) {
  const { tab } = useParams<{ tab?: string }>();
  const tabs: TabDef[] = [
    { key: "skills", label: "技能" },
    { key: "connectors", label: "连接器" },
    { key: "permissions", label: "权限" },
  ];
  const active = activeTab(tabs, tab);
  return (
    <div className="page wide">
      <h1 style={{ fontSize: 20 }}>能力与工具</h1>
      <TabBar base="/agentself/capabilities" tabs={tabs} active={active} testId="capabilities-tabs" />
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
      <h1 style={{ fontSize: 20 }}>用量与预算</h1>
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
      <h1 style={{ fontSize: 20 }}>记录</h1>
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
      <h1 style={{ fontSize: 20 }}>组织图</h1>
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
