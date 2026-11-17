// Paper library: user-chosen folder, arXiv / DOI / PDF intake, dedupe, full-text search (CJK too),
// notes, moving the folder. Network sources are replaced by fixtures in the formats arXiv and
// Crossref return.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "agenteam-lib-"));
process.env.AGENTEAM_HOME = home;
// @ts-expect-error plain JS module
const lib = await import("../../../scripts/lib/library.mjs");
const pdf = fs.readFileSync(path.join(__dirname, "fixtures", "sample-paper.pdf"));
const arxivPdf = fs.readFileSync(path.join(__dirname, "fixtures", "arxiv-paper.pdf"));

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1412.6980v9</id>
    <published>2014-12-22T13:54:29Z</published>
    <title>Adam: A Method for Stochastic
  Optimization</title>
    <summary>  We introduce Adam, an algorithm for first-order gradient-based optimization of
stochastic objective functions &amp; more.</summary>
    <author><name>Diederik P. Kingma</name></author>
    <author><name>Jimmy Ba</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <link title="pdf" href="http://arxiv.org/pdf/1412.6980v9" rel="related" type="application/pdf"/>
  </entry>
</feed>`;
const HTML = `<html><body><nav>skip</nav><article><h1>Adam</h1><p>${"Adaptive moment estimation uses bias correction. ".repeat(60)}</p><p>Sparse gradients 稀疏梯度 work well.</p></article></body></html>`;
const CROSSREF = JSON.stringify({ message: { DOI: "10.1038/nature14539", title: ["Deep learning"], author: [{ given: "Yann", family: "LeCun" }, { given: "Yoshua", family: "Bengio" }], issued: { "date-parts": [[2015, 5, 27]] }, "container-title": ["Nature"], abstract: "<jats:p>Deep learning allows computational models…</jats:p>", URL: "http://dx.doi.org/10.1038/nature14539" } });
const fetchImpl = async (url: string, o?: { binary?: boolean }) => {
  if (url.includes("export.arxiv.org")) return url.includes("9999.99999") ? `<feed><entry><id>http://arxiv.org/api/errors#x</id></entry></feed>` : ATOM;
  if (url.includes("arxiv.org/html/")) return HTML;
  if (url.includes("arxiv.org/pdf/")) return o?.binary ? arxivPdf : "";
  if (url.endsWith(".pdf")) return o?.binary ? pdf : "";
  if (url.includes("api.crossref.org")) return CROSSREF;
  throw new Error(`unexpected ${url}`);
};

describe("identifiers", () => {
  it("reads arXiv ids from ids and URLs, DOIs from text and links", () => {
    expect(lib.parseArxivId("https://arxiv.org/abs/1412.6980v9")).toBe("1412.6980");
    expect(lib.parseArxivId("arXiv:2310.06825")).toBe("2310.06825");
    expect(lib.parseArxivId("https://arxiv.org/pdf/2310.06825v2.pdf")).toBe("2310.06825");
    expect(lib.parseArxivId("hep-th/9901001")).toBe("hep-th/9901001");
    expect(lib.parseDoi("https://doi.org/10.1038/nature14539.")).toBe("10.1038/nature14539");
    expect(lib.parseArxivId("deep learning")).toBeNull();
  });
});

