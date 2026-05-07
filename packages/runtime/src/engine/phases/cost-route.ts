/**
 * COST_ROUTE phase — model selection by complexity router (Anthropic only).
 *
 * Optional; gated by `config.enableCostTracking`. Acquires `CostService`
 * lazily. The router returns Anthropic-style model names (e.g. `claude-haiku-*`),
 * so the routed model is only applied when `config.provider === "anthropic"`.
 * For other providers, falls back to `config.defaultModel`.
 *
 * Sets `ctx.selectedModel` for downstream phases.
 *
 * Extracted from `execution-engine.ts:1046-1081` (Phase 3: COST_ROUTE).
 */
import { Effect } from "effect";
import { CostService } from "@reactive-agents/cost";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

export const costRoute: Phase = {
  name: "cost-route",

  skip: (_ctx, deps) => !deps.config.enableCostTracking,

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const costOpt = yield* Effect.serviceOption(CostService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );

      if (costOpt._tag !== "Some") {
        return { ...ctx, selectedModel: deps.config.defaultModel };
      }

      const taskDescription = extractTaskText(deps.task.input);
      const modelConfig = yield* costOpt.value
        .routeToModel(taskDescription)
        .pipe(
          Effect.catchAll(() => Effect.succeed({ model: deps.config.defaultModel })),
        );

      const routedModel = (modelConfig as any).model as string | undefined;
      const useRoutedModel = deps.config.provider === "anthropic" && !!routedModel;

      return {
        ...ctx,
        selectedModel: useRoutedModel ? routedModel : deps.config.defaultModel,
      };
    }),
};
