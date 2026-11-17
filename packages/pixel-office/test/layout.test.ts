import { describe, expect, it } from "vitest";
import { ROBOT, SPRITE_HEIGHT, SPRITE_WIDTH, grey, hashColor, layoutOffice, ZONE_W } from "../src/index.js";

const person = (id: string, dept: string | null, isLead = false) =>
  ({ agentId: id, departmentId: dept, name: id, title: "", model: "Claude", eye: "claude", isLead, anim: "idle", pendingCards: 0 }) as const;

describe("pixel office layout", () => {
  it("robot sprite is 8x8", () => {
    expect(ROBOT).toHaveLength(8);
    for (const row of ROBOT) expect(row).toHaveLength(8);
  });
  it("one zone per department, lead at the front", () => {
    const l = layoutOffice({
      at: "",
      departments: [{ id: "r", name: "科研部", icon: "" }, { id: "c", name: "公司部", icon: "" }],
      people: [person("lead", "r", true), person("a", "r"), person("b", "r"), person("x", "c")],
    });
    expect(l.zones.map((z) => z.name)).toEqual(["科研部", "公司部"]);
    expect(l.width).toBe(2 * ZONE_W);
    const lead = l.seats.find((s) => s.agentId === "lead")!;
    const a = l.seats.find((s) => s.agentId === "a")!;
    expect(lead.isLead).toBe(true);
    expect(lead.y).toBeLessThan(a.y);
    expect(l.seats.find((s) => s.agentId === "x")!.zone).toBe(1);
  });
  it("people without department go to a shared zone", () => {
    const l = layoutOffice({ at: "", departments: [], people: [person("solo", null)] });
    expect(l.zones.map((z) => z.id)).toEqual(["__none"]);
  });
  it("grows height for many staff", () => {
    const people = [person("lead", "r", true), ...Array.from({ length: 9 }, (_, i) => person(`p${i}`, "r"))];
    const l = layoutOffice({ at: "", departments: [{ id: "r", name: "r", icon: "" }], people });
    expect(l.height).toBeGreaterThan(180);
    expect(new Set(l.seats.map((s) => `${s.deskX},${s.deskY}`)).size).toBe(l.seats.length);
  });
  it("keeps a lead and three employees compact without an unused bottom row", () => {
    const l = layoutOffice({ at: "", departments: [{ id: "r", name: "r", icon: "" }], people: [person("lead", "r", true), ...["a", "b", "c"].map(id => person(id, "r"))] });
    // Two-times pixel scaling leaves room for the app chrome in a 900px viewport.
    expect(l.height * 2 + 200).toBeLessThanOrEqual(900);
    expect(l.height - Math.max(...l.seats.map(s => s.deskY))).toBeLessThanOrEqual(36);
    for (const seat of l.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.x + SPRITE_WIDTH).toBeLessThanOrEqual(l.width);
      expect(seat.y + SPRITE_HEIGHT).toBeGreaterThan(seat.deskY + 4);
      expect(seat.y + SPRITE_HEIGHT).toBeLessThanOrEqual(seat.deskY + 14);
    }
  });
  it("grows only when a new staff row is occupied and starts unled teams at the front", () => {
    const layout = (count: number, lead: boolean) => layoutOffice({ at: "", departments: [{ id: "r", name: "r", icon: "" }], people: [...(lead ? [person("lead", "r", true)] : []), ...Array.from({ length: count }, (_, i) => person(`p${i}`, "r"))] });
    const three = layout(3, true), four = layout(4, true), six = layout(6, true);
    expect(four.height).toBe(six.height);
    expect(four.height - three.height).toBe(four.seats.at(-1)!.deskY - three.seats.at(-1)!.deskY);
    const unled = layout(3, false);
    expect(unled.seats.every(s => s.deskY === three.seats[0].deskY)).toBe(true);
    const mixed = layoutOffice({ at: "", departments: [{ id: "r", name: "r", icon: "" }, { id: "s", name: "s", icon: "" }], people: [...four.seats.map(s => person(s.agentId, "r", s.isLead)), person("solo", "s")] });
    expect(mixed.height).toBe(four.height);
  });
  it("stable body colours and grey for paused", () => {
    expect(hashColor("abc")).toBe(hashColor("abc"));
    expect(grey("#ff0000")).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});

import { robotDataUrl, robotSvg } from "../src/index.js";
describe("robot avatar (P9)", () => {
  it("keeps the legacy API while displaying the selected model character", () => {
    const svg = robotSvg("agent-1", "codex");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('data-family="codex"');
    expect(svg).toContain('viewBox="0 0 48 44"');
    expect(svg).not.toBe(robotSvg("agent-1", "claude"));
    expect(robotSvg("agent-1", "codex")).toBe(svg);
  });
  it("greys out muted (paused) robots and encodes as a data url", () => {
    expect(robotSvg("agent-1", "claude", true)).toContain('data-action="paused"');
    expect(robotDataUrl("x").startsWith("data:image/svg+xml;utf8,")).toBe(true);
  });
});
