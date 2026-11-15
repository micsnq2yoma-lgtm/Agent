// The one Agentself sidebar (PLAN 7.0), mounted by ui/src/components/Layout.tsx in place of
// Paperclip's own navigation. Daily items on top, the "管理" group collapsed by default.
// Paperclip's inbox, dashboard, new-task button, agent chat, cases, goals and company switcher
// are intentionally absent here; their routes still work by URL.
import { useState } from "react";
import { Link, useLocation, useParams } from "@/lib/router";
import { AS_BASE, useAgentselfOptional } from "../App";
import { useSkin } from "../lib/skin";
import { Robot, Wordmark } from "./Brand";

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
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const location = useLocation();
  const [manageOpen, setManageOpen] = useState(readManageOpen);
  const ctx = s?.ctx ?? null;

  // path relative to the company prefix, e.g. "/agentself/projects" or "/org"
  const rel = companyPrefix ? location.pathname.replace(new RegExp(`^/${companyPrefix}(?=/|$)`, "i"), "") || "/" : location.pathname;
  const isActive = (to: string, exact = false) => (exact ? rel === to : rel === to || rel.startsWith(`${to}/`));

  const item = (to: string, label: string, opts: { exact?: boolean; count?: number; hot?: boolean; testId?: string } = {}) => (
    <Link to={to} className={`nav-item ${isActive(to, opts.exact) ? "active" : ""}`} data-testid={opts.testId}>
      <span>{label}</span>
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
  const manageActive = ["/org", "/agents", "/agentself/capabilities", "/agentself/routines", "/routines", "/agentself/usage", "/costs", "/activity", "/approvals", "/skills"].some((p) => isActive(p));

  return (
    <div className="agentself" style={{ height: "100%", width: "100%" }} data-agentself-sidebar="">
      <aside className="sidebar" aria-label="Agentself 导航">
        <div className="brand">
          <Robot />
          <Wordmark />
          <span style={{ flex: 1 }} />
          <Link to="/search" className="btn ghost" title="搜索" aria-label="搜索" style={{ padding: "2px 6px" }}>
            ⌕
          </Link>
        </div>
        {item(AS_BASE, t("workbench"), { exact: true, count: s?.pending, hot: true, testId: "nav-workbench" })}
        {item(`${AS_BASE}/projects`, t("project"), { count: s?.projectCount, testId: "nav-projects" })}
        <div className="nav-section">
          <span>{t("department")}</span>
        </div>
        {depts.map((d) => {
          const lead = ctx?.agents.find((a) => a.id === d.leadAgentId);
          const n = s?.pendingByDept[d.name] ?? 0;
          const to = `${AS_BASE}/departments/${d.key}`;
          return (
            <Link key={d.key} to={to} className={`nav-item ${isActive(to) ? "active" : ""}`}>
              <Robot id={lead?.id ?? d.key} eye={lead?.adapterType === "codex_local" ? "codex" : "claude"} size={20} />
              <span>{d.name}</span>
              {n ? <span className="count hot">{n}</span> : null}
            </Link>
          );
        })}
        {item(`${AS_BASE}/departments/new`, `＋ 新建${t("department")}`, { exact: true })}
        {archived ? item(`${AS_BASE}/archived`, "已归档", { count: archived }) : null}

        <button className={`nav-section nav-toggle ${manageActive && !manageOpen ? "has-active" : ""}`} aria-expanded={manageOpen} onClick={toggleManage} data-testid="nav-manage">
          <span>管理</span>
          <span aria-hidden>{manageOpen ? "▾" : "▸"}</span>
        </button>
        {manageOpen && (
          <div className="nav-group">
            {item("/org", "组织图")}
            {item("/agents", `全部${t("employee")}`)}
            {item(`${AS_BASE}/capabilities`, "能力与工具")}
            {item(`${AS_BASE}/routines`, t("routine"))}
            {item(`${AS_BASE}/usage`, "用量与预算")}
            {item("/activity", "记录")}
          </div>
        )}
        <div className="spacer" />
        {item(`${AS_BASE}/settings`, "设置", { testId: "nav-settings" })}
        <div className="nav-me">
          <Link to="/company/settings/instance/profile" className={`nav-item ${isActive("/company/settings/instance/profile") ? "active" : ""}`}>
            <span>{t("user")}</span>
          </Link>
          <Link to={AS_BASE} className="nav-item" title="通知：等你拍板的卡片" onClick={() => s?.setFilter("decide")} style={{ width: "auto" }}>
            <span>通知</span>
            {s?.pending ? <span className="count hot">{s.pending}</span> : null}
          </Link>
        </div>
      </aside>
    </div>
  );
}
