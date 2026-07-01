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
 * `selectCapableModel` maps to a `PROVIDER_CONFIGS` record keyed by known providers.
 * Unknown providers (e.g. the deterministic "test" provider used in unit tests) cause
 * a synchronous TypeError. We guard explicitly with `isRoutableProvider` (which checks
 * membership in PROVIDER_CONFIGS dynamically — stays in sync when providers are added)
 * before calling the rail so that unknown providers degrade to `defaultModel` without
 * relying on Effect.try to swallow a TypeError defect.
 */
import { Effect } from "effect";
import {
  analyzeComplexity,
  selectCapableModel,
  TIER_ORDER,
  isRoutableProvider,
} from "@reactive-agents/cost";
import type { ModelTier } from "@reactive-agents/cost";
import { extractTaskText } from "../util.js";
import type { Phase } from "../phase.js";

// Convenience narrow: TIER_ORDER imported from @reactive-agents/cost.
const asTier = (t: unknown): ModelTier =>
  (TIER_ORDER as readonly string[]).includes(t as string)
    ? (t as ModelTier)
    : "haiku";

export const costRoute: Phase = {
  name: "cost-route",
  skip: (_ctx, deps) => !deps.config.modelRouting,
  run: (ctx, deps) =>
    Effect.gen(function* () {
      const fallback = { ...ctx, selectedModel: deps.config.defaultModel };

      // Belt-and-suspenders: runGuardedPhase bypasses phase.skip; guard here too.
      if (!deps.config.modelRouting) return fallback;

      // T2: unknown providers (e.g. "test") have no tier table; degrade before
      // calling the rail so we never produce a TypeError defect.
      // isRoutableProvider is a type guard that narrows to Provider.
      if (!isRoutableProvider(deps.config.provider)) return fallback;
      const provider = deps.config.provider; // narrowed to Provider by the guard above

      const taskText = extractTaskText(deps.task.input);
      const analysis = yield* analyzeComplexity(taskText).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (!analysis) return fallback; // advisory: degrade to defaultModel

      const minTier = asTier(deps.config.modelRouting.minTier);
      const startIdx = Math.max(
        TIER_ORDER.indexOf(asTier(analysis.recommendedTier)),
        TIER_ORDER.indexOf(minTier),
      );
      const startTier = TIER_ORDER[startIdx]!;

      // F1: include system prompt in the prompt-size estimate so the window
      // check accounts for the full context, not just the task text.
      // Tool schema text is excluded: deps.tools is opaque (ServiceLike = unknown)
      // at the phase boundary and cannot be called here without a separate seam.
      const systemPromptChars = deps.config.systemPrompt?.length ?? 0;
      const estPromptTokens = Math.ceil((taskText.length + systemPromptChars) / 4);

      const tierModels = deps.config.modelRouting.tierModels;

      // Advisory: still wrap in Effect.try as a belt-and-suspenders against any
      // remaining synchronous throws from the rail (e.g. bad PROVIDER_CONFIGS entry).
      const routed = yield* Effect.try({
        // F2: pass tierModels so overrides are honoured per-tier AND still
        // window-gated inside selectCapableModel.
        try: () => selectCapableModel(provider, startTier, estPromptTokens, tierModels),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      return { ...ctx, selectedModel: routed ?? deps.config.defaultModel };
    }),
};
