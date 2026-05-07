/**
 * STRATEGY_SELECT phase — choose a reasoning strategy for the task.
 *
 * Acquires the optional `StrategySelector` service. When wired, calls
 * `select(selectionContext, memoryContext)` and uses its result; on failure or
 * absent service, falls back to `config.defaultStrategy` (or "reactive").
 *
 * Sets `ctx.selectedStrategy` for downstream phases (notably AGENT_LOOP).
 *
 * Extracted from `execution-engine.ts:1010-1036` (Phase 4: STRATEGY_SELECT).
 *
 * NOTE: Post-phase work in execution-engine.ts (tool registry fetch,
 * allowedTools mismatch warning, log line) is orchestrator-level setup and
 * stays inline.
 */
import { Effect, Context } from "effect";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

type StrategySelectorLike = {
  select: (selCtx: unknown, memCtx: unknown) => Effect.Effect<string>;
};
const StrategySelectorTag = Context.GenericTag<StrategySelectorLike>("StrategySelector");

export const strategySelect: Phase = {
  name: "strategy-select",

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const selectorOpt = yield* Effect.serviceOption(StrategySelectorTag);
      const fallback = deps.config.defaultStrategy ?? "reactive";

      const strategy =
        selectorOpt._tag === "Some"
          ? yield* selectorOpt.value
              .select(
                {
                  taskDescription: extractTaskText(deps.task.input),
                  taskType: deps.task.type,
                  complexity: 0.5,
                  urgency: 0.5,
                },
                ctx.memoryContext,
              )
              .pipe(Effect.catchAll(() => Effect.succeed(fallback)))
          : fallback;

      return { ...ctx, selectedStrategy: strategy };
    }),
};
