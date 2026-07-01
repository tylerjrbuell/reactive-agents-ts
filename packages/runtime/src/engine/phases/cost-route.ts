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
 *
 * IMPORTANT — belt-and-suspenders guard in run():
 * `runGuardedPhase` (called by `pre-loop-dispatch.ts`) does NOT check `phase.skip`
 * before invoking `phase.run`. The `skip` predicate is only honoured by `runPipeline`.
 * To prevent the run body from executing when model routing is disabled, the first
 * line of `run()` also checks `!deps.config.modelRouting` and returns the fallback
 * immediately. This makes the phase safe regardless of the call site.
 *
 * IMPORTANT — advisory selectCapableModel:
 * `selectCapableModel` maps to a `PROVIDER_CONFIGS` record keyed by known providers
 * ("anthropic" | "openai" | "gemini" | "ollama" | "litellm"). Unknown providers
 * (e.g. the deterministic "test" provider used in unit tests) cause a synchronous
 * TypeError. If that TypeError escapes into `Effect.gen` as an unhandled throw it
 * becomes a defect that bypasses `Effect.catchAll`, silently kills the daemon fiber
 * in the streaming path, and leaves the stream queue without a terminal event —
 * causing every streaming test to hang until timeout. We wrap the call in
 * `Effect.try` so any provider-lookup failure degrades to `defaultModel` instead.
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
      const fallback = { ...ctx, selectedModel: deps.config.defaultModel };

      // Belt-and-suspenders: runGuardedPhase bypasses phase.skip; guard here too.
      if (!deps.config.modelRouting) return fallback;

      const provider = deps.config.provider ?? "anthropic";
      const taskText = extractTaskText(deps.task.input);
      const analysis = yield* analyzeComplexity(taskText).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!analysis) return fallback; // advisory: degrade to defaultModel

      const minTier = asTier(deps.config.modelRouting.minTier);
      const startIdx = Math.max(
        TIERS.indexOf(asTier(analysis.recommendedTier)),
        TIERS.indexOf(minTier),
      );
      const startTier = TIERS[startIdx]!;
      const estPromptTokens = Math.ceil(taskText.length / 4);

      const override = deps.config.modelRouting.tierModels?.[startTier];
      // Advisory: wrap in Effect.try so unknown providers (e.g. "test") degrade
      // gracefully instead of throwing a defect that would kill the stream daemon.
      const routed = yield* Effect.try({
        try: () => override ?? selectCapableModel(provider, startTier, estPromptTokens),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      return { ...ctx, selectedModel: routed ?? deps.config.defaultModel };
    }),
};
