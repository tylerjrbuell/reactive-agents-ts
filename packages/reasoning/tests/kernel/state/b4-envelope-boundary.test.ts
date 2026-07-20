/**
 * b4-envelope-boundary.test.ts — Wave 2 B4 / §5.3 (2026-07-20).
 *
 * The kernel→strategy boundary MUST carry completion honesty. Two invariants:
 *
 *   1. `envelopeFromKernelState` PROJECTS the honesty markers
 *      (`harnessAuthoredOutput`, `verificationWarning`) and degrades
 *      `completionStatus` to `partial` when the harness shipped unverified.
 *      Red-on-cut: if the projection drops a marker, a consuming strategy
 *      (plan-execute / reflexion / blueprint / code-action) re-derives
 *      "completed" from output presence — the exact B4 disease.
 *
 *   2. The IN-KERNEL verifier's degrade-to-warn honesty crosses the boundary
 *      via the envelope's `verificationWarning` — NOT via the deleted
 *      write-only `meta.verifierVerdict` / `meta.verifierRejected`. The receipt
 *      verdict is owned by the result-boundary verifier (§5.3); the in-kernel
 *      verifier owns control flow + the envelope honesty markers.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import {
  initialKernelState,
  transitionState,
  type ThoughtKernel,
} from "../../../src/kernel/state/kernel-state.js";
import { envelopeFromKernelState } from "../../../src/kernel/state/completion-envelope.js";
import type {
  Verifier,
  VerificationContext,
  VerificationResult,
} from "../../../src/kernel/capabilities/verify/verifier.js";

describe("B4 envelope boundary: honesty markers are projected", () => {
  it("projects harnessAuthoredOutput + verificationWarning and degrades completionStatus to partial", () => {
    const terminal = transitionState(
      initialKernelState({ strategy: "react", kernelType: "test", maxIterations: 5 }),
      {
        status: "done",
        output: "Concatenated tool artifacts the model never authored.",
        meta: {
          harnessAuthoredOutput: true,
          verificationWarning: "output-is-model-authored failed",
        },
      },
    );

    const envelope = envelopeFromKernelState(terminal);

    // The projected honesty markers cross the boundary (drop → B4 disease).
    expect(envelope.harnessAuthoredOutput).toBe(true);
    expect(envelope.verificationWarning).toBe("output-is-model-authored failed");
    // A harness-authored ship is NEVER a clean success.
    expect(envelope.completionStatus).toBe("partial");
  });

  it("a clean terminal yields completionStatus=completed with no honesty markers", () => {
    const terminal = transitionState(
      initialKernelState({ strategy: "react", kernelType: "test", maxIterations: 5 }),
      { status: "done", output: "Paris is the capital of France." },
    );
    const envelope = envelopeFromKernelState(terminal);
    expect(envelope.completionStatus).toBe("completed");
    expect(envelope.harnessAuthoredOutput).toBeUndefined();
    expect(envelope.verificationWarning).toBeUndefined();
  });
});

const FABRICATED = "$80,000";

/** Kernel that immediately finishes with a fabricated figure. */
const fabricatedKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: `Bitcoin is currently ${FABRICATED} USD.`,
      iteration: state.iteration + 1,
    }),
  );

/** Verifier that always rejects on evidence-grounding (persistent fabrication). */
const alwaysRejectVerifier: Verifier = {
  verify(_ctx: VerificationContext): VerificationResult {
    return {
      verified: false,
      softFail: false,
      severity: "reject",
      action: "final-answer",
      summary: `final-answer: failed at evidence-grounded (unverified figure: ${FABRICATED})`,
      checks: [
        { name: "action-success", passed: true, severity: "pass" },
        {
          name: "evidence-grounded",
          passed: false,
          severity: "reject",
          reason: `unverified figure: ${FABRICATED}`,
        },
      ],
    };
  },
};

describe("B4/§5.3: in-kernel verifier honesty crosses the boundary via the envelope", () => {
  it("degrade-to-warn surfaces verificationWarning on the envelope, not a dead meta verdict", async () => {
    const layer = TestLLMServiceLayer([{ text: `Bitcoin is still ${FABRICATED} USD.` }]);
    const state = await Effect.runPromise(
      runKernel(
        fabricatedKernel,
        {
          task: "What is the BTC price?",
          verifier: alwaysRejectVerifier,
          grounding: { mode: "block", maxRetries: 1 },
        },
        { maxIterations: 5, strategy: "react", kernelType: "test" },
      ).pipe(Effect.provide(layer)),
    );

    // Control flow: never hard-failed; the answer is surfaced.
    expect(state.status).toBe("done");

    // The honesty signal crosses the boundary through the envelope.
    const envelope = envelopeFromKernelState(state);
    expect(envelope.verificationWarning).toBeDefined();
    expect(String(envelope.verificationWarning)).toContain(FABRICATED);

    // §5.3: the write-only verdict fields were removed — nothing rides meta.
    const meta = state.meta as Record<string, unknown>;
    expect(meta["verifierVerdict"]).toBeUndefined();
    expect(meta["verifierRejected"]).toBeUndefined();
    expect(meta["verifierEscalation"]).toBeUndefined();
  });
});
