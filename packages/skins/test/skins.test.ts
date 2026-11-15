import { describe, expect, it } from "vitest";
import { court, cssVars, getSkin, office, term, validateSkin } from "../src/index.js";

describe("skins", () => {
  it("terms change with the skin", () => {
    expect(term(office, "lead")).toBe("主管");
    expect(term(court, "lead")).toBe("尚书");
    expect(term(court, "report")).toBe("奏折");
  });
  it("falls back to office for unknown ids", () => {
    expect(getSkin("nope").id).toBe("office");
  });
  it("exposes css variables, with dark overrides", () => {
    expect(cssVars(office)["--as-accent"]).toBe("#d9480f");
    expect(cssVars(office, true)["--as-bg"]).toBe("#1d1a24");
    expect(cssVars(office)["--as-accent-strong"]).toBe("#b4410c");
  });
  it("built-in skins are valid and complete", () => {
    expect(validateSkin(office)).toEqual([]);
    expect(validateSkin(court)).toEqual([]);
    expect(validateSkin({ id: "x", name: "x", tokens: {}, terms: {} }).length).toBeGreaterThan(10);
  });
});

import { registerSkin, skins as registry } from "../src/index.js";
describe("shared skins", () => {
  it("registers a valid shared skin and rejects an invalid one", () => {
    const lab = { ...office, id: "lab-test", name: "实验室", terms: { ...office.terms, lead: "组长" } };
    expect(registerSkin(lab)).toEqual([]);
    expect(term(getSkin("lab-test"), "lead")).toBe("组长");
    expect(registerSkin({ ...lab, id: "Bad Id" } as never).length).toBeGreaterThan(0);
    expect(registry["Bad Id"]).toBeUndefined();
  });
});

import { paperclipVars, termOverrides } from "../src/index.js";
describe("skin → Paperclip (P9)", () => {
  it("maps tokens onto the admin UI variables, with dark tokens when dark", () => {
    const v = paperclipVars(office);
    expect(v["--background"]).toBe(office.tokens.bg);
    expect(v["--primary"]).toBe(office.tokens.accent);
    expect(v["--radius"]).toBe(office.tokens.radius);
    expect(v["--font-sans"]).toBe(office.tokens.fontBody);
    expect(paperclipVars(court)["--background"]).toBe(court.tokens.bg);
    expect(paperclipVars(office, true)["--background"]).toBe(office.darkTokens!.bg);
  });
  it("turns the translation layer's words into the skin's terms", () => {
    const o = Object.fromEntries(termOverrides(office));
    expect(o["智能体"]).toBe("员工");
    expect(o["管理台"]).toBe("我");
    expect(o["例行任务"]).toBeUndefined(); // same word, no override
    const c = Object.fromEntries(termOverrides(court));
    expect(c["智能体"]).toBe("侍郎");
    expect(c["管理台"]).toBe("朕");
    expect(c["例行任务"]).toBe("常例");
  });
});
