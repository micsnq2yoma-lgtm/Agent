// AgenTeam views as routes of the Paperclip UI (P8).
// <AgenteamRoot> wraps the company layout: it loads the AgenTeam context + feed once and
// provides them to the sidebar and every AgenTeam page, and hosts the drawers and toast so
// they work from any page. Pages are registered in routes.tsx.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { registerSkin, type Skin } from "@agenteam/skins";
import { useNavigate, useParams } from "@/lib/router";
import { as, usePoll, type Context } from "./lib/api";
import { act, loadFeed, type Feed } from "./lib/feed";
import type { Card, Filter } from "./lib/cards";
import { cardsOfLead } from "./lib/progress";
import { SkinProvider, useSkin } from "./lib/skin";
import { registerAgentAdapters } from "./lib/avatar";
import { Composer, Home } from "./views/Home";
import { CapabilitiesHub, DepartmentPage, EmployeePage, OrgPage, RecordsHub, UsageHub } from "./views/Hubs";
import { Team } from "./views/Team";
import { ProjectDrawer } from "./views/ProjectDrawer";
import { EmployeeDrawer } from "./views/EmployeeDrawer";
import { Archived, NewDepartment, Projects, Routines, SettingsPage, settingsTabLabel, useSettingsTab } from "./views/Pages";
import { LibraryView } from "./views/Library";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "./components/Skeleton";
import "./fonts-cjk.css";
import "./styles.css";

export const AS_BASE = "/agenteam";

interface AgenteamState {
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

const StateCtx = createContext<AgenteamState | null>(null);
export function useAgenteam(): AgenteamState {
  const v = useContext(StateCtx);
  if (!v) throw new Error("useAgenteam outside <AgenteamRoot>");
  return v;
}
export function useAgenteamOptional(): AgenteamState | null {
  return useContext(StateCtx);
}

const EMPTY_FEED_DEPS: unknown[] = [];

export function AgenteamRoot({ children }: { children: ReactNode }) {
  const [ctx, ctxError, reloadCtx] = usePoll<Context>(
    async () => {
      // shared skins from ~/.agenteam/skins must be registered before the provider reads them;
      // both requests go out together
      const [skinList, c] = await Promise.all([as.get<Skin[]>("/skins").catch(() => [] as Skin[]), as.get<Context>("/context")]);
      for (const s of skinList) registerSkin(s);
      registerAgentAdapters(c.agents);
      return c;
    },
    30000,
    [],
    "context",
  );
  // agents from the cached context need their adapters registered too (robot eyes)
  useEffect(() => {
    if (ctx) registerAgentAdapters(ctx.agents);
  }, [ctx]);
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
    ctx?.company ? `feed.${ctx.company.id}` : undefined,
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
    const key = "agenteam.notified";
    let seen: string[] = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    } catch {
      /* ignore */
    }
    const fresh = feed.cards.filter((c) => (c.type === "decide" || c.type === "hire") && !seen.includes(c.id));
    if (fresh.length && Notification.permission === "granted" && document.hidden) {
      for (const c of fresh.slice(0, 3)) new Notification(`${t("decide")}：${c.title}`, { body: `${c.department ?? ""}` });
    }
    try {
      sessionStorage.setItem(key, JSON.stringify([...seen, ...fresh.map((c) => c.id)].slice(-200)));
    } catch {
      /* ignore */
    }
  }, [feed, t]);

  const value = useMemo<AgenteamState>(() => {
    // keyed by team key, with the same membership rules as the lead page
    const pendingByDept: Record<string, number> = {};
    if (ctx && feed) for (const d of ctx.departments) pendingByDept[d.key] = cardsOfLead(ctx, feed.issues, feed.cards, d).length;
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
      pending: (feed?.cards ?? []).filter((c) => c.type === "decide" || c.type === "hire").length,
      pendingByDept,
      projectCount: (feed?.issues ?? []).filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status)).length,
    };
  }, [ctx, ctxError, reloadCtx, feed, feedError, reloadFeed, filter, toast, runAct]);

  return (
    <StateCtx.Provider value={value}>
      {children}
      {ctx?.company && project && (
        <div className="agenteam">
          <ProjectDrawer ctx={ctx} issueId={project} onClose={() => setProject(null)} toast={toast} cards={feed?.cards ?? []} />
        </div>
      )}
      {ctx?.company && employee && (
        <div className="agenteam">
          <EmployeeDrawer ctx={ctx} agentId={employee} onClose={() => setEmployee(null)} toast={toast} />
        </div>
      )}
      {toastMsg && (
        <div className="agenteam">
          <div className="toast">{toastMsg}</div>
        </div>
      )}
    </StateCtx.Provider>
  );
}

