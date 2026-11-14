// File: tests/kernel/loop/enumeration-abstain-acted-on.test.ts
//
// Local-model campaign 2026-11-13, lh-1 trace 01M7BMXFY8350ZFQQQTF63DAEQ:
// from iteration 12 the control plane resolved `abstain` ("requirement answer
// expects 6 items, found 0, no progress for N iterations") every iteration
// through 47 and nothing acted on it, because the seams only acted when the
// grounding-forced decision was non-null and an enumeration abstain carries
// none. Zero-token: each test drives the shared stall seam iteration by
// iteration with the requirement-progress the assessment would report.

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { resolveStallControlPlane } from "../../../src/kernel/loop/iterate-control-plane-seams.js";
import { resolveHorizonProfile } from "../../../src/kernel/loop/runner-helpers/horizon-profile.js";
import { enumerationStallPatience } from "../../../src/kernel/control/emitters.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../src/kernel/utils/observation-helpers.js";
import {
  initialKernelState,
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";
import type { RunContract } from "../../../src/kernel/contract/run-contract.js";
import type { RunAssessment } from "../../../src/kernel/assessment/assess.js";
import type { ReasoningStep } from "../../../src/types/index.js";

const MAX_ITER = 50;
const options: KernelRunOptions = { maxIterations: MAX_ITER, strategy: "reactive", kernelType: "react" };
const input: KernelInput = { task: "Answer all six questions" };
const lane = { lane: "gather" as const, missingRequiredTools: [] as readonly string[], canFinalize: false };

const contract: RunContract = {
  requirements: [
    {
      id: "answer",
      kind: "question-answered",
      spec: {
        description: "answer all six questions",
        acceptance: "self-critique",
        enumeration: { expectedCount: 6, itemShape: "list-entry" },
      },
    },
  ],
  deliverables: [],
  constraints: [],
  horizon: "long",
  postConditions: [],
};

const assessmentWith = (stallCount: number): RunAssessment => ({
  requirements: { satisfied: [], outstanding: ["answer"], blocked: [] },
  deliverables: { produced: [], missing: [] },
  evidenceDelta: 0,
  phase: "gather",
  pace: { burnRatio: 0.1, band: "green" },
  health: { recentFailures: 0, consecutiveFailures: 0, stuckSignals: 0, iterationsSinceEvidence: 0, failureArgVariety: 0 },
  requirementProgress: new Map([["answer", { stallCount, refEscalation: new Map() }]]),
});

const stateAt = (iteration: number, stallCount: number, steps: readonly ReasoningStep[] = []): KernelState => {
  const base = initialKernelState(options);
  return transitionState(base, {
    status: "thinking",
    iteration,
    steps: [...steps],
    meta: { ...base.meta, runContract: contract, assessment: assessmentWith(stallCount) },
  });
};

/** The seam at one iteration; horizon is a long-horizon profile (the only place the emitter is live). */
const seamAt = (state: KernelState) =>
  Effect.runPromise(
    resolveStallControlPlane({
      state,
      currentInput: input,
      requiredTools: [],
      currentOptions: options,
      horizon: resolveHorizonProfile({ horizonProfile: "long", maxIterations: MAX_ITER }),
      laneDecision: lane,
    }),
  );

/** Run the seam over a stall-count script, one entry per iteration from iteration 10; the first exit, if any. */
async function firstExitIteration(stalls: readonly number[], steps: readonly ReasoningStep[] = []) {
  for (let i = 0; i < stalls.length; i++) {
    const iteration = 10 + i;
    const out = await seamAt(stateAt(iteration, stalls[i]!, steps));
    if (out.exit !== null) return { iteration, out };
  }
  return undefined;
}

describe("control-plane enumeration abstain is acted on", () => {
  it("patience scales with the iteration budget (floor 4, 10% above)", () => {
    expect(enumerationStallPatience(20)).toBe(4);
    expect(enumerationStallPatience(50)).toBe(5);
    expect(enumerationStallPatience(100)).toBe(10);
  });

  it("(1) an enumeration stuck at found 0 ends honestly at the patience, not at the iteration cap", async () => {
    const patience = enumerationStallPatience(MAX_ITER);
    // stall count rises one per iteration from 0, as in the trace
    const stalls = Array.from({ length: MAX_ITER - 10 }, (_, i) => i);
    const hit = await firstExitIteration(stalls);
    expect(hit).toBeDefined();
    expect(hit!.iteration).toBe(10 + patience);
    expect(hit!.iteration).toBeLessThan(MAX_ITER);
    const s = hit!.out.state;
    // no material at all: the guard's own honest failure stands, naming the requirement
    expect(s.status).toBe("failed");
    expect(s.error).toContain("expects 6 items, found 0");
    expect(s.error).toContain("satisfy the requirement (answer: 0/6 items found");
  });

  it("(2) an enumeration that keeps progressing (stall resets as the model sees new items) never abstains", async () => {
    // found rising 0,1,2,3...: each new page clears the stall; it never reaches patience
    const patience = enumerationStallPatience(MAX_ITER);
    const stalls = Array.from({ length: 40 }, (_, i) => i % (patience - 1));
    expect(await firstExitIteration(stalls)).toBeUndefined();
  });

  it("(3) abstain after real partial results delivers the partial with an Unfinished list", async () => {
    const DRAFT = "WASI is the WebAssembly System Interface, a standard for portable system calls. ".repeat(3);
    const steps: ReasoningStep[] = [
      makeStep("observation", "page body", { observationResult: makeObservationResult("http-get", true, "page body") }),
      makeStep("thought", DRAFT),
    ];
    const hit = await firstExitIteration(
      Array.from({ length: 20 }, (_, i) => i),
      steps,
    );
    expect(hit).toBeDefined();
    const s = hit!.out.state;
    expect(s.status).toBe("done");
    expect(s.output).toContain("WASI is the WebAssembly System Interface");
    expect(s.output).toContain("Unfinished:");
    expect(s.output).toContain("satisfy the requirement (answer: 0/6 items found");
    expect(hit!.out.exit?.decision).toBe("handoff");
  });
});
