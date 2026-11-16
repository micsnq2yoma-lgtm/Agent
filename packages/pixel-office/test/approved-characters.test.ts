import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ACTION_TEXT, characterFrame, FRAME_MS, SPRITE_HEIGHT, SPRITE_WIDTH, type PixelAction } from "../src/characters.js";

// Approved on 2026-11-16, before the other providers' logo-inspired redesign.
// Hash rendered RGBA cells, not drawing commands, so equivalent refactors pass.
const APPROVED = {
  claude: "348fa8229c09b604fb60343c0e360c4091f262219fcfcf4ec208815780bfdfb3",
  deepseek: "2c2e26268b37f1841cd2dcaad8ae8cfa0afff596f930e8bf2665d5fe7776d5d0",
  codex: "c6a2fdb04d398e837ed2d7a651c4903cfe12c088a6e437bb600be979374e48fb",
} as const;

it.each(Object.keys(APPROVED) as Array<keyof typeof APPROVED>)("preserves every approved %s frame, colour, and timing", (family) => {
  const hash = createHash("sha256").update(`${SPRITE_WIDTH}x${SPRITE_HEIGHT}@${FRAME_MS}ms`);
  for (const action of Object.keys(ACTION_TEXT).sort() as PixelAction[]) for (const muted of [false, true]) {
    hash.update(`${action}:${muted}`);
    for (let frame = 0; frame < 4; frame++) {
      const rgba = Buffer.alloc(SPRITE_WIDTH * SPRITE_HEIGHT * 4);
      for (const [x, y, w, h, color] of characterFrame(family, action, frame, muted)) {
        const rgb = Number.parseInt(color.slice(1), 16);
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
          const offset = ((y + dy) * SPRITE_WIDTH + x + dx) * 4;
          rgba[offset] = (rgb >> 16) & 255;
          rgba[offset + 1] = (rgb >> 8) & 255;
          rgba[offset + 2] = rgb & 255;
          rgba[offset + 3] = 255;
        }
      }
      hash.update(rgba);
    }
  }
  expect(hash.digest("hex")).toBe(APPROVED[family]);
});
