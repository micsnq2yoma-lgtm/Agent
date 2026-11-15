import { describe, expect, it } from "vitest";
import { criteriaMarkdown, normalizeCriteria, normalizeEvidence, parseVerdicts, verdictSummary, verificationMarkdown, verifierPrompt } from "../src/acceptance.js";

const crit = normalizeCriteria([{ text: "复现主结果，误差 < 2%", evidence: "指标表" }, "给出能否用于课题的结论", { text: "  " }]);

describe("criteria", () => {
  it("numbers criteria and drops empty ones", () => {
    expect(crit.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(crit[0]).toEqual({ id: "c1", text: "复现主结果，误差 < 2%", evidence: "指标表" });
    expect(criteriaMarkdown(crit)).toContain("**c2** 给出能否用于课题的结论");
  });
  it("needs at least one and caps at 12", () => {
    expect(() => normalizeCriteria([])).toThrow();
    expect(normalizeCriteria(Array.from({ length: 20 }, (_, i) => `标准${i}`))).toHaveLength(12);
  });
});

describe("evidence (builder submits, never judges)", () => {
  it("reports criteria without evidence as missing", () => {
    const r = normalizeEvidence(crit, { items: [{ criterionId: "c1", evidence: "results/table.md：误差 1.3%" }] });
    expect(r.missing).toEqual(["c2"]);
    const r2 = normalizeEvidence(crit, { items: [{ criterionId: "c1", evidence: "x" }, { criterionId: "c2", missing: true }] });
    expect(r2.missing).toEqual(["c2"]);
  });
  it("rejects unknown criteria and disputes without a reason", () => {
    expect(() => normalizeEvidence(crit, { items: [{ criterionId: "c9", evidence: "x" }] })).toThrow(/c9/);
    expect(() => normalizeEvidence(crit, { items: [], disputes: [{ criterionId: "c1" }] })).toThrow(/理由/);
  });
  it("keeps the last item per criterion and records disputes", () => {
    const r = normalizeEvidence(crit, {
      items: [{ criterionId: "c1", evidence: "旧" }, { criterionId: "c1", evidence: "新" }],
      disputes: [{ criterionId: "c2", kind: "invalid_criterion", reason: "超出需求" }],
    });
    expect(r.items).toEqual([{ criterionId: "c1", evidence: "新", missing: false }]);
    expect(r.disputes[0]).toEqual({ criterionId: "c2", kind: "invalid_criterion", reason: "超出需求" });
  });
});

describe("independent verifier", () => {
  it("prompt carries goal, every criterion, evidence, disputes and report, and asks for JSON only", () => {
    const p = verifierPrompt({
      goal: "看论文方法能否用于课题",
      criteria: crit,
      items: [{ criterionId: "c1", evidence: "误差 1.3%", missing: false }],
      disputes: [{ criterionId: "c2", kind: "invalid_criterion", reason: "需要用户数据" }],
      report: "## 结论\n可以用",
    });
    for (const s of ["看论文方法能否用于课题", "c1：复现主结果", "误差 1.3%", "c2：给出能否用于课题的结论", "（没有证据）", "需要用户数据", "可以用", '"verdicts"']) expect(p).toContain(s);
  });
  it("parses verdicts; unknown verdicts and missing criteria become uncertain", () => {
    const v = parseVerdicts('好的 {"verdicts":[{"criterionId":"c1","verdict":"passed","reason":"误差在范围内"},{"criterionId":"c9","verdict":"passed"},{"criterionId":"c2","verdict":"maybe"}]}', crit)!;
    expect(v.map((x) => x.verdict)).toEqual(["passed", "uncertain"]);
    expect(verdictSummary(v)).toEqual({ passed: 1, failed: 0, uncertain: 1, allPassed: false });
    const v2 = parseVerdicts('{"verdicts":[{"criterionId":"c1","verdict":"failed","reason":"r","suggestion":"s"}]}', crit)!;
    expect(v2[1]).toMatchObject({ criterionId: "c2", verdict: "uncertain" });
    expect(parseVerdicts("不是 JSON", crit)).toBeNull();
    expect(verificationMarkdown(crit, v2, "sonnet")).toContain("未通过 1");
  });
});
