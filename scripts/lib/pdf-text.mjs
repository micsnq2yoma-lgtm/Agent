// Best-effort PDF → text with no dependencies, for the paper library's full-text search.
// Handles what LaTeX / Word / LibreOffice / ReportLab PDFs use: FlateDecode streams, object streams
// (PDF 1.5+), fonts with ToUnicode CMaps (1- and 2-byte codes, Identity-H), simple fonts with
// WinAnsi / Standard / MacRoman encodings and /Differences glyph names, and the text operators
// Tj, TJ, ', " with line / word breaks guessed from positioning. Scanned PDFs (images) have no text:
// `quality` then comes out low and the caller asks an agent to read the PDF instead.
import zlib from "node:zlib";

/* ---------------- tiny PDF object reader ---------------- */
function inflate(buf) {
  for (const f of [zlib.inflateSync, zlib.inflateRawSync]) {
    try {
      return f(buf);
    } catch {
      /* try next */
    }
  }
  // truncated streams: take what decompresses
  try {
    return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  } catch {
    return Buffer.alloc(0);
  }
}

/** Parse a PDF value at `s[i]` (latin1 string). Returns [value, nextIndex]. */
function parseValue(s, i) {
  const ws = /[\s\0]/;
  while (i < s.length && (ws.test(s[i]) || s[i] === "%")) {
    if (s[i] === "%") while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    else i++;
  }
  const c = s[i];
  if (c === "<" && s[i + 1] === "<") {
    const d = {};
    i += 2;
    for (;;) {
      while (i < s.length && ws.test(s[i])) i++;
      if (s[i] === ">" && s[i + 1] === ">") return [d, i + 2];
      if (i >= s.length) return [d, i];
      const [k, j] = parseValue(s, i);
      const [v, j2] = parseValue(s, j);
      if (k && typeof k === "object" && "name" in k) d[k.name] = v;
      i = j2 > j ? j2 : j + 1;
    }
  }
  if (c === "[") {
    const a = [];
    i++;
    for (;;) {
      while (i < s.length && ws.test(s[i])) i++;
      if (s[i] === "]" || i >= s.length) return [a, i + 1];
      const [v, j] = parseValue(s, i);
      if (j <= i) return [a, i + 1];
      a.push(v);
      i = j;
    }
  }
  if (c === "/") {
    let j = i + 1;
    while (j < s.length && !/[\s\0/<>[\]()%{}]/.test(s[j])) j++;
    return [{ name: s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, j];
  }
  if (c === "(") return readLiteral(s, i);
  if (c === "<") {
    const j = s.indexOf(">", i);
    return [{ hex: s.slice(i + 1, j).replace(/\s/g, "") }, j + 1];
  }
  const m = /^([+-]?\d*\.?\d+)(?:\s+(\d+)\s+R(?![A-Za-z]))?/.exec(s.slice(i, i + 40));
  if (m) {
    if (m[2] !== undefined) return [{ ref: Number(m[1]) }, i + m[0].length];
    return [Number(m[1]), i + m[1].length];
  }
  const w = /^[A-Za-z]+/.exec(s.slice(i, i + 20));
  if (w) return [w[0] === "true" ? true : w[0] === "false" ? false : w[0] === "null" ? null : { op: w[0] }, i + w[0].length];
  return [null, i + 1];
}

function readLiteral(s, i) {
  let depth = 0;
  let out = "";
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      const n = s[j + 1];
      const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (n in map) {
        out += map[n];
        j++;
      } else if (/[0-7]/.test(n)) {
        const o = /^[0-7]{1,3}/.exec(s.slice(j + 1, j + 4))[0];
        out += String.fromCharCode(parseInt(o, 8) & 0xff);
        j += o.length;
      } else if (n === "\r" || n === "\n") {
        j++;
        if (n === "\r" && s[j + 1] === "\n") j++;
      } else j++;
      continue;
    }
    if (c === "(") {
      depth++;
      if (depth === 1) continue;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return [{ str: out }, j + 1];
    }
    out += c;
  }
  return [{ str: out }, s.length];
}

