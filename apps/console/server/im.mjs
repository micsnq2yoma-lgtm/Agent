// IM host (PLAN 6): pushes high-tier cards to Feishu, applies button clicks back to Paperclip,
// keeps both ends in sync, and routes inbound text to the front desk.
const arr = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

let status = "未启用";
let stopFn = null;
let timer = null;

export function imStatus() {
  return status;
}
export function setImStatus(s) {
  status = s;
}

const PUSH_KINDS = { high: new Set(["issue_thread_interaction", "approval", "decision", "budget_alert"]), medium: new Set(["failed_run", "agent_error_alert"]) };

/** Attention items -> TeamCards for IM (pure apart from the interaction lookup). */
export async function imCards({ items, getInteractions, agentsById, tiers }) {
  const cards = [];
  for (const it of items) {
    if (it.dismissal) continue;
    if (it.snoozedUntil && Date.parse(it.snoozedUntil) > Date.now()) continue;
    const isHigh = PUSH_KINDS.high.has(it.sourceKind);
    const isMedium = PUSH_KINDS.medium.has(it.sourceKind);
    if (!(isHigh && tiers.includes("high")) && !(isMedium && tiers.includes("medium"))) continue;
    const creatorId = it.resolverAudience?.createdByAgentId ?? it.subject?.metadata?.createdByAgentId ?? null;
    const base = {
      id: it.id,
      tier: isHigh ? "high" : "medium",
      who: (creatorId && agentsById[creatorId]?.name) || it.resolverAudience?.createdByAgentName || "",
      department: it.project?.name ?? "",
      ref: it.relatedIssue?.identifier ?? "",
    };
    if (it.sourceKind === "issue_thread_interaction" && it.relatedIssue && it.subject?.id) {
      const inter = (await getInteractions(it.relatedIssue.id)).find((x) => x.id === it.subject.id);
      if (!inter) continue;
      if (inter.kind === "ask_user_questions") {
        const q = inter.payload?.questions?.[0];
        const help = q?.helpText ?? "";
        const m = help.match(/不回复会怎样[:：]\s*(.*)$/s);
        cards.push({
          ...base,
          title: q?.prompt ?? inter.title ?? "需要你回答",
          explain: m ? help.slice(0, m.index).trim() : help,
          ifNoReply: m ? m[1].trim() : "",
          options: (q?.options ?? []).map((o) => ({ id: o.id, label: o.label })),
          action: { kind: "interaction", issueId: it.relatedIssue.id, interactionId: inter.id, questionId: q?.id ?? "" },
        });
      } else {
        const isReport = inter.payload?.target?.key === "report";
        cards.push({
          ...base,
          tier: isReport ? "medium" : base.tier,
          title: isReport ? `${it.relatedIssue.title}（汇报待验收）` : (inter.payload?.prompt ?? inter.title ?? "需要你确认"),
          explain: inter.payload?.prompt ?? "",
          options: [
            { id: "__accept", label: inter.payload?.acceptLabel ?? "同意" },
            { id: "__reject", label: inter.payload?.rejectLabel ?? "不同意" },
          ],
          action: { kind: "interaction", issueId: it.relatedIssue.id, interactionId: inter.id, questionId: "" },
        });
      }
      continue;
    }
    if (it.sourceKind === "approval" && it.subject?.id) {
      cards.push({ ...base, title: it.subject.title ?? "审批", explain: it.whyNow ?? "", options: [{ id: "approve", label: "批准" }, { id: "reject", label: "拒绝" }], action: { kind: "approval", approvalId: it.subject.id } });
      continue;
    }
    cards.push({ ...base, title: it.subject?.title ?? it.whyNow ?? "需要你处理", explain: it.whyNow ?? "", options: [], action: { kind: "view" } });
  }
  return cards;
}

/**
 * Cards that are not Paperclip attention items: new-employee requests (decide tier) and notices
 * from notify_user / the memory job (low tier). Pure.
 */
export function extraCards({ hires = [], notices = [], agentsById = {}, pushNotices = true }) {
  const cards = [];
  for (const h of hires) {
    if (h.status !== "pending") continue;
    cards.push({
      id: `hire:${h.id}`,
      tier: "high",
      who: h.leadName ?? agentsById[h.leadAgentId]?.name ?? "",
      department: h.team ?? "",
      ref: "",
      title: `新建员工「${h.name}」`,
      explain: [`负责：${h.capabilities}`, h.reason ? `理由：${h.reason}` : "", `用：${h.adapterType === "codex_local" ? "Codex" : "Claude"}（在网页上批准可以改名字和模型来源）`].filter(Boolean).join("\n"),
      ifNoReply: "不会新建，主管会等你",
      options: [
        { id: "approve", label: "同意" },
        { id: "reject", label: "不同意" },
      ],
      action: { kind: "hire", hireId: h.id },
    });
  }
  if (pushNotices)
    for (const n of notices) {
      if (n.status !== "open") continue;
      cards.push({
        id: `notice:${n.id}`,
        tier: "low",
        who: (n.agentId && agentsById[n.agentId]?.name) || "",
        department: "",
        ref: "",
        title: String(n.title ?? "").split(/\n/)[0].slice(0, 80) || "通知",
        explain: n.body && n.body !== n.title ? String(n.body).slice(0, 1500) : "",
        ifNoReply: "",
        options: [{ id: "dismiss", label: "知道了" }],
        action: { kind: "notice", noticeId: n.id },
      });
    }
  return cards;
}

