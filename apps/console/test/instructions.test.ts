// P4: an agent's instructions carry the *contents* of its memory and the global profile, regenerated
// when they change, so a preference saved by task A reaches task B without the model reading any file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { instructionsPath, refreshAllInstructions, refreshInstructions } from "../../../scripts/lib/instructions.mjs";
// @ts-expect-error plain JS module
import { writeAgentRuntime } from "../../../scripts/lib/department.mjs";
// @ts-expect-error plain JS module
import { initMemory } from "../../../scripts/lib/memory.mjs";
// @ts-expect-error plain JS module
import { ensureProfile, profilePath } from "../../../scripts/lib/profile.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "as-instr-"));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
const emp = path.join(home, "workspaces", "research", "scholar");
const lead = path.join(home, "workspaces", "research", "lead");
ensureProfile(home);
for (const [cwd, role] of [
  [emp, "employee"],
  [lead, "lead"],
] as const) {
  initMemory(cwd, { role, name: role, title: "", department: "科研", reportsTo: "x", capabilities: "", identity: role === "lead" ? "你是主管" : "你是文献员" });
  writeAgentRuntime(cwd, { role, adapterType: "claude_local", home });
}
const read = (cwd: string) => fs.readFileSync(instructionsPath(cwd), "utf8");

describe("agent instructions (P4)", () => {
  it("inline the skill, the agent's memory and the global profile", () => {
    const text = read(emp);
    expect(text).toContain("你是文献员");
    expect(text).toContain("# 员工通用规则");
    expect(text).toContain("先问清单");
    expect(read(lead)).not.toContain("你是文献员");
  });
  it("a preference saved by task A is in task B's instructions after the run ends", () => {
    fs.appendFileSync(path.join(emp, "memory", "user.md"), "- 以后速递类回答第一行写【科研部速递】\n");
    expect(read(emp)).not.toContain("【科研部速递】");
    expect(refreshInstructions(emp, home)).toBe(true); // what the plugin does on agent.run.finished
    expect(read(emp)).toContain("【科研部速递】");
  });
  it("profile changes reach every agent", () => {
    fs.appendFileSync(profilePath(home, "decisions"), "- [2026-11-15] 报告一律用表格\n");
    expect(refreshAllInstructions(home)).toBe(2);
    expect(read(emp)).toContain("报告一律用表格");
    expect(read(lead)).toContain("报告一律用表格");
  });
  it("stay bounded and keep the outline intact", () => {
    fs.writeFileSync(path.join(emp, "memory", "notes.md"), "# 经验\n" + "- 很长的经验\n".repeat(3000));
    refreshInstructions(emp, home);
    const text = read(emp);
    expect(text.length).toBeLessThan(60_000);
    expect(text).toContain("以下省略，完整内容见");
    expect(text).toContain("### 以往经验");
    expect(refreshInstructions(path.join(home, "nope"), home)).toBe(false);
  });
});
