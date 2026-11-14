// Shared types for Agentself: cards, messages, department packs, office snapshots.

/** Three attention tiers (PLAN 4.3). */
export type Tier = "high" | "medium" | "low";

/** Card kinds (PLAN 4.4, from agent-autoloop). */
export type CardKind = "ask" | "notice" | "resolve" | "later";

/** What a feed message is about; used by tier classification. */
export type MessageKind =
  | "decision"
  | "approval"
  | "agent_question"
  | "budget_alert"
  | "rework_limit"
  | "hop_limit"
  | "lead_report"
  | "run_failed"
  | "frontdesk_answer"
  | "task_progress"
  | "routine_done"
  | "memory_suggestion";

export interface FeedMessage {
  id: string;
  kind: MessageKind;
  tier: Tier;
  companyId: string;
  departmentId?: string | null;
  issueId?: string | null;
  agentId?: string | null;
  title: string;
  body?: string;
  createdAt: string;
  /** Source object in Paperclip, e.g. decision / approval id. */
  source?: { type: string; id: string };
  options?: CardOption[];
  /** "不回复会怎样" */
  ifNoReply?: string;
  status: "open" | "handled" | "snoozed";
  snoozedUntil?: string | null;
}

export interface CardOption {
  id: string;
  label: string;
  style?: "default" | "primary" | "destructive";
}

export interface DepartmentMeta {
  id: string;
  name: string;
  icon: string;
  description?: string;
  leadAgentId?: string | null;
  projectId?: string | null;
  defaultModel?: string | null;
  seat?: { x: number; y: number } | null;
}

export type AdapterType = "claude_local" | "codex_local";

/** Department pack format (PLAN 7.4). Saved in packs/departments/*.json. */
export interface DepartmentPack {
  schema: "agentself.department/1";
  name: string;
  icon: string;
  description: string;
  lead: PackMember | null;
  members: PackMember[];
  skills?: string[];
  routines?: PackRoutine[];
  budgetMonthlyCents?: number;
}

export interface PackMember {
  key: string;
  name: string;
  title: string;
  role: "general" | "engineer" | "researcher" | "pm" | "designer" | "qa";
  adapterType: AdapterType;
  model?: string;
  capabilities?: string;
  budgetMonthlyCents?: number;
  identity?: string;
}

export interface PackRoutine {
  key: string;
  title: string;
  /** agent-autoloop rule fields translated: when / to / prompt / skill / maxActive */
  cron?: string;
  webhook?: boolean;
  to: string;
  prompt: string;
  skill?: string;
  maxActive?: number;
}

/** Pixel office animation states (PLAN 7.1), in priority order. */
export type OfficeAnim = "failed" | "waiting" | "working" | "delivering" | "paused" | "idle" | "walk_to_lead";

export interface OfficeSnapshot {
  at: string;
  departments: Array<{ id: string; name: string; icon: string }>;
  people: Array<{
    agentId: string;
    departmentId: string | null;
    name: string;
    title: string;
    model: string;
    eye: "claude" | "codex" | "other";
    isLead: boolean;
    anim: OfficeAnim;
    bubble?: string | null;
    pendingCards: number;
    currentIssueId?: string | null;
  }>;
}
