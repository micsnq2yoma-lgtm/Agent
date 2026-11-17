// Read the acceptance documents the team-layer plugin writes (plugins/team-layer/src/acceptance.ts):
//   criteria      "- **c1** 标准\n  - 证据：需要什么证据"
//   evidence      "- **c1** 标准\n  - 证据：员工提交的证据\n  - 异议：…"
//   verification  "# 独立核查（model）…\n- **c1** 通过：标准\n  - 理由：…\n  - 建议：…"
// Pure functions so the card detail and the project drawer share one reading.

export type Verdict = "passed" | "failed" | "uncertain";
export interface CriterionRow {
  id: string;
  text: string;
  /** what the lead asked for */
  wanted: string;
  /** what the employee submitted */
  evidence: string | null;
  dispute: string | null;
  verdict: Verdict | null;
  reason: string | null;
}
export interface Acceptance {
  rows: CriterionRow[];
  model: string | null;
  verifiedAt: string | null;
  passed: number;
}

const VERDICT: Record<string, Verdict> = { 通过: "passed", 未通过: "failed", 无法判断: "uncertain" };
export const VERDICT_TEXT: Record<Verdict, string> = { passed: "通过", failed: "未通过", uncertain: "无法判断" };

function blocks(md: string): Array<{ id: string; head: string; subs: Record<string, string> }> {
  const out: Array<{ id: string; head: string; subs: Record<string, string> }> = [];
  for (const line of md.split(/\r?\n/)) {
    const top = line.match(/^- \*\*(c\d+)\*\*\s*(.*)$/);
    if (top) {
      out.push({ id: top[1], head: top[2].trim(), subs: {} });
      continue;
    }
    const sub = line.match(/^\s+- (证据|异议|理由|建议)[:：]\s*(.*)$/);
    if (sub && out.length) out[out.length - 1].subs[sub[1]] = sub[2].trim();
  }
  return out;
}

export function parseAcceptance(docs: { criteria?: string; evidence?: string; verification?: string }): Acceptance {
  const rows = new Map<string, CriterionRow>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { id, text: "", wanted: "", evidence: null, dispute: null, verdict: null, reason: null });
    return rows.get(id)!;
  };
  for (const b of blocks(docs.criteria ?? "")) {
    const r = row(b.id);
    r.text = b.head;
    r.wanted = b.subs["证据"] ?? "";
  }
  for (const b of blocks(docs.evidence ?? "")) {
    const r = row(b.id);
    if (!r.text) r.text = b.head;
    const ev = b.subs["证据"];
    r.evidence = ev && ev !== "（没有证据）" ? ev : null;
    r.dispute = b.subs["异议"] ?? null;
  }
  for (const b of blocks(docs.verification ?? "")) {
    const m = b.head.match(/^(通过|未通过|无法判断)[:：]\s*(.*)$/);
    const r = row(b.id);
    if (m) {
      r.verdict = VERDICT[m[1]];
      if (!r.text) r.text = m[2];
    }
    r.reason = b.subs["理由"] ?? null;
  }
  const list = [...rows.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const model = (docs.verification ?? "").match(/^# 独立核查（([^）]+)）/m)?.[1] ?? null;
  return { rows: list, model, verifiedAt: null, passed: list.filter((r) => r.verdict === "passed").length };
}

