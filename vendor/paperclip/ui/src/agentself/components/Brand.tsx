// AGENTSELF wordmark, set in the display serif with the E in the brand colour (DESIGN §5), and the
// model-specific pixel employee portraits.
import { characterDataUrl } from "@agentself/pixel-office";
import { modelFamilyFor, officeAnimForStatus, type ModelFamily } from "@agentself/shared";
import { useSyncExternalStore } from "react";
import { employeeRevision, registeredEmployee, subscribeEmployees } from "../lib/avatar";

export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className="wordmark" role="img" aria-label="AGENTSELF" style={{ fontSize: size }}>
      <span aria-hidden="true">AGENTS</span>
      <span aria-hidden="true" className="e">
        E
      </span>
      <span aria-hidden="true">LF</span>
    </span>
  );
}

export function Robot({ id = "frontdesk", eye = "other", size = 26, grey = false, status }: { id?: string; eye?: ModelFamily; size?: number; grey?: boolean; status?: string }) {
  useSyncExternalStore(subscribeEmployees, employeeRevision, () => 0);
  const employee = registeredEmployee(id);
  const family = employee?.family ?? eye;
  const action = grey ? "paused" : officeAnimForStatus(status ?? employee?.status);
  return <img width={size} height={size} alt="" aria-hidden="true" className="employee-pixel-avatar"
    src={characterDataUrl(family, action, { animated: size >= 40, muted: grey })} />;
}

export function eyeOf(adapterType: string | undefined, model?: unknown): ModelFamily {
  return modelFamilyFor(adapterType, model);
}

export function modelName(a: { adapterType?: string; adapterConfig?: { model?: string } } | undefined): string {
  if (!a) return "";
  if (a.adapterConfig?.model) return a.adapterConfig.model;
  return a.adapterType === "claude_local" ? "Claude" : a.adapterType === "codex_local" ? "Codex" : (a.adapterType ?? "");
}

/** Paperclip agent status in plain words. */
export const AGENT_STATUS: Record<string, string> = { running: "运行中", active: "空闲", idle: "空闲", paused: "已暂停", error: "出错", terminated: "已停用", pending_approval: "待批准" };
