import { useEffect, useRef, useState } from "react";
import type { OfficeSnapshot } from "@agentself/shared";
import { OfficeRenderer, type Label } from "@agentself/pixel-office";
import { as, type Context } from "../lib/api";
import type { Card } from "../lib/cards";
import { useSkin } from "../lib/skin";

const ANIM_TEXT: Record<string, string> = {
  failed: "出错了",
  waiting: "等你拍板",
  working: "工作中",
  delivering: "交付待验收",
  paused: "暂停",
  idle: "空闲",
  walk_to_lead: "去交付",
};
const ANIM_DOT: Record<string, string> = {
  failed: "var(--as-high)",
  waiting: "#ffc56b",
  working: "var(--as-success)",
  delivering: "var(--as-medium)",
  paused: "#9a9a9a",
  idle: "var(--as-border)",
  walk_to_lead: "var(--as-medium)",
};

export function Team(props: {
  ctx: Context;
  cards: Card[];
  department: string | null;
  openProject: (issueId: string) => void;
  openEmployee: (agentId: string) => void;
  act: (card: Card, opt: string) => void;
}) {
  const { t, skin } = useSkin();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OfficeRenderer | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [zones, setZones] = useState<Array<{ id: string; name: string; left: number }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [worldW, setWorldW] = useState(300);

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new OfficeRenderer(canvasRef.current);
    rendererRef.current = r;
    r.start();
    const tick = setInterval(() => setLabels(r.labels()), 120);
    return () => {
      r.stop();
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setPalette({ floorA: skin.office.floor, wall: skin.office.wall, desk: skin.office.desk, accent: skin.office.accent });
  }, [skin]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await as.get<OfficeSnapshot>("/office");
        if (!alive) return;
        const filtered = props.department
          ? { ...s, departments: s.departments.filter((d) => d.name === props.department), people: s.people.filter((p) => s.departments.find((d) => d.id === p.departmentId)?.name === props.department) }
          : s;
        setSnapshot(filtered);
        rendererRef.current?.setSnapshot(filtered);
        setZones(rendererRef.current?.zoneLabels() ?? []);
        if (canvasRef.current) setWorldW(canvasRef.current.width);
        setLabels(rendererRef.current?.labels() ?? []);
      } catch {
        /* keep last frame */
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [props.department]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.selected = selected;
  }, [selected]);

  const person = snapshot?.people.find((p) => p.agentId === selected);
  const label = labels.find((l) => l.agentId === selected);
  const personCards = props.cards.filter((c) => c.type === "decide" && person && c.who === person.name);

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      {snapshot && snapshot.people.length === 0 && <div className="empty">还没有{t("employee")}。去侧栏「{t("department")} ＋」新建一个。</div>}
      <div className="office-wrap" style={{ maxWidth: worldW * 4, margin: "0 auto" }}>
        <canvas
          ref={canvasRef}
          width={300}
          height={180}
          aria-label={`${t("team")}：点击人物查看`}
          onClick={(e) => {
            const rc = e.currentTarget.getBoundingClientRect();
            const id = rendererRef.current?.hitTest((e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height) ?? null;
            setSelected(id);
          }}
        />
        {zones.map((z) => (
          <div key={z.id} className="zone-label" style={{ left: `${z.left * 100}%` }}>
            {z.name}
          </div>
        ))}
        {labels.map((l) => (
          <div key={l.agentId} className="nameplate" style={{ left: `${l.left * 100}%`, top: `${l.top * 100}%` }}>
            <span className="dot" style={{ background: ANIM_DOT[l.anim] }} />
            {l.isLead && !l.name.includes(t("lead")) ? `${l.name}·${t("lead")}` : l.name}
            <span className="m">{l.model}</span>
          </div>
        ))}
        {person && label && (
          <div className="popover" style={{ left: `min(calc(${label.left * 100}% + 12px), calc(100% - 270px))`, top: `${label.top * 100 + 4}%` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{person.name}</strong>
              <button className="close-x" style={{ fontSize: 16 }} onClick={() => setSelected(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--as-muted)" }}>
              {person.isLead ? t("lead") : person.title} · {person.model} · {ANIM_TEXT[person.anim]}
            </div>
            <div style={{ marginTop: 8, fontSize: 13 }}>{person.bubble ? `在做：${person.bubble}` : "现在没有进行中的任务"}</div>
            {personCards.map((c) => (
              <div key={c.id} style={{ marginTop: 8, fontSize: 13 }}>
                <div>{c.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {c.options.slice(0, 3).map((o) => (
                    <button key={o.id} className="btn" onClick={() => props.act(c, o.id)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {person.currentIssueId && (
                <button className="btn" onClick={() => props.openProject(person.currentIssueId!)}>
                  看{t("project")}
                </button>
              )}
              <button className="btn" onClick={() => props.openEmployee(person.agentId)}>
                档案
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="hint" style={{ textAlign: "center" }}>
        举牌 = 有{t("card")}等你；红色 ! = 出错；屏幕滚动 = 工作中。点人物看详情。
      </div>
    </div>
  );
}
