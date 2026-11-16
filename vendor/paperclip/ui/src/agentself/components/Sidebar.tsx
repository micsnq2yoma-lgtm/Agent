// The one Agentself sidebar (PLAN 7.0), mounted by ui/src/components/Layout.tsx in place of
// Paperclip's own navigation. v0.6 SETO (DESIGN §4.1): four top-level items — 工作台, 项目,
// 主管 (one row per lead + new), 管理 (collapsed) — and 设置 pinned at the bottom.
// Paperclip's inbox, dashboard, agent chat, cases, goals and company switcher stay reachable by URL.
import { useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight, Folder, House, PanelLeftClose, Plus, Search, Settings } from "lucide-react";
import { Link, useLocation, useParams } from "@/lib/router";
import { useSidebar } from "@/context/SidebarContext";
import { AS_BASE, useAgentselfOptional } from "../App";
import { useSkin } from "../lib/skin";
import { PackIcon } from "../lib/icons";
import { Wordmark } from "./Brand";

const MANAGE_KEY = "agentself.sidebar.manageOpen";

function readManageOpen(): boolean {
  try {
    return localStorage.getItem(MANAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AgentselfSidebar() {
  const s = useAgentselfOptional();
  const { t } = useSkin();
  const { toggleSidebar } = useSidebar();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const location = useLocation();
  const [manageOpen, setManageOpen] = useState(readManageOpen);
  const ctx = s?.ctx ?? null;

  // path relative to the company prefix, e.g. "/agentself/projects" or "/org"
  const rel = companyPrefix ? location.pathname.replace(new RegExp(`^/${companyPrefix}(?=/|$)`, "i"), "") || "/" : location.pathname;
  const isActive = (to: string, exact = false) => (exact ? rel === to : rel === to || rel.startsWith(`${to}/`));

  const item = (to: string, label: string, opts: { exact?: boolean; count?: number; hot?: boolean; testId?: string; icon?: ReactNode } = {}) => (
    <Link to={to} className={`nav-item ${isActive(to, opts.exact) ? "active" : ""}`} data-testid={opts.testId}>
      {opts.icon}
      <span className="label">{label}</span>
      {opts.count ? <span className={`count ${opts.hot ? "hot" : ""}`}>{opts.count}</span> : null}
    </Link>
  );

  const toggleManage = () => {
    const next = !manageOpen;
    setManageOpen(next);
    try {
      localStorage.setItem(MANAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const depts = (ctx?.departments ?? []).filter((d) => !d.archived);
  const archived = (ctx?.departments ?? []).filter((d) => d.archived).length;
  const manageActive = ["/agentself/org", "/org", "/agents", "/agentself/capabilities", "/agentself/routines", "/routines", "/agentself/usage", "/agentself/records", "/costs", "/activity", "/approvals", "/skills", "/apps", "/artifacts", "/agentself/archived"].some((p) => isActive(p));

  return (
    <div className="agentself" style={{ height: "100%", width: "100%" }} data-agentself-sidebar="">
      <aside className="sidebar" aria-label="Agentself 导航">
        <div className="brand">
          <Wordmark />
          <span style={{ flex: 1 }} />
          <button className="icon-btn xs plain" aria-label="收起侧栏" title="收起侧栏" onClick={toggleSidebar}>
            <PanelLeftClose />
          </button>
        </div>
        <Link to="/search" className="search-pill" aria-label="搜索">
          <Search aria-hidden="true" />
          <span>搜索</span>
        </Link>

        {item(AS_BASE, t("workbench"), { exact: true, count: s?.pending, hot: true, testId: "nav-workbench", icon: <House aria-hidden="true" /> })}
        {item(`${AS_BASE}/projects`, t("project"), { count: s?.projectCount, testId: "nav-projects", icon: <Folder aria-hidden="true" /> })}
        {item(`${AS_BASE}/library`, "论文库", { testId: "nav-library", icon: <BookOpen aria-hidden="true" /> })}

        <div className="nav-section">
          <span>{t("lead")}</span>
          <Link to={`${AS_BASE}/departments/new`} className="icon-btn xs plain" aria-label={`新建${t("lead")}`} title={`新建${t("lead")}`}>
            <Plus />
          </Link>
        </div>
        {depts.map((d) => {
          const lead = ctx?.agents.find((a) => a.id === d.leadAgentId);
          const n = s?.pendingByDept[d.key] ?? 0;
          const to = `${AS_BASE}/departments/${d.key}`;
          // Always the lead's name; a team without a lead (made before plan B) says so instead of
          // passing its team name off as a lead.
          return (
            <Link key={d.key} to={to} className={`nav-item ${isActive(to) ? "active" : ""}`} title={lead ? `${lead.name} · ${d.name}` : `${d.name}：还没有${t("lead")}`}>
              <PackIcon name={d.icon} />
              <span className="label">{lead?.name ?? d.name}</span>
              {!lead && <span className="nav-note">无{t("lead")}</span>}
              {n ? <span className="count hot">{n}</span> : null}
            </Link>
          );
        })}
        {depts.length === 0 && item(`${AS_BASE}/departments/new`, `新建${t("lead")}`, { exact: true, icon: <Plus aria-hidden="true" /> })}

        <button className={`nav-section nav-toggle ${manageActive && !manageOpen ? "has-active" : ""}`} aria-expanded={manageOpen} onClick={toggleManage} data-testid="nav-manage">
          <span>管理</span>
          {manageOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
        {manageOpen && (
          <div className="nav-group">
            {item(`${AS_BASE}/org`, "组织图")}
            {item("/agents/all", `全部${t("employee")}`)}
            {item(`${AS_BASE}/capabilities`, "能力与工具")}
            {item(`${AS_BASE}/routines`, t("routine"))}
            {item(`${AS_BASE}/usage`, "用量与预算")}
            {item(`${AS_BASE}/records`, "记录")}
            {archived ? item(`${AS_BASE}/archived`, "已归档", { count: archived }) : null}
          </div>
        )}
        <div className="spacer" />
        {item(`${AS_BASE}/settings`, "设置", { testId: "nav-settings", icon: <Settings aria-hidden="true" /> })}
      </aside>
    </div>
  );
}
