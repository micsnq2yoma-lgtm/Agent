import type { ModelFamily, OfficeAnim } from "@agentself/shared";

export type PixelAction = OfficeAnim | "thinking" | "reading" | "writing" | "searching";
export type Pixel = readonly [x: number, y: number, width: number, height: number, color: string];
export const SPRITE_WIDTH = 48;
export const SPRITE_HEIGHT = 44;
export const FRAME_MS = 240;
export const ACTION_TEXT: Record<PixelAction, string> = {
  idle: "空闲待命", thinking: "思考中", working: "工作中", reading: "查阅资料", writing: "编写内容", searching: "查找线索",
  waiting: "等待决策", delivering: "交付待验收", walk_to_lead: "送交成果", failed: "遇到错误", paused: "已暂停",
};

/** Preserve the supplied sprite.ts whale's exact silhouette and belly pattern. */
export const WHALE_BODY = [
  "..............d.d", "..............ddd", "....bbbbbbbbb.d..", "...bbbbbbbbbbbd..",
  "..bbbbbbbbbbbbb..", "..bbbbbbbbbbbbb..", "..bbbbbbbbbbbbb..", "..bbllllllllllb..",
  "..blglllglllglb..", "...lglllglllgl...", "...lllllllllll...", "....ddddddddd....",
];
export const WHALE_PALETTE = { b: "#4D8FE8", d: "#2F5FB3", l: "#D6EBFF", g: "#9CC4F0" };

const PALETTES: Record<ModelFamily, { main: string; shade: string; light: string; ink: string; eye: string }> = {
  codex: { main: "#4F78F6", shade: "#304BBA", light: "#83A4FF", ink: "#1D285F", eye: "#86E7F1" },
  deepseek: { main: WHALE_PALETTE.b, shade: WHALE_PALETTE.d, light: WHALE_PALETTE.l, ink: "#0B1A33", eye: "#0B1A33" },
  claude: { main: "#D77757", shade: "#A9533A", light: "#EEA484", ink: "#452F2B", eye: "#1D1716" },
  gemini: { main: "#4387F7", shade: "#3367BE", light: "#BCE4FF", ink: "#263D76", eye: "#17355D" },
  kimi: { main: "#F3F8FF", shade: "#007CFF", light: "#00F6FF", ink: "#002F5B", eye: "#002F5B" },
  glm: { main: "#20242D", shade: "#515B6D", light: "#CFD8E5", ink: "#10151E", eye: "#FFFFFF" },
  qwen: { main: "#644CFF", shade: "#4331B7", light: "#B9AEFF", ink: "#302369", eye: "#FFFFFF" },
  minimax: { main: "#FF5260", shade: "#BD285C", light: "#FFC5A6", ink: "#662541", eye: "#662541" },
  grok: { main: "#20232C", shade: "#747E90", light: "#F2F5FA", ink: "#121620", eye: "#FFFFFF" },
  other: { main: "#8A9C8D", shade: "#526D62", light: "#CBD9BB", ink: "#2D453A", eye: "#21352A" },
};

export function pixelActionFor(state?: string): PixelAction {
  if (state && Object.hasOwn(ACTION_TEXT, state)) return state as PixelAction;
  if (state === "success") return "delivering";
  if (state === "confused" || state === "listening" || state === "pending_approval") return "waiting";
  if (state === "loading") return "thinking";
  if (state === "sleepy" || state === "terminated" || state === "budget_paused") return "paused";
  if (state === "running") return "working";
  if (state === "error") return "failed";
  return "idle";
}

function desaturate(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const v = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.7 + 45);
  return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
}

// Rasterise the new geometric silhouettes once, not on every office paint.
// The one-cell rims keep white/black characters readable in both UI themes.
function polygon(points: readonly (readonly [number, number])[], fill: string, rim: string): Pixel[] {
  const cells = new Set<string>();
  for (let y = 3; y < 41; y++) for (let x = 3; x < 45; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) cells.add(`${x},${y}`);
  }
  return [...cells].map(cell => {
    const [x, y] = cell.split(",").map(Number);
    const edge = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !cells.has(`${x+dx},${y+dy}`));
    return [x, y, 1, 1, edge ? rim : fill] as Pixel;
  });
}

