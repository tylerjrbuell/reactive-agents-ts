/**
 * grounding-block-mode.test.ts — Phase D1 integration.
 *
 * Block-mode evidence-grounding at the terminal verifier gate must:
 *   (a) on a fabricated figure → run exactly ONE corrective synthesis retry;
 *       if the retry grounds → accept the corrected answer (pass).
 *   (b) if still ungrounded after maxRetries → DEGRADE to warn: surface the
 *       answer WITH `verificationWarning`, status stays NON-failed.
 * It must NEVER hard-fail and NEVER loop past maxRetries.
 *
 * Driven through the real `runKernel` post-loop terminal gate with a custom
 * Verifier (injected via `input.verifier`) that emits the `evidence-grounded`
 * reject check the gate special-cases. The corrective synthesis output is
 * controlled via TestLLMService.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import {
  transitionState,
  type ThoughtKernel,
} from "../../../src/kernel/state/kernel-state.js";
import type {
  Verifier,
  VerificationContext,
  VerificationResult,
} from "../../../src/kernel/capabilities/verify/verifier.js";

const FABRICATED = "$80,000";
const GROUNDED = "$62,578";

/** Kernel that immediately finishes with a fabricated figure. */
const fabricatedKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      status: "done",
      output: `Bitcoin is currently ${FABRICATED} USD.`,
      iteration: state.iteration + 1,
    }),
  );

/**
 * Verifier that pushes an evidence-grounded REJECT whenever the content still
 * contains the fabricated figure; passes once the content is grounded.
 * `alwaysReject` forces the persistent-fabrication branch.
 */
const groundingVerifier = (alwaysReject: boolean): Verifier => ({
  verify(ctx: VerificationContext): VerificationResult {
    const ungrounded = alwaysReject || ctx.content.includes(FABRICATED);
    const checks = [
      { name: "action-success", passed: true, severity: "pass" as const },
      {
        name: "evidence-grounded",
        passed: !ungrounded,
        severity: (ungrounded ? "reject" : "pass") as "reject" | "pass",
        reason: ungrounded ? `unverified figure: ${FABRICATED}` : undefined,
      },
    ];
    return {
      verified: !ungrounded,
      softFail: false,
      severity: ungrounded ? "reject" : "pass",
      action: "final-answer",
      summary: ungrounded ? `final-answer: failed at evidence-grounded (unverified figure: ${FABRICATED})` : "final-answer: 2 checks passed",
      checks,
    };
  },
});

describe("block-mode grounding: retry → correct → pass", () => {
  it("runs one corrective synthesis retry and accepts the grounded answer", async () => {
    // Corrective synthesis returns a grounded figure → second verify passes.
    const layer = TestLLMServiceLayer([{ text: `Bitcoin is currently ${GROUNDED} USD.` }]);
    const result = await Effect.runPromise(
      runKernel(
        fabricatedKernel,
        {
          task: "What is the BTC price?",
          verifier: groundingVerifier(false),
          grounding: { mode: "block", maxRetries: 1 },
        },
        { maxIterations: 5, strategy: "react", kernelType: "test" },
      ).pipe(Effect.provide(layer)),
    );

    expect(result.status).not.toBe("failed");
    expect(result.status).toBe("done");
    expect(result.output ?? "").toContain(GROUNDED);
    // Corrected on retry — no degrade warning surfaced.
    expect(result.meta.verificationWarning).toBeUndefined();
    // Exactly one corrective attempt was spent.
    expect(result.meta.groundingBlockRetry).toBe(1);
  });
});

describe("block-mode grounding: persistent fabrication → degrade-to-warn", () => {
  it("caps at one retry then degrades to warn (status not failed, verifierWarning present)", async () => {
    // Corrective synthesis ALSO ungrounded; verifier always rejects.
    const layer = TestLLMServiceLayer([{ text: `Bitcoin is still ${FABRICATED} USD.` }]);
    const result = await Effect.runPromise(
      runKernel(
        fabricatedKernel,
        {
          task: "What is the BTC price?",
          verifier: groundingVerifier(true),
          grounding: { mode: "block", maxRetries: 1 },
        },
        { maxIterations: 5, strategy: "react", kernelType: "test" },
      ).pipe(Effect.provide(layer)),
    );

    // Never hard-fails.
    expect(result.status).not.toBe("failed");
    expect(result.status).toBe("done");
    // Answer is surfaced, not nullified.
    expect(result.output ?? "").toBeTruthy();
    // Degrade-to-warn: warning present, not flagged as a hard rejection.
    expect(result.meta.verificationWarning).toBeDefined();
    expect(String(result.meta.verificationWarning)).toContain(FABRICATED);
    expect(result.meta.verifierRejected).not.toBe(true);
    // Capped at exactly maxRetries — never looped past.
    expect(result.meta.groundingBlockRetry).toBe(1);
  });
});
