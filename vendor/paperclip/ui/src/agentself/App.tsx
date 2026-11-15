// Agentself views as routes of the Paperclip UI (P8).
// <AgentselfRoot> wraps the company layout: it loads the Agentself context + feed once and
// provides them to the sidebar and every Agentself page, and hosts the drawers and toast so
// they work from any page. Pages are registered in routes.tsx.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { registerSkin, type Skin } from "@agentself/skins";
import { useNavigate, useParams } from "@/lib/router";
import { as, usePoll, type Context } from "./lib/api";
import { act, loadFeed, type Feed } from "./lib/feed";
import type { Card, Filter } from "./lib/cards";
import { SkinProvider, useSkin } from "./lib/skin";
import { Home } from "./views/Home";
import { Team } from "./views/Team";
import { ProjectDrawer } from "./views/ProjectDrawer";
import { EmployeeDrawer } from "./views/EmployeeDrawer";
import { Archived, Capabilities, NewDepartment, Projects, Routines, SettingsPage, Usage } from "./views/Pages";
import "./styles.css";

export const AS_BASE = "/agentself";

interface AgentselfState {
  ctx: Context | null;
  ctxError: string | null;
  reloadCtx: () => void;
  feed: Feed | null;
  feedError: string | null;
  reloadFeed: () => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  openProject: (issueId: string) => void;
  openEmployee: (agentId: string) => void;
  toast: (s: string) => void;
  runAct: (card: Card, opt: string) => Promise<void>;
  pending: number;
  pendingByDept: Record<string, number>;
  projectCount: number;
}

const StateCtx = createContext<AgentselfState | null>(null);
export function useAgentself(): AgentselfState {
  const v = useContext(StateCtx);
  if (!v) throw new Error("useAgentself outside <AgentselfRoot>");
  return v;
}
export function useAgentselfOptional(): AgentselfState | null {
  return useContext(StateCtx);
}

const EMPTY_FEED_DEPS: unknown[] = [];

export function AgentselfRoot({ children }: { children: ReactNode }) {
  const [ctx, ctxError, reloadCtx] = usePoll<Context>(
    async () => {
      // shared skins from ~/.agentself/skins must be registered before the provider reads them
      for (const s of await as.get<Skin[]>("/skins").catch(() => [])) registerSkin(s);
      return as.get<Context>("/context");
    },
    30000,
  );
  return (
    <SkinProvider initial={ctx?.settings?.skin ?? "office"}>
      <FeedLayer ctx={ctx} ctxError={ctxError} reloadCtx={reloadCtx}>
        {children}
      </FeedLayer>
    </SkinProvider>
  );
}

