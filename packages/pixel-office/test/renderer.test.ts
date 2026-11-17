import { afterEach, expect, it, vi } from "vitest";
import type { OfficeSnapshot } from "../../shared/src/index.js";
import { characterFrame, DEFAULT_PALETTE, layoutOffice, OfficeRenderer, SPRITE_HEIGHT, SPRITE_WIDTH } from "../src/index.js";

type Paint = { x: number; y: number; w: number; h: number; color: string };
const covers = (p: Paint, x: number, y: number) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;

const snapshot = (): OfficeSnapshot => ({
  at: "", departments: [{ id: "dev", name: "研发", icon: "" }],
  people: ["lead", "a", "b", "c"].map((id, i) => ({ agentId: id, name: id, title: "", departmentId: "dev", model: "DeepSeek", eye: "deepseek", anim: i === 3 ? "walk_to_lead" : "idle", isLead: i === 0, pendingCards: 0, bubble: "验证任务标题" })),
});

function fixture() {
  const paints: Paint[] = [];
  const context = new Proxy({ fillStyle: "", fillRect(x: number, y: number, w: number, h: number) { paints.push({ x, y, w, h, color: this.fillStyle }); } }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { tick = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const renderer = new OfficeRenderer(canvas);
  let time = 0;
  return { renderer, canvas, paints, advance: (frames = 15) => { renderer.start(); for (let i = 0; i < frames; i++) { paints.length = 0; time += 64; tick(time); } } };
}
afterEach(() => vi.unstubAllGlobals());

it("fits staff sprites and readable speech anchors inside each zone", () => {
  const { renderer, canvas } = fixture();
  const s = snapshot(); renderer.reducedMotion = true; renderer.setSnapshot(s);
  const layout = layoutOffice(s);
  for (const seat of layout.seats) {
    expect(seat.x + SPRITE_WIDTH).toBeLessThanOrEqual(canvas.width);
    expect(seat.y + SPRITE_HEIGHT).toBeLessThan(canvas.height);
    const label = renderer.labels().find(l => l.agentId === seat.agentId)!;
    expect(label.left * canvas.width * 2 - 68).toBeGreaterThanOrEqual(0);
    expect(label.left * canvas.width * 2 + 68).toBeLessThanOrEqual(canvas.width * 2);
    expect(label.bubble).toBe("验证任务标题");
    expect(renderer.hitTest((seat.x + 44) / canvas.width, (seat.y + 25) / canvas.height)).toBe(seat.agentId);
  }
});
it("cancels an in-flight delivery when the observed state changes", () => {
  const { renderer, advance } = fixture(); const s = snapshot();
  s.people[3].anim = "idle"; renderer.setSnapshot(s);
  const start = renderer.labels().at(-1)!;
  s.people[3].anim = "walk_to_lead"; renderer.setSnapshot(s); advance();
  const moving = renderer.labels().at(-1)!;
  expect([moving.left, moving.top]).not.toEqual([start.left, start.top]);
  s.people[3].anim = "failed"; renderer.setSnapshot(s);
  expect(renderer.labels().at(-1)!.left).toBe(start.left);
  expect(renderer.labels().at(-1)!.top).toBe(start.top);
});
it("leaves room between an upper nameplate and the next row's two-line speech at 2x", () => {
  const { renderer, canvas } = fixture();
  const s = snapshot();
  s.people.push(...s.people.slice(1).map(p => ({ ...p, agentId: `${p.agentId}-2`, anim: "idle" as const })));
  renderer.reducedMotion = true; renderer.setSnapshot(s);
  const seats = layoutOffice(s).seats;
  const labels = renderer.labels();
  for (const seat of seats) {
    const label = labels.find(l => l.agentId === seat.agentId)!;
    expect(label.top * canvas.height).toBeGreaterThanOrEqual(seat.deskY + 14);
    expect(label.top * canvas.height * 2 + 22).toBeLessThanOrEqual(canvas.height * 2);
    for (const above of seats.filter(other => other.deskY < seat.deskY)) {
      const upper = labels.find(l => l.agentId === above.agentId)!;
      // A 62px speech card and a 22px nameplate must not overlap at minimum zoom.
      expect((label.bubbleTop - upper.top) * canvas.height).toBeGreaterThanOrEqual(42);
    }
  }
});
it("paints the chair behind the seated character and the desk over its feet", () => {
  const { renderer, paints, advance } = fixture();
  const s = snapshot(); s.people = [{ ...s.people[0], eye: "codex", model: "Codex" }];
  renderer.reducedMotion = true; renderer.setSnapshot(s); advance(1);
  const seat = layoutOffice(s).seats[0];
  const footX = seat.x + 17, footY = seat.y + 38;
  const deskIndex = paints.findIndex(p => p.color === DEFAULT_PALETTE.desk && p.x === seat.deskX && p.y === seat.deskY + 4);
  const chairIndex = paints.findIndex(p => p.color === DEFAULT_PALETTE.chair);
  expect(chairIndex).toBeGreaterThanOrEqual(0);
  expect(deskIndex).toBeGreaterThan(chairIndex);
  const foot = paints.slice(0, deskIndex).findLast(p => covers(p, footX, footY));
  expect(foot).toBeDefined();
  expect(paints.indexOf(foot!)).toBeGreaterThan(chairIndex);
  expect(foot!.color).not.toBe(DEFAULT_PALETTE.chair);
  expect(paints.findLast(p => covers(p, footX, footY))!.color).toBe(DEFAULT_PALETTE.desk);
  // The face remains visible above the furniture; seating never edits the sprite.
  const faceX = 17, faceY = 16;
  const face = characterFrame("codex", "idle", 0).findLast(([x, y, w, h]) => faceX >= x && faceX < x + w && faceY >= y && faceY < y + h)!;
  expect(paints.findLast(p => covers(p, seat.x + faceX, seat.y + faceY))!.color).toBe(face[4]);
});
it("walks the first row into the clear corridor before crossing and stays in bounds", () => {
  const { renderer, canvas, advance } = fixture();
  const s = snapshot(); renderer.setSnapshot(s);
  const seats = layoutOffice(s).seats;
  const start = seats.find(seat => seat.agentId === "c")!;
  let crossed = false;
  for (let i = 0; i < 85; i++) {
    advance(1);
    const label = renderer.labels().find(l => l.agentId === "c")!;
    const x = label.left * canvas.width - SPRITE_WIDTH / 2;
    const y = label.top * canvas.height - SPRITE_HEIGHT - 5;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + SPRITE_WIDTH).toBeLessThanOrEqual(canvas.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + SPRITE_HEIGHT).toBeLessThanOrEqual(canvas.height);
    if (Math.abs(x - start.x) > 0.01) {
      crossed = true;
      expect(y + SPRITE_HEIGHT).toBeLessThanOrEqual(start.y);
    }
  }
  expect(crossed).toBe(true);
  expect(renderer.labels().find(l => l.agentId === "c")!.top * canvas.height).toBe(start.deskY + 18);
});
it("keeps delivery stationary with reduced motion", () => {
  const { renderer, advance } = fixture(); renderer.reducedMotion = true; renderer.setSnapshot(snapshot());
  const before = renderer.labels(); advance(); expect(renderer.labels()).toEqual(before);
});
