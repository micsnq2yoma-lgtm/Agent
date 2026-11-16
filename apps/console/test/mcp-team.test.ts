// Team MCP server: reporting settles the task in code (P1 run 5), and role boundaries hold.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { handle } from "../server/mcp-team.mjs";

type Issue = { id: string; companyId: string; status: string; parentId: string | null; assigneeAgentId: string; projectId: string };
const db = {
  issues: [] as Issue[],
  docs: {} as Record<string, unknown>,
  comments: [] as Array<{ issueId: string; body: string }>,
  interactions: [] as Array<{ issueId: string; kind: string; payload: { target?: { key?: string; revisionId?: string } } }>,
  calls: [] as string[],
  /** force Paperclip to refuse in_review even with a review path */
  refuseReview: false,
};
let server: http.Server;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : null;
    const p = new URL(req.url!, "http://x").pathname;
    let out: unknown = null;
    let m: RegExpMatchArray | null;
    db.calls.push(`${req.method} ${p}`);
    if ((m = p.match(/^\/api\/issues\/(\w+)$/))) {
      const i = db.issues.find((x) => x.id === m![1])!;
      if (req.method === "PATCH") {
        // Paperclip: an agent may not move a task to in_review without a review path
        const hasPath = db.interactions.some((x) => x.issueId === i.id);
        if (b.status === "in_review" && (!hasPath || db.refuseReview)) {
          res.writeHead(422, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "invalid_issue_disposition: Agent-authored updates that move an issue to in_review must include a real review path." }));
        }
        Object.assign(i, b);
      }
      out = i;
    } else if ((m = p.match(/^\/api\/issues\/(\w+)\/documents\/(\w+)$/))) {
      if (req.method === "PUT") db.docs[`${m[1]}:${m[2]}`] = { ...b, id: `doc-${m[2]}`, latestRevisionId: "11111111-1111-4111-8111-111111111111" };
      out = db.docs[`${m[1]}:${m[2]}`] ?? null;
    } else if ((m = p.match(/^\/api\/issues\/(\w+)\/interactions$/)) && req.method === "POST") {
      db.interactions.push({ issueId: m[1], ...b });
      out = { id: `int-${db.interactions.length}` };
    } else if (p === "/api/plugins/tools/execute") {
      out = { result: { content: "已取消这个任务上未触发的提醒和看守" } };
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
  it("submit_report: drop reminders, then a confirmation card on the report, then in_review", async () => {
    db.issues.push({ id: "top", companyId: "c1", status: "in_progress", parentId: null, assigneeAgentId: "lead1", projectId: "p" });
    db.calls.length = 0;
    const r = await call("submit_report", { issueId: "top", body: "## 结论\n可以" });
    expect(r.err).toBe(false);
    expect((db.docs["top:report"] as { body: string }).body).toContain("可以");
    expect(db.issues[0].status).toBe("in_review");
    const card = db.interactions.find((x) => x.issueId === "top")!;
    expect(card.kind).toBe("request_confirmation");
    expect(card.payload.target).toMatchObject({ key: "report", revisionId: "11111111-1111-4111-8111-111111111111" });
    const order = (x: string) => db.calls.findIndex((c) => c === x);
    expect(order("POST /api/plugins/tools/execute")).toBeLessThan(order("POST /api/issues/top/interactions"));
    expect(order("POST /api/issues/top/interactions")).toBeLessThan(order("PATCH /api/issues/top"));
    expect(db.comments.at(-1)).toEqual({ issueId: "top", body: "已汇报，等你确认。" });
  });
  it("when Paperclip still refuses in_review, reminders are already dropped and the lead gets the reason", async () => {
    db.issues.push({ id: "top3", companyId: "c1", status: "in_progress", parentId: null, assigneeAgentId: "lead1", projectId: "p" });
    db.refuseReview = true;
    db.calls.length = 0;
    const r = await call("submit_report", { issueId: "top3", body: "x" });
    db.refuseReview = false;
    expect(r.err).toBe(true);
    expect(r.text).toContain("invalid_issue_disposition");
    expect(r.text).toContain("提醒已取消");
    expect(db.calls).toContain("POST /api/plugins/tools/execute");
    expect(db.issues.find((i) => i.id === "top3")!.status).toBe("in_progress");
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
  it("an employee can settle its own task (exercises the shared helpers)", async () => {
    process.env.PAPERCLIP_AGENT_ID = "emp";
    try {
      const r = await call("update_task", { issueId: "kid", status: "done" }, "employee");
      expect(r.err).toBe(false);
      expect(JSON.parse(r.text)).toMatchObject({ id: "kid", status: "done", parentId: "top" });
      expect((await call("update_task", { issueId: "top", status: "done" }, "employee")).err).toBe(true);
    } finally {
      process.env.PAPERCLIP_AGENT_ID = "lead1";
    }
  });
  it("employees cannot see lead-only tools", async () => {
    const r = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "employee");
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain("submit_report");
    expect(names).not.toContain("create_subtask");
    expect(names).toContain("submit_evidence");
  });
});

// @ts-expect-error plain JS module
import { askFirstGate, codexBlock } from "../server/mcp-team.mjs";
describe("delegation guards (PR #4 p13)", () => {
  const parent = { id: "top", title: "清理旧实验结果", description: "目录里堆了好几次实验的结果文件，帮我清理一下，只留最新的一份。" };
  it("refuses to hand an ask-first job to an employee before the user said yes", async () => {
    const r = await askFirstGate(parent, "删除 3 个旧 CSV", "none", undefined, { interactions: [] });
    expect(r).toMatch(/先问清单/);
    expect(r).toMatch(/ask_user/);
  });
  it("lets it through once the user answered a card on the parent", async () => {
    expect(await askFirstGate(parent, "删除 3 个旧 CSV", "approved", undefined, { interactions: [{ status: "answered" }] })).toBeNull();
    expect(await askFirstGate(parent, "x", "approved", undefined, { interactions: [{ status: "pending" }] })).toMatch(/还没有用户回答过/);
    expect(await askFirstGate(parent, "x", "approved", undefined, { interactions: [{ status: "rejected" }] })).toMatch(/还没有用户回答过/);
  });
  it("a lead can explain a false alarm; plain tasks pass", async () => {
    expect(await askFirstGate(parent, "x", "none", "清理的是我自己刚生成的临时文件", { interactions: [] })).toBeNull();
    expect(await askFirstGate({ id: "t", title: "数质数", description: "数一数 1 到 10000 的质数" }, "写脚本", "none", undefined, { interactions: [] })).toBeNull();
    expect(await askFirstGate(parent, "x", undefined, undefined, { interactions: [] })).toMatch(/none 或 approved/);
  });
  it("Codex employees cannot take delegated work until they have team tools", () => {
    expect(codexBlock({ name: "实验员", adapterType: "codex_local" }, false)).toMatch(/Codex 员工/);
    expect(codexBlock({ name: "实验员", adapterType: "codex_local" }, true)).toBeNull();
    expect(codexBlock({ name: "科研员", adapterType: "claude_local" }, false)).toBeNull();
  });
});
