// Run: bun test packages/reasoning/tests/control/error-recovery-precedence.test.ts
//
// A precedence inversion at the F3 (repeated-identical-tool-failure) seam — the
// same class of bug the control plane was built to kill, left unfixed because the
// emitter that belongs there was never called.
//
// `resolveControlPlane` documents a TOTAL ORDER over control actions:
//
//     veto(0) > abstain(1) > terminate(2) > strategy-switch(3) > redirect(4) > steer(5)
//
// `abstain` outranks `redirect` because a run whose grounding is structurally
// impossible must decline honestly rather than burn more iterations. That is the
// whole point of the P5 fix.
//
// But the F3 seam (`iterate-pass.ts:974`) forces its `redirect` directly and then
// `return "continue"`s. The in-loop abstain signal is only ever built at the
// strategy-switch seam, which requires the LOOP DETECTOR to trip first. So when a
// run qualifies for forced abstention AND hits a repeated identical tool failure
// in the same iteration, the redirect wins — by code order, not by the documented
// precedence. The run keeps re-steering a model that cannot possibly ground its
// answer, and only abstains later, post-loop, after spending the redirect budget.
//
// `proposeFromErrorRecovery` exists to make that seam a PROPOSAL rather than a
// forced action. Before this fix it had zero production callers: its only
// references anywhere were in `emitters.test.ts`. Unit-testing the function, not
// the call — so the resolver never saw the redirect, and never got the chance to
// rank abstain above it.
//
// These tests drive the REAL `runKernel` → `iteratePass` → F3 seam.

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { FORCE_UNGROUNDED_THRESHOLD } from "../../src/kernel/loop/runner-helpers/force-abstention.js";

const FLAKY = "flaky-tool";
const ERROR_TEXT = "Error: connection refused";

/** One failed observation for FLAKY, identical every time (feeds the F3 detector). */
const failedObs = () =>
  makeStep("observation", ERROR_TEXT, {
    observationResult: makeObservationResult(FLAKY, false, ERROR_TEXT),
    toolUsed: FLAKY,
  });

/**
 * A kernel pass that lands two identical tool failures and marks the run as
 * having exhausted its ungrounded-synthesis retries.
 *
 * Both conditions then hold in the SAME iteration:
 *   - F3 fires            (two identical failures for a known tool this pass)
 *   - forced abstention qualifies (ungroundedSynthesisRejections >= threshold,
 *                          no deliverable)
 *
 * Per the total order, `abstain` must win.
 */
const failingKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
      steps: [...state.steps, failedObs(), failedObs()],
      meta: {
        ...state.meta,
        // REACHABLE precondition. This used to set
        // `synthesisRetryCount: FORCE_UNGROUNDED_THRESHOLD` (2) — a value
        // production CAPS AT 1 (arbitrator: SYNTHESIS_RETRY_MAX). The seam was
        // being unit-tested with an input it could never receive, which hid the
        // fact that the in-loop abstain proposal was always null. The reachable
        // pair is one grounded-terminal redirect + one synthesis retry.
        groundingRedirectCount: 1,
        synthesisRetryCount: 1,
      },
    } as never),
  );

const INPUT = {
  task: "Find the current price of BTC and report it",
  availableToolSchemas: [
    { name: FLAKY, description: "a tool that always fails", parameters: {} },
  ],
  allToolSchemas: [{ name: FLAKY, description: "a tool that always fails", parameters: {} }],
  requiredTools: [] as string[],
} as never;

const run = (horizonProfile?: "long") =>
  Effect.runPromise(
    runKernel(failingKernel, INPUT, {
      maxIterations: 4,
      strategy: "test",
      kernelType: "test",
      ...(horizonProfile ? { horizonProfile } : {}),
    } as never).pipe(Effect.provide(TestLLMServiceLayer())),
  );

const harnessSignals = (state: { steps: readonly { type: string; content: string }[] }) =>
  state.steps.filter((s) => s.type === "harness_signal").map((s) => s.content);

// MEASURED (reachable precondition: one grounding redirect + one synthesis retry):
//
//   default profile : iteration 4/4, terminatedBy (none),   2 F3 redirects
//   long-horizon    : iteration 2,   terminatedBy abstained, 0 F3 redirects
//
// The default profile never declines at all here — the post-loop §7.5 abstention
// requires a TERMINAL_ANSWER_REASON, and this run exhausts its iterations instead.
// So the seam does not merely decline EARLIER; under this profile it is the only
// path to an honest decline, and it saves two iterations of re-steering a model
// that could never ground its answer.
//
// An earlier version of this file set `synthesisRetryCount: 2` and recorded a
// different baseline. That input is impossible in production (capped at 1), so
// both the baseline and the "abstains post-loop" claim were artifacts.

const recoveryRedirects = (state: { steps: readonly { type: string; content: string }[] }) =>
  harnessSignals(state).filter((c) => c.includes("Recovery required"));

describe("F3 seam — abstain must outrank the error-recovery redirect", () => {
  it("LONG-HORIZON: the run declines at the FIRST qualifying iteration, not at the budget's end", async () => {
    // Baseline burned all 4 iterations. The resolver ranks abstain(1) above
    // redirect(4), so the decline lands as soon as both proposals coexist.
    const state = await run("long");
    expect(state.meta.terminatedBy).toBe("abstained");
    expect(state.iteration).toBe(2); // was 4, and the default profile never abstains
  });

  it("LONG-HORIZON: the redirect that LOST is not also injected", async () => {
    // The resolver picks exactly ONE action per iteration. If the redirect still
    // ran alongside the abstain, both actuators fired — the P5 race, recreated.
    const state = await run("long");
    expect(recoveryRedirects(state)).toHaveLength(0);
  });

  it("LONG-HORIZON: the abstention names why grounding was impossible", async () => {
    const state = await run("long");
    const abstention = state.meta.abstention as { reason?: string } | undefined;
    expect(abstention?.reason).toContain("could not ground an answer");
  });
});

describe("DEFAULT profile is unchanged (lift-gate discipline)", () => {
  it("OFF the profile the F3 redirect still fires and the budget is still spent", async () => {
    // The control-plane seam is opt-in behind the horizon profile, exactly as the
    // strategy-switch seam is. Off the profile, behavior is byte-identical to the
    // measured baseline: 4 iterations, 2 redirects, and NO honest decline.
    const state = await run();
    expect(state.iteration).toBe(4);
    expect(recoveryRedirects(state)).toHaveLength(2);
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });
});
