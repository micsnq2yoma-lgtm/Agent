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
  it("not a PDF: no text, quality 0", () => {
    expect(pdfText(Buffer.from("hello world")).quality).toBe(0);
  });
});