/** All objects: { num: { dict, value, stream: Buffer|null } }, object streams expanded. */
function readObjects(buf) {
  const s = buf.toString("latin1");
  const objs = {};
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const [value, after] = parseValue(s, m.index + m[0].length);
    let stream = null;
    const rest = s.slice(after, after + 30);
    const sm = /^\s*stream\r?\n/.exec(rest);
    if (sm && value && typeof value === "object") {
      const start = after + sm[0].length;
      let len = typeof value.Length === "number" ? value.Length : -1;
      let end = len >= 0 ? start + len : -1;
      if (end < 0 || s.slice(end, end + 20).indexOf("endstream") < 0) end = s.indexOf("endstream", start);
      stream = buf.subarray(start, end);
      re.lastIndex = end;
    }
    // later in the file wins: incremental updates (arXiv's stamp) redefine objects at the end
    objs[num] = { value, stream, at: m.index };
  }
  // object streams, in file order, so an object redefined by a later update stays the newest
  for (const o of Object.values(objs).sort((a, b) => a.at - b.at)) {
    if (o.value?.Type?.name !== "ObjStm" || !o.stream) continue;
    const data = decodeStream(o, objs).toString("latin1");
    const n = Number(o.value.N) || 0;
    const first = Number(o.value.First) || 0;
    const head = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const num = head[2 * k];
      const off = head[2 * k + 1];
      if (objs[num] && objs[num].at > o.at) continue;
      const [value] = parseValue(data, first + off);
      objs[num] = { value, stream: null, at: o.at };
    }
  }
  return objs;
}

const deref = (v, objs) => {
  for (let k = 0; k < 8 && v && typeof v === "object" && "ref" in v; k++) v = objs[v.ref]?.value;
  return v;
};
function decodeStream(o, objs) {
  if (!o?.stream) return Buffer.alloc(0);
  let f = deref(o.value?.Filter, objs);
  const filters = Array.isArray(f) ? f.map((x) => deref(x, objs)?.name) : f ? [f.name] : [];
  let data = o.stream;
  for (const name of filters) {
    if (name === "FlateDecode" || name === "Fl") data = inflate(data);
    else if (name === "ASCIIHexDecode" || name === "AHx") data = Buffer.from(data.toString("latin1").replace(/[^0-9a-fA-F]/g, ""), "hex");
    else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
    else return Buffer.alloc(0); // images (DCT, JPX…) and rarer filters carry no text
  }
  return data;
}

/** ASCII85 (ReportLab and PostScript-era PDFs). */
function ascii85(buf) {
  const s = buf.toString("latin1").replace(/\s/g, "").replace(/^<~/, "").replace(/~>.*$/, "");
  const out = [];
  let group = [];
  for (const ch of s) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    group.push(v);
    if (group.length === 5) {
      let n = 0;
      for (const g of group) n = n * 85 + g;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length) {
    const len = group.length;
    while (group.length < 5) group.push(84);
    let n = 0;
    for (const g of group) n = n * 85 + g;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, len - 1));
  }
  return Buffer.from(out);
}

/* ---------------- fonts ---------------- */
// Glyph names LaTeX fonts use in /Differences that are not single letters.
const GLYPHS = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", quoteright: "’", quoteleft: "‘",
  parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";",
  less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_",
  grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", quotedblleft: "“", quotedblright: "”", endash: "–", emdash: "—", bullet: "•",
  ff: "ff", fi: "fi", fl: "fl", ffi: "ffi", ffl: "ffl", dotlessi: "ı", germandbls: "ß", ae: "æ", oe: "œ", oslash: "ø", AE: "Æ", OE: "Œ", Oslash: "Ø",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", section: "§", dagger: "†", daggerdbl: "‡",
  periodcentered: "·", multiply: "×", divide: "÷", degree: "°", plusminus: "±", ellipsis: "…", copyright: "©", registered: "®", trademark: "™",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", theta: "θ", omega: "ω", infinity: "∞",
};
function glyphToChar(name) {
  if (/^[A-Za-z]$/.test(name)) return name;
  if (name in GLYPHS) return GLYPHS[name];
  const u = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  const base = name.split(".")[0];
  if (base !== name) return glyphToChar(base);
  return "";
}
// WinAnsi bytes 0x80–0x9F that differ from Latin-1.
const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x95: "•", 0x85: "…", 0x99: "™", 0x8c: "Œ", 0x9c: "œ" };

function parseCMap(text) {
  const map = new Map();
  let width = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (cs) {
    const h = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (h) width = h[1].length / 2;
  }
  const u16 = (hex) => {
    const b = Buffer.from(hex, "hex");
    let out = "";
    for (let k = 0; k + 1 < b.length; k += 2) out += String.fromCharCode(b.readUInt16BE(k));
    return out;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith("[")) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => u16(x[1]));
        for (let k = 0; k <= hi - lo && k < items.length; k++) map.set(lo + k, items[k]);
      } else {
        const start = Buffer.from(m[3].slice(1, -1), "hex");
        for (let k = 0; k <= hi - lo; k++) {
          const b = Buffer.from(start);
          if (b.length >= 2) b.writeUInt16BE((b.readUInt16BE(b.length - 2) + k) & 0xffff, b.length - 2);
          map.set(lo + k, u16(b.toString("hex")));
        }
      }
    }
  }
  return { map, width };
}

