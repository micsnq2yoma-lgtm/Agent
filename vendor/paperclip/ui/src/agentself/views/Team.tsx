import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OfficeSnapshot } from "@agentself/shared";
import { ACTION_TEXT, DARK_PALETTE, DEFAULT_PALETTE, OfficeRenderer, type Label } from "@agentself/pixel-office";
import { as, type Context } from "../lib/api";
import type { Card } from "../lib/cards";
import { useSkin } from "../lib/skin";

const ANIM_TEXT = ACTION_TEXT;
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
  const { t, skin, dark } = useSkin();
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
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => { r.reducedMotion = media.matches; };
    media.addEventListener("change", motionChanged);
    r.start();
    const tick = setInterval(() => setLabels(r.labels()), 120);
    return () => {
      r.stop();
      clearInterval(tick);
      media.removeEventListener("change", motionChanged);
    };
  }, []);

  useEffect(() => {
    // The office skin has full light / dark palettes (DESIGN §5); other skins override four keys.
    const base = dark ? DARK_PALETTE : DEFAULT_PALETTE;
    rendererRef.current?.setPalette(
      skin.id === "office" ? base : { ...base, floorA: skin.office.floor, wall: skin.office.wall, desk: skin.office.desk, accent: skin.office.accent },
    );
  }, [skin, dark]);

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
      {snapshot && snapshot.people.length === 0 && <div className="empty"><b>还没有{t("employee")}</b><span>在侧栏「{t("lead")}」旁边点加号，新建一位{t("lead")}和他的{t("employee")}。</span></div>}
      <div className="office-scroll">
      <div className="office-wrap" style={{ maxWidth: worldW * 4, minWidth: worldW * 2, margin: "0 auto" }}>
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
          <div key={`speech-${l.agentId}`} className="employee-speech" style={{ left: `${l.left * 100}%`, top: `${l.bubbleTop * 100}%` }}>
            <strong>{ANIM_TEXT[l.anim]}</strong>
            {l.bubble && <span title={l.bubble}>{l.bubble}</span>}
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
              <button className="icon-btn xs plain" onClick={() => setSelected(null)} aria-label="关闭">
                <X />
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
      </div>
      <div className="hint" style={{ textAlign: "center" }}>
        敲电脑 = 工作中；举牌 = 等待决策；拿报告 = 交付；暂停时静止。对话框显示当前任务。
      </div>
    </div>
  );
}
