// Model identity and status are shared by all employee portrait consumers.
import { modelFamilyFor, officeAnimForStatus, type ModelFamily } from "@agentself/shared";
import { characterDataUrl, pixelActionFor } from "@agentself/pixel-office";

export interface EmployeeIdentity {
  id?: string;
  adapterType?: string;
  adapterConfig?: { model?: unknown } | null;
  status?: string;
}
type Entry = { family: ModelFamily; status?: string; adapterType?: string; model?: string };
let employees = new Map<string, Entry>();
let revision = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();
export const subscribeEmployees = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const employeeRevision = () => revision;
export const registeredEmployee = (id: string) => employees.get(id);

export function registerAgentAdapters(agents: EmployeeIdentity[]) {
  const next = new Map<string, Entry>();
  for (const a of agents) if (a.id) next.set(a.id, {
    family: modelFamilyFor(a.adapterType, typeof a.adapterConfig?.model === "string" ? a.adapterConfig.model : undefined),
    status: a.status,
    adapterType: a.adapterType,
    model: typeof a.adapterConfig?.model === "string" ? a.adapterConfig.model : undefined,
  });
  const changed = next.size !== employees.size || [...next].some(([id, item]) => {
    const old = employees.get(id);
    return old?.family !== item.family || old?.status !== item.status || old?.adapterType !== item.adapterType || old?.model !== item.model;
  });
  if (!changed) return;
  employees = next;
  cache.clear();
  revision++;
  listeners.forEach((listener) => listener());
}

export function robotAvatarUrl(seed: string, muted = false, pose?: string, animated = false, identity?: EmployeeIdentity): string {
  const saved = employees.get(seed);
  const model = typeof identity?.adapterConfig?.model === "string" ? identity.adapterConfig.model : undefined;
  // Partial agent records (e.g. task assignees) must keep the registered model.
  const effectiveModel = identity?.adapterConfig !== undefined ? model : saved?.model;
  const family = modelFamilyFor(identity?.adapterType ?? saved?.adapterType, effectiveModel);
  const status = officeAnimForStatus(identity?.status ?? saved?.status);
  const action = muted || status === "paused" ? "paused" : pose && pose !== "rest" ? pixelActionFor(pose) : status;
  const key = `${family}|${action}|${muted}|${animated}`;
  let url = cache.get(key);
  if (!url) {
    url = characterDataUrl(family, action, { animated, muted });
    cache.set(key, url);
  }
  return url;
}
