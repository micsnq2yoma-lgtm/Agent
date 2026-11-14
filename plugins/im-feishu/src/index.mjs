// Feishu (Lark) IM channel (PLAN 6). Long-connection mode: no public webhook needed.
//
// ImChannel contract (adapted for long-connection channels):
//   id
//   start({ onText, onAction }) -> stop()        inbound text / card-button callbacks
//   sendText(to, text) -> MsgRef
//   sendCard(to, card) -> MsgRef                 card = TeamCard (see buildCard)
//   updateCard(ref, state)                       state: "handled" | "expired" with a label
//   parseAction(event) -> CardAction | null
//   verifyInbound(event) -> InboundMsg | null    allowlist + text extraction
import * as lark from "@larksuiteoapi/node-sdk";

/** @typedef {{ id: string, tier: "high"|"medium"|"low", title: string, who?: string, department?: string, ref?: string, explain?: string, ifNoReply?: string, options: Array<{id: string, label: string}>, action: Record<string, string> }} TeamCard */

const TIER_TEMPLATE = { high: "red", medium: "blue", low: "grey" };
const TIER_LABEL = { high: "要你拍板", medium: "交付结果", low: "动态" };

/** Build a Feishu interactive card (JSON 1.0 schema) from a TeamCard. Pure. */
export function buildCard(card, state = null) {
  const meta = [card.who, card.department, card.ref].filter(Boolean).join(" · ");
  const elements = [];
  if (meta) elements.push({ tag: "note", elements: [{ tag: "plain_text", content: meta }] });
  if (card.explain) elements.push({ tag: "div", text: { tag: "lark_md", content: card.explain.slice(0, 1500) } });
  if (state) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**${state.label}**` } });
  } else if (card.options?.length) {
    elements.push({
      tag: "action",
      actions: card.options.slice(0, 6).map((o, i) => ({
        tag: "button",
        text: { tag: "plain_text", content: o.label },
        type: i === 0 ? "primary" : "default",
        value: { ...card.action, optionId: o.id, cardId: card.id },
      })),
    });
  }
  if (card.ifNoReply && !state) elements.push({ tag: "note", elements: [{ tag: "plain_text", content: `不回复：${card.ifNoReply}` }] });
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: state ? "grey" : TIER_TEMPLATE[card.tier] ?? "blue",
      title: { tag: "plain_text", content: `${state ? "已处理" : TIER_LABEL[card.tier] ?? ""}｜${card.title}`.slice(0, 100) },
    },
    elements,
  };
}

/** Extract an inbound text message; returns null for non-allowlisted users or non-text messages. Pure. */
export function verifyInbound(event, allowUserIds) {
  const sender = event?.sender?.sender_id?.open_id;
  const msg = event?.message;
  if (!sender || !msg) return null;
  if (!allowUserIds?.length || !allowUserIds.includes(sender)) return null;
  if (msg.message_type !== "text") return null;
  let text = "";
  try {
    text = JSON.parse(msg.content).text ?? "";
  } catch {
    return null;
  }
  text = text.replace(/@_user_\d+/g, "").trim();
  if (!text) return null;
  return { userId: sender, chatId: msg.chat_id, messageId: msg.message_id, text };
}

/** Parse a card button callback (card.action.trigger). Pure. */
export function parseAction(event, allowUserIds) {
  const operator = event?.operator?.open_id;
  const value = event?.action?.value;
  if (!operator || !value || typeof value !== "object") return null;
  if (!allowUserIds?.length || !allowUserIds.includes(operator)) return null;
  if (!value.cardId || !value.optionId) return null;
  return { userId: operator, messageId: event?.context?.open_message_id ?? null, ...value };
}

export function createFeishuChannel({ appId, appSecret, allowUserIds = [], domain = lark.Domain.Feishu, logger = console }) {
  if (!appId || !appSecret) throw new Error("飞书 appId / appSecret 未配置");
  const client = new lark.Client({ appId, appSecret, domain, appType: lark.AppType.SelfBuild });
  let ws = null;

  async function send(to, msgType, content) {
    const r = await client.im.message.create({
      params: { receive_id_type: to.type ?? "open_id" },
      data: { receive_id: to.id, msg_type: msgType, content: JSON.stringify(content) },
    });
    if (r.code !== 0) throw new Error(`飞书发送失败：${r.code} ${r.msg}`);
    return { messageId: r.data.message_id };
  }

  return {
    id: "feishu",
    verifyInbound: (e) => verifyInbound(e, allowUserIds),
    parseAction: (e) => parseAction(e, allowUserIds),
    sendText: (to, text) => send(to, "text", { text }),
    sendCard: (to, card) => send(to, "interactive", buildCard(card)),
    async updateCard(ref, card, state) {
      const r = await client.im.message.patch({ path: { message_id: ref.messageId }, data: { content: JSON.stringify(buildCard(card, state)) } });
      if (r.code !== 0) throw new Error(`飞书更新卡片失败：${r.code} ${r.msg}`);
    },
    start({ onText, onAction, onStatus }) {
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          const msg = verifyInbound(data, allowUserIds);
          if (msg) await onText(msg).catch((e) => logger.error("feishu onText", e));
        },
        "card.action.trigger": async (data) => {
          const action = parseAction(data, allowUserIds);
          if (!action) return { toast: { type: "error", content: "无权限或无效操作" } };
          try {
            const res = await onAction(action);
            return { toast: { type: "success", content: res?.toast ?? "已处理" }, ...(res?.card ? { card: { type: "raw", data: res.card } } : {}) };
          } catch (e) {
            return { toast: { type: "error", content: `处理失败：${String(e.message ?? e).slice(0, 80)}` } };
          }
        },
      });
      ws = new lark.WSClient({ appId, appSecret, domain, loggerLevel: lark.LoggerLevel.warn });
      ws.start({ eventDispatcher: dispatcher });
      onStatus?.("已连接 · 长连接模式");
      return () => {
        try {
          ws?.close?.();
        } catch {
          /* ignore */
        }
        ws = null;
      };
    },
  };
}