/**
 * The built-in encoding of an embedded Type1 font (`dup 12 /fi put` in the font program's clear-text
 * part). pdfTeX embeds Computer Modern / Times subsets this way with no /Encoding and no ToUnicode:
 * without it ligatures, quotes and dashes in LaTeX papers come out as control bytes.
 */
function builtinEncoding(f, objs) {
  const desc = deref(f.FontDescriptor, objs);
  const ff = desc?.FontFile && objs[desc.FontFile.ref];
  if (!ff?.stream) return {};
  const data = decodeStream(ff, objs);
  const len1 = Number(deref(ff.value?.Length1, objs)) || data.length;
  const clear = data.subarray(0, Math.min(len1, data.length)).toString("latin1");
  const out = {};
  for (const m of clear.matchAll(/dup\s+(\d+)\s*\/([^\s/]+)\s+put/g)) {
    const ch = glyphToChar(m[2]);
    if (ch) out[Number(m[1])] = ch;
  }
  return out;
}

function makeFont(fontDict, objs) {
  const f = deref(fontDict, objs) ?? {};
  const sub = f.Subtype?.name;
  const enc = deref(f.Encoding, objs);
  let cmap = null;
  const tu = f.ToUnicode && objs[f.ToUnicode.ref];
  if (tu) cmap = parseCMap(decodeStream(tu, objs).toString("latin1"));
  const twoByte = sub === "Type0" || (enc?.name && /Identity|UCS2|UTF16/.test(enc.name));
  // the font's own encoding first; /Differences of the PDF's encoding override it
  const diff = !cmap && !twoByte && sub === "Type1" && !enc?.name ? builtinEncoding(f, objs) : {};
  const encDict = enc && typeof enc === "object" && !("name" in enc) ? enc : null;
  if (Array.isArray(encDict?.Differences)) {
    let code = 0;
    for (const d of encDict.Differences) {
      if (typeof d === "number") code = d;
      else if (d?.name) diff[code++] = glyphToChar(d.name);
    }
  }
  const width = cmap?.width ?? (twoByte ? 2 : 1);
  return (bytes) => {
    let out = "";
    for (let k = 0; k < bytes.length; k += width) {
      const code = width === 2 ? ((bytes[k] << 8) | (bytes[k + 1] ?? 0)) : bytes[k];
      if (cmap?.map.has(code)) out += cmap.map.get(code);
      else if (code in diff) out += diff[code];
      else if (width === 1) out += WIN[code] ?? (code >= 32 ? String.fromCharCode(code) : "");
    }
    return out;
  };
}

/* ---------------- content streams ---------------- */
/**
 * Text of a content stream. `res` are its resources; Form XObjects it draws (`Do`) are read with
 * their own resources: arXiv's stamp wraps every original page into one, and figures made in LaTeX
 * carry their labels in them.
 */
