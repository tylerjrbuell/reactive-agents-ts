/**
 * Phase 6 VERIFY summary log.
 *
 * Verification may be fast (heuristics) or involve extra LLM calls when
 * useLLMTier is on; without this log line it looks like verify "did
 * nothing" in normal verbosity. Lifted from execution-engine.ts
 * post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { ObsLike } from "../runtime-context.js";

export interface VerifySummaryLogArgs {
  readonly ctx: ExecutionContext;
  readonly config: ReactiveAgentsConfig;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
}

export const logVerifySummary = (
  args: VerifySummaryLogArgs,
): Effect.Effect<void, never> => {
  const { ctx, config, obs, isNormal } = args;
  return Effect.gen(function* () {
    if (!config.enableVerification || !obs || !isNormal) return;
    const vr = ctx.metadata.verificationResult;
    if (vr) {
      const failedLayers = (vr.layerResults ?? [])
        .filter((l) => l.passed === false)
        .map((l) => l.layerName ?? "?")
        .join(", ");
      const failHint = failedLayers.length > 0 ? ` | failed layers: ${failedLayers}` : "";
      yield* obs
        .info(
          `◉ [verify]     score=${(vr.overallScore ?? 0).toFixed(2)} passed=${String(vr.passed)} recommendation=${String(vr.recommendation ?? "?")}${failHint}`,
        )
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/verify-summary-log.ts:log-summary", tag: errorTag(err) })));
    } else {
      yield* obs
        .info(
          "◉ [verify]     skipped — VerificationService not in runtime (check createRuntime / .withVerification wiring)",
        )
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/verify-summary-log.ts:log-skipped", tag: errorTag(err) })));
    }
  });
};
