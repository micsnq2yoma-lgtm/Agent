// Structured acceptance (plan B step 2, after LobeHub's acceptance-evidence + verify tools).
// The lead writes criteria on the parent task; the employee submits evidence per criterion on its
// child task and never judges; an independent verifier session (a different model, no tools) judges
// each criterion; the lead reads the verdicts and makes the final call.
// Pure functions only: no host, no I/O, so they can be unit-tested.

export interface Criterion {
  id: string;
  text: string;
  /** What kind of evidence proves it (numbers, file, screenshot, command output, citation…). */
  evidence: string;
}

export interface EvidenceItem {
  criterionId: string;
  evidence: string;
  /** true when the employee has no evidence for this criterion. */
  missing: boolean;
}

export type DisputeKind = "invalid_criterion" | "missed_evidence";
export interface Dispute {
  criterionId: string;
  kind: DisputeKind;
  reason: string;
}

export type Verdict = "passed" | "failed" | "uncertain";
export interface CriterionVerdict {
  criterionId: string;
  verdict: Verdict;
  reason: string;
  suggestion: string;
}

const clean = (s: unknown, max = 2000) => String(s ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

/** Normalise the lead's input into c1..cN. Accepts strings or { text, evidence }. Max 12. */
export function normalizeCriteria(input: unknown): Criterion[] {
  const items = Array.isArray(input) ? input : [];
  const out: Criterion[] = [];
  for (const raw of items) {
    const text = clean(typeof raw === "string" ? raw : (raw as { text?: unknown })?.text, 500);
    if (!text) continue;
    const evidence = typeof raw === "string" ? "" : clean((raw as { evidence?: unknown })?.evidence, 300);
    out.push({ id: `c${out.length + 1}`, text, evidence });
    if (out.length >= 12) break;
  }
  if (out.length === 0) throw new Error("至少要有一条验收标准");
  return out;
}

/**
 * Validate the employee's evidence against the criteria. Unknown criterion ids are rejected;
 * criteria without an item are reported as missing (not an error: the employee may say so).
 */
export function normalizeEvidence(
  criteria: Criterion[],
  input: { items?: unknown; disputes?: unknown },
): { items: EvidenceItem[]; disputes: Dispute[]; missing: string[] } {
  const ids = new Set(criteria.map((c) => c.id));
  const items: EvidenceItem[] = [];
  for (const raw of Array.isArray(input.items) ? input.items : []) {
    const r = raw as { criterionId?: unknown; evidence?: unknown; missing?: unknown };
    const criterionId = clean(r.criterionId, 10);
    if (!ids.has(criterionId)) throw new Error(`没有这条验收标准：${criterionId || "（空）"}`);
    const evidence = clean(r.evidence, 4000);
    const missing = r.missing === true || !evidence;
    const prev = items.findIndex((x) => x.criterionId === criterionId);
    const item = { criterionId, evidence, missing };
    if (prev >= 0) items[prev] = item;
    else items.push(item);
  }
  const disputes: Dispute[] = [];
  for (const raw of Array.isArray(input.disputes) ? input.disputes : []) {
    const r = raw as { criterionId?: unknown; kind?: unknown; reason?: unknown };
    const criterionId = clean(r.criterionId, 10);
    if (!ids.has(criterionId)) throw new Error(`异议指向的验收标准不存在：${criterionId || "（空）"}`);
    const kind: DisputeKind = r.kind === "missed_evidence" ? "missed_evidence" : "invalid_criterion";
    const reason = clean(r.reason, 1000);
    if (!reason) throw new Error(`对 ${criterionId} 的异议要写理由`);
    disputes.push({ criterionId, kind, reason });
  }
  const covered = new Set(items.filter((i) => !i.missing).map((i) => i.criterionId));
  return { items, disputes, missing: criteria.filter((c) => !covered.has(c.id)).map((c) => c.id) };
}

export function verifierPrompt(input: { goal: string; criteria: Criterion[]; items: EvidenceItem[]; disputes: Dispute[]; report: string }): string {
  const byId = new Map(input.items.map((i) => [i.criterionId, i]));
  const blocks = input.criteria
    .map((c) => {
      const e = byId.get(c.id);
      const disputes = input.disputes.filter((d) => d.criterionId === c.id);
      return [
        `### ${c.id}：${c.text}`,
        c.evidence ? `要求的证据：${c.evidence}` : "",
        `员工提交的证据：${e && !e.missing ? e.evidence : "（没有证据）"}`,
        ...disputes.map((d) => `员工的异议（${d.kind === "invalid_criterion" ? "认为标准本身不合理" : "认为之前漏看了证据"}）：${d.reason}`),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return `你是一名交付核查员。下面是一项任务的目标、验收标准，以及干活的员工逐条提交的证据和报告。你要逐条判断交付是否满足每一条验收标准。

规则：
- 只根据下面提供的材料判断。你没有搜索、文件或命令工具，也不需要。
- 怀疑但果断：材料清楚表明满足就判 "passed"，清楚表明不满足就判 "failed"，只有材料确实无法下结论时才判 "uncertain"。
- 员工说"没有证据"的，判 "uncertain"（除非报告里有确凿的反面证据，判 "failed"）。
- 员工对标准提出异议的：仍按标准本身判定，但在 reason 里说明你是否认同异议。
- failed 和 uncertain 必须给出 suggestion：具体还要做什么或补什么证据。
- 不要编造材料里没有的事实。

只输出一个 JSON 对象，不要输出其他文字：
{"verdicts":[{"criterionId":"c1","verdict":"passed|failed|uncertain","reason":"一两句话","suggestion":""}]}

## 目标
${clean(input.goal, 2000) || "（未提供）"}

## 逐条标准与证据
${blocks}

## 员工的报告
${clean(input.report, 12000) || "（没有报告）"}`;
}

/** Parse the verifier's output; every criterion gets a verdict (missing ones become uncertain). */
export function parseVerdicts(raw: string, criteria: Criterion[]): CriterionVerdict[] | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let list: unknown[];
  try {
    const o = JSON.parse(raw.slice(s, e + 1));
    list = Array.isArray(o?.verdicts) ? o.verdicts : [];
  } catch {
    return null;
  }
  const byId = new Map<string, CriterionVerdict>();
  for (const x of list) {
    const r = x as Record<string, unknown>;
    const criterionId = clean(r.criterionId, 10);
    if (!criteria.some((c) => c.id === criterionId)) continue;
    const verdict: Verdict = r.verdict === "passed" || r.verdict === "failed" ? r.verdict : "uncertain";
    byId.set(criterionId, { criterionId, verdict, reason: clean(r.reason, 600), suggestion: clean(r.suggestion, 600) });
  }
  return criteria.map(
    (c) => byId.get(c.id) ?? { criterionId: c.id, verdict: "uncertain", reason: "核查员没有给出这条的判定", suggestion: "由主管自己核对" },
  );
}

export function verdictSummary(verdicts: CriterionVerdict[]) {
  const count = (v: Verdict) => verdicts.filter((x) => x.verdict === v).length;
  return { passed: count("passed"), failed: count("failed"), uncertain: count("uncertain"), allPassed: verdicts.every((x) => x.verdict === "passed") };
}

const VERDICT_TEXT: Record<Verdict, string> = { passed: "通过", failed: "未通过", uncertain: "无法判断" };

export function criteriaMarkdown(criteria: Criterion[]): string {
  return `# 验收标准\n\n${criteria.map((c) => `- **${c.id}** ${c.text}${c.evidence ? `\n  - 证据：${c.evidence}` : ""}`).join("\n")}\n`;
}

export function evidenceMarkdown(criteria: Criterion[], items: EvidenceItem[], disputes: Dispute[]): string {
  const byId = new Map(items.map((i) => [i.criterionId, i]));
  const rows = criteria.map((c) => {
    const e = byId.get(c.id);
    const ds = disputes.filter((d) => d.criterionId === c.id).map((d) => `  - 异议：${d.reason}`);
    return [`- **${c.id}** ${c.text}`, `  - 证据：${e && !e.missing ? e.evidence : "（没有证据）"}`, ...ds].join("\n");
  });
  return `# 逐条证据\n\n${rows.join("\n")}\n`;
}

export function verificationMarkdown(criteria: Criterion[], verdicts: CriterionVerdict[], model: string): string {
  const byId = new Map(verdicts.map((v) => [v.criterionId, v]));
  const s = verdictSummary(verdicts);
  const rows = criteria.map((c) => {
    const v = byId.get(c.id)!;
    return [`- **${c.id}** ${VERDICT_TEXT[v.verdict]}：${c.text}`, v.reason && `  - 理由：${v.reason}`, v.suggestion && `  - 建议：${v.suggestion}`].filter(Boolean).join("\n");
  });
  return `# 独立核查（${model}）\n\n通过 ${s.passed} · 未通过 ${s.failed} · 无法判断 ${s.uncertain}\n\n${rows.join("\n")}\n\n> 核查员只看任务书、证据和报告，不看过程。最终是否通过由主管决定。\n`;
}
