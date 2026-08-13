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
import { CostService, type ModelTier } from "@reactive-agents/cost";
import type { Phase } from "../phase.js";
import { resolveModelName } from "../util.js";

// Coarse haiku/sonnet/opus classification for cost tracking's `tier` field.
// `ModelTier` is Anthropic-shaped (haiku/sonnet/opus) but applied across every
// provider as a rough cheap/mid/expensive bucket — there is no authoritative
// model->tier table for arbitrary provider model strings (PROVIDER_CONFIGS in
// @reactive-agents/cost only maps a handful of named example models per tier,
// not real-world strings like "gemma4:12b"). This is a best-effort heuristic
// on the model name, not an exact classification; "sonnet" is the fallback
// for anything it can't read a size signal from, matching prior behavior for
// the genuinely-unknown case while fixing the case where a real signal exists.
export function classifyTier(model: string): ModelTier {
  const m = model.toLowerCase();
  if (/\b(haiku|mini|nano|flash-lite|[1-3]b)\b/.test(m)) return "haiku";
  if (/\b(opus|[4-9]\d+b|\d{3,}b)\b/.test(m)) return "opus";
  return "sonnet";
}

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
      const model = resolveModelName(ctx, deps.config);
      const inputTokens =
        typeof ctx.metadata?.["inputTokens"] === "number" ? ctx.metadata["inputTokens"] : 0;

      yield* costOpt.value
        .recordCost({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          model,
          tier: classifyTier(model),
          inputTokens,
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
