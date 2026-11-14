import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { buildCard, parseAction, verifyInbound } from "../src/index.mjs";
// @ts-expect-error plain JS module
import { applyAction, imCards, startIm, stopIm, imStatus } from "../../../apps/console/server/im.mjs";

const ALLOW = ["ou_me"];
const card = {
  id: "att-1",
  tier: "high",
  title: "现在开始训练吗？",
  who: "实验员",
  department: "科研部",
  ref: "AGE-9",
  explain: "会占用 GPU 6 小时",
  ifNoReply: "明早再提醒",
  options: [
    { id: "o1", label: "开始" },
    { id: "o2", label: "先别动" },
  ],
  action: { kind: "interaction", issueId: "I", interactionId: "X", questionId: "choice" },
};

describe("feishu card rendering", () => {
  it("renders buttons carrying the action payload", () => {
    const c = buildCard(card);
    expect(c.header.template).toBe("red");
    expect(c.header.title.content).toContain("要你拍板");
    const actions = c.elements.find((e: { tag: string }) => e.tag === "action").actions;
    expect(actions.map((a: { text: { content: string } }) => a.text.content)).toEqual(["开始", "先别动"]);
    expect(actions[0].value).toMatchObject({ kind: "interaction", optionId: "o1", cardId: "att-1", interactionId: "X" });
  });
  it("handled state removes buttons and greys out", () => {
    const c = buildCard(card, { label: "已处理：开始" });
    expect(c.header.template).toBe("grey");
    expect(c.elements.some((e: { tag: string }) => e.tag === "action")).toBe(false);
    expect(JSON.stringify(c)).toContain("已处理：开始");
  });
});

describe("feishu inbound and actions", () => {
  const msg = (openId: string, text: string, type = "text") => ({
    sender: { sender_id: { open_id: openId } },
    message: { message_type: type, content: JSON.stringify({ text }), chat_id: "c", message_id: "m" },
  });
  it("accepts allowlisted text, strips mentions", () => {
    expect(verifyInbound(msg("ou_me", "@_user_1 今天天气"), ALLOW)).toMatchObject({ userId: "ou_me", text: "今天天气" });
  });
  it("rejects strangers, non-text and empty allowlists", () => {
    expect(verifyInbound(msg("ou_x", "hi"), ALLOW)).toBeNull();
    expect(verifyInbound(msg("ou_me", "hi", "image"), ALLOW)).toBeNull();
    expect(verifyInbound(msg("ou_me", "hi"), [])).toBeNull();
  });
  it("parses button callbacks only from allowlisted operators", () => {
    const ev = { operator: { open_id: "ou_me" }, action: { value: { cardId: "att-1", optionId: "o1", kind: "interaction" } }, context: { open_message_id: "om" } };
    expect(parseAction(ev, ALLOW)).toMatchObject({ cardId: "att-1", optionId: "o1", messageId: "om" });
    expect(parseAction({ ...ev, operator: { open_id: "ou_x" } }, ALLOW)).toBeNull();
  });
});

