// Run: bun test packages/reasoning/tests/kernel/kernel-loop-signal-wiring.test.ts --timeout 15000
//
// RC-3 — the kernel's repeated-identical-failure redirect streak is the single
// loop-stuck trigger authority. reactive-intelligence's strategy-switch
// evaluator refuses to fire without it, so this pins that the kernel actually
// HANDS the count over. Without this test the RI-side guard would silently turn
// entropy-driven strategy switching off framework-wide.
import { Effect, Option } from "effect";
import { describe, it, expect } from "bun:test";
import { runReactiveObserver } from "../../src/kernel/capabilities/reflect/reactive-observer.js";
import type { KernelState, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import type { StrategyServices } from "../../src/kernel/utils/service-utils.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeKernelState, makeStrategyServices } from "../../src/testing/kernel-fixtures.js";

const entropyScore = {
  composite: 0.5,
  sources: { token: 0.3, structural: 0.4, semantic: 0.5, behavioral: 0.7, contextPressure: 0.1 },
  trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
  confidence: "medium" as const,
  modelTier: "local" as const,
  iteration: 3,
  iterationWeight: 0.8,
  timestamp: Date.now(),
};

const mockEntropySensor = {
  score: () => Effect.succeed(entropyScore),
  scoreContext: () => Effect.succeed({ utilizationPct: 0.5, sections: [], atRiskSections: [], compressionHeadroom: 0.5 }),
  getCalibration: () => Effect.succeed({ modelId: "test-model", calibrated: true, sampleCount: 25, highEntropyThreshold: 0.72, convergenceThreshold: 0.35, driftDetected: false }),
  updateCalibration: () => Effect.succeed({ modelId: "test-model", calibrated: true, sampleCount: 26, highEntropyThreshold: 0.72, convergenceThreshold: 0.35, driftDetected: false }),
  getTrajectory: () => Effect.succeed({ history: [], derivative: 0, momentum: 0, shape: "insufficient-data" as const }),
};

function makeLoopState(): KernelState {
  return makeKernelState({
    taskId: "rc3-wiring",
    strategy: "reactive",
    kernelType: "react",
    steps: [makeStep("thought", "Retrying the same failing call", {})],
    iteration: 4,
    tokens: 500,
    meta: { entropy: { modelId: "test-model", entropyHistory: [entropyScore] } },
  });
}

const options: KernelRunOptions = {
  maxIterations: 10,
  strategy: "reactive",
  kernelType: "react",
  modelId: "test-model",
};

/** Runs the observer and returns the params the controller was evaluated with. */
const captureEvalParams = async (
  failureRecoveryRedirects: number | undefined,
): Promise<Record<string, unknown>> => {
  let captured: Record<string, unknown> = {};
  const services: StrategyServices = makeStrategyServices({
    entropySensor: Option.some(mockEntropySensor),
    reactiveController: Option.some({
      evaluate: (params) => {
        captured = params;
        return Effect.succeed([]);
      },
    }),
  });

  await Effect.runPromise(
    runReactiveObserver(
      makeLoopState(),
      services,
      Option.none(),
      0,
      options,
      { redirectsIssued: failureRecoveryRedirects },
    ),
  );
  return captured;
};

describe("RC-3: kernel loop signal wiring", () => {
  it("hands the kernel's failureRecoveryRedirects count to the controller", async () => {
    const params = await captureEvalParams(2);
    expect(params["kernelLoopSignal"]).toEqual({ redirectsIssued: 2 });
  });

  it("reports zero redirects as an explicit zero, not as an absent signal", async () => {
    // A live kernel pass that has issued no redirect yet must still be
    // distinguishable from a caller that never plumbed the field at all.
    const params = await captureEvalParams(0);
    expect(params["kernelLoopSignal"]).toEqual({ redirectsIssued: 0 });
  });

  it("omits the signal entirely when the caller does not supply a count", async () => {
    const params = await captureEvalParams(undefined);
    expect(params).not.toHaveProperty("kernelLoopSignal");
  });
});
