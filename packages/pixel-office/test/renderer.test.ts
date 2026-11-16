import { afterEach, expect, it, vi } from "vitest";
import type { OfficeSnapshot } from "../../shared/src/index.js";
import { layoutOffice, OfficeRenderer, SPRITE_HEIGHT, SPRITE_WIDTH } from "../src/index.js";

const snapshot = (): OfficeSnapshot => ({
  at: "", departments: [{ id: "dev", name: "研发", icon: "" }],
  people: ["lead", "a", "b", "c"].map((id, i) => ({ agentId: id, name: id, title: "", departmentId: "dev", model: "DeepSeek", eye: "deepseek", anim: i === 3 ? "walk_to_lead" : "idle", isLead: i === 0, pendingCards: 0, bubble: "验证任务标题" })),
});

function fixture() {
  const context = new Proxy({}, { get: () => () => {} });
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { tick = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const renderer = new OfficeRenderer(canvas);
  return { renderer, canvas, advance: () => { renderer.start(); for (let i = 1; i < 16; i++) tick(i * 64); } };
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
  const { renderer, advance } = fixture(); const s = snapshot(); renderer.setSnapshot(s);
  const start = renderer.labels().at(-1)!; advance();
  expect(renderer.labels().at(-1)!.left).not.toBe(start.left);
  s.people[3].anim = "failed"; renderer.setSnapshot(s);
  expect(renderer.labels().at(-1)!.left).toBe(start.left);
  expect(renderer.labels().at(-1)!.top).toBe(start.top);
});
it("keeps delivery stationary with reduced motion", () => {
  const { renderer, advance } = fixture(); renderer.reducedMotion = true; renderer.setSnapshot(snapshot());
  const before = renderer.labels(); advance(); expect(renderer.labels()).toEqual(before);
});