/* ---------------- pages ---------------- */

function readView(): "work" | "team" {
  try {
    return localStorage.getItem("agenteam.view") === "team" ? "team" : "work";
  } catch {
    return "work";
  }
}

export { Skeleton };

/**
 * Page frame (DESIGN §2 / §4.2): a 64px top bar with no bottom line — breadcrumbs on the left, an
 * optional centre control (the workbench / pixel-team switch), page actions on the right. The
 * pending count lives only on the sidebar's 工作台 item.
 */
function PageFrame({ ctx, children, crumbs, center, actions }: { ctx: Context | null; children: (ctx: Context) => ReactNode; crumbs?: ReactNode[]; center?: ReactNode; actions?: ReactNode }) {
  const s = useAgenteam();
  const navigate = useNavigate();
  const { t } = useSkin();
  let body: ReactNode;
  if (s.ctxError && !ctx)
    body = (
      <div className="page">
        <div className="empty">
          <b>连不上 AgenTeam 本地服务</b>
          <span>{s.ctxError}。请确认用 `node scripts/start.mjs` 启动，它会同时拉起本地服务。</span>
        </div>
      </div>
    );
  else if (!ctx)
    body = (
      <div className="page" style={{ maxWidth: 760, paddingTop: 48 }}>
        <Skeleton />
      </div>
    );
  else if (!ctx.company)
    body = (
      <div className="page">
        <div className="empty">
          <b>还没有团队</b>
          <span>先新建一位{t("lead")}和他的{t("employee")}，名字由你来定。</span>
          <button className="btn primary" onClick={() => navigate(`${AS_BASE}/departments/new`)}>
            新建{t("lead")}
          </button>
        </div>
      </div>
    );
  else body = children(ctx);
  return (
    <div className="agenteam as-page">
      <div className="topbar">
        <nav className="crumbs" aria-label="位置">
          {(crumbs ?? []).map((c, i, all) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {i === all.length - 1 ? <b>{c}</b> : c}
              {i < all.length - 1 && <ChevronRight aria-hidden="true" />}
            </span>
          ))}
        </nav>
        <div>{center}</div>
        <div className="actions">{actions}</div>
      </div>
      {s.feedError && <div className="error-banner">数据刷新失败：{s.feedError}</div>}
      <div className="content">{body}</div>
    </div>
  );
}

/** 像素团队顶部统计条 (P10): 运行中 / 阻塞 / 等你拍板 / 本月花费 */
function TeamStats({ ctx }: { ctx: Context }) {
  const s = useAgenteam();
  const { t } = useSkin();
  const running = ctx.agents.filter((a) => a.status === "running").length;
  const blocked = (s.feed?.issues ?? []).filter((i) => i.status === "blocked").length;
  const spent = (ctx.company?.spentMonthlyCents ?? 0) / 100;
  const budget = (ctx.company?.budgetMonthlyCents ?? 0) / 100;
  return (
    <div className="stats" data-testid="team-stats">
      <div><b>{running}</b><span>运行中</span></div>
      <div><b>{blocked}</b><span>阻塞</span></div>
      <div className={s.pending ? "hot" : ""}><b>{s.pending}</b><span>{t("decide")}</span></div>
      <div><b>${spent.toFixed(2)}</b><span>本月花费{budget ? ` / $${budget.toFixed(0)}` : ""}</span></div>
    </div>
  );
}

/** "工作台 · 2 位主管 · 3 名员工" (DESIGN §4.2) */
function WorkbenchCrumb({ ctx }: { ctx: Context | null }) {
  const { t } = useSkin();
  const live = (ctx?.departments ?? []).filter((d) => !d.archived);
  const leadIds = new Set(live.map((d) => d.leadAgentId).filter(Boolean));
  const employees = new Set(live.flatMap((d) => d.members).filter((id) => !leadIds.has(id) && ctx?.agents.find((a) => a.id === id)?.status !== "terminated"));
  return (
    <span>
      {t("workbench")}
      {ctx && (
        <span className="crumb-meta">
          {" "}· {leadIds.size} 位{t("lead")} · {employees.size} 名{t("employee")}
        </span>
      )}
    </span>
  );
}

