// Loads the acceptance documents for the workbench and drawer; parsing lives in acceptance-parse.ts.
import { pc } from "./api";
import { parseAcceptance, type Acceptance } from "./acceptance-parse";
export * from "./acceptance-parse";

interface DocLike {
  body?: string;
  markdown?: string;
  latestRevision?: { body?: string };
  updatedAt?: string;
}
async function doc(issueId: string, key: string): Promise<{ body: string; updatedAt: string | null }> {
  try {
    const d = await pc.get<DocLike>(`/issues/${issueId}/documents/${key}`);
    return { body: d.body ?? d.markdown ?? d.latestRevision?.body ?? "", updatedAt: d.updatedAt ?? null };
  } catch {
    return { body: "", updatedAt: null };
  }
}

/**
 * Criteria live on the lead's (parent) task, evidence and verification on the employee's child task.
 * `childId` is the latest child; pass null when the lead has not delegated yet.
 */
export async function loadAcceptance(parentId: string, childId: string | null): Promise<Acceptance> {
  const [criteria, evidence, verification] = await Promise.all([
    doc(parentId, "criteria"),
    childId ? doc(childId, "evidence") : Promise.resolve({ body: "", updatedAt: null }),
    childId ? doc(childId, "verification") : Promise.resolve({ body: "", updatedAt: null }),
  ]);
  const a = parseAcceptance({ criteria: criteria.body, evidence: evidence.body, verification: verification.body });
  return { ...a, verifiedAt: verification.updatedAt };
}
