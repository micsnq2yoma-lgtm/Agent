// Team MCP server: reporting settles the task in code (P1 run 5), and role boundaries hold.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { handle } from "../server/mcp-team.mjs";

type Issue = { id: string; companyId: string; status: string; parentId: string | null; assigneeAgentId: string; projectId: string };
const db: { issues: Issue[]; docs: Record<string, unknown>; comments: Array<{ issueId: string; body: string }> } = { issues: [], docs: {}, comments: [] };
let server: http.Server;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : null;
    const p = new URL(req.url!, "http://x").pathname;
    let out: unknown = null;
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/api\/issues\/(\w+)$/))) {
      const i = db.issues.find((x) => x.id === m![1])!;
      if (req.method === "PATCH") Object.assign(i, b);
      out = i;
    } else if ((m = p.match(/^\/api\/issues\/(\w+)\/documents\/(\w+)$/))) {
      if (req.method === "PUT") db.docs[`${m[1]}:${m[2]}`] = b;
      out = db.docs[`${m[1]}:${m[2]}`] ?? null;
    } else if ((m = p.match(/^\/api\/issues\/(\w+)\/comments$/))) {
      db.comments.push({ issueId: m[1], body: b.body });
      out = {};
    } else {
      res.writeHead(404);
      return res.end("{}");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.PAPERCLIP_AGENT_ID = "lead1";
  process.env.PAPERCLIP_COMPANY_ID = "c1";
});
afterAll(() => server.close());

const call = async (name: string, args: Record<string, unknown>, role = "lead") => {
  const r = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, role);
  return { err: !!r.result.isError, text: r.result.content[0].text as string };
};

describe("team MCP server", () => {
  it("submit_report writes the report and moves the lead's task to in_review", async () => {
    db.issues.push({ id: "top", companyId: "c1", status: "in_progress", parentId: null, assigneeAgentId: "lead1", projectId: "p" });
    const r = await call("submit_report", { issueId: "top", body: "## 结论\n可以" });
    expect(r.err).toBe(false);
    expect((db.docs["top:report"] as { body: string }).body).toContain("可以");
    expect(db.issues[0].status).toBe("in_review");
    expect(db.comments.at(-1)).toEqual({ issueId: "top", body: "已汇报，等你确认。" });
  });
  it("writing the report through write_document settles the task too", async () => {
    db.issues.push({ id: "top2", companyId: "c1", status: "in_progress", parentId: null, assigneeAgentId: "lead1", projectId: "p" });
    const r = await call("write_document", { issueId: "top2", key: "report", body: "x" });
    expect(r.text).toContain("in_review");
    expect(db.issues.find((i) => i.id === "top2")!.status).toBe("in_review");
  });
  it("does not settle a child task or someone else's task", async () => {
    db.issues.push({ id: "kid", companyId: "c1", status: "in_progress", parentId: "top", assigneeAgentId: "emp", projectId: "p" });
    expect((await call("submit_report", { issueId: "kid", body: "x" })).err).toBe(true);
    expect(db.issues.find((i) => i.id === "kid")!.status).toBe("in_progress");
    await call("write_document", { issueId: "kid", key: "report", body: "x" }, "employee");
    expect(db.issues.find((i) => i.id === "kid")!.status).toBe("in_progress");
  });
  it("employees cannot see lead-only tools", async () => {
    const r = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "employee");
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain("submit_report");
    expect(names).not.toContain("create_subtask");
    expect(names).toContain("submit_evidence");
  });
});
