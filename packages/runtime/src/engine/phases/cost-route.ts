/**
 * COST_ROUTE phase — provider-agnostic model selection by complexity + capability rail.
 *
 * Gated by `config.modelRouting` (absent = off, zero overhead). When enabled, the
 * phase picks the cheapest model whose context window covers the estimated prompt,
 * starting from the complexity-recommended tier for the configured provider.
 *
 * Routing is ADVISORY: any error from `analyzeComplexity` or the capability rail
 * degrades gracefully to `config.defaultModel`; the phase never fails a run.
 *
 * Sets `ctx.selectedModel` for downstream phases.
 */
import { Effect } from "effect";
import { analyzeComplexity, selectCapableModel } from "@reactive-agents/cost";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

const TIERS = ["haiku", "sonnet", "opus"] as const;
type Tier = (typeof TIERS)[number];
const asTier = (t: unknown): Tier => (TIERS.includes(t as Tier) ? (t as Tier) : "haiku");

export const costRoute: Phase = {
  name: "cost-route",
  skip: (_ctx, deps) => !deps.config.modelRouting,
  run: (ctx, deps) =>
    Effect.gen(function* () {
      const provider = deps.config.provider ?? "anthropic";
      const fallback = { ...ctx, selectedModel: deps.config.defaultModel };

      const taskText = extractTaskText(deps.task.input);
      const analysis = yield* analyzeComplexity(taskText).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!analysis) return fallback; // advisory: degrade to defaultModel

      const minTier = asTier(deps.config.modelRouting?.minTier);
      const startIdx = Math.max(
        TIERS.indexOf(asTier(analysis.recommendedTier)),
        TIERS.indexOf(minTier),
      );
      const startTier = TIERS[startIdx]!;
      const estPromptTokens = Math.ceil(taskText.length / 4);

      const override = deps.config.modelRouting?.tierModels?.[startTier];
      const routed = override ?? selectCapableModel(provider, startTier, estPromptTokens);
      return { ...ctx, selectedModel: routed ?? deps.config.defaultModel };
    }),
};
