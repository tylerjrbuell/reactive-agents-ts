// File: src/kernel/assessment/guard-adapters.test.ts
//
// E2 — the guard-side assessment adapters. Each predicate is OPT-IN behind the
// long-horizon profile: with `horizonActive = false` EVERY predicate returns the
// neutral `false` (the calling guard keeps its byte-identical legacy path). These
// tests pin BOTH: (a) flag-off is always neutral, and (b) flag-on reads the
// correct assessment field.

import { describe, expect, it } from "bun:test";
import type { RunAssessment } from "./assess.js";
import {
  assessmentFailuresAreArgVarying,
  assessmentIsGatheringPhase,
  assessmentIsSynthesizePhase,
  assessmentShowsEvidenceProgress,
  nextLowDeltaCount,
  nextStalledCount,
} from "./guard-adapters.js";

function make(overrides: {
  evidenceDelta?: number;
  phase?: RunAssessment["phase"];
  failureArgVariety?: number;
}): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding: [], blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: overrides.evidenceDelta ?? 0,
    phase: overrides.phase ?? "gather",
    pace: { burnRatio: 0, projectedCompletion: 0, band: "green" },
    health: {
      recentFailures: 0,
      consecutiveFailures: 0,
      repeatWaste: 0,
      stuckSignals: 0,
      contradictions: 0,
      iterationsSinceEvidence: 0,
      failureArgVariety: overrides.failureArgVariety ?? 0,
    },
  };
}

describe("guard-adapters — flag OFF is always neutral (byte-identical legacy path)", () => {
  const rich = make({ evidenceDelta: 5, phase: "synthesize", failureArgVariety: 9 });
  it("evidence-progress OFF → false even with evidenceDelta > 0", () => {
    expect(assessmentShowsEvidenceProgress(false, rich)).toBe(false);
  });
  it("gathering-phase OFF → false", () => {
    expect(assessmentIsGatheringPhase(false, make({ phase: "gather" }))).toBe(false);
  });
  it("synthesize-phase OFF → false", () => {
    expect(assessmentIsSynthesizePhase(false, rich)).toBe(false);
  });
  it("arg-varying OFF → false", () => {
    expect(assessmentFailuresAreArgVarying(false, rich)).toBe(false);
  });
  it("undefined assessment (no contract) OFF → false everywhere", () => {
    expect(assessmentShowsEvidenceProgress(false, undefined)).toBe(false);
    expect(assessmentIsGatheringPhase(false, undefined)).toBe(false);
    expect(assessmentIsSynthesizePhase(false, undefined)).toBe(false);
    expect(assessmentFailuresAreArgVarying(false, undefined)).toBe(false);
  });
});

describe("guard-adapters — flag ON reads the correct field", () => {
  it("evidence-progress: true iff evidenceDelta > 0", () => {
    expect(assessmentShowsEvidenceProgress(true, make({ evidenceDelta: 1 }))).toBe(true);
    expect(assessmentShowsEvidenceProgress(true, make({ evidenceDelta: 0 }))).toBe(false);
  });
  it("gathering-phase: true iff phase === gather", () => {
    expect(assessmentIsGatheringPhase(true, make({ phase: "gather" }))).toBe(true);
    expect(assessmentIsGatheringPhase(true, make({ phase: "execute" }))).toBe(false);
    expect(assessmentIsGatheringPhase(true, make({ phase: "synthesize" }))).toBe(false);
  });
  it("synthesize-phase: true iff phase === synthesize", () => {
    expect(assessmentIsSynthesizePhase(true, make({ phase: "synthesize" }))).toBe(true);
    expect(assessmentIsSynthesizePhase(true, make({ phase: "gather" }))).toBe(false);
  });
  it("arg-varying: true iff failureArgVariety > 1", () => {
    expect(assessmentFailuresAreArgVarying(true, make({ failureArgVariety: 2 }))).toBe(true);
    expect(assessmentFailuresAreArgVarying(true, make({ failureArgVariety: 1 }))).toBe(false);
    expect(assessmentFailuresAreArgVarying(true, make({ failureArgVariety: 0 }))).toBe(false);
  });
  it("ON with undefined assessment → false (defensive; no contract compiled)", () => {
    expect(assessmentShowsEvidenceProgress(true, undefined)).toBe(false);
    expect(assessmentIsSynthesizePhase(true, undefined)).toBe(false);
  });
});

// ── Named regression #3: terse-model tax (low_delta, audit 02-#3) ───────────
//
// A terse model emits few tokens per iteration → tokenDelta < threshold EVERY
// iteration → the low-delta counter climbs and the guard exits the run early,
// even though the model keeps calling tools successfully (real gather progress).
describe("nextLowDeltaCount — terse-model tax", () => {
  it("OLD (flag off) MISFIRES: low delta climbs even while gathering succeeds", () => {
    const gathering = make({ evidenceDelta: 3 });
    let count = 0;
    for (let i = 0; i < 3; i++) count = nextLowDeltaCount(count, /*lowDelta*/ true, false, gathering);
    // Reaches the ≥2 exit threshold despite productive gathering — the misfire.
    expect(count).toBe(3);
  });
  it("NEW (flag on): a new gather (evidenceDelta > 0) resets the counter → no premature exit", () => {
    const gathering = make({ evidenceDelta: 3 });
    let count = 0;
    for (let i = 0; i < 3; i++) count = nextLowDeltaCount(count, /*lowDelta*/ true, true, gathering);
    expect(count).toBe(0);
  });
  it("NEW still exits when low delta AND no evidence (a real stall)", () => {
    const stalled = make({ evidenceDelta: 0 });
    let count = 0;
    for (let i = 0; i < 3; i++) count = nextLowDeltaCount(count, /*lowDelta*/ true, true, stalled);
    expect(count).toBe(3);
  });
});

// ── Named regression #2: harness-takeover (stall staleness, audit 02-#3) ────
//
// The stall counter tracked new deliverable ARTIFACTS only. A long research run
// gathers evidence for many iterations before writing any file → artifactDelta
// stays 0 → consecutiveStalled climbs → the harness "takes over" and ships a
// partial deliverable while the model was legitimately still gathering.
describe("nextStalledCount — harness-takeover", () => {
  it("OLD (flag off) MISFIRES: no new artifact ⇒ stall climbs during gathering", () => {
    const gathering = make({ evidenceDelta: 2 });
    let count = 0;
    for (let i = 0; i < 4; i++) count = nextStalledCount(count, /*artifactDelta*/ 0, false, gathering);
    expect(count).toBe(4); // crosses the stall threshold → harness takes over
  });
  it("NEW (flag on): new evidence resets the stall counter → harness stays out", () => {
    const gathering = make({ evidenceDelta: 2 });
    let count = 0;
    for (let i = 0; i < 4; i++) count = nextStalledCount(count, /*artifactDelta*/ 0, true, gathering);
    expect(count).toBe(0);
  });
  it("NEW still stalls when neither an artifact NOR new evidence appears", () => {
    const idle = make({ evidenceDelta: 0 });
    let count = 0;
    for (let i = 0; i < 4; i++) count = nextStalledCount(count, /*artifactDelta*/ 0, true, idle);
    expect(count).toBe(4);
  });
});
