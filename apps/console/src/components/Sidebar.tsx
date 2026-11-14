import type { Context } from "../lib/api";
import { useSkin } from "../lib/skin";
import { Robot, Wordmark } from "./Brand";

export type Route =
  | { page: "home" }
  | { page: "projects" }
  | { page: "routines" }
  | { page: "capabilities" }
  | { page: "usage" }
  | { page: "settings" }
  | { page: "archived" }
  | { page: "new-department" };

export function Sidebar(props: {
  ctx: Context | null;
  route: Route;
  go: (r: Route) => void;
  department: string | null;
  setDepartment: (d: string | null) => void;
  pendingByDept: Record<string, number>;
  projectCount: number;
}) {
  const { t } = useSkin();
  const { route, go, ctx } = props;
  const item = (r: Route, label: string, count?: number, hot = false) => (
    <button className={`nav-item ${route.page === r.page && !props.department ? "active" : ""}`} onClick={() => (props.setDepartment(null), go(r))}>
      <span>{label}</span>
      {count ? <span className={`count ${hot ? "hot" : ""}`}>{count}</span> : null}
    </button>
  );
  const depts = (ctx?.departments ?? []).filter((d) => !d.archived);
  return (
    <aside className="sidebar">
      <div className="brand">
        <Robot />
        <Wordmark />
      </div>
      {item({ page: "home" }, t("workbench"))}
      {item({ page: "projects" }, t("project"), props.projectCount)}
      {item({ page: "routines" }, t("routine"))}
      {item({ page: "capabilities" }, "能力与工具")}
      {item({ page: "usage" }, "用量")}
      <div className="nav-section">
        <span>{t("department")}</span>
        <button title={`新建${t("department")}`} onClick={() => go({ page: "new-department" })}>
          ＋
        </button>
      </div>
      {depts.map((d) => {
        const lead = ctx?.agents.find((a) => a.id === d.leadAgentId);
        const n = props.pendingByDept[d.name] ?? 0;
        return (
          <button
            key={d.key}
            className={`nav-item ${props.department === d.name ? "active" : ""}`}
            onClick={() => {
              props.setDepartment(props.department === d.name ? null : d.name);
              if (route.page !== "home") go({ page: "home" });
            }}
          >
            <Robot id={lead?.id ?? d.key} eye={lead?.adapterType === "codex_local" ? "codex" : "claude"} size={20} />
            <span>{d.name}</span>
            {n ? <span className="count hot">{n}</span> : null}
          </button>
        );
      })}
      {item({ page: "archived" }, "已归档", (ctx?.departments ?? []).filter((d) => d.archived).length || undefined)}
      <div className="spacer" />
      {item({ page: "settings" }, "设置")}
      <div className="nav-item" style={{ cursor: "default" }}>
        <span>{t("user")}</span>
      </div>
    </aside>
  );
}
