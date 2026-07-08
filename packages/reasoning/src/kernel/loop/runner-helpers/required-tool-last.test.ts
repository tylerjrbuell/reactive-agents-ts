// required-tool-last.test.ts — E2 named regression: required-tool-last
// (audit 02-#6).
//
// A required-tool-LAST task (e.g. "gather from N sources, THEN write report.md")
// legitimately does not call the required write tool during the gathering phase.
// The legacy "ignored nudge" rule counts every iteration where the missing set
// did not shrink as an ignored nudge → consecutiveIgnoredNudges climbs → the
// stall step FAST-ESCALATES to failure before the model ever reaches the write.
// E2: a gathering-phase iteration is never "ignored" (reads assessment.phase via
// the gatheringPhase flag). OFF → byte-identical to the legacy rule.

import { describe, expect, it } from "bun:test";
import { isIgnoredNudge } from "./stall-deliverable.js";

describe("isIgnoredNudge — required-tool-last", () => {
  // Scenario: 3 gathering iterations, the required write tool still missing
  // (missing count stays 1 → the set never shrinks). Legacy counts each as
  // ignored; with a tolerance of 2 that fast-escalates to failure by iter 2.
  it("OLD (gatheringPhase off) MISFIRES: unchanged missing set ⇒ every iteration ignored", () => {
    let consecutiveIgnored = 0;
    for (let i = 0; i < 3; i++) {
      const ignored = isIgnoredNudge(/*gatheringPhase*/ false, /*prev*/ 1, /*current*/ 1);
      consecutiveIgnored = ignored ? consecutiveIgnored + 1 : 0;
    }
    expect(consecutiveIgnored).toBe(3); // ≥ tolerance(2) → fast-escalate to failure
  });

  it("NEW (gatheringPhase on): gathering iterations are never ignored → no fast-escalation", () => {
    let consecutiveIgnored = 0;
    for (let i = 0; i < 3; i++) {
      const ignored = isIgnoredNudge(/*gatheringPhase*/ true, /*prev*/ 1, /*current*/ 1);
      consecutiveIgnored = ignored ? consecutiveIgnored + 1 : 0;
    }
    expect(consecutiveIgnored).toBe(0);
  });

  it("legacy rule preserved off the profile: a SHRINKING missing set is not ignored", () => {
    expect(isIgnoredNudge(false, /*prev*/ 2, /*current*/ 1)).toBe(false);
  });

  it("legacy rule preserved off the profile: a stagnant/growing set IS ignored", () => {
    expect(isIgnoredNudge(false, /*prev*/ 1, /*current*/ 1)).toBe(true);
    expect(isIgnoredNudge(false, /*prev*/ 1, /*current*/ 2)).toBe(true);
  });

  it("no prior nudge yet (prevMissing = -1) is never ignored, either mode", () => {
    expect(isIgnoredNudge(false, -1, 1)).toBe(false);
    expect(isIgnoredNudge(true, -1, 1)).toBe(false);
  });
});
