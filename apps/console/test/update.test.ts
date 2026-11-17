import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { mergeUpdateState } from "../../../scripts/lib/update-state.mjs";
import { updateFinished } from "../../../vendor/paperclip/ui/src/agenteam/lib/update-status";

const oldTime = "2026-11-17T07:00:00.000Z";
const checkTime = "2026-11-17T07:01:00.000Z";
const doneTime = "2026-11-17T07:02:00.000Z";

describe("update completion", () => {
  it("a first version check cannot complete an update that has not started", () => {
    const checked = mergeUpdateState({}, { lastCheck: { behind: 2 } }, checkTime);
    expect(checked.checkedAt).toBe(checkTime);
    expect(checked.updatedAt).toBeUndefined();
    expect(updateFinished(checked)).toBe(false);
  });

  it("checking again preserves the previous result without making it a new completion", () => {
    const previous = { status: "updated", current: "old", updatedAt: oldTime };
    const checked = mergeUpdateState(previous, { lastCheck: { behind: 2 } }, checkTime);
    expect(checked.updatedAt).toBe(oldTime);
    expect(updateFinished(checked, previous.updatedAt)).toBe(false);
    expect(previous).not.toHaveProperty("checkedAt");
  });

  it("continues waiting through startup, backup, another version check, and restart", () => {
    let state = mergeUpdateState({}, { lastCheck: { behind: 2 } }, oldTime);
    state = mergeUpdateState(state, { status: "updating" }, checkTime);
    expect(updateFinished(state)).toBe(false);
    state = mergeUpdateState(state, { lastCheck: { behind: 0 } }, doneTime);
    expect(state.updatedAt).toBe(checkTime);
    expect(updateFinished(state)).toBe(false);
    state = mergeUpdateState(state, { status: "updated", current: "new" }, doneTime);
    expect(updateFinished(state)).toBe(true);
  });

  it.each(["updated", "up_to_date", "rolled_back", "broken"])("recognizes only a new %s result", (status) => {
    expect(updateFinished({ status, updatedAt: oldTime }, oldTime)).toBe(false);
    expect(updateFinished({ status }, oldTime)).toBe(false);
    expect(updateFinished({ status, updatedAt: doneTime }, oldTime)).toBe(true);
  });

  it("does not turn an unknown state or a connection recovery into completion", () => {
    expect(updateFinished({ updatedAt: doneTime }, oldTime)).toBe(false);
    expect(updateFinished({ status: "checking", updatedAt: doneTime }, oldTime)).toBe(false);
  });

  it("does not compare server timestamps with the browser clock", () => {
    expect(updateFinished({ status: "updated", updatedAt: oldTime }, doneTime)).toBe(true);
  });
});
