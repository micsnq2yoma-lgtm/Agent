// Data access for the console: Paperclip REST (proxied at /api) + AgenTeam local service (/agenteam/api, proxied by the Paperclip server).
import { useCallback, useEffect, useRef, useState } from "react";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((json && (json.error || json.message)) || `${res.status} ${url}`);
  return json as T;
}

export const pc = {
  get: <T,>(p: string) => req<T>("GET", `/api${p}`),
  post: <T,>(p: string, b?: unknown) => req<T>("POST", `/api${p}`, b ?? {}),
  patch: <T,>(p: string, b: unknown) => req<T>("PATCH", `/api${p}`, b),
  put: <T,>(p: string, b: unknown) => req<T>("PUT", `/api${p}`, b),
  del: <T,>(p: string) => req<T>("DELETE", `/api${p}`),
};

export const as = {
  get: <T,>(p: string) => req<T>("GET", `/agenteam/api${p}`),
  post: <T,>(p: string, b?: unknown) => req<T>("POST", `/agenteam/api${p}`, b ?? {}),
  put: <T,>(p: string, b: unknown) => req<T>("PUT", `/agenteam/api${p}`, b),
  del: <T,>(p: string) => req<T>("DELETE", `/agenteam/api${p}`),
};

export const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : (((x as { items?: T[] })?.items ?? []) as T[]));

/** Poll a loader; returns [data, error, reload]. */
/**
 * Poll `load` every `ms`. With `cacheKey`, the last result is kept in localStorage and shown at
 * once on the next visit while the first load is in flight (stale-while-revalidate), so the
 * workbench does not sit on a skeleton for the seconds the first round trips take.
 */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = [], cacheKey?: string): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(() => (cacheKey ? readCache<T>(cacheKey) : null));
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(() => {
    loadRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
        if (cacheKey) writeCache(cacheKey, d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    run();
    const t = setInterval(run, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, error, run];
}

const CACHE_PREFIX = "agenteam.cache.";
function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(CACHE_PREFIX + key);
    else localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or blocked storage: the cache is only a convenience */
  }
}

/* ---------------- domain types (subset of Paperclip) ---------------- */
export interface Company {
  id: string;
  name: string;
  issuePrefix: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
}
export interface Agent {
  id: string;
  name: string;
  title?: string | null;
  role: string;
  status: string;
  adapterType: string;
  adapterConfig?: { model?: string; cwd?: string };
  reportsTo?: string | null;
  capabilities?: string | null;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
  metadata?: { agenteam?: { department?: string; departmentName?: string; isLead?: boolean; projectId?: string; memberKey?: string; source?: string } };
}
export interface Department {
  key: string;
  name: string;
  /** pack icon key (microscope, rocket, …), shown as a lucide line icon */
  icon?: string;
  projectId: string | null;
  leadAgentId: string | null;
  members: string[];
  description: string;
  archived: boolean;
}
export interface Settings {
  companyName: string;
  frontdeskModel: string;
  askWhenUnclear: boolean;
  skin: string;
  externalDefault: "ask" | "direct";
  globalBudgetCents: number;
  feishu: { enabled: boolean; appId: string; secretRef: string; allowUserIds: string[]; pushTiers: string[]; pushNotices?: boolean };
}
export interface Context {
  company: Company | null;
  departments: Department[];
  agents: Agent[];
  projects: Array<{ id: string; name: string; description?: string }>;
  settings: Settings;
  paperclipUrl: string;
}
export interface Issue {
  id: string;
  identifier: string | null;
  title: string;
  description?: string | null;
  status: string;
  parentId: string | null;
  projectId: string | null;
  assigneeAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  blockedByIssueIds?: string[];
  /** "routine_execution" when a routine (定时任务) created it; originId is then the routine id */
  originKind?: string;
  originId?: string | null;
}