describe("IM host", () => {
  const attention = [
    {
      id: "att-1",
      sourceKind: "issue_thread_interaction",
      subject: { id: "X", metadata: { createdByAgentId: "emp" } },
      relatedIssue: { id: "I", identifier: "AGE-9", title: "复现" },
      project: { name: "科研部" },
      createdAt: "2026-11-14T10:00:00Z",
    },
    { id: "att-2", sourceKind: "failed_run", subject: { id: "R", title: "运行失败" }, createdAt: "2026-11-14T10:00:00Z" },
  ];
  const interactions = [{ id: "X", kind: "ask_user_questions", payload: { questions: [{ id: "choice", prompt: "开始吗？", helpText: "说明\n不回复会怎样：明早再提醒", options: [{ id: "o1", label: "开始" }] }] } }];

  it("only high tier by default; medium when enabled", async () => {
    const args = { items: attention, getInteractions: async () => interactions, agentsById: { emp: { name: "实验员" } } };
    const high = await imCards({ ...args, tiers: ["high"] });
    expect(high.map((c: { id: string }) => c.id)).toEqual(["att-1"]);
    expect(high[0]).toMatchObject({ who: "实验员", ifNoReply: "明早再提醒", title: "开始吗？" });
    expect((await imCards({ ...args, tiers: ["high", "medium"] })).length).toBe(2);
  });

  it("applies a button to Paperclip", async () => {
    const calls: unknown[] = [];
    const pc = async (...a: unknown[]) => void calls.push(a);
    await applyAction(pc, { kind: "interaction", issueId: "I", interactionId: "X", questionId: "choice", optionId: "o1" });
    await applyAction(pc, { kind: "approval", approvalId: "A", optionId: "approve" });
    expect(calls).toEqual([
      ["POST", "/issues/I/interactions/X/respond", { answers: [{ questionId: "choice", optionIds: ["o1"] }] }],
      ["POST", "/approvals/A/approve", {}],
    ]);
  });

  it("end to end with a fake channel: push, answer in IM, sync handled from web, inbound text", async () => {
    process.env.AGENTSELF_FEISHU_APP_SECRET = "test-secret";
    let items = [...attention.slice(0, 1)];
    const sentCards: string[] = [];
    const updates: string[] = [];
    const texts: string[] = [];
    const pcCalls: string[] = [];
    let handlers: { onText: (m: unknown) => Promise<void>; onAction: (a: unknown) => Promise<{ toast: string }> } | null = null;
    const store: { im?: { sent: Record<string, { state: string }> } } = {};
    const pc = async (method: string, p: string) => {
      pcCalls.push(`${method} ${p}`);
      if (p.endsWith("/attention")) return { items };
      if (p.endsWith("/interactions")) return interactions;
      return {};
    };
    await startIm({
      settings: { externalDefault: "ask", feishu: { enabled: true, appId: "cli_x", allowUserIds: ["ou_me"], pushTiers: ["high"] } },
      store,
      saveStore: () => {},
      pc,
      loadContext: async () => ({ company: { id: "C" }, agents: [{ id: "emp", name: "实验员" }] }),
      frontdesk: async () => ({ route: "answer", answer: { answer: "明天有雨" } }),
      intervalMs: 60_000,
      createChannel: async () => ({
        sendCard: async (_to: unknown, c: { id: string }) => (sentCards.push(c.id), { messageId: `m-${c.id}` }),
        updateCard: async (ref: { messageId: string }) => void updates.push(ref.messageId),
        sendText: async (_to: unknown, t: string) => void texts.push(t),
        start: (h: typeof handlers) => ((handlers = h), () => {}),
      }),
    });
    expect(sentCards).toEqual(["att-1"]);
    expect(imStatus()).toContain("已连接");

    // answer in IM
    const r = await handlers!.onAction({ cardId: "att-1", optionId: "o1", kind: "interaction", issueId: "I", interactionId: "X", questionId: "choice" });
    expect(r.toast).toBe("已处理");
    expect(pcCalls).toContain("POST /issues/I/interactions/X/respond");
    expect(store.im!.sent["att-1"].state).toBe("handled");

    // inbound text goes to the front desk and the answer comes back
    await handlers!.onText({ userId: "ou_me", text: "明天天气？" });
    expect(texts).toEqual(["明天有雨"]);
    stopIm();

    // a second card handled on the web gets marked handled in IM on the next sync
    items = [{ ...attention[0], id: "att-3" }];
    await startIm({
      settings: { feishu: { enabled: true, appId: "cli_x", allowUserIds: ["ou_me"], pushTiers: ["high"] } },
      store,
      saveStore: () => {},
      pc,
      loadContext: async () => ({ company: { id: "C" }, agents: [] }),
      frontdesk: async () => ({}),
      intervalMs: 50,
      createChannel: async () => ({
        sendCard: async (_to: unknown, c: { id: string }) => (sentCards.push(c.id), { messageId: `m-${c.id}` }),
        updateCard: async (ref: { messageId: string }) => void updates.push(ref.messageId),
        sendText: async () => {},
        start: () => () => {},
      }),
    });
    items = [];
    await new Promise((res) => setTimeout(res, 200));
    stopIm();
    expect(updates).toContain("m-att-3");
    expect(store.im!.sent["att-3"].state).toBe("handled");
  });

  it("stays disabled without credentials", async () => {
    delete process.env.AGENTSELF_FEISHU_APP_SECRET;
    await startIm({ settings: { feishu: { enabled: true, appId: "x", allowUserIds: ["ou"] } }, store: {}, saveStore: () => {}, pc: async () => ({}), loadContext: async () => ({}), frontdesk: async () => ({}), createChannel: async () => ({}) });
    expect(imStatus()).toContain("AGENTSELF_FEISHU_APP_SECRET");
  });
});
