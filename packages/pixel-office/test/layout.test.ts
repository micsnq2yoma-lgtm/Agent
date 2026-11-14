import { describe, expect, it } from "vitest";
import { ROBOT, grey, hashColor, layoutOffice, ZONE_W } from "../src/index.js";

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
  it("stable body colours and grey for paused", () => {
    expect(hashColor("abc")).toBe(hashColor("abc"));
    expect(grey("#ff0000")).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});
