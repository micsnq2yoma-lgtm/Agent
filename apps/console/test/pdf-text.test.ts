// Zero-dependency PDF text extraction for the paper library.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { pdfText } from "../../../scripts/lib/pdf-text.mjs";

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n));

describe("pdfText", () => {
  it("LibreOffice PDF (CID fonts, ToUnicode): English and Chinese, no spaces inside Chinese", () => {
    const r = pdfText(fixture("sample-paper.pdf"));
    expect(r.pageCount).toBe(1);
    expect(r.text).toMatch(/Adam: A Method for Stochastic Optimization/);
    expect(r.text).toMatch(/自适应学习率方法在稀疏梯度上表现良好/);
    expect(r.quality).toBeGreaterThan(0.9);
  });
  it("ReportLab PDF (ASCII85 + Flate, standard fonts), two pages", () => {
    const r = pdfText(fixture("arxiv-paper.pdf"));
    expect(r.pageCount).toBe(2);
    expect(r.pages[0]).toMatch(/Attention Is All You Need/);
    expect(r.pages[1]).toMatch(/scaled dot-product attention/);
  });
  it("arXiv-stamped LaTeX PDF: page wrapped in a Form XObject by an update, Type1 built-in encoding", () => {
    // What arXiv serves for papers with no HTML version (Adam, 1412.6980): pdfTeX embeds Type1
    // subsets with no /Encoding and no ToUnicode (ligatures live in the font program's encoding),
    // and the arXiv stamp, added as an incremental update, moves the page into a Form XObject.
    const font = (fontFile: number) => `<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+CMR10 /FontDescriptor ${fontFile} 0 R >>`;
    const fontProgram = "%!PS-AdobeFont-1.0: CMR10\n/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 12 /fi put\ndup 13 /fl put\ndup 123 /endash put\ndup 97 /a put\nreadonly def\ncurrentfile eexec\n";
    const stream = (dict: string, body: string) => `<< ${dict} /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
    const body = "BT /F1 10 Tf 72 700 Td (We introduce Adam, an algorithm for \\014rst-order gradient-based optimization) Tj 0 -12 Td [(of stochastic objective functions) -333 (with \\015exible step sizes 10{20.)] TJ ET";
    const original = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      stream("", body),
      font(6),
      "<< /Type /FontDescriptor /FontName /ABCDEF+CMR10 /FontFile 7 0 R >>",
      stream(`/Length1 ${fontProgram.length} /Length2 0 /Length3 0`, fontProgram),
    ];
    let pdf = "%PDF-1.5\n";
    original.forEach((o, k) => (pdf += `${k + 1} 0 obj\n${o}\nendobj\n`));
    pdf += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
    // the stamp: page 3 redefined, its old content drawn as XObject 8, plus a side label
    const update = [
      [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 9 0 R /Resources << /Font << /F9 10 0 R >> /XObject << /Xo1 8 0 R >> >> >>"],
      [8, stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >>", body)],
      [9, stream("", "q /Xo1 Do Q BT /F9 20 Tf 0 1 -1 0 32 200 Tm (arXiv:1412.6980v9  [cs.LG]  30 Jan 2017) Tj ET")],
      [10, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>"],
    ] as const;
    for (const [n, o] of update) pdf += `${n} 0 obj\n${o}\nendobj\n`;
    pdf += "trailer\n<< /Root 1 0 R /Prev 0 >>\n%%EOF\n";
    const r = pdfText(Buffer.from(pdf, "latin1"));
    expect(r.pageCount).toBe(1);
    expect(r.text).toMatch(/We introduce Adam, an algorithm for first-order gradient-based optimization/);
    expect(r.text).toMatch(/with flexible step sizes 10–20\./);
    expect(r.text).toMatch(/arXiv:1412\.6980v9/);
  });
  it("not a PDF: no text, quality 0", () => {
    expect(pdfText(Buffer.from("hello world")).quality).toBe(0);
  });
});
