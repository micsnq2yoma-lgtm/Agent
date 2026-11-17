// Paper library: one folder the user chooses (any disk, e.g. D:\Papers), plain files only, so it can
// be backed up, synced or opened by hand:
//   <root>/library.json                  catalog (metadata of every paper, rebuilt from the folders if lost)
//   <root>/papers/<id>/meta.json         title, authors, year, venue, arXiv id / DOI, abstract, tags…
//   <root>/papers/<id>/paper.pdf         the PDF, when there is one
//   <root>/papers/<id>/fulltext.txt      extracted text (PDF, or arXiv's HTML version)
//   <root>/papers/<id>/notes.md          the user's and the agents' notes
// The root itself is set in ~/.agenteam/library-settings.json (default ~/.agenteam/library).
// Search is plain full text (BM25 over title / abstract / notes / full-text chunks, CJK as bigrams):
// no embeddings, no index service, fine for a personal library of a few thousand papers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pdfText } from "./pdf-text.mjs";

const agenteamHome = () => process.env.AGENTEAM_HOME ?? path.join(os.homedir(), ".agenteam");
const settingsFile = () => path.join(agenteamHome(), "library-settings.json");
export const defaultRoot = () => path.join(agenteamHome(), "library");

export function libraryRoot() {
  try {
    const r = JSON.parse(fs.readFileSync(settingsFile(), "utf8")).root;
    if (r) return r;
  } catch {
    /* default */
  }
  return defaultRoot();
}

/**
 * Point the library at another folder. `move`: carry the existing papers over (copy, then remove the
 * old folder's papers); otherwise the new folder is used as is (an existing library there is picked up).
 */
export function setLibraryRoot(next, { move = false } = {}) {
  const root = path.resolve(String(next ?? "").trim());
  if (!String(next ?? "").trim()) throw Object.assign(new Error("要填一个文件夹路径"), { status: 400 });
  const old = libraryRoot();
  if (path.resolve(old) === root) return { root, moved: 0 };
  if (root.startsWith(path.resolve(old) + path.sep)) throw Object.assign(new Error("新位置不能在旧位置里面"), { status: 400 });
  fs.mkdirSync(root, { recursive: true });
  fs.accessSync(root, fs.constants.W_OK);
  let moved = 0;
  if (move && fs.existsSync(path.join(old, "papers"))) {
    for (const id of fs.readdirSync(path.join(old, "papers"))) {
      const to = path.join(root, "papers", id);
      if (fs.existsSync(to)) continue;
      fs.cpSync(path.join(old, "papers", id), to, { recursive: true });
      moved++;
    }
    for (const id of fs.readdirSync(path.join(old, "papers"))) if (fs.existsSync(path.join(root, "papers", id))) fs.rmSync(path.join(old, "papers", id), { recursive: true, force: true });
  }
  fs.mkdirSync(agenteamHome(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ root, updatedAt: new Date().toISOString() }, null, 2));
  rebuildCatalog(root);
  return { root, moved };
}

const papersDir = (root = libraryRoot()) => path.join(root, "papers");
const paperDir = (id, root = libraryRoot()) => {
  if (!/^[\w.-]+$/.test(id)) throw Object.assign(new Error(`论文 id 不对：${id}`), { status: 400 });
  return path.join(papersDir(root), id);
};
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};
const readText = (f) => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

/* ---------------- catalog ---------------- */
function catalogFile(root = libraryRoot()) {
  return path.join(root, "library.json");
}
export function rebuildCatalog(root = libraryRoot()) {
  const list = [];
  if (fs.existsSync(papersDir(root)))
    for (const id of fs.readdirSync(papersDir(root))) {
      const m = readJson(path.join(papersDir(root), id, "meta.json"), null);
      if (m) list.push(m);
    }
  list.sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(catalogFile(root), JSON.stringify({ version: 1, papers: list }, null, 2));
  return list;
}
export function listPapers({ root = libraryRoot() } = {}) {
  const c = readJson(catalogFile(root), null);
  return Array.isArray(c?.papers) ? c.papers : rebuildCatalog(root);
}
function saveMeta(meta, root = libraryRoot()) {
  const dir = paperDir(meta.id, root);
  fs.mkdirSync(dir, { recursive: true });
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  const list = listPapers({ root }).filter((p) => p.id !== meta.id);
  fs.writeFileSync(catalogFile(root), JSON.stringify({ version: 1, papers: [meta, ...list] }, null, 2));
  return meta;
}