const BRAND_BODIES = {
  kimi: polygon([[10,7],[19,7],[19,19],[31,7],[40,7],[26,22],[39,34],[39,39],[31,37],[19,27],[19,38],[10,38]], "#F3F8FF", "#002F5B"),
  glm: [
    ...polygon([[9,9],[27,9],[23,15],[9,15]], "#20242D", "#8994A7"),
    ...polygon([[30,9],[41,9],[20,37],[9,37]], "#20242D", "#8994A7"),
    ...polygon([[26,31],[41,31],[41,37],[22,37]], "#20242D", "#8994A7"),
  ],
  qwen: [
    ...polygon([[21,5],[28,5],[32,11],[40,11],[44,17],[40,23],[24,23],[17,12]], "#7456FF", "#4431B5"),
    ...polygon([[9,14],[14,14],[25,33],[21,39],[14,39],[10,33],[13,28],[6,20]], "#4B65F5", "#303FB5"),
    ...polygon([[35,24],[41,24],[45,31],[41,37],[35,37],[30,41],[23,41],[20,35],[30,35]], "#7952EE", "#4931A3"),
  ],
};

/** Pure integer-cell drawing, shared by SVG portraits and the office canvas. */
export function characterFrame(family: ModelFamily, action: PixelAction = "idle", frame = 0, muted = false): Pixel[] {
  const c = PALETTES[family] ?? PALETTES.other;
  const f = ((Math.floor(frame) % 4) + 4) % 4;
  const p = f % 2;
  const frozen = action === "paused";
  const bob = frozen ? 0 : action === "delivering" ? [0, -1, -2, -1][f] : action === "working" ? -p : f === 2 ? -1 : 0;
  const result: Pixel[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    const fill = muted || frozen ? desaturate(color) : color;
    const last = result.at(-1);
    // Merge neighbouring cells without changing paint order or rendered pixels.
    // This keeps the geometric masks small in both SVG and canvas portraits.
    if (last && last[0] + last[2] === x && last[1] === y && last[3] === h && last[4] === fill) {
      result[result.length - 1] = [last[0], y, last[2] + w, h, fill];
    } else result.push([x, y, w, h, fill]);
  };
  const r = (x: number, y: number, w: number, h: number, color: string) => rect(x, y + bob, w, h, color);
  const map = (rows: string[], palette: Record<string, string>, x: number, y: number, scale = 1) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (palette[ch]) r(x + i * scale, y + j * scale, scale, scale, palette[ch]);
  }));
  const eye = (x: number, y: number) => {
    if (frozen || (action === "idle" && f === 3)) { r(x - 1, y + 1, 3, 1, c.eye); return; }
    if (action === "delivering") { r(x, y, 1, 1, c.eye); r(x - 1, y + 1, 1, 1, c.eye); r(x + 1, y + 1, 1, 1, c.eye); return; }
    r(x, y, 1, 2, c.eye);
    if (action === "failed") r(x, y + 2, 1, 2, "#7CC8FF");
  };
  const arms = (left: number, right: number, y: number, color = c.shade) => {
    r(left, y + (action === "working" ? p : 0), 3, 3, color);
    r(right, y + (action === "delivering" ? -2 * p : action === "working" ? 1 - p : 0), 3, 3, color);
  };
  if (family === "codex") {
    // Reference: a blue puff-shaped shell, dark >_ visor, and a small laptop.
    r(13, 4, 8, 1, c.ink); r(25, 5, 7, 1, c.ink);
    r(10, 5, 13, 4, c.ink); r(23, 6, 12, 4, c.ink);
    r(8, 9, 29, 5, c.ink); r(6, 13, 33, 11, c.ink);
    r(8, 24, 29, 4, c.ink); r(12, 28, 21, 3, c.ink);
    r(12, 6, 10, 4, c.main); r(24, 7, 9, 4, c.main);
    r(10, 9, 25, 5, c.main); r(8, 13, 29, 11, c.main);
    r(10, 24, 25, 3, c.shade); r(14, 27, 17, 3, c.shade);
    r(13, 5, 7, 1, c.light); r(10, 8, 3, 2, c.light); r(9, 11, 1, 4, c.light); r(25, 6, 6, 1, c.light);
    r(15, 14, 21, 12, c.ink); r(16, 15, 19, 10, "#243674"); r(17, 14, 16, 1, c.light);
    if (action === "failed") map(["e...e", ".e.e.", "..e..", ".e.e.", "e...e"], { e: "#F29B9B" }, 20, 18);
    else if (frozen) { r(19, 21, 4, 1, c.eye); r(28, 21, 4, 1, c.eye); }
    else { map(["e...", ".e..", "..e.", ".e..", "e..."], { e: c.eye }, 19, 18); if (f !== 3) r(28, 23, 4, 1, c.eye); }
    r(14, 30, 18, 7, c.ink); r(15, 30, 16, 5, c.main); r(16, 33, 14, 3, c.shade);
    r(15, 36, 7, 5, c.ink); r(27, 36, 7, 4, c.ink); r(16, 37, 5, 3, c.main); r(28, 37, 5, 2, c.shade);
    arms(12, 34, 30, c.main);
  } else if (family === "deepseek") {
    map(WHALE_BODY, WHALE_PALETTE, 7, 11, 2);
    eye(15, 19); eye(31, 19);
    arms(7, 37, 23, c.shade);
    if (!frozen && action !== "failed") map(p ? ["u.u.u", ".u.u.", "..u.."] : [".u.u.", "..u..", "..u.."], { u: "#7CC8FF" }, 19, 5, 2);
  } else if (family === "claude") {
    r(13, 13, 24, 18, c.main); r(13, 29, 24, 2, c.shade); r(14, 13, 22, 1, c.light);
    [13, 17, 31, 35].forEach((x, i) => r(x, 31, 2, action === "walk_to_lead" && i % 2 === p ? 3 : 5, c.main));
    arms(9, 38, 22, c.main); eye(18, 18); eye(31, 18);
  } else if (family === "gemini") {
    // Four concave sides, with Google's red/yellow/green/blue around a blue core.
    const widths = [1,1,1,2,2,2,3,3,4,4,5,6,7,9,12,16,19,16,12,9,7,6,5,4,4,3,3,2,2,2,1,1,1];
    widths.forEach((half, row) => {
      for (let x = 24 - half; x < 24 + half; x++) {
        const y = row + 5;
        const color = y < 12 ? "#F46C78" : y < 17 ? (x < 23 ? "#F5A579" : "#8A9AF7")
          : x < 15 ? "#F6CF52" : x < 20 ? (y < 22 ? "#A8CF71" : "#66C78C")
          : y > 29 ? "#4ABB8A" : y > 25 && x < 25 ? "#54BCBC" : "#4387F7";
        r(x, y, 1, 1, color);
      }
    });
    r(24, 7, 1, 4, "#FFB4AF"); r(37, 21, 3, 1, "#87B9FF");
    eye(21, 20); eye(28, 20); r(24, 24, 2, 1, c.ink);
    r(18, 23, 2, 1, "#C5EDC2"); r(30, 23, 2, 1, "#B5DAFF");
    if (!frozen) map([".s.","sss",".s."], { s: f === 1 ? "#F6CF52" : c.light }, 35, 8);
  } else if (family === "kimi") {
    // The K itself is the character: an upright stem and two swept limbs.
    BRAND_BODIES.kimi.forEach(([x,y,w,h,color]) => r(x,y,w,h,color));
    r(11, 9, 2, 7, "#D1E6FF"); r(13, 8, 5, 1, "#FFFFFF");
    r(32, 7, 7, 3, c.shade); r(34, 7, 4, 1, c.light);
    eye(13, 20); eye(17, 20); r(14, 24, 2, 1, c.shade);
    r(11, 23, 2, 1, "#8CC8FF"); r(17, 23, 2, 1, "#8CC8FF");
    r(11, 35, 7, 2, c.shade); r(33, 34, 4, 2, c.shade);
    arms(6, 38, 28, c.shade);
  } else if (family === "glm") {
    // Z.AI's slanted ribbon stays separated from its two horizontal end caps.
    BRAND_BODIES.glm.forEach(([x,y,w,h,color]) => r(x,y,w,h,color));
    r(11, 10, 11, 1, c.light); r(29, 32, 10, 1, "#A9B3C4");
    eye(24, 21); eye(28, 21); r(24, 25, 2, 1, c.light);
    arms(7, 39, 25, c.shade);
    if (!frozen) r(33 - f * 4, 12 + f * 5, 2, 1, c.light);
  } else if (family === "qwen") {
    // Three separate folded ribbons keep the triangular negative space open.
    BRAND_BODIES.qwen.forEach(([x,y,w,h,color]) => r(x,y,w,h,color));
    r(22, 6, 5, 1, c.light); r(8, 18, 1, 4, "#9BBAFF"); r(24, 39, 4, 1, c.light);
    eye(28, 16); eye(35, 16); r(31, 20, 2, 1, "#D8CFFF");
    if (!frozen) r(25 + p, 26 - p, 2, 2, "#C1B6FF");
    arms(8, 40, 29, c.shade);
  } else if (family === "minimax") {
    // A continuous pink-to-orange waveform, with two tall central arches.
    const wave = [
      ".............ppp.....ooo.............",
      "............ppppp...ooooo............",
      "............pp.pp...oo.oo............",
      "............pp.pp...oo.oo............",
      "............pp.pp...oo.oo............",
      ".....ppp....pp.pp...oo.oo....ooo......",
      "....ppppp...pp.pp...oo.oo...ooooo.....",
      "....pp.pp...pp.pp...oo.oo...oo.oo.....",
      "....pp.pp...pp.pp...oo.oo...oo.oo.....",
      "....pp.pp...pp.pp...oo.oo...oo.oo.....",
      "pp..pp.pp...pp.pp...oo.oo...oo.oo.....",
      "pp..pp.pp...pp.pp...oo.oo...oo.oo.....",
      "pppppp.pp...pp.pp...oo.oo...oo.oo.....",
      ".pppp..pp...pp.pp...oo.oo...oo.oo.....",
      ".......pp...pp.pp...oo.oo...oo.oo.....",
      ".......pp...pp.pp...oo.oo...oo.oo.....",
      ".......pp...pp......oo.oo...oo........",
      ".......pp...pp.pp...oo.ooooooo........",
      ".......ppppppp.pp...oo..ooooo.........",
      "........ppppp..pp...oo................",
      "...............pp...oo................",
      "...............ppppooo................",
      "................ppooo.................",
    ];
    map(wave, { p: "#FF3763", o: "#FF7038" }, 5, 9);
    // A small face bridges the middle without closing the outer waveform gaps.
    r(19, 19, 13, 8, "#FFB3A6"); r(20, 18, 11, 1, "#FFD0BA");
    eye(22, 21); eye(28, 21); r(25, 25, 2, 1, c.shade);
    r(19, 9, 2, 2, c.light); r(27, 9, 2, 2, c.light);
    if (!frozen) { r(18, 14 + p, 1, 2, "#FFD0BA"); r(26, 15 - p, 1, 2, "#FFD0BA"); }
  } else if (family === "grok") {
    // A dark core, broken white orbit, and a comet cutting from SW to NE.
    const orbit = [
      ".........ssssssss..........", "......ssswwwwwwwwsss.......", "....sswwwwwwwwwwwwwwss.....",
      "...swwwwsssssssssswwwws....", "..swwwssddddddddddsswwws...", ".swwwsddddddddddddddswwws..",
      ".swwsddddddddddddddddswws..", "swwwsddddddddddddddddswwws.", "swwsddddddddddddddddddswws.",
      "swwsddddddddddddddddddswws.", "swwsddddddddddddddddddswws.", "swwsddddddddddddddddddswws.",
      "swwsddddddddddddddddddswws.", "swwwsddddddddddddddddswwws.", ".swwsddddddddddddddddswws..",
      ".swwwsddddddddddddddswwws..", "..swwwssddddddddddsswwws...", "...swwwwsssssssssswwwws....",
      "....sswwwwwwwwwwwwwwss.....", "......ssswwwwwwwwsss.......", ".........ssssssss..........",
    ];
    map(orbit, { s: c.shade, w: c.light, d: c.main }, 11, 12);
    // Widen the slash towards its top, preserving the recognisable sharp tip.
    for (let i = 0; i < 28; i++) {
      const x = 8 + i, y = 38 - i;
      r(x, y, 3, i > 18 ? 4 : 2, c.shade);
      r(x + 1, y, 1, i > 18 ? 2 : 1, c.light);
    }
    r(37, 9, 2, 2, c.light); r(39, 7, 1, 2, c.light);
    eye(18, 21); eye(22, 21); r(18, 25, 2, 1, c.light);
    arms(9, 38, 29, c.shade);
  } else {
    r(13, 14, 23, 18, c.ink); r(14, 15, 21, 16, c.main); r(15, 16, 19, 2, c.light);
    r(16, 32, 6, 4, c.shade); r(29, 32, 6, 4, c.shade);
    r(23, 9, 2, 6, c.shade); r(18, 8, 6, 3, c.light); r(25, 6, 5, 3, c.main);
    arms(9, 37, 24); eye(19, 21); eye(30, 21);
  }
  // Work props are observational. No feeding, affection, or pointer interactions.
  if (action === "working" || (family === "codex" && action === "idle")) {
    for (let row = 0; row < 11; row++) r(29 - Math.floor(row / 4), 27 + row, 15, 1, c.ink);
    for (let row = 0; row < 8; row++) r(30 - Math.floor(row / 4), 28 + row, 12, 1, "#2E4789");
    map(["e..", ".e.", "..e", ".e.", "e.."], { e: "#86E7F1" }, 33, 29);
    r(25, 38, 18, 2, c.shade); r(23 + p, 35, 5, 3, c.main);
  }
  if (action === "thinking") { [0, 1, 2].forEach(i => rect(35 + i * 4, 5 - i, 2, 2, i === f % 3 ? c.light : c.shade)); }
  if (action === "reading" || action === "writing") {
    r(14, 29, 21, 10, c.ink); r(15, 30, 9, 8, "#F4EEDC"); r(25, 30, 9, 8, "#F4EEDC");
    [0, 1, 2].forEach(i => { r(17, 31 + i * 2, 5, 1, "#B9AE95"); r(27, 31 + i * 2, 5, 1, "#B9AE95"); });
    if (action === "writing") r(31 + p, 25, 2, 10, "#FFD45C");
    else r(24 + p, 30, 1, 8, "#B9AE95");
  }
  if (action === "searching") map([".bbbb.", "b....b", "b....b", "b....b", ".bbbb.", "....dd", ".....d"], { b: "#7CC8FF", d: c.ink }, 37 - p, 25);
  if (action === "waiting") {
    r(38, 13, 1, 21, "#7C6653"); r(33, 7, 12, 12, "#FFD886");
    map([".ii.", "i..i", "..i.", ".i..", "....", ".i.."], { i: c.ink }, 37, 10);
  }
  if (action === "delivering" || action === "walk_to_lead") {
    r(32, 26, 12, 14, c.ink); r(33, 27, 10, 12, "#F4EEDC"); r(35, 29, 6, 1, "#B9AE95");
    map(["....g", "g..g.", ".gg.."], { g: "#37836C" }, 35, 33);
    if (action === "delivering") map(["..y..", "..y..", "yyyyy", "..y..", "..y.."], { y: "#FFD45C" }, 5, 9 - p);
  }
  if (action === "failed") { rect(40, 5, 2, 6, "#D86363"); rect(40, 13, 2, 2, "#D86363"); }
  if (frozen) { rect(35, 5, 2, 7, c.shade); rect(40, 5, 2, 7, c.shade); }
  return result;
}

