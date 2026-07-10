// Run: bun test packages/reasoning/tests/control/stall-abstain-precedence.test.ts
//
// The F3 precedence inversion (see error-recovery-precedence.test.ts) again, at
// the STALL seam — found by asking which other seams force a control action
// without consulting the resolver.
//
// `runStallDeliverableStep` forces its own action: a `steer` (required-tool
// nudge / recovery steering) or a harness-deliverable `terminate`. The resolver's
// documented total order ranks:
//
//     abstain(1) < terminate(2) < steer(5)          (lower index wins)
//
// So a run with NO deliverable whose ungrounded-synthesis retries are exhausted —
// one that provably cannot ground its answer — must decline honestly rather than
// be nudged. It was nudged, because the stall seam never asked.
//
// `proposeFromStallGuard` was written for exactly this seam and had ZERO
// production callers: every reference to it lived in `emitters.test.ts`. The
// emitter was unit-tested into looking done.
//
// MEASURED on the real runKernel -> iteratePass path, with a REACHABLE
// precondition (one grounding redirect + one synthesis retry):
//
//   default profile : iteration 5, terminatedBy (none),   2 nudges
//   long-horizon    : iteration 3, terminatedBy abstained, 0 nudges
//
// The default profile never declines here at all. So the seam is not merely
// declining earlier — under this profile it is the only path to an honest
// decline, and it saves two iterations of nudging a model that could never
// ground its answer.
//
// An earlier version set `synthesisRetryCount: 2`, which production caps at 1.
// That baseline was an artifact of an input the seam can never receive.

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { FORCE_UNGROUNDED_THRESHOLD } from "../../src/kernel/loop/runner-helpers/force-abstention.js";

const TOOL = "web-search";

/**
 * A kernel pass that STALLS: it only thinks. No tool call, so no artifact and no
 * deliverable; `synthesisRetryCount` marks the ungrounded-synthesis retries as
 * exhausted, which is what makes forced abstention qualify.
 *
 * Both conditions then hold at the same iteration:
 *   - the stall guard trips   (no new artifacts for `stallThreshold` iterations)
 *   - forced abstention qualifies (no deliverable, ungrounded retries exhausted)
 *
 * Per the total order, `abstain` must win.
 */
const stallingKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
      steps: [...state.steps, makeStep("thought", "thinking about it")],
      meta: {
        // REACHABLE precondition — see note in error-recovery-precedence.test.ts.
        // `synthesisRetryCount: 2` is impossible in production (capped at 1).
        ...state.meta,
        groundingRedirectCount: 1,
        synthesisRetryCount: 1,
      },
    } as never),
  );

const schema = [{ name: TOOL, description: "search the web", parameters: {} }];
const INPUT = {
  task: "Find the current price of BTC and report it",
  availableToolSchemas: schema,
  allToolSchemas: schema,
  requiredTools: [TOOL],
} as never;

const run = (horizonProfile?: "long") =>
  Effect.runPromise(
    runKernel(stallingKernel, INPUT, {
      maxIterations: 6,
      strategy: "test",
      kernelType: "test",
      ...(horizonProfile ? { horizonProfile } : {}),
    } as never).pipe(Effect.provide(TestLLMServiceLayer())),
  );

const nudges = (state: { steps: readonly { type: string }[] }) =>
  state.steps.filter((s) => s.type === "harness_signal");

describe("stall seam — abstain must outrank the stall guard's steer", () => {
  it("LONG-HORIZON: the run declines at the FIRST stall that qualifies", async () => {
    const state = await run("long");
    expect(state.meta.terminatedBy).toBe("abstained");
    expect(state.iteration).toBe(3); // default reaches 5 and never abstains
  });

  it("LONG-HORIZON: the steer that LOST is not also injected", async () => {
    // Exactly ONE action per iteration. A surviving nudge means both actuators
    // fired — the P5 race, recreated at this seam.
    const state = await run("long");
    expect(nudges(state)).toHaveLength(0); // was 2
  });

  it("LONG-HORIZON: the abstention names why grounding was impossible", async () => {
    const state = await run("long");
    const abstention = state.meta.abstention as { reason?: string } | undefined;
    expect(abstention?.reason).toContain("could not ground an answer");
  });
});

describe("DEFAULT profile is unchanged (lift-gate discipline)", () => {
  it("OFF the profile the stall guard still nudges and the budget is still spent", async () => {
    const state = await run();
    expect(state.iteration).toBe(5);
    expect(nudges(state)).toHaveLength(2);
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });
});