export function getPaper(id, { root = libraryRoot() } = {}) {
  const dir = paperDir(id, root);
  const meta = readJson(path.join(dir, "meta.json"), null);
  if (!meta) throw Object.assign(new Error(`论文库里没有 ${id}`), { status: 404 });
  return {
    ...meta,
    notes: readText(path.join(dir, "notes.md")),
    hasPdf: fs.existsSync(path.join(dir, "paper.pdf")),
    pdfPath: fs.existsSync(path.join(dir, "paper.pdf")) ? path.join(dir, "paper.pdf") : null,
    fulltextChars: readText(path.join(dir, "fulltext.txt")).length,
  };
}
export function pdfPath(id) {
  const f = path.join(paperDir(id), "paper.pdf");
  return fs.existsSync(f) ? f : null;
}
/** A slice of the full text (agents read long papers in pages). */
export function readFulltext(id, { offset = 0, limit = 12_000 } = {}) {
  const t = readText(path.join(paperDir(id), "fulltext.txt"));
  return { id, total: t.length, offset, text: t.slice(offset, offset + limit), more: offset + limit < t.length };
}
export function setFulltext(id, text, source = "agent") {
  const dir = paperDir(id);
  const meta = readJson(path.join(dir, "meta.json"), null);
  if (!meta) throw Object.assign(new Error(`论文库里没有 ${id}`), { status: 404 });
  fs.writeFileSync(path.join(dir, "fulltext.txt"), String(text));
  meta.fulltext = { status: "ok", source, chars: String(text).length };
  return saveMeta(meta);
}
/** Replace the notes (`mode: "replace"`) or append a dated entry (default). */
export function writeNotes(id, text, { mode = "append", by = "" } = {}) {
  const dir = paperDir(id);
  if (!fs.existsSync(path.join(dir, "meta.json"))) throw Object.assign(new Error(`论文库里没有 ${id}`), { status: 404 });
  const f = path.join(dir, "notes.md");
  if (mode === "replace") fs.writeFileSync(f, String(text));
  else fs.appendFileSync(f, `${readText(f) ? "\n" : ""}## ${new Date().toISOString().slice(0, 10)}${by ? ` · ${by}` : ""}\n\n${String(text).trim()}\n`);
  const meta = readJson(path.join(dir, "meta.json"), {});
  meta.hasNotes = true;
  saveMeta(meta);
  return readText(f);
}
export function updatePaper(id, patch) {
  const meta = readJson(path.join(paperDir(id), "meta.json"), null);
  if (!meta) throw Object.assign(new Error(`论文库里没有 ${id}`), { status: 404 });
  for (const k of ["title", "authors", "year", "venue", "abstract", "tags", "status", "url", "doi", "arxivId"]) if (patch[k] !== undefined) meta[k] = patch[k];
  if (Array.isArray(meta.tags)) meta.tags = [...new Set(meta.tags.map((t) => String(t).trim()).filter(Boolean))];
  return saveMeta(meta);
}
export function removePaper(id) {
  fs.rmSync(paperDir(id), { recursive: true, force: true });
  const root = libraryRoot();
  fs.writeFileSync(catalogFile(root), JSON.stringify({ version: 1, papers: listPapers({ root }).filter((p) => p.id !== id) }, null, 2));
}