/** Apply a card button to Paperclip (or, for hire / notice cards, to the given handlers). */
export async function applyAction(pc, a, handlers = {}) {
  if (a.kind === "hire") return handlers.hire(a.hireId, a.optionId === "approve" ? "approve" : "reject");
  if (a.kind === "notice") return handlers.notice(a.noticeId);
  if (a.kind === "interaction") {
    if (a.optionId === "__accept") return pc("POST", `/issues/${a.issueId}/interactions/${a.interactionId}/accept`, {});
    if (a.optionId === "__reject") return pc("POST", `/issues/${a.issueId}/interactions/${a.interactionId}/reject`, { reason: "在飞书里选择了需要修改，请在网页补充具体意见" });
    return pc("POST", `/issues/${a.issueId}/interactions/${a.interactionId}/respond`, { answers: [{ questionId: a.questionId, optionIds: [a.optionId] }] });
  }
  if (a.kind === "approval") return pc("POST", `/approvals/${a.approvalId}/${a.optionId === "approve" ? "approve" : "reject"}`, {});
  throw new Error("这张卡片需要在网页上处理");
}

/**
 * Start / restart the IM loop.
 * deps: { settings, store, saveStore, pc, loadContext, frontdesk, createChannel, intervalMs }
 */
export async function startIm(deps) {
  stopIm();
  const f = deps.settings.feishu ?? {};
  if (!f.enabled) return setImStatus("未启用");
  const secret = process.env[f.secretRef || "AGENTEAM_FEISHU_APP_SECRET"];
  if (!f.appId || !secret) return setImStatus("未配置：需要 App ID 和环境变量 AGENTEAM_FEISHU_APP_SECRET");
  if (!f.allowUserIds?.length) return setImStatus("未配置：白名单为空");
  let channel;
  try {
    channel = await deps.createChannel({ appId: f.appId, appSecret: secret, allowUserIds: f.allowUserIds });
  } catch (e) {
    return setImStatus(`连接失败：${e.message}`);
  }
  const to = { type: "open_id", id: f.allowUserIds[0] };
  deps.store.im ??= { sent: {} };
  const sent = deps.store.im.sent;

  const tick = async () => {
    try {
      const ctx = await deps.loadContext();
      if (!ctx.company) return;
      const attention = arr(await deps.pc("GET", `/companies/${ctx.company.id}/attention`));
      const agentsById = Object.fromEntries(ctx.agents.map((a) => [a.id, a]));
      const cache = {};
      const getInteractions = async (issueId) => (cache[issueId] ??= arr(await deps.pc("GET", `/issues/${issueId}/interactions`)));
      const cards = [
        ...(await imCards({ items: attention, getInteractions, agentsById, tiers: f.pushTiers ?? ["high"] })),
        ...extraCards({
          hires: deps.store.hireRequests ?? [],
          notices: deps.notices ? await deps.notices(ctx.company.id).catch(() => []) : [],
          agentsById,
          pushNotices: f.pushNotices !== false,
        }),
      ];
      const live = new Set(cards.map((c) => c.id));
      for (const card of cards) {
        if (sent[card.id]) continue;
        const ref = await channel.sendCard(to, card);
        sent[card.id] = { ...ref, card, state: "open", at: new Date().toISOString() };
        deps.saveStore();
      }
      // handled on the web (or elsewhere): mark handled in IM
      for (const [id, s] of Object.entries(sent)) {
        if (s.state !== "open" || live.has(id)) continue;
        await channel.updateCard(s, s.card, { label: "已在网页处理" }).catch(() => {});
        s.state = "handled";
        deps.saveStore();
      }
      setImStatus("已连接 · 长连接模式");
    } catch (e) {
      setImStatus(`同步出错：${String(e.message ?? e).slice(0, 80)}`);
    }
  };

  stopFn = channel.start({
    onStatus: setImStatus,
    onText: async (msg) => {
      const r = await deps.frontdesk({ text: msg.text, external: deps.settings.externalDefault });
      const reply =
        r.route === "answer"
          ? r.answer.answer
          : r.route === "task"
            ? `已交给${r.assigneeName ?? "主管"}（${r.issue.identifier}），大事会先给你一份计划，完成后会推给你。`
            : r.route === "followup"
              ? `已补充给 ${r.issue.identifier} 的${r.assigneeName ? `主管${r.assigneeName}` : "负责人"}。`
              : `判断不出交给哪位主管，请在网页上选一下：${r.title}`;
      await channel.sendText({ type: "open_id", id: msg.userId }, reply);
    },
    onAction: async (a) => {
      await applyAction(deps.pc, a, deps.handlers ?? {});
      const s = sent[a.cardId];
      const label = `已处理：${s?.card.options.find((o) => o.id === a.optionId)?.label ?? a.optionId}`;
      if (s) {
        s.state = "handled";
        deps.saveStore();
      }
      return { toast: "已处理", card: s ? (await import("@agenteam/im-feishu")).buildCard(s.card, { label }) : undefined };
    },
  });
  await tick();
  timer = setInterval(tick, deps.intervalMs ?? 15_000);
}

export function stopIm() {
  if (timer) clearInterval(timer);
  timer = null;
  if (stopFn) stopFn();
  stopFn = null;
}
