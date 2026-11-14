import React from "react";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";
export function ConsolePage() {
  const { data } = usePluginData("stats") as { data?: { issuesSeen?: number; ticks?: number } };
  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ letterSpacing: "0.3em" }}>AGENTSELF</h1>
      <p>P0 full-page plugin test.</p>
      <pre data-testid="p0-stats">{JSON.stringify(data ?? {}, null, 2)}</pre>
    </div>
  );
}
export function NavLink() { return <span>Agentself</span>; }