describe("adding papers", () => {
  it("arXiv: metadata from the API, text from the HTML version, the PDF kept", async () => {
    const { paper, existed } = await lib.addPaper({ ref: "https://arxiv.org/abs/1412.6980", tags: ["optimizer"], fetchImpl });
    expect(existed).toBe(false);
    expect(paper).toMatchObject({ id: "arxiv-1412.6980", title: "Adam: A Method for Stochastic Optimization", authors: ["Diederik P. Kingma", "Jimmy Ba"], year: 2014, arxivId: "1412.6980", hasPdf: true, status: "unread" });
    expect(paper.abstract).toMatch(/objective functions & more/);
    expect(paper.fulltext).toMatchObject({ status: "ok", source: "arxiv-html" });
    expect(lib.libraryRoot()).toBe(path.join(home, "library"));
  });
  it("the same paper again is found, not duplicated", async () => {
    expect((await lib.addPaper({ ref: "arXiv:1412.6980v3", fetchImpl })).existed).toBe(true);
  });
  it("DOI: metadata from Crossref", async () => {
    const { paper } = await lib.addPaper({ ref: "10.1038/nature14539", fetchImpl });
    expect(paper).toMatchObject({ title: "Deep learning", authors: ["Yann LeCun", "Yoshua Bengio"], year: 2015, venue: "Nature" });
  });
  it("an uploaded PDF: text extracted for search; the same file twice is one paper", async () => {
    const a = await lib.addPaper({ file: { name: "adam-notes.pdf", data: pdf }, fetchImpl });
    expect(a.paper.fulltext.status).toBe("ok");
    expect(lib.readFulltext(a.paper.id).text).toMatch(/稀疏梯度/);
    expect((await lib.addPaper({ file: { name: "copy.pdf", data: pdf }, fetchImpl })).existed).toBe(true);
    await expect(lib.addPaper({ file: { name: "x.pdf", data: Buffer.from("hello") }, fetchImpl })).rejects.toThrow(/不是 PDF/);
  });
  it("unknown inputs and missing arXiv ids are explained", async () => {
    await expect(lib.addPaper({ ref: "a paper about cats", fetchImpl })).rejects.toThrow(/认不出来/);
    await expect(lib.addPaper({ ref: "9999.99999", fetchImpl })).rejects.toThrow(/找不到/);
  });
});

describe("search and notes", () => {
  it("finds papers by title, abstract, full text and notes, Chinese included", () => {
    expect(lib.searchLibrary("stochastic optimization")[0].id).toBe("arxiv-1412.6980");
    expect(lib.searchLibrary("LeCun")[0].title).toBe("Deep learning");
    const zh = lib.searchLibrary("稀疏梯度");
    expect(zh.length).toBeGreaterThan(0);
    expect(zh[0].passage).toMatch(/稀疏梯度/);
    lib.writeNotes("doi-10.1038_nature14539", "和我的课题相关：可以借鉴表示学习的综述结构", { by: "科研员" });
    expect(lib.searchLibrary("表示学习")[0].id).toBe("doi-10.1038_nature14539");
    expect(lib.getPaper("doi-10.1038_nature14539").notes).toMatch(/## \d{4}-\d{2}-\d{2} · 科研员/);
  });
  it("filters by tag and status; reads long text in slices", () => {
    expect(lib.searchLibrary("", { tag: "optimizer" }).map((p: { id: string }) => p.id)).toEqual(["arxiv-1412.6980"]);
    lib.updatePaper("arxiv-1412.6980", { status: "read" });
    expect(lib.searchLibrary("adam", { status: "unread" }).some((p: { id: string }) => p.id === "arxiv-1412.6980")).toBe(false);
    const part = lib.readFulltext("arxiv-1412.6980", { offset: 0, limit: 100 });
    expect(part.text.length).toBe(100);
    expect(part.more).toBe(true);
  });
});

describe("the library folder", () => {
  it("moves to a folder the user chooses, papers included", () => {
    const old = lib.libraryRoot();
    const next = path.join(home, "D-drive", "Papers");
    const r = lib.setLibraryRoot(next, { move: true });
    expect(r).toMatchObject({ root: next, moved: 3 });
    expect(lib.libraryRoot()).toBe(next);
    expect(fs.existsSync(path.join(next, "papers", "arxiv-1412.6980", "paper.pdf"))).toBe(true);
    expect(fs.existsSync(path.join(old, "papers", "arxiv-1412.6980"))).toBe(false);
    expect(lib.searchLibrary("LeCun")[0].title).toBe("Deep learning");
  });
  it("pointing at a folder that already holds a library picks it up; nesting is refused", () => {
    const other = path.join(home, "elsewhere");
    lib.setLibraryRoot(other);
    expect(lib.listPapers()).toEqual([]);
    lib.setLibraryRoot(path.join(home, "D-drive", "Papers"));
    expect(lib.listPapers().length).toBe(3);
    expect(() => lib.setLibraryRoot(path.join(home, "D-drive", "Papers", "inner"))).toThrow(/不能在旧位置里面/);
  });
  it("the catalog is rebuilt from the folders if it is lost", () => {
    fs.rmSync(path.join(lib.libraryRoot(), "library.json"));
    expect(lib.listPapers().length).toBe(3);
  });
});
