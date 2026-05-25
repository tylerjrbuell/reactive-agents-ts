/**
 * Post-loop final snapshot capture.
 *
 * Extracted from execution-engine.ts (W26-A step 2). Runs once after the
 * inline agent loop exits, recording the final ctx state (strategy, tools,
 * token usage, cost) through the ObservabilityService. No-op when no
 * observability backend is wired.
 */
import { Effect } from "effect";
import { resolveCapability } from "@reactive-agents/llm-provider";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { ObsLike } from "../runtime-context.js";
import { resolveModelName } from "../util.js";

export const captureFinalSnapshot = (
  ctx: ExecutionContext,
  config: ReactiveAgentsConfig,
  obs: ObsLike | null,
): Effect.Effect<void, never> => {
  if (!obs) return Effect.void;

  return obs
    .captureSnapshot(ctx.agentId, {
      currentStrategy: ctx.selectedStrategy,
      activeTools: ctx.availableTools ?? [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: ctx.tokensUsed,
        contextWindowUsed: ctx.messages.length,
        contextWindowMax: resolveCapability(
          String(ctx.provider ?? config.provider ?? "unknown"),
          resolveModelName(ctx, config),
        ).recommendedNumCtx,
      },
      costAccumulated: ctx.cost,
    })
    .pipe(
      Effect.asVoid,
      Effect.catchAll((err) =>
        emitErrorSwallowed({
          site: "runtime/src/engine/finalize/snapshot-final.ts:captureFinalSnapshot",
          tag: errorTag(err),
        }),
      ),
    );
};
