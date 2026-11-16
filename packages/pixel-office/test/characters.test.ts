import { describe, expect, it } from "vitest";
import { MODEL_FAMILIES } from "../../shared/src/index.js";
import { ACTION_TEXT, characterFrame, characterSvg, pixelActionFor, SPRITE_HEIGHT, SPRITE_WIDTH, type PixelAction } from "../src/characters.js";

describe("model employee sprites", () => {
  it("keeps every frame of every model and action inside its integer-cell canvas", () => {
    for (const family of MODEL_FAMILIES) for (const action of Object.keys(ACTION_TEXT) as PixelAction[]) {
      for (let f = 0; f < 4; f++) {
        const pixels = characterFrame(family, action, f);
        expect(pixels.length).toBeGreaterThan(0);
        for (const [x, y, w, h, color] of pixels) {
          expect([x, y, w, h].every(Number.isInteger)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
          expect(w).toBeGreaterThan(0); expect(h).toBeGreaterThan(0);
          expect(x + w).toBeLessThanOrEqual(SPRITE_WIDTH);
          expect(y + h).toBeLessThanOrEqual(SPRITE_HEIGHT);
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });
  it("uses distinguishable silhouettes, including when desaturated", () => {
    const silhouettes = MODEL_FAMILIES.map(family => JSON.stringify(characterFrame(family).map(p => p.slice(0, 4))));
    expect(new Set(silhouettes).size).toBe(MODEL_FAMILIES.length);
  });
  it.each([...MODEL_FAMILIES])("animates %s working and freezes its paused pose", family => {
    expect(characterFrame(family, "working", 0)).not.toEqual(characterFrame(family, "working", 1));
    expect(characterFrame(family, "paused", 0)).toEqual(characterFrame(family, "paused", 3));
    expect(characterSvg(family, "paused", { animated: true })).not.toContain("@keyframes");
    expect(characterSvg(family, "working", { animated: true })).toContain("prefers-reduced-motion:reduce");
  });
  it("does not interpret inherited object properties as actions", () => {
    expect(pixelActionFor("constructor")).toBe("idle");
    expect(pixelActionFor("success")).toBe("delivering");
    expect(pixelActionFor("loading")).toBe("thinking");
    expect(pixelActionFor("sleepy")).toBe("paused");
  });
});
