/**
 * Verification Quality Gate orchestrator.
 *
 * Reads the verifier's result. If the response was REJECTED and we have
 * retries remaining, builds a verification-feedback message, injects it
 * into the conversation thread, dispatches a rate-limited THINK retry
 * (which runs through `runVerificationThinkRetry`), then re-runs verify
 * on the revised response. If still rejected, logs a warning and proceeds.
 *
 * Extracted from `execution-engine.ts:1349-1438` (W23 step 6a-8) to shrink
 * the engine module without changing behavior.
 *
 * Three callback deps keep engine internals out of this module:
 *  - fireGuardedThinkRetry — wraps the retry call site through the engine's
 *    lifecycle-checked guardedPhase wrapper.
 *  - runVerifyAgain — re-runs the engine's `verify` phase via runGuardedPhase
 *    + the engine's `deps: PhaseDeps` bundle.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";

export interface VerificationQualityGateDeps {
  readonly config: ReactiveAgentsConfig;
  readonly obs: ObsLike | null;
  readonly fireGuardedThinkRetry: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>;
  readonly runVerifyAgain: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>;
}

export const runVerificationQualityGate = (
  initialCtx: ExecutionContext,
  deps: VerificationQualityGateDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { config, obs, fireGuardedThinkRetry, runVerifyAgain } = deps;
  return Effect.gen(function* () {
    let ctx = initialCtx;
    if (!config.enableVerification) return ctx;

    const vResult = ctx.metadata.verificationResult as
      | { passed?: boolean; recommendation?: string; overallScore?: number; layerResults?: unknown[] }
      | undefined;
    const vRetryCount = (ctx.metadata.verificationRetryCount as number) ?? 0;
    const maxVRetries = config.maxVerificationRetries ?? 1;

    if (
      !vResult ||
      vResult.passed !== false ||
      vResult.recommendation !== "reject" ||
      vRetryCount >= maxVRetries
    ) {
      return ctx;
    }

    if (obs) {
      yield* obs.info(
        `⚠ [verify] Response rejected (score: ${vResult.overallScore?.toFixed(2) ?? "?"}) — retrying think phase (attempt ${vRetryCount + 1}/${maxVRetries})`,
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/verification-quality-gate.ts:log-rejection", tag: errorTag(err) })));
    }

    // Build verification feedback for the next think iteration
    const feedbackParts: string[] = [
      `[Verification Feedback] Your previous response was rejected (score: ${vResult.overallScore?.toFixed(2) ?? "unknown"}).`,
    ];
    if (Array.isArray(vResult.layerResults)) {
      for (const lr of vResult.layerResults as Array<{ layerName?: string; passed?: boolean; details?: string }>) {
        if (lr.passed === false && lr.details) {
          feedbackParts.push(`- ${lr.layerName ?? "check"}: ${lr.details}`);
        }
      }
    }
    feedbackParts.push("Please revise your answer to address these issues.");

    // Inject feedback as a system message and reset completion state
    ctx = {
      ...ctx,
      messages: [
        ...ctx.messages,
        { role: "user", content: feedbackParts.join("\n") },
      ],
      metadata: {
        ...ctx.metadata,
        isComplete: false,
        verificationRetryCount: vRetryCount + 1,
        verificationFeedback: feedbackParts.join("\n"),
      },
    };

    // Re-run the think phase (single retry call).
    //
    // S3 (AUDIT-overhaul-2026 §16.4): when ReasoningService is wired,
    // route the retry through it so it inherits state.steps[],
    // entropy scoring, RI dispatcher, healing pipeline, FC tool
    // execution, episodic memory bridge, and telemetry hooks. When
    // reasoning is NOT wired (test mode / minimal layer), fall back
    // to the original inline LLM call. The fallback is preserved
    // byte-for-byte to keep verification-quality-gate.test.ts green
    // (it pins llmCallCount === 2 and verifyCallCount === 2).
    ctx = yield* fireGuardedThinkRetry(ctx);

    // Re-run verification on the revised response (uses the
    // same extracted phase value; W23).
    ctx = yield* runVerifyAgain(ctx);

    // If still rejected after retry, log warning and continue
    const vResultAfterRetry = ctx.metadata.verificationResult as
      | { passed?: boolean; recommendation?: string; overallScore?: number }
      | undefined;
    if (vResultAfterRetry && vResultAfterRetry.passed === false) {
      if (obs) {
        yield* obs.info(
          `⚠ [verify] Response still rejected after ${vRetryCount + 1} retry(s) (score: ${vResultAfterRetry.overallScore?.toFixed(2) ?? "?"}) — proceeding anyway`,
        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/verification-quality-gate.ts:log-still-rejected", tag: errorTag(err) })));
      }
    }

    return ctx;
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
