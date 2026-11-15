// Pixel office (PLAN 7.1). Input: an OfficeSnapshot. Output: a canvas drawing + label positions.
// Room drawing is ported from the v0.1 demo (our own work); people are original 8x8 pixel robots.
import type { OfficeAnim, OfficeSnapshot } from "@agentself/shared";

export interface OfficePalette {
  floorA: string;
  floorB: string;
  wall: string;
  wallDark: string;
  trim: string;
  sky: string;
  desk: string;
  deskTop: string;
  deskLeg: string;
  monitor: string;
  screenIdle: string;
  screenOn: string;
  code: string;
  plant: string;
  plantDark: string;
  pot: string;
  rug: string;
  rugB: string;
  chair: string;
  mug: string;
  shelf: string;
  books: string[];
  accent: string;
}

export const DEFAULT_PALETTE: OfficePalette = {
  floorA: "#e9e5de",
  floorB: "#e2ddd4",
  wall: "#f1eee8",
  wallDark: "#e6e2db",
  trim: "#d6cfc4",
  sky: "#cfe3f1",
  desk: "#8a6b4f",
  deskTop: "#b08a66",
  deskLeg: "#5e4733",
  monitor: "#2f2f3a",
  screenIdle: "#3a4660",
  screenOn: "#58d0ff",
  code: "#ffffff",
  plant: "#4f9a4a",
  plantDark: "#33703a",
  pot: "#c56a3d",
  rug: "#ede3d4",
  rugB: "#d9480f",
  chair: "#4a4458",
  mug: "#ffffff",
  shelf: "#7c5a3c",
  books: ["#c23b3b", "#3a5a8c", "#ffc56b", "#2b7a3b"],
  accent: "#d9480f",
};

export const EYE_COLORS = { claude: "#ffc56b", codex: "#4fd1e8", other: "#c9c3ff" } as const;
export const BODY_COLORS = ["#3a7bd5", "#2b7a3b", "#8a6bd6", "#d9480f", "#c23b3b", "#0f8a8a", "#b0892f", "#6b7280"];

/** 8x8 robot: a antenna, f frame, s screen, e eye, b body. */
export const ROBOT = ["...aa...", ".ffffff.", "ffssssff", "fsessesf", "fssssssf", ".ffffff.", "..bbbb..", ".b.bb.b."];

export const WORLD_H = 180;
export const ZONE_W = 150;
const TOP = 46;

export interface Seat {
  agentId: string;
  x: number;
  y: number;
  deskX: number;
  deskY: number;
  isLead: boolean;
  zone: number;
}

export interface Layout {
  width: number;
  height: number;
  zones: Array<{ id: string; name: string; x: number; w: number }>;
  seats: Seat[];
}

/** Pure layout: one zone per department (people without a department go to a shared zone). */
export function layoutOffice(snapshot: OfficeSnapshot): Layout {
  const zoneIds = snapshot.departments.map((d) => d.id);
  if (snapshot.people.some((p) => !p.departmentId || !zoneIds.includes(p.departmentId))) zoneIds.push("__none");
  const zones = zoneIds.map((id, i) => ({
    id,
    name: snapshot.departments.find((d) => d.id === id)?.name ?? "其他",
    x: i * ZONE_W,
    w: ZONE_W,
  }));
  const seats: Seat[] = [];
  zones.forEach((z, zi) => {
    const people = snapshot.people.filter((p) => (p.departmentId && zoneIds.includes(p.departmentId) ? p.departmentId : "__none") === z.id);
    const lead = people.find((p) => p.isLead);
    const staff = people.filter((p) => p !== lead);
    if (lead) {
      const deskX = z.x + z.w / 2 - 20;
      const deskY = TOP + 32;
      seats.push({ agentId: lead.agentId, x: deskX + 16, y: deskY - 11, deskX, deskY, isLead: true, zone: zi });
    }
    staff.forEach((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const deskX = z.x + 6 + col * 47;
      const deskY = TOP + 78 + row * 46;
      seats.push({ agentId: p.agentId, x: deskX + 16, y: deskY - 11, deskX, deskY, isLead: false, zone: zi });
    });
  });
  const rows = Math.max(1, ...zones.map((_, zi) => Math.ceil(seats.filter((s) => s.zone === zi && !s.isLead).length / 3)));
  return { width: Math.max(ZONE_W, zones.length * ZONE_W), height: Math.max(WORLD_H, TOP + 78 + rows * 46 + 6), zones, seats };
}

export function hashColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BODY_COLORS[h % BODY_COLORS.length];
}

/** Grey out a colour for the paused state. */
export function grey(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  const v = Math.round(y * 0.6 + 90);
  return `#${[v, v, v].map((c) => Math.min(255, c).toString(16).padStart(2, "0")).join("")}`;
}