function textOfContent(content, res, ctx, depth = 0) {
  const fonts = ctx.fontsOf(res);
  const s = content.toString("latin1");
  let out = "";
  let font = (b) => Buffer.from(b).toString("latin1");
  let size = 10;
  let lastY = null;
  const stack = [];
  const bytesOf = (v) => (v?.str !== undefined ? Buffer.from(v.str, "latin1") : v?.hex !== undefined ? Buffer.from(v.hex.length % 2 ? `${v.hex}0` : v.hex, "hex") : Buffer.alloc(0));
  const newline = () => {
    if (out && !out.endsWith("\n")) out += "\n";
  };
  for (let i = 0; i < s.length; ) {
    const [v, j] = parseValue(s, i);
    if (j <= i) {
      i++;
      continue;
    }
    i = j;
    if (!v || typeof v !== "object" || !("op" in v)) {
      stack.push(v);
      continue;
    }
    const op = v.op;
    if (op === "BI") {
      // inline image: skip to EI
      const e = s.indexOf("EI", i);
      i = e < 0 ? s.length : e + 2;
    } else if (op === "Tf") {
      size = Number(stack[stack.length - 1]) || size;
      const name = stack[stack.length - 2]?.name;
      font = fonts[name] ?? font;
    } else if (op === "Tj" || op === "'" || op === '"') {
      if (op !== "Tj") newline();
      out += font(bytesOf(stack[stack.length - 1]));
    } else if (op === "TJ") {
      const arr = stack[stack.length - 1];
      if (Array.isArray(arr))
        for (const x of arr) {
          if (typeof x === "number") {
            if (x < -200 && !out.endsWith(" ")) out += " ";
          } else out += font(bytesOf(x));
        }
    } else if (op === "Td" || op === "TD" || op === "Tm" || op === "T*") {
      const y = op === "Tm" ? Number(stack[stack.length - 1]) : op === "T*" ? null : Number(stack[stack.length - 1]);
      if (op === "T*") newline();
      else if (op === "Tm") {
        if (lastY !== null && Math.abs(y - lastY) > size * 0.5) newline();
        else if (!out.endsWith(" ") && !out.endsWith("\n")) out += " ";
        lastY = y;
      } else if (Math.abs(y) > 0.1) newline();
      else if (Math.abs(Number(stack[stack.length - 2])) > size * 0.15 && !out.endsWith(" ")) out += " ";
    } else if (op === "ET") {
      if (!out.endsWith(" ") && !out.endsWith("\n")) out += " ";
    } else if (op === "Do") {
      const name = stack[stack.length - 1]?.name;
      const ref = name && deref(res?.XObject, ctx.objs)?.[name];
      const xo = ref?.ref !== undefined ? ctx.objs[ref.ref] : null;
      if (xo?.value?.Subtype?.name === "Form" && depth < 6 && !ctx.drawing.has(ref.ref)) {
        ctx.drawing.add(ref.ref);
        const inner = textOfContent(decodeStream(xo, ctx.objs), deref(xo.value.Resources, ctx.objs) ?? res, ctx, depth + 1);
        ctx.drawing.delete(ref.ref);
        if (inner.trim()) {
          newline();
          out += `${inner}\n`;
        }
      }
    }
    stack.length = 0;
  }
  return out;
}

function pageContents(page, objs) {
  const c = deref(page.Contents, objs);
  const refs = Array.isArray(page.Contents) ? page.Contents : Array.isArray(c) ? c : [page.Contents];
  return Buffer.concat(refs.map((r) => (r?.ref !== undefined ? decodeStream(objs[r.ref], objs) : Buffer.alloc(0))));
}

function collectPages(node, objs, inherited = {}, out = [], seen = new Set()) {
  const n = deref(node, objs);
  if (!n || typeof n !== "object" || seen.has(n)) return out;
  seen.add(n);
  const res = n.Resources ?? inherited.Resources;
  if (n.Type?.name === "Pages" || Array.isArray(n.Kids)) for (const k of n.Kids ?? []) collectPages(k, objs, { Resources: res }, out, seen);
  else out.push({ ...n, Resources: res });
  return out;
}

/** Page texts of a PDF and a 0–1 quality score (share of letters / CJK in the output). */
export function pdfText(buf, { maxPages = 400 } = {}) {
  const objs = readObjects(buf);
  const catalog = Object.values(objs).find((o) => o.value?.Type?.name === "Catalog")?.value;
  let pages = catalog ? collectPages(catalog.Pages, objs) : [];
  if (!pages.length) pages = Object.values(objs).filter((o) => o.value?.Type?.name === "Page").map((o) => o.value);
  const texts = [];
  const fontCache = new Map();
  const ctx = {
    objs,
    drawing: new Set(),
    fontsOf(res) {
      const fonts = {};
      for (const [name, ref] of Object.entries(deref(res?.Font, objs) ?? {})) {
        // fonts without an object number are inline dicts: cache them per dict, not per name
        const key = ref?.ref ?? ref;
        if (!fontCache.has(key)) fontCache.set(key, makeFont(ref, objs));
        fonts[name] = fontCache.get(key);
      }
      return fonts;
    },
  };
  for (const page of pages.slice(0, maxPages)) {
    const res = deref(page.Resources, objs) ?? {};
    const t = textOfContent(pageContents(page, objs), res, ctx)
      // compatibility forms (Kangxi radicals ⽂ → 文, ligatures ﬁ → fi, full-width digits)
      .normalize("NFKC")
      .replace(/[ \t]+/g, " ")
      // no spaces between CJK characters (positioning puts them there)
      .replace(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]) (?=[\p{Script=Han}\u3000-\u303f\uff00-\uffef])/gu, "$1")
      .replace(/ ?\n ?/g, "\n")
      .replace(/(\w)-\n(\w)/g, "$1$2") // hyphenation at line ends
      .trim();
    texts.push(t);
  }
  const all = texts.join("\n");
  const good = (all.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const visible = all.replace(/\s/g, "").length;
  return { pages: texts, text: all, quality: visible ? good / visible : 0, chars: all.length, pageCount: pages.length };
}