/** 工作台 / 像素团队 */
export function WorkbenchPage() {
  const s = useAgenteam();
  const { t } = useSkin();
  const navigate = useNavigate();
  const [view, setViewState] = useState<"work" | "team">(readView);
  const setView = (v: "work" | "team") => {
    setViewState(v);
    try {
      localStorage.setItem("agenteam.view", v);
    } catch {
      /* ignore */
    }
  };
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
    <PageFrame ctx={s.ctx} crumbs={[<WorkbenchCrumb key="w" ctx={s.ctx} />]} center={toggle}>
      {(ctx) =>
        view === "team" ? (
          <div className="page">
            <TeamStats ctx={ctx} />
            <Team ctx={ctx} cards={s.feed?.cards ?? []} department={null} openProject={s.openProject} openEmployee={s.openEmployee} act={(c, o) => void s.runAct(c, o)} />
            <div style={{ marginTop: 14 }}>
              <Composer ctx={ctx} onDone={s.reloadFeed} />
            </div>
          </div>
        ) : (
          <Home
            ctx={ctx}
            feed={s.feed}
            reload={s.reloadFeed}
            department={null}
            filter={s.filter}
            setFilter={s.setFilter}
            openProject={s.openProject}
            openAllProjects={() => navigate(`${AS_BASE}/projects`)}
            toast={s.toast}
          />
        )
      }
    </PageFrame>
  );
}

export function DepartmentRoutePage() {
  const s = useAgenteam();
  const { t } = useSkin();
  const { departmentKey } = useParams<{ departmentKey: string }>();
  const dept = s.ctx?.departments.find((d) => d.key === departmentKey);
  const lead = s.ctx?.agents.find((a) => a.id === dept?.leadAgentId);
  return (
    <PageFrame ctx={s.ctx} crumbs={[t("lead"), lead?.name ?? dept?.name ?? ""]}>
      {(ctx) => <DepartmentPage ctx={ctx} issues={s.feed?.issues ?? []} cards={s.feed?.cards ?? []} openProject={s.openProject} openEmployee={s.openEmployee} act={(c, o) => void s.runAct(c, o)} toast={s.toast} />}
    </PageFrame>
  );
}
export function ProjectsPage() {
  const s = useAgenteam();
  const { t } = useSkin();
  return <PageFrame ctx={s.ctx} crumbs={[t("project")]}>{(ctx) => <Projects ctx={ctx} issues={s.feed?.issues ?? []} openProject={s.openProject} />}</PageFrame>;
}
export function LibraryPage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["论文库"]}>{() => <LibraryView toast={s.toast} />}</PageFrame>;
}
export function RoutinesPage() {
  const s = useAgenteam();
  const { t } = useSkin();
  return <PageFrame ctx={s.ctx} crumbs={["管理", t("routine")]}>{(ctx) => <Routines ctx={ctx} />}</PageFrame>;
}
export function CapabilitiesPage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["管理", "能力与工具"]}>{(ctx) => <CapabilitiesHub ctx={ctx} />}</PageFrame>;
}
export function UsagePage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["管理", "用量与预算"]}>{(ctx) => <UsageHub ctx={ctx} />}</PageFrame>;
}
export function RecordsPage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["管理", "记录"]}>{() => <RecordsHub />}</PageFrame>;
}
export function OrgRoutePage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["管理", "组织图"]}>{() => <OrgPage />}</PageFrame>;
}
/** Paperclip's employee detail wrapped with the 档案 / 记忆 tabs (mounted by ui/src/App.tsx). */
export function EmployeeRoute({ detail }: { detail: ReactNode }) {
  const s = useAgenteamOptional();
  return <EmployeePage ctx={s?.ctx ?? null} toast={s?.toast ?? (() => {})} detail={detail} />;
}
export function SettingsRoutePage() {
  const s = useAgenteam();
  const [tab, setTab] = useSettingsTab();
  return (
    <PageFrame ctx={s.ctx} crumbs={["设置", settingsTabLabel(tab)]}>
      {(ctx) => <SettingsPage ctx={ctx} onSaved={s.reloadCtx} tab={tab} setTab={setTab} />}
    </PageFrame>
  );
}
export function ArchivedPage() {
  const s = useAgenteam();
  return <PageFrame ctx={s.ctx} crumbs={["管理", "已归档"]}>{(ctx) => <Archived ctx={ctx} onChange={s.reloadCtx} />}</PageFrame>;
}
export function NewDepartmentPage() {
  const s = useAgenteam();
  const { t } = useSkin();
  const navigate = useNavigate();
  return (
    <PageFrame ctx={s.ctx} crumbs={[t("lead"), `新建${t("lead")}`]}>
      {(ctx) => (
        <NewDepartment
          ctx={ctx}
          onCreated={(key) => {
            s.reloadCtx();
            s.toast(`${t("department")}已创建`);
            try {
              localStorage.setItem("agenteam.view", "team");
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
