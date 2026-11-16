// Pixel office (PLAN 7.1). Input: an OfficeSnapshot. Output: a canvas drawing + label positions.
// Model-specific employees share the same integer-cell artwork as UI portraits.
import type { OfficeAnim, OfficeSnapshot } from "@agentself/shared";
import { characterDataUrl, characterFrame, characterSvg, FRAME_MS, SPRITE_HEIGHT, SPRITE_WIDTH } from "./characters.js";
export * from "./characters.js";

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

/** Office skin, light (DESIGN §5). */
export const DEFAULT_PALETTE: OfficePalette = {
  floorA: "#EFEDE9",
  floorB: "#E8E5E1",
  wall: "#F6F5F3",
  wallDark: "#E4E1DD",
  trim: "#D8D2CB",
  sky: "#F7E4D6",
  desk: "#3A3F45",
  deskTop: "#CDBBA8",
  deskLeg: "#3A3F45",
  monitor: "#2B3138",
  screenIdle: "#46566B",
  screenOn: "#9FC4BA",
  code: "#ffffff",
  plant: "#8FA58A",
  plantDark: "#7A9475",
  pot: "#E3876A",
  rug: "#EDEAE6",
  rugB: "#E3876A",
  chair: "#5F6266",
  mug: "#ffffff",
  shelf: "#8E7F73",
  books: ["#E3876A", "#C6BCC4", "#EBC3A0", "#A9B79B", "#9AA7B5"],
  accent: "#E3876A",
};

/** Office skin, dark (DESIGN §5). */
export const DARK_PALETTE: OfficePalette = {
  floorA: "#191C20",
  floorB: "#1D2125",
  wall: "#1E2226",
  wallDark: "#2A2F34",
  trim: "#3A3F45",
  sky: "#3B3240",
  desk: "#2B3035",
  deskTop: "#8C7C6C",
  deskLeg: "#2B3035",
  monitor: "#14181C",
  screenIdle: "#33465E",
  screenOn: "#5CC4AE",
  code: "#ffffff",
  plant: "#6E8A6A",
  plantDark: "#5D7859",
  pot: "#C9765D",
  rug: "#22262A",
  rugB: "#C9765D",
  chair: "#3A4047",
  mug: "#D8D2CB",
  shelf: "#5B5048",
  books: ["#E3876A", "#C6BCC4", "#EBC3A0", "#A9B79B", "#9AA7B5"],
  accent: "#E3876A",
};

/** The lead's seat gets a 3px peach → lavender outline; nothing else uses a gradient (DESIGN §5). */
export const LEAD_OUTLINE = ["#F2BC94", "#BFB6D6"] as const;

export function lerpColor(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}


export const EYE_COLORS = { claude: "#ffc56b", codex: "#4fd1e8", other: "#c9c3ff" } as const;
// Muted to sit on the grey SETO floor (DESIGN §5).
export const BODY_COLORS = ["#5B7FD6", "#7D8794", "#9C8CC9", "#3E9C8C", "#B07CC9", "#C9956A"];

/** 8x8 robot: a antenna, f frame, s screen, e eye, b body. */
export const ROBOT = ["...aa...", ".ffffff.", "ffssssff", "fsessesf", "fssssssf", ".ffffff.", "..bbbb..", ".b.bb.b."];

export const WORLD_H = 300;
export const ZONE_W = 240;
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
      const deskY = TOP + 64;
      seats.push({ agentId: lead.agentId, x: deskX - 4, y: deskY - SPRITE_HEIGHT, deskX, deskY, isLead: true, zone: zi });
    }
    staff.forEach((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const deskX = z.x + 16 + col * 74;
      const deskY = TOP + 164 + row * 100;
      seats.push({ agentId: p.agentId, x: deskX - 4, y: deskY - SPRITE_HEIGHT, deskX, deskY, isLead: false, zone: zi });
    });
  });
  const rows = Math.max(1, ...zones.map((_, zi) => Math.ceil(seats.filter((s) => s.zone === zi && !s.isLead).length / 3)));
  return { width: Math.max(ZONE_W, zones.length * ZONE_W), height: Math.max(WORLD_H, TOP + 164 + rows * 100 + 6), zones, seats };
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
  bubbleTop: number;
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
    for (const id of this.seenWalk) {
      if (this.reducedMotion || !s.people.some((p) => p.agentId === id && p.anim === "walk_to_lead")) {
        this.seenWalk.delete(id);
        this.walkers.delete(id);
      }
    }
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
        const aisleX = Math.min(seat.deskX + 42, (seat.zone + 1) * ZONE_W - SPRITE_WIDTH - 2);
        const path: Array<[number, number]> = [
          [seat.x, seat.y],
          [aisleX, seat.y],
          [aisleX, midY],
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
        left: (x + SPRITE_WIDTH / 2) / this.layout.width,
        top: (y + SPRITE_HEIGHT + 17) / this.layout.height,
        bubbleTop: Math.max(42, y - 6) / this.layout.height,
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
      if (x >= px && x <= px + SPRITE_WIDTH && y >= py && y <= py + SPRITE_HEIGHT) return s.agentId;
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
    if (!this.reducedMotion) this.stepWalkers(dt);
    if (this.reducedMotion) t = 0;
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
        this.px(P.books[(b + s) % P.books.length], sx + 2 + b * 5, 10 + s * 13 + (9 - hgt), 3, hgt);
      }
      // lead rug
      const lead = this.layout.seats.find((s) => s.isLead && s.zone === this.layout.zones.indexOf(z));
      if (lead) {
        const rx = lead.deskX - 8, ry = lead.deskY - 22, rw = 56, rh = 40;
        this.px(P.rug, rx, ry, rw, rh);
        // 3px outline, peach at the top-left fading to lavender at the bottom-right
        for (let i = 0; i < rw; i++) {
          const c = lerpColor(LEAD_OUTLINE[0], LEAD_OUTLINE[1], i / (rw - 1));
          this.px(c, rx + i, ry - 3, 1, 3);
          this.px(c, rx + i, ry + rh, 1, 3);
        }
        for (let j = -3; j < rh + 3; j++) {
          const t = (j + 3) / (rh + 5);
          this.px(lerpColor(LEAD_OUTLINE[0], LEAD_OUTLINE[1], t * 0.5), rx - 3, ry + j, 3, 1);
          this.px(lerpColor(LEAD_OUTLINE[0], LEAD_OUTLINE[1], 0.5 + t * 0.5), rx + rw, ry + j, 3, 1);
        }
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
    }
    for (const w of this.walkers.values()) {
      const p = byId.get(w.agentId);
      if (p) {
        this.drawRobot(w.x, w.y, p, t, true);
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
        this.px(P.accent, x + 21, y - 10 + b, 6, 2);
        this.px(P.accent, x + 22, y - 8 + b, 4, 1);
        this.px(P.accent, x + 23, y - 7 + b, 2, 1);
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
    const frame = this.reducedMotion ? 0 : Math.floor(t / FRAME_MS);
    const action = walking ? "walk_to_lead" : p.anim;
    for (const [dx, dy, w, h, color] of characterFrame(p.eye, action, frame)) {
      this.px(color, x + dx, y + dy, w, h);
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

/** Compatibility API for existing avatar consumers. */
export function robotSvg(_seed: string, eye: keyof typeof EYE_COLORS = "claude", muted = false, _background = "#26241f"): string {
  return characterSvg(eye, muted ? "paused" : "idle", { muted });
}

export function robotDataUrl(_seed: string, eye: keyof typeof EYE_COLORS = "claude", muted = false): string {
  return characterDataUrl(eye, muted ? "paused" : "idle", { muted });
}
