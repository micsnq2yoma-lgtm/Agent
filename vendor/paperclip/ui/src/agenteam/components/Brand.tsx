// AGENTEAM brand: the mark (three agents linked into one team, the lead in the brand colour) and the
// wordmark AGEN·T·EAM in the display serif, the T (the letter AGENT and TEAM share) in the brand colour.
// Model-specific pixel employee portraits use the registered employee identity and observed status.
import { characterDataUrl } from "@agenteam/pixel-office";
import { modelFamilyFor, officeAnimForStatus, type ModelFamily } from "@agenteam/shared";
import { useSyncExternalStore } from "react";
import { AgenteamLogo } from "../../components/AgenteamLogo";
import { employeeRevision, registeredEmployee, subscribeEmployees } from "../lib/avatar";

/** The mark. Ink follows the text colour (light / dark skins); the lead head takes the brand colour. */
export function LogoMark({ size = 24 }: { size?: number | string }) {
  return <AgenteamLogo className="logomark" width={size} height={size} />;
}

export function Wordmark({ size = 21, mark = true }: { size?: number | string; mark?: boolean }) {
  return (
    <span className="wordmark" role="img" aria-label="AGENTEAM" style={{ fontSize: size }}>
      {mark && (
        <span className="mark" aria-hidden="true">
          <LogoMark size={typeof size === "number" ? Math.round(size * 1.15) : "1.15em"} />
        </span>
      )}
      <span aria-hidden="true">AGEN</span>
      <span aria-hidden="true" className="e">
        T
      </span>
      <span aria-hidden="true">EAM</span>
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

export function modelName(a: { adapterType?: string; adapterConfig?: { model?: string }; metadata?: { agenteam?: { source?: string } } } | undefined): string {
  if (!a) return "";
  const src = a.metadata?.agenteam?.source;
  // API models: "deepseek · deepseek-chat" (the provider matters more than the raw model id)
  if (src?.startsWith("api:")) return [src.slice(4), a.adapterConfig?.model].filter(Boolean).join(" · ");
  if (a.adapterConfig?.model) return a.adapterConfig.model;
  return a.adapterType === "claude_local" ? "Claude" : a.adapterType === "codex_local" ? "Codex" : (a.adapterType ?? "");
}

/** Paperclip agent status in plain words. */
export const AGENT_STATUS: Record<string, string> = { running: "运行中", active: "空闲", idle: "空闲", paused: "已暂停", error: "出错", terminated: "已停用", pending_approval: "待批准" };