export interface Label {
  agentId: string;
  name: string;
  model: string;
  title: string;
  anim: OfficeAnim;
  bubble: string | null;
  pendingCards: number;
  /** fractions of the canvas (0..1) for HTML overlay positioning */
  left: number;
  top: number;
  isLead: boolean;
}

type Walker = { agentId: string; path: Array<[number, number]>; i: number; x: number; y: number; back: boolean };

export class OfficeRenderer {
  private ctx: CanvasRenderingContext2D;
  private snapshot: OfficeSnapshot = { at: "", departments: [], people: [] };
  private layout: Layout = layoutOffice(this.snapshot);
  private raf = 0;
  private last = 0;
  private walkers = new Map<string, Walker>();
  private seenWalk = new Set<string>();
  selected: string | null = null;
  reducedMotion = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private palette: OfficePalette = DEFAULT_PALETTE,
  ) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("canvas 2d not available");
    this.ctx = c;
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  setPalette(p: Partial<OfficePalette>) {
    this.palette = { ...this.palette, ...p };
  }

  setSnapshot(s: OfficeSnapshot) {
    this.snapshot = s;
    this.layout = layoutOffice(s);
    if (this.canvas.width !== this.layout.width || this.canvas.height !== this.layout.height) {
      this.canvas.width = this.layout.width;
      this.canvas.height = this.layout.height;
    }
    // one-off delivery walk to the lead
    for (const p of s.people) {
      if (p.anim !== "walk_to_lead") {
        this.seenWalk.delete(p.agentId);
        continue;
      }
      if (this.seenWalk.has(p.agentId) || this.reducedMotion) continue;
      this.seenWalk.add(p.agentId);
      const seat = this.layout.seats.find((x) => x.agentId === p.agentId);
      const lead = this.layout.seats.find((x) => x.isLead && x.zone === seat?.zone);
      if (seat && lead) {
        const midY = lead.deskY + 22;
        const path: Array<[number, number]> = [
          [seat.x, seat.y],
          [seat.deskX + 42, seat.y],
          [seat.deskX + 42, midY],
          [lead.x, midY],
          [lead.x, lead.deskY + 14],
        ];
        this.walkers.set(p.agentId, { agentId: p.agentId, path, i: 1, x: seat.x, y: seat.y, back: false });
      }
    }
  }

  labels(): Label[] {
    return this.snapshot.people.map((p) => {
      const seat = this.layout.seats.find((s) => s.agentId === p.agentId);
      const w = this.walkers.get(p.agentId);
      const x = w ? w.x : (seat?.x ?? 0);
      const y = w ? w.y : (seat?.y ?? 0);
      return {
        agentId: p.agentId,
        name: p.name,
        model: p.model,
        title: p.title,
        anim: p.anim,
        bubble: p.bubble ?? null,
        pendingCards: p.pendingCards,
        left: (x + 4) / this.layout.width,
        top: (y + 22) / this.layout.height,
        isLead: p.isLead,
      };
    });
  }

  zoneLabels() {
    return this.layout.zones.map((z) => ({ id: z.id, name: z.name, left: (z.x + z.w / 2) / this.layout.width }));
  }

  /** canvas pixel -> agent id */
  hitTest(fx: number, fy: number): string | null {
    const x = fx * this.layout.width;
    const y = fy * this.layout.height;
    for (const s of this.layout.seats) {
      const w = this.walkers.get(s.agentId);
      const px = w ? w.x : s.x;
      const py = w ? w.y : s.y;
      if (x >= px - 3 && x <= px + 11 && y >= py - 4 && y <= py + 12) return s.agentId;
      if (!w && x >= s.deskX && x <= s.deskX + 40 && y >= s.deskY - 12 && y <= s.deskY + 14) return s.agentId;
    }
    return null;
  }

  start() {
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /* ------------------------------------------------------------ */

  private px(c: string, x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private frame(t: number) {
    const dt = Math.min(64, t - (this.last || t));
    this.last = t;
    this.stepWalkers(dt);
    const P = this.palette;
    const { width: W, height: H } = this.layout;
    this.ctx.imageSmoothingEnabled = false;
    // floor
    for (let iy = 0; iy * 10 + TOP < H; iy++) for (let ix = 0; ix * 10 < W; ix++) this.px((ix + iy) % 2 ? P.floorA : P.floorB, ix * 10, TOP + iy * 10, 10, 10);
    // wall
    this.px(P.wall, 0, 0, W, 38);
    this.px(P.wallDark, 0, 36, W, 8);
    this.px(P.trim, 0, 44, W, 2);
    for (const z of this.layout.zones) {
      // zone divider
      if (z.x > 0) this.px(P.trim, z.x, TOP, 1, H - TOP);
      // windows
      [z.x + 14, z.x + 104].forEach((wx, i) => {
        this.px(P.trim, wx - 2, 8, 34, 24);
        this.px(P.sky, wx, 10, 30, 20);
        const cx = wx + ((Math.floor(t / 140) + i * 11) % 40) - 8;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(wx, 10, 30, 20);
        this.ctx.clip();
        this.px("#ffffff", cx, 15, 9, 3);
        this.px("#ffffff", cx + 2, 13, 5, 2);
        this.ctx.restore();
        this.px(P.trim, wx + 14, 10, 2, 20);
        this.px(P.trim, wx, 19, 30, 1);
      });
      // shelf between windows
      const sx = z.x + 58;
      this.px(P.shelf, sx, 8, 32, 30);
      for (let s = 0; s < 2; s++) for (let b = 0; b < 6; b++) {
        const hgt = 6 + ((b * 3 + s) % 3);
        this.px(P.books[(b + s) % 4], sx + 2 + b * 5, 10 + s * 13 + (9 - hgt), 3, hgt);
      }
      // lead rug
      const lead = this.layout.seats.find((s) => s.isLead && s.zone === this.layout.zones.indexOf(z));
      if (lead) {
        this.px(P.rug, lead.deskX - 8, lead.deskY - 22, 56, 40);
        this.px(P.rugB, lead.deskX - 8, lead.deskY - 22, 56, 1);
        this.px(P.rugB, lead.deskX - 8, lead.deskY + 17, 56, 1);
      }
      this.plant(z.x + z.w - 14, TOP + 4);
    }
    // seats
    const byId = new Map(this.snapshot.people.map((p) => [p.agentId, p]));
    for (const s of this.layout.seats) {
      const p = byId.get(s.agentId);
      if (!p) continue;
      this.px(P.chair, s.deskX + 14, s.deskY - 8, 14, 9);
      const walking = this.walkers.has(s.agentId);
      if (!walking) this.drawRobot(s.x, s.y, p, t);
      this.drawDesk(s.deskX, s.deskY, walking ? "idle" : p.anim, t, s.isLead);
      if (!walking) this.drawBadge(s.x, s.y, p.anim, t);
    }
    for (const w of this.walkers.values()) {
      const p = byId.get(w.agentId);
      if (p) {
        this.drawRobot(w.x, w.y, p, t, true);
        // carrying a report
        this.px("#ffffff", w.x + 8, w.y + 6, 4, 5);
        this.px("#9aa3b5", w.x + 9, w.y + 8, 2, 1);
      }
    }
    // selection marker
    if (this.selected) {
      const s = this.layout.seats.find((x) => x.agentId === this.selected);
      const w = this.walkers.get(this.selected ?? "");
      if (s) {
        const x = w ? w.x : s.x;
        const y = w ? w.y : s.y;
        const b = this.reducedMotion ? 0 : Math.floor(t / 300) % 2;
        this.px(P.accent, x + 1, y - 10 + b, 6, 2);
        this.px(P.accent, x + 2, y - 8 + b, 4, 1);
        this.px(P.accent, x + 3, y - 7 + b, 2, 1);
      }
    }
  }

  private plant(x: number, y: number) {
    const P = this.palette;
    this.px(P.plantDark, x + 2, y, 6, 4);
    this.px(P.plant, x, y + 3, 10, 5);
    this.px(P.plantDark, x + 3, y + 6, 4, 3);
    this.px(P.pot, x + 2, y + 9, 7, 6);
  }

  private drawRobot(x: number, y: number, p: OfficeSnapshot["people"][number], t: number, walking = false) {
    const paused = p.anim === "paused";
    const body = paused ? grey(hashColor(p.agentId)) : hashColor(p.agentId);
    const eye = paused ? "#6b6b6b" : EYE_COLORS[p.eye];
    const blink = !this.reducedMotion && (t + p.agentId.length * 377) % 3600 < 130;
    const typing = p.anim === "working" && !this.reducedMotion;
    const bob = walking ? Math.floor(t / 140) % 2 : typing ? Math.floor(t / 220) % 2 : 0;
    const pal: Record<string, string> = {
      a: paused ? "#8a8a8a" : p.anim === "failed" ? "#c23b3b" : "#9aa3b5",
      f: paused ? "#5a5a5a" : "#2f2f3a",
      s: "#1b1722",
      e: blink ? "#1b1722" : eye,
      b: body,
    };
    ROBOT.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === ".") continue;
        // legs alternate when walking
        if (walking && r === 7 && ((bob && c < 4) || (!bob && c >= 4))) continue;
        this.px(pal[ch] ?? body, x + c, y + r - (r < 6 ? bob : 0), 1, 1);
      }
    });
  }

  private drawBadge(x: number, y: number, anim: OfficeAnim, t: number) {
    const flash = this.reducedMotion || Math.floor(t / 400) % 2 === 0;
    if (anim === "failed") {
      this.px("#c23b3b", x + 3, y - 9, 2, 5);
      this.px("#c23b3b", x + 3, y - 3, 2, 1);
    }
    if (anim === "waiting") {
      // holding up a sign
      this.px("#5e4733", x + 8, y - 6, 1, 10);
      this.px(flash ? "#ffc56b" : "#ffffff", x + 5, y - 12, 8, 6);
      this.px("#1b1722", x + 8, y - 11, 2, 1);
      this.px("#1b1722", x + 9, y - 10, 1, 2);
      this.px("#1b1722", x + 9, y - 7, 1, 1);
    }
    if (anim === "delivering") {
      this.px("#ffffff", x + 9, y + 2, 4, 5);
      this.px("#2b7a3b", x + 10, y + 4, 2, 1);
    }
  }

  private drawDesk(dx: number, dy: number, anim: OfficeAnim, t: number, isLead: boolean) {
    const P = this.palette;
    const w = isLead ? 40 : 34;
    this.px(P.deskTop, dx, dy, w, 4);
    this.px(P.desk, dx, dy + 4, w, 7);
    this.px(P.deskLeg, dx, dy + 10, w, 1);
    this.px(P.deskLeg, dx + 1, dy + 11, 3, 3);
    this.px(P.deskLeg, dx + w - 4, dy + 11, 3, 3);
    this.px(P.monitor, dx + 2, dy - 9, 13, 10);
    let scr = anim === "working" ? P.screenOn : P.screenIdle;
    if (anim === "paused") scr = P.monitor;
    if (anim === "failed") scr = Math.floor(t / 500) % 2 ? "#c23b3b" : P.screenIdle;
    if (anim === "waiting") scr = Math.floor(t / 400) % 2 ? "#ffcf5a" : P.screenIdle;
    this.px(scr, dx + 3, dy - 8, 11, 7);
    if (anim === "working") {
      for (let i = 0; i < 3; i++) {
        const lw = 2 + ((Math.floor(t / 160) + i * 3 + dx) % 8);
        this.px(P.code, dx + 4, dy - 7 + i * 2, Math.min(9, lw), 1);
      }
    }
    if (isLead) this.px(P.accent, dx + 30, dy + 1, 7, 2);
    else this.px(P.mug, dx + 26, dy - 1, 3, 3);
  }

  private stepWalkers(dt: number) {
    for (const [id, w] of this.walkers) {
      let budget = dt * 0.05;
      while (budget > 0 && w.i < w.path.length) {
        const [tx, ty] = w.path[w.i];
        const dx = tx - w.x;
        const dy = ty - w.y;
        const d = Math.hypot(dx, dy);
        if (d <= budget) {
          w.x = tx;
          w.y = ty;
          w.i++;
          budget -= d;
        } else {
          w.x += (dx / d) * budget;
          w.y += (dy / d) * budget;
          budget = 0;
        }
      }
      if (w.i >= w.path.length) {
        if (w.back) this.walkers.delete(id);
        else {
          // walk back to the seat
          w.path = [...w.path].reverse();
          w.i = 1;
          w.back = true;
        }
      }
    }
  }
}

/**
 * The pixel robot as a standalone SVG string (P9): used as every employee avatar in the
 * Paperclip admin pages. Body colour comes from the seed (agent id), eyes from the adapter.
 */
export function robotSvg(seed: string, eye: keyof typeof EYE_COLORS = "claude", muted = false, background = "#26241f"): string {
  const body = seed === "frontdesk" ? BODY_COLORS[0] : hashColor(seed);
  const pal: Record<string, string> = {
    a: "#9aa3b5",
    f: muted ? "#5a5a5a" : "#2f2f3a",
    s: "#1b1722",
    e: muted ? "#6b6b6b" : EYE_COLORS[eye],
    b: muted ? grey(body) : body,
  };
  const rects = ROBOT.flatMap((row, y) => [...row].map((ch, x) => (ch === "." ? "" : `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 10 10" shape-rendering="crispEdges"><rect x="-1" y="-1" width="10" height="10" rx="1.2" fill="${background}"/>${rects}</svg>`;
}

/** robotSvg as a data: URL for <img src>. */
export function robotDataUrl(seed: string, eye: keyof typeof EYE_COLORS = "claude", muted = false): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(robotSvg(seed, eye, muted))}`;
}
