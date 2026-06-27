import { describe, it, expect } from "bun:test";
import { buildRequiredToolNudge } from "../../../src/kernel/loop/runner-helpers/stall-deliverable.js";
import { DEFAULT_STALL_POLICY } from "../../../src/kernel/state/kernel-state.js";

describe("StallPolicy defaults", () => {
  it("tolerates 2 ignored nudges and escalates content by default", () => {
    expect(DEFAULT_STALL_POLICY.ignoredNudgeTolerance).toBe(2);
    expect(DEFAULT_STALL_POLICY.escalateNudgeContent).toBe(true);
  });
});

describe("buildRequiredToolNudge (content escalation — StallPolicy C)", () => {
  it("first nudge is the plain reminder", () => {
    const n = buildRequiredToolNudge(["file-write"], 1, 0, true);
    expect(n).toContain("Required tool quota not met: file-write");
    expect(n).not.toContain("despite");
  });

  it("repeat nudge ESCALATES (count-aware, stronger, names the ignored tool)", () => {
    const n = buildRequiredToolNudge(["file-write"], 2, 1, true);
    expect(n).toContain("despite 2 reminders");
    expect(n).toContain("1 ignored in a row");
    expect(n).toContain("file-write NOW");
    expect(n.toLowerCase()).toContain("do not call meta-tools");
  });

  it("escalation OFF → stable verbatim text even on repeats", () => {
    const n1 = buildRequiredToolNudge(["x"], 1, 0, false);
    const n3 = buildRequiredToolNudge(["x"], 3, 2, false);
    expect(n3).toBe(n1);
  });

  it("handles multiple missing tools", () => {
    const n = buildRequiredToolNudge(["a", "b"], 2, 1, true);
    expect(n).toContain("[a, b]");
  });
});
