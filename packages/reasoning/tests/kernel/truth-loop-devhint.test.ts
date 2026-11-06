// Run: bun test packages/reasoning/tests/kernel/truth-loop-devhint.test.ts --timeout 15000
//
// Truthfulness audit 2026-11-06, item 4: the loop detector's message carried
// developer remediation ("Fix: … .withContextProfile({ tier: 'local' })",
// "Use .withReasoning({ defaultStrategy: … })") and reached the model through
// the strategy-switch handoff's `Failure reason:` line (92 runs). The model
// cannot act on builder config.
//
// Now `LoopDetection.message` is a model-actionable summary and the advice
// lives in `devHint`, which reaches only the run error (developer-facing).
//
// RED-ON-CUT: fold the devHint text back into `message` in loop-detector.ts
// and the "model-visible text" tests fail.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { detectLoopPattern } from "../../src/kernel/capabilities/reflect/loop-detector.js";
import { buildHandoffSummary } from "../../src/kernel/capabilities/verify/harness-internal-text.js";
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { makeKernelInput, makeKernelRunOptions } from "../../src/testing/kernel-fixtures.js";

const DEV_ADVICE = /\.with[A-Z]|Fix: \(1\)|persona instruction|your provider/;

const thoughtStall = () =>
  detectLoopPattern(
    [makeStep("thought", "a"), makeStep("thought", "b"), makeStep("thought", "c"), makeStep("thought", "d")],
    9, 9, 3,
  );
const repeatedThought = () =>
  detectLoopPattern([makeStep("thought", "same"), makeStep("thought", "same"), makeStep("thought", "same")], 9, 3, 9);

/** The handoff the switch path renders, with the failureReason turn-guard-operations builds. */
const handoffFor = (d: NonNullable<ReturnType<typeof detectLoopPattern>>) =>
  buildHandoffSummary({
    switchNumber: 1,
    previousStrategy: "reactive",
    stepsCompleted: 4,
    failureReason: `pattern=${d.pattern.id} (${d.pattern.name}); ${d.message}`,
    toolsCalled: [],
    permanentlyFailedTools: [],
    keyObservations: [],
  });

describe("truth item 4 — developer advice never reaches the model", () => {
  it("pattern (c) consecutive thoughts: model-visible text is actionable, advice is in devHint", () => {
    const d = thoughtStall();
    expect(d?.pattern.id).toBe("c");
    expect(d!.message).not.toMatch(DEV_ADVICE);
    expect(handoffFor(d!)).not.toMatch(DEV_ADVICE);
    expect(d!.message).toContain("consecutive thinking steps with no tool calls");
    expect(d!.devHint).toContain(".withContextProfile");
  });

  it("pattern (b) repeated thought: same split", () => {
    const d = repeatedThought();
    expect(d?.pattern.id).toBe("b");
    expect(d!.message).not.toMatch(DEV_ADVICE);
    expect(handoffFor(d!)).not.toMatch(DEV_ADVICE);
    expect(d!.devHint).toContain(".withReasoning");
  });

  it("the run error (developer-facing) still carries the advice", async () => {
    const options = makeKernelRunOptions({ strategy: "react" });
    const steps = [
      makeStep("action", "call", { toolCall: { id: "1", name: "web-search", arguments: {} } }),
      makeStep("observation", "ENOENT", { observationResult: makeObservationResult("web-search", false, "ENOENT not found") }),
      makeStep("harness_signal", "exit gate: denied once", {
        exitGate: { proposedBy: "loop_resolution", gateDecision: "deny-once", reason: "loop_graceful", outstanding: ["x"] },
      }),
    ];
    const state = transitionState(initialKernelState(options), { steps });
    const detection = thoughtStall()!;
    const r = await Effect.runPromise(
      resolveDetectedLoop({
        state, currentInput: makeKernelInput({ task: "t" }), currentOptions: options,
        loopMsg: detection.message, detection,
        failureRecoveryRedirects: 0, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 0, maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(r.state.status).toBe("failed");
    expect(r.state.error ?? "").toContain(detection.message);
    expect(r.state.error ?? "").toContain(".withContextProfile");
  });
});
