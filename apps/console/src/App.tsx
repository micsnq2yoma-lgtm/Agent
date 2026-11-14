import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { as, usePoll, type Context } from "./lib/api";
import { registerSkin, type Skin } from "@agentself/skins";
import { act, loadFeed, type Feed } from "./lib/feed";
import type { Card, Filter } from "./lib/cards";
import { SkinProvider, useSkin } from "./lib/skin";
import { Sidebar, type Route } from "./components/Sidebar";
import { Home } from "./views/Home";
import { Team } from "./views/Team";
import { ProjectDrawer } from "./views/ProjectDrawer";
import { EmployeeDrawer } from "./views/EmployeeDrawer";
import { Archived, Capabilities, NewDepartment, Projects, Routines, SettingsPage, Usage } from "./views/Pages";

function readView(): "work" | "team" {
  try {
    return localStorage.getItem("agentself.view") === "team" ? "team" : "work";
  } catch {
    return "work";
  }
}

function Shell({ ctx, reloadCtx }: { ctx: Context; reloadCtx: () => void }) {
  const { t } = useSkin();
  const [route, setRoute] = useState<Route>({ page: "home" });
  const [view, setViewState] = useState<"work" | "team">(readView);
  const [department, setDepartment] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [project, setProject] = useState<string | null>(null);
  const [employee, setEmployee] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [feed, feedErr, reload] = usePoll<Feed>(() => loadFeed(ctx), 5000, [ctx.company?.id, ctx.agents.length]);

  const setView = (v: "work" | "team") => {
    setViewState(v);
    try {
      localStorage.setItem("agentself.view", v);
    } catch {
      /* ignore */
    }
  };
  const toast = useCallback((s: string) => {
    setToastMsg(s);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const pendingByDept = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of feed?.cards ?? []) if (c.type === "decide" && c.department) m[c.department] = (m[c.department] ?? 0) + 1;
    return m;
  }, [feed]);
  const pending = (feed?.cards ?? []).filter((c) => c.type === "decide").length;
  const projectCount = (feed?.issues ?? []).filter((i) => !i.parentId && !["done", "cancelled"].includes(i.status)).length;

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
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  }, []);

  const runAct = async (card: Card, opt: string) => {
    try {
      await act(card, opt);
      toast("已处理");
      reload();
    } catch (e) {
      toast(`处理失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  let body: React.JSX.Element;
  if (route.page === "home") {
    body =
      view === "team" ? (
        <Team ctx={ctx} cards={feed?.cards ?? []} department={department} openProject={setProject} openEmployee={setEmployee} act={(c, o) => void runAct(c, o)} />
      ) : (
        <Home ctx={ctx} feed={feed} reload={reload} department={department} filter={filter} setFilter={setFilter} openProject={setProject} toast={toast} />
      );
  } else if (route.page === "projects") body = <Projects ctx={ctx} issues={feed?.issues ?? []} openProject={setProject} />;
  else if (route.page === "routines") body = <Routines ctx={ctx} />;
  else if (route.page === "capabilities") body = <Capabilities ctx={ctx} />;
  else if (route.page === "usage") body = <Usage ctx={ctx} />;
  else if (route.page === "settings") body = <SettingsPage ctx={ctx} onSaved={reloadCtx} />;
  else if (route.page === "archived") body = <Archived ctx={ctx} onChange={reloadCtx} />;
  else
    body = (
      <NewDepartment
        ctx={ctx}
        onCreated={() => {
          reloadCtx();
          toast(`${t("department")}已创建`);
          setRoute({ page: "home" });
          setView("team");
        }}
      />
    );

  return (
    <div className="shell">
      <Sidebar ctx={ctx} route={route} go={setRoute} department={department} setDepartment={setDepartment} pendingByDept={pendingByDept} projectCount={projectCount} />
      <main className="main">
        <div className="topbar">
          {route.page === "home" ? (
            <div className="toggle" role="tablist">
              <button role="tab" aria-selected={view === "work"} className={view === "work" ? "on" : ""} onClick={() => setView("work")}>
                {t("workbench")}
              </button>
              <button role="tab" aria-selected={view === "team"} className={view === "team" ? "on" : ""} onClick={() => setView("team")}>
                {t("team")}
              </button>
            </div>
          ) : (
            <span />
          )}
          {pending > 0 && (
            <button
              className="pending-badge"
              onClick={() => {
                setRoute({ page: "home" });
                setView("work");
                setFilter("decide");
              }}
            >
              {pending} 件等你拍板
            </button>
          )}
        </div>
        {feedErr && <div className="error-banner">数据刷新失败：{feedErr}</div>}
        <div className="content">{body}</div>
      </main>
      {project && <ProjectDrawer ctx={ctx} issueId={project} onClose={() => setProject(null)} toast={toast} />}
      {employee && <EmployeeDrawer ctx={ctx} agentId={employee} onClose={() => setEmployee(null)} toast={toast} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

export function App() {
  const [ctx, err, reload] = usePoll<Context>(
    async () => {
      // shared skins from ~/.agentself/skins must be registered before the provider reads them
      for (const s of await as.get<Skin[]>("/skins").catch(() => [])) registerSkin(s);
      return as.get<Context>("/context");
    },
    30000,
  );
  if (err && !ctx)
    return (
      <div className="page">
        <div className="empty">
          连不上 Agentself 服务：{err}
          <br />
          请确认 Paperclip（3100）和 console 服务（3200）都在运行。
        </div>
      </div>
    );
  if (!ctx) return <div className="page">加载中…</div>;
  if (!ctx.company)
    return (
      <SkinProvider initial={ctx.settings?.skin ?? "office"}>
        <div className="page">
          <div className="empty">还没有团队。运行 `node scripts/setup-department.mjs packs/departments/research.json` 建一个示例部门，或稍后在这里新建。</div>
        </div>
      </SkinProvider>
    );
  return (
    <SkinProvider initial={ctx.settings.skin}>
      <Shell ctx={ctx} reloadCtx={reload} />
    </SkinProvider>
  );
}
