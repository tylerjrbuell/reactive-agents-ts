// endgame-amputation.test.ts — E2 named regression: endgame amputation
// (audit 02-#5, H6 generalized).
//
// RI early-stop fires when entropy has converged (or the run is spinning near
// maxIterations). During the SYNTHESIS endgame — the model composing its final
// answer — entropy naturally flattens/converges, so early-stop misfires and
// confiscates exactly the deliverable a long-horizon run exists to produce. H6
// patched the overflow-guard branch via entropy shape; E2 generalizes the fix to
// ANY branch via assessment.phase. The `phase` field is supplied ONLY under the
// long-horizon profile, so absent it behavior is byte-identical.

import { describe, expect, it } from "bun:test";
import { evaluateEarlyStop } from "./early-stop.js";
import type { ControllerEvalParams } from "../types.js";

/** Params that WOULD early-stop: converged entropy at/below threshold, output present. */
function convergedParams(over: Partial<ControllerEvalParams> = {}): ControllerEvalParams {
  const converging = { shape: "converging", derivative: -0.1, momentum: 0.1 };
  return {
    entropyHistory: [
      { composite: 0.2, trajectory: converging },
      { composite: 0.15, trajectory: converging },
    ],
    iteration: 40,
    maxIterations: 50,
    strategy: "reactive",
    calibration: {
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
      calibrated: true,
      sampleCount: 30,
    },
    config: { earlyStop: true, contextCompression: true, strategySwitch: true },
    contextPressure: 0,
    behavioralLoopScore: 0,
    hasUserOutput: true,
    ...over,
  };
}

describe("evaluateEarlyStop — endgame amputation", () => {
  it("OLD (no phase) MISFIRES: fires early-stop on the converged endgame", () => {
    const decision = evaluateEarlyStop(convergedParams());
    expect(decision).not.toBeNull();
    expect(decision?.decision).toBe("early-stop");
  });

  it("NEW: synthesize phase suppresses early-stop (endgame protected)", () => {
    const decision = evaluateEarlyStop(convergedParams({ phase: "synthesize" }));
    expect(decision).toBeNull();
  });

  it("NEW: a non-synthesize phase still allows the convergence early-stop", () => {
    for (const phase of ["orient", "gather", "execute", "verify"] as const) {
      const decision = evaluateEarlyStop(convergedParams({ phase }));
      expect(decision).not.toBeNull();
    }
  });

  it("NEW: synthesize also suppresses the overflow-guard branch near maxIterations", () => {
    // Diverging shape near the ceiling would still trip the overflow guard for a
    // spinning run; phase=synthesize must override it so the answer is composed.
    const spinning = convergedParams({
      phase: "synthesize",
      iteration: 49,
      maxIterations: 50,
      entropyHistory: [
        { composite: 0.9, trajectory: { shape: "flat", derivative: 0, momentum: 0 } },
        { composite: 0.9, trajectory: { shape: "flat", derivative: 0, momentum: 0 } },
      ],
    });
    expect(evaluateEarlyStop(spinning)).toBeNull();
  });
});
