/**
 * COST_TRACK phase — record cost + token usage for compliance and budget tracking.
 *
 * Optional; gated by `config.enableCostTracking`. Acquires `CostService` lazily.
 * Reads `cacheHit` from `ctx.metadata.cacheHit` (set by the agent-loop when a
 * semantic-cache hit short-circuits LLM calls).
 *
 * Extracted from `execution-engine.ts:3683-3713` (Phase 8: COST_TRACK).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { CostService } from "@reactive-agents/cost";
import type { Phase } from "../phase.js";

export const costTrack: Phase = {
  name: "cost-track",

  skip: (_ctx, deps) => !deps.config.enableCostTracking,

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const costOpt = yield* Effect.serviceOption(CostService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (costOpt._tag !== "Some") return ctx;

      const cacheHit = Boolean(ctx.metadata?.["cacheHit"]);

      yield* costOpt.value
        .recordCost({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          model: String(ctx.selectedModel ?? "unknown"),
          tier: "sonnet" as const,
          inputTokens: 0,
          outputTokens: ctx.tokensUsed,
          cost: ctx.cost,
          cachedHit: cacheHit,
          taskType: deps.task.type,
          latencyMs: Date.now() - ctx.startedAt.getTime(),
        })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/phases/cost-track.ts:record-cost",
              tag: errorTag(err),
            }),
          ),
        );

      return ctx;
    }),
};
