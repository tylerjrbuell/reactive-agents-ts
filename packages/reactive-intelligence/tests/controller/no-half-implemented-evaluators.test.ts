// Run: bun test packages/reactive-intelligence/tests/controller/no-half-implemented-evaluators.test.ts --timeout 15000
//
// North Star principle 11: no half-implemented features. The framework
// previously fired four advisory-only ControllerDecisions whose dispatcher
// would suppress with reason "mode-advisory" because no handler existed:
//
//   - prompt-switch
//   - memory-boost
//   - skill-reinject
//   - human-escalate
//
// They contributed cycles in the controller-evaluate path AND telemetry
// noise without producing any action. WS-4 Phase 2 (2026-05-28, master
// plan §3.6 RC-3) completed the prune: evaluator files deleted AND
// ControllerDecision union members removed. This test pins their absence
// at runtime — if a future iteration re-introduces one of these
// decisions, it MUST also register a real dispatch handler before the
// test will let it ship.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  ReactiveControllerService,
  ReactiveControllerServiceLive,
} from "../../src/controller/controller-service.js";
import type { ReactiveControllerConfig } from "../../src/types.js";
import { defaultInterventionConfig } from "../../src/controller/intervention.js";

const testControllerConfig: ReactiveControllerConfig = {
  earlyStop: true,
  strategySwitch: true,
};

// The last six were deleted by the RI controller census (2026-11-06): they
// never changed a run (inert, unreachable, no input, or never past threshold).
const REMOVED_DECISIONS = [
  "prompt-switch",
  "memory-boost",
  "skill-reinject",
  "human-escalate",
  "temp-adjust",
  "compress",
  "skill-activate",
  "tool-inject",
  "stall-detect",
  "harness-harm",
] as const;

describe("Removed half-implemented evaluators (North Star P11)", () => {
  for (const decisionName of REMOVED_DECISIONS) {
    it(`does not appear in defaultInterventionConfig.modes: ${decisionName}`, () => {
      const modes = defaultInterventionConfig.modes as Record<string, unknown>;
      expect(modes[decisionName]).toBeUndefined();
    }, 15000);
  }

  it("never fires any of the removed decisions for any input", async () => {
    const layer = ReactiveControllerServiceLive(testControllerConfig);

    // Stress the evaluator with input shapes likely to have triggered any of
    // the removed evaluators in the past — high entropy, flat trajectory,
    // many priors, all confidence skills active, etc.
    const params = {
      entropyHistory: Array.from({ length: 8 }, (_, i) => ({
        composite: 0.7,
        trajectory: { shape: "flat", derivative: 0.0, momentum: 0.0 },
      })),
      iteration: 8,
      maxIterations: 12,
      strategy: "reactive",
      calibration: {
        highEntropyThreshold: 0.7,
        convergenceThreshold: 0.3,
        calibrated: true,
        sampleCount: 50,
      },
      config: testControllerConfig,
      behavioralLoopScore: 0.6,
      priorDecisionsThisRun: ["switch-strategy"],
      consecutiveToolFailures: 0,
    };

    const decisions = await Effect.runPromise(
      Effect.gen(function* () {
        const ctrl = yield* ReactiveControllerService;
        return yield* ctrl.evaluate(params);
      }).pipe(Effect.provide(layer)),
    );

    const fired = decisions.map((d) => d.decision);
    for (const removed of REMOVED_DECISIONS) {
      expect(fired).not.toContain(removed);
    }
  }, 15000);
});
