// Problems in a machine's own Codex setup are explained, never fixed behind the user's back.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { configProblems, explainCodexError } from "../../../scripts/lib/codex-check.mjs";

describe("Codex config check", () => {
  it('service_tier = "default" (rejected by codex-cli 0.128) is reported with a fix', () => {
    const p = configProblems('model = "gpt-5"\nservice_tier = "default"\n');
    expect(p).toHaveLength(1);
    expect(p[0].code).toBe("service_tier");
    expect(p[0].fix).toMatch(/flex/);
  });
  it("accepted tiers and a missing key are fine", () => {
    expect(configProblems('service_tier = "flex"')).toEqual([]);
    expect(configProblems('service_tier = "fast"')).toEqual([]);
    expect(configProblems('model = "gpt-5"')).toEqual([]);
  });
  it("the probe's error messages get a plain explanation", () => {
    expect(explainCodexError("Error loading config.toml: unknown variant `default`, expected `fast` or `flex`")).toMatch(/service_tier/);
    expect(explainCodexError("error: unexpected argument ''PAPERCLIP_API_KEY',' found")).toMatch(/拆开/);
    expect(explainCodexError("all good")).toBeNull();
  });
});