export function characterSvg(family: ModelFamily, action: PixelAction = "idle", { animated = false, muted = false } = {}): string {
  const art = (frame: number) => characterFrame(family, action, frame, muted).map(([x,y,w,h,color]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`).join("");
  const moving = animated && action !== "paused" && !muted;
  const css = moving ? `<style>${[0,1,2,3].map(i => `@keyframes p${i}{0%,100%{opacity:${i===0?1:0}}${[0,1,2,3].map(j=>`${j*25}%{opacity:${i===j?1:0}}`).join("")}}.f${i}{animation:p${i} ${FRAME_MS*4}ms steps(1,end) infinite;opacity:${i===0?1:0}}`).join("")}@media(prefers-reduced-motion:reduce){.frame{animation:none!important;opacity:0!important}.f0{opacity:1!important}}</style>` : "";
  const drawing = moving ? [0,1,2,3].map(f=>`<g class="frame f${f}">${art(f)}</g>`).join("") : art(0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPRITE_WIDTH} ${SPRITE_HEIGHT}" shape-rendering="crispEdges" data-family="${family}" data-action="${action}">${css}${drawing}</svg>`;
}

export function characterDataUrl(family: ModelFamily, action: PixelAction = "idle", options?: { animated?: boolean; muted?: boolean }): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(characterSvg(family, action, options))}`;
}