function FeedLayer({ ctx, ctxError, reloadCtx, children }: { ctx: Context | null; ctxError: string | null; reloadCtx: () => void; children: ReactNode }) {
  const { t } = useSkin();
  const [feed, feedError, reloadFeed] = usePoll<Feed | null>(
    () => (ctx?.company ? loadFeed(ctx) : Promise.resolve(null)),
    5000,
    ctx ? [ctx.company?.id, ctx.agents.length] : EMPTY_FEED_DEPS,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [project, setProject] = useState<string | null>(null);
  const [employee, setEmployee] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = useCallback((s: string) => {
    setToastMsg(s);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);
  const runAct = useCallback(
    async (card: Card, opt: string) => {
      try {
        await act(card, opt);
        toast("已处理");
        reloadFeed();
      } catch (e) {
        toast(`处理失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [reloadFeed, toast],
  );

  // browser notification for new high-tier cards
  useEffect(() => {
    if (!feed || typeof Notification === "undefined") return;
    const key = "agentself.notified";
    let seen: string[] = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    } catch {
      /* ignore */
    }
    const fresh = feed.cards.filter((c) => c.type === "decide" && !seen.includes(c.id));
    if (fresh.length && Notification.permission === "granted" && document.hidden) {
      for (const c of fresh.slice(0, 3)) new Notification(`${t("decide")}：${c.title}`, { body: `${c.department ?? ""}` });
    }
    try {
      sessionStorage.setItem(key, JSON.stringify([...seen, ...fresh.map((c) => c.id)].slice(-200)));
    } catch {
      /* ignore */
    }
  }, [feed, t]);

  const value = useMemo<AgentselfState>(() => {
    const pendingByDept: Record<string, number> = {};
    for (const c of feed?.cards ?? []) if (c.type === "decide" && c.department) pendingByDept[c.department] = (pendingByDept[c.department] ?? 0) + 1;
    return {
      ctx,
      ctxError,
      reloadCtx,
      feed,
      feedError,
      reloadFeed,
      filter,
      setFilter,
      openProject: setProject,
      openEmployee: setEmployee,
      toast,
      runAct,
      pending: (feed?.cards ?? []).filter((c) => c.type === "decide").length,
      pendingByDept,
      projectCount: (feed?.issues ?? []).filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status)).length,
    };
  }, [ctx, ctxError, reloadCtx, feed, feedError, reloadFeed, filter, toast, runAct]);

  return (
    <StateCtx.Provider value={value}>
      {children}
      {ctx?.company && project && (
        <div className="agentself">
          <ProjectDrawer ctx={ctx} issueId={project} onClose={() => setProject(null)} toast={toast} />
        </div>
      )}
      {ctx?.company && employee && (
        <div className="agentself">
          <EmployeeDrawer ctx={ctx} agentId={employee} onClose={() => setEmployee(null)} toast={toast} />
        </div>
      )}
      {toastMsg && (
        <div className="agentself">
          <div className="toast">{toastMsg}</div>
        </div>
      )}
    </StateCtx.Provider>
  );
}

/* ---------------- pages ---------------- */

function readView(): "work" | "team" {
  try {
    return localStorage.getItem("agentself.view") === "team" ? "team" : "work";
  } catch {
    return "work";
  }
}

function PageFrame({ ctx, children, topbar }: { ctx: Context | null; children: (ctx: Context) => ReactNode; topbar?: ReactNode }) {
  const s = useAgentself();
  const navigate = useNavigate();
  let body: ReactNode;
  if (s.ctxError && !ctx)
    body = (
      <div className="page">
        <div className="empty">
          连不上 Agentself 本地服务：{s.ctxError}
          <br />
          请确认用 `node scripts/start.mjs` 启动（它会同时拉起本地服务）。
        </div>
      </div>
    );
  else if (!ctx) body = <div className="page">加载中…</div>;
  else if (!ctx.company)
    body = (
      <div className="page">
        <div className="empty">还没有团队。运行 `node scripts/setup-department.mjs packs/departments/research.json` 建一个示例部门，或稍后在这里新建。</div>
      </div>
    );
  else body = children(ctx);
  return (
    <div className="agentself as-page">
      <div className="topbar">
        {topbar ?? <span />}
        {s.pending > 0 && (
          <button
            className="pending-badge"
            onClick={() => {
              s.setFilter("decide");
              navigate(AS_BASE);
            }}
          >
            {s.pending} 件等你拍板
          </button>
        )}
      </div>
      {s.feedError && <div className="error-banner">数据刷新失败：{s.feedError}</div>}
      <div className="content">{body}</div>
    </div>
  );
}

/** 工作台 / 像素团队; with :departmentKey it shows one department. */
export function WorkbenchPage() {
  const s = useAgentself();
  const { t } = useSkin();
  const { departmentKey } = useParams<{ departmentKey?: string }>();
  const [view, setViewState] = useState<"work" | "team">(readView);
  const setView = (v: "work" | "team") => {
    setViewState(v);
    try {
      localStorage.setItem("agentself.view", v);
    } catch {
      /* ignore */
    }
  };
  const department = departmentKey ? (s.ctx?.departments.find((d) => d.key === departmentKey)?.name ?? null) : null;
  const toggle = (
    <div className="toggle" role="tablist">
      <button role="tab" aria-selected={view === "work"} className={view === "work" ? "on" : ""} onClick={() => setView("work")}>
        {t("workbench")}
      </button>
      <button role="tab" aria-selected={view === "team"} className={view === "team" ? "on" : ""} onClick={() => setView("team")}>
        {t("team")}
      </button>
    </div>
  );
  return (
    <PageFrame ctx={s.ctx} topbar={toggle}>
      {(ctx) =>
        view === "team" ? (
          <Team ctx={ctx} cards={s.feed?.cards ?? []} department={department} openProject={s.openProject} openEmployee={s.openEmployee} act={(c, o) => void s.runAct(c, o)} />
        ) : (
          <Home ctx={ctx} feed={s.feed} reload={s.reloadFeed} department={department} filter={s.filter} setFilter={s.setFilter} openProject={s.openProject} toast={s.toast} />
        )
      }
    </PageFrame>
  );
}

export function ProjectsPage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <Projects ctx={ctx} issues={s.feed?.issues ?? []} openProject={s.openProject} />}</PageFrame>;
}
export function RoutinesPage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <Routines ctx={ctx} />}</PageFrame>;
}
export function CapabilitiesPage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <Capabilities ctx={ctx} />}</PageFrame>;
}
export function UsagePage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <Usage ctx={ctx} />}</PageFrame>;
}
export function SettingsRoutePage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <SettingsPage ctx={ctx} onSaved={s.reloadCtx} />}</PageFrame>;
}
export function ArchivedPage() {
  const s = useAgentself();
  return <PageFrame ctx={s.ctx}>{(ctx) => <Archived ctx={ctx} onChange={s.reloadCtx} />}</PageFrame>;
}
export function NewDepartmentPage() {
  const s = useAgentself();
  const { t } = useSkin();
  const navigate = useNavigate();
  return (
    <PageFrame ctx={s.ctx}>
      {(ctx) => (
        <NewDepartment
          ctx={ctx}
          onCreated={(key) => {
            s.reloadCtx();
            s.toast(`${t("department")}已创建`);
            try {
              localStorage.setItem("agentself.view", "team");
            } catch {
              /* ignore */
            }
            navigate(`${AS_BASE}/departments/${key}`);
          }}
        />
      )}
    </PageFrame>
  );
}
