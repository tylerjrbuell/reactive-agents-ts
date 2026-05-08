/**
 * Semantic cache check — runs before reasoning. On hit, short-circuits the
 * agent-loop: no LLM call, no tool dispatch.
 *
 * Decision logic:
 *   - If `config.enableCostTracking === false`: no-op (cache disabled)
 *   - If `CostService` not wired: no-op (returns ctx + cacheHit: false)
 *   - If `CostService.checkCache(query)` returns a cached value:
 *     * Update ctx.metadata to mark complete with cached response
 *     * Set ctx.metadata.cacheHit = true (read by cost-track phase)
 *     * Log "[cache] HIT — skipping reasoning"
 *     * Return cacheHit: true to caller
 *
 * The agent-loop's caller checks the returned `cacheHit` flag and skips the
 * reasoning call entirely on hit. The cost-track phase (extracted earlier)
 * reads `ctx.metadata.cacheHit` from the marker set here.
 *
 * Behavior locked in by `tests/semantic-cache-hit.test.ts` (W23 step 1):
 * cache hit → LLM count stays 0, cost-track records `cachedHit: true`.
 *
 * Extracted from `execution-engine.ts:982-1014` (W23 step 5).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { CostService } from "@reactive-agents/cost";
import { extractTaskText } from "../../util.js";
import type { ReactiveAgentsConfig, ExecutionContext } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import type { Task } from "@reactive-agents/core";

export interface CacheCheckResult {
  /** Updated ctx (on hit, ctx.metadata is populated with the cached response). */
  readonly ctx: ExecutionContext;
  /** True if cache returned a value — caller skips reasoning when true. */
  readonly cacheHit: boolean;
}

export interface CacheCheckParams {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly ctx: ExecutionContext;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
}

export const checkSemanticCache = (
  params: CacheCheckParams,
): Effect.Effect<CacheCheckResult, never> =>
  Effect.gen(function* () {
    const { config, task, ctx, obs, isNormal } = params;

    if (!config.enableCostTracking) {
      return { ctx, cacheHit: false };
    }

    const costOpt = yield* Effect.serviceOption(CostService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );

    if (costOpt._tag !== "Some") {
      return { ctx, cacheHit: false };
    }

    const taskText = extractTaskText(task.input);
    const cached = yield* costOpt.value.checkCache(taskText).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );

    if (cached === null) {
      return { ctx, cacheHit: false };
    }

    // Cache hit — populate ctx.metadata + log + return cacheHit: true
    const updatedCtx: ExecutionContext = {
      ...ctx,
      metadata: {
        ...ctx.metadata,
        lastResponse: cached,
        isComplete: true,
        cacheHit: true,
        stepsCount: 0,
        reasoningSteps: [],
        reasoningResult: {
          output: cached,
          status: "completed",
          metadata: { cost: 0, tokensUsed: 0, stepsCount: 0 },
        },
      },
    };

    if (obs && isNormal) {
      yield* obs
        .info("◉ [cache]      HIT — skipping reasoning")
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/phases/agent-loop/cache-check.ts:hit-log",
              tag: errorTag(err),
            }),
          ),
        );
    }

    return { ctx: updatedCtx, cacheHit: true };
  });