/* ---------------- identifiers ---------------- */
/** arXiv id from an id, abs/pdf/html URL or "arXiv:…" (new 2301.12345v2 and old hep-th/9901001 styles). */
export function parseArxivId(s) {
  const t = String(s ?? "").trim();
  const m =
    /arxiv\.org\/(?:abs|pdf|html)\/([\w.-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i.exec(t) ??
    /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i.exec(t) ??
    /^(?:arxiv:\s*)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.exec(t);
  return m ? m[1] : null;
}
export function parseDoi(s) {
  const m = /(10\.\d{4,9}\/[^\s"<>]+)/.exec(decodeURIComponent(String(s ?? "")));
  return m ? m[1].replace(/[.,;)]+$/, "") : null;
}
const idFor = ({ arxivId, doi, sha }) => (arxivId ? `arxiv-${arxivId.replace(/\//g, "_")}` : doi ? `doi-${doi.toLowerCase().replace(/[^\w.-]+/g, "_").slice(0, 80)}` : `pdf-${sha.slice(0, 12)}`);

/** Find a paper already in the library by arXiv id, DOI, PDF hash or (normalized) title. */
export function findExisting({ arxivId, doi, sha, title }) {
  const norm = (t) => String(t ?? "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
  const nt = norm(title);
  return (
    listPapers().find(
      (p) => (arxivId && p.arxivId === arxivId) || (doi && p.doi?.toLowerCase() === doi.toLowerCase()) || (sha && p.sha256 === sha) || (nt.length > 12 && norm(p.title) === nt),
    ) ?? null
  );
}

/* ---------------- metadata sources ---------------- */
const decodeXml = (s) =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Parse one entry of the arXiv API (Atom). Pure. */
export function parseArxivAtom(xml) {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const tag = (t) => decodeXml(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(entry)?.[1]);
  const idUrl = tag("id");
  if (!idUrl || /api\/errors/.test(idUrl)) return null;
  const published = tag("published");
  return {
    arxivId: parseArxivId(idUrl),
    title: tag("title"),
    abstract: tag("summary"),
    authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) => decodeXml(m[1])),
    year: published ? Number(published.slice(0, 4)) : null,
    published,
    venue: tag("arxiv:journal_ref") || "arXiv",
    doi: tag("arxiv:doi") || null,
    category: /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(entry)?.[1] ?? null,
    url: `https://arxiv.org/abs/${parseArxivId(idUrl)}`,
  };
}
/** Parse a Crossref /works/<doi> response. Pure. */
export function parseCrossref(json) {
  const m = json?.message;
  if (!m) return null;
  const year = m.issued?.["date-parts"]?.[0]?.[0] ?? m.published?.["date-parts"]?.[0]?.[0] ?? null;
  return {
    doi: m.DOI,
    title: decodeXml(Array.isArray(m.title) ? m.title[0] : m.title),
    authors: (m.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name).filter(Boolean),
    year,
    venue: (Array.isArray(m["container-title"]) ? m["container-title"][0] : m["container-title"]) || m.publisher || "",
    abstract: decodeXml(String(m.abstract ?? "").replace(/<[^>]+>/g, " ")),
    url: m.URL ?? `https://doi.org/${m.DOI}`,
  };
}
/** Visible text of arXiv's HTML version (LaTeXML), without navigation and references markup. Pure. */
export function htmlArticleText(html) {
  const body = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  return body
    .replace(/<(script|style|nav|header|footer|math)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<annotation[\s\S]*?<\/annotation>/gi, " ")
    .replace(/<\/(p|div|h\d|li|tr|section|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function get(url, { binary = false, timeoutMs = 60_000 } = {}) {
  const r = await fetch(url, { headers: { "user-agent": "agenteam-library/1.0 (personal research library)" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} 返回 ${r.status}`), { status: r.status });
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}

/* ---------------- adding ---------------- */
function extractFulltext(dir, meta, pdf) {
  try {
    const r = pdfText(pdf);
    if (r.quality >= 0.6 && r.chars >= Math.min(500, 120 * Math.max(1, r.pageCount))) {
      fs.writeFileSync(path.join(dir, "fulltext.txt"), r.text);
      meta.fulltext = { status: "ok", source: "pdf", chars: r.chars, pages: r.pageCount };
      return r;
    }
    meta.fulltext = { status: "needs_agent", source: "pdf", chars: r.chars, quality: Number(r.quality.toFixed(2)), note: "PDF 里抽不出可用文字（扫描件或特殊字体）：让员工用读文件工具读 PDF，再用 library_set_fulltext 写回" };
  } catch (e) {
    meta.fulltext = { status: "needs_agent", source: "pdf", note: `解析 PDF 失败：${e instanceof Error ? e.message : e}` };
  }
  return null;
}
/** Title / first lines of a PDF's text when there is no other metadata. */
function guessTitle(text, fallback) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 8 && l.length < 200 && !/^(arxiv|preprint|proceedings|journal)/i.test(l));
  return lines[0] ?? fallback;
}

/**
 * Add a paper. `ref`: an arXiv id or URL, a DOI or doi.org URL, a URL to a PDF, or a local PDF path.
 * Or `file`: { name, data: Buffer } for an uploaded PDF. Returns { paper, existed }.
 */
export async function addPaper({ ref = "", file = null, tags = [], by = "", fetchImpl = get } = {}) {
  const root = libraryRoot();
  const now = new Date().toISOString();
  let meta = null;
  let pdf = null;
  let fulltext = null;
  const arxivId = file ? null : parseArxivId(ref);
  const doi = file || arxivId ? null : parseDoi(ref);

  if (arxivId) {
    const dup = findExisting({ arxivId });
    if (dup) return { paper: getPaper(dup.id), existed: true };
    const atom = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    meta = parseArxivAtom(atom);
    if (!meta) throw Object.assign(new Error(`arXiv 上找不到 ${arxivId}`), { status: 404 });
    // arXiv's HTML version is clean text; the PDF is kept either way
    try {
      const html = await fetchImpl(`https://arxiv.org/html/${arxivId}`);
      const t = htmlArticleText(html);
      if (t.length > 2000) fulltext = { text: t, source: "arxiv-html" };
    } catch {
      /* older papers have no HTML version */
    }
    try {
      pdf = await fetchImpl(`https://arxiv.org/pdf/${arxivId}`, { binary: true });
    } catch {
      /* metadata alone is still useful */
    }
  } else if (doi) {
    const dup = findExisting({ doi });
    if (dup) return { paper: getPaper(dup.id), existed: true };
    meta = parseCrossref(JSON.parse(await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)));
    if (!meta) throw Object.assign(new Error(`Crossref 上找不到 ${doi}`), { status: 404 });
  } else if (file?.data || /\.pdf$/i.test(ref) || /^https?:\/\//i.test(ref)) {
    if (file?.data) pdf = file.data;
    else if (/^https?:\/\//i.test(ref)) pdf = await fetchImpl(ref, { binary: true });
    else {
      if (!fs.existsSync(ref)) throw Object.assign(new Error(`找不到文件：${ref}`), { status: 404 });
      pdf = fs.readFileSync(ref);
    }
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw Object.assign(new Error("这不是 PDF 文件"), { status: 400 });
    meta = { title: file?.name?.replace(/\.pdf$/i, "") ?? path.basename(String(ref)).replace(/\.pdf$/i, ""), authors: [], year: null, venue: "", abstract: "", url: /^https?:/.test(ref) ? ref : "" };
  } else throw Object.assign(new Error("认不出来：请给 arXiv 编号或链接、DOI、PDF 链接或本机 PDF 路径"), { status: 400 });

  const sha = pdf ? crypto.createHash("sha256").update(pdf).digest("hex") : null;
  const dup = findExisting({ arxivId: meta.arxivId, doi: meta.doi, sha, title: pdf && !arxivId && !doi ? null : meta.title });
  if (dup) return { paper: getPaper(dup.id), existed: true };

  const id = idFor({ arxivId: meta.arxivId, doi: meta.doi, sha: sha ?? crypto.randomBytes(8).toString("hex") });
  const dir = paperDir(id, root);
  fs.mkdirSync(dir, { recursive: true });
  const full = { id, ...meta, tags: [...new Set(tags)], status: "unread", addedAt: now, addedBy: by || "用户", sha256: sha, fulltext: { status: "none" } };
  if (pdf) fs.writeFileSync(path.join(dir, "paper.pdf"), pdf);
  if (fulltext) {
    fs.writeFileSync(path.join(dir, "fulltext.txt"), fulltext.text);
    full.fulltext = { status: "ok", source: fulltext.source, chars: fulltext.text.length };
  } else if (pdf) {
    const r = extractFulltext(dir, full, pdf);
    // a bare PDF: take the title from its first page when the file name says little
    if (r && !arxivId && !doi && (/^(paper|download|document|\d+)$/i.test(full.title) || full.title.length < 6)) full.title = guessTitle(r.pages[0], full.title);
  }
  saveMeta(full, root);
  return { paper: getPaper(id, { root }), existed: false };
}

/* ---------------- search ---------------- */
/** Terms: lowercase Latin words / numbers, CJK as overlapping bigrams. Pure. */
export function tokenize(text) {
  const out = [];
  const s = String(text ?? "").toLowerCase().normalize("NFKC");
  for (const m of s.matchAll(/[\p{Script=Han}]+|[a-z0-9][a-z0-9-]*/gu)) {
    const w = m[0];
    if (/^\p{Script=Han}/u.test(w)) {
      if (w.length === 1) out.push(w);
      for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
    } else if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
}
const STOP = new Set(["the", "of", "and", "to", "in", "a", "for", "is", "on", "with", "by", "we", "that", "as", "are", "this", "an", "be", "from", "at", "or", "it", "our"]);

function bm25(qTerms, docs) {
  const N = docs.length || 1;
  const avg = docs.reduce((n, d) => n + d.len, 0) / N || 1;
  const df = new Map();
  for (const t of new Set(qTerms)) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  return docs.map((d) => {
    let score = 0;
    for (const t of qTerms) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avg))));
    }
    return score * d.weight;
  });
}
function termFreq(terms) {
  const tf = new Map();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * Search titles, abstracts, notes and full texts. Returns papers ranked, each with the best matching
 * passage. Filters: `tag`, `status` (unread / read / …), `year`.
 */
export function searchLibrary(query, { limit = 10, tag = null, status = null, year = null, fulltext = true } = {}) {
  const root = libraryRoot();
  let papers = listPapers({ root });
  if (tag) papers = papers.filter((p) => (p.tags ?? []).includes(tag));
  if (status) papers = papers.filter((p) => p.status === status);
  if (year) papers = papers.filter((p) => String(p.year) === String(year));
  const q = tokenize(query);
  if (!q.length) return papers.slice(0, limit).map((p) => ({ ...brief(p), score: 0, passage: (p.abstract ?? "").slice(0, 240) }));
  const docs = [];
  for (const p of papers) {
    const dir = paperDir(p.id, root);
    const head = `${p.title}\n${(p.authors ?? []).join(", ")}\n${(p.tags ?? []).join(" ")}`;
    docs.push({ p, text: head, weight: 3 });
    if (p.abstract) docs.push({ p, text: p.abstract, weight: 1.6 });
    const notes = readText(path.join(dir, "notes.md"));
    if (notes) docs.push({ p, text: notes, weight: 1.8 });
    if (fulltext) {
      const t = readText(path.join(dir, "fulltext.txt"));
      for (let i = 0; i < t.length; i += 1500) docs.push({ p, text: t.slice(i, i + 1800), weight: 1, offset: i });
    }
  }
  for (const d of docs) {
    const terms = tokenize(d.text);
    d.tf = termFreq(terms);
    d.len = terms.length || 1;
  }
  const scores = bm25(q, docs);
  const best = new Map();
  docs.forEach((d, i) => {
    if (scores[i] <= 0) return;
    const cur = best.get(d.p.id);
    if (!cur) best.set(d.p.id, { p: d.p, total: scores[i], top: scores[i], doc: d });
    else {
      cur.total += scores[i] * 0.5;
      if (scores[i] > cur.top) Object.assign(cur, { top: scores[i], doc: d });
    }
  });
  return [...best.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((b) => ({ ...brief(b.p), score: Number(b.total.toFixed(3)), passage: passageOf(b.doc.text, q), ...(b.doc.offset !== undefined ? { offset: b.doc.offset } : {}) }));
}
const brief = (p) => ({ id: p.id, title: p.title, authors: (p.authors ?? []).slice(0, 4), year: p.year, venue: p.venue, tags: p.tags ?? [], status: p.status, arxivId: p.arxivId ?? null, doi: p.doi ?? null });
function passageOf(text, q) {
  const low = text.toLowerCase().normalize("NFKC");
  const hit = q.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 120);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 360).replace(/\s+/g, " ").trim()}…`;
}

/** Counts for the settings page. */
export function libraryStats() {
  const root = libraryRoot();
  const papers = listPapers({ root });
  return {
    root,
    papers: papers.length,
    unread: papers.filter((p) => p.status === "unread").length,
    needsText: papers.filter((p) => p.fulltext?.status === "needs_agent").length,
    tags: [...new Set(papers.flatMap((p) => p.tags ?? []))].sort(),
  };
}
