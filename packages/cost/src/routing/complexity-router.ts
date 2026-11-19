import { Effect, Option, Either } from "effect";
import type { ModelTier, ModelCostConfig, ComplexityAnalysis, Provider } from "../types.js";
import { RoutingError } from "../errors.js";
import { EventBus } from "@reactive-agents/core";
import { priceFor } from "@reactive-agents/llm-provider";
import { JudgmentService } from "@reactive-agents/judgment";
import { buildComplexityJudgmentQuestions, buildComplexityJudgmentState, answerToTier } from "./judgment-complexity-questions.js";

// ─── Model tiers per provider ───
// Each provider maps haiku/sonnet/opus to its light/mid/heavy model. No prices
// here: getModelCostConfig reads them from the PriceBook, so routing estimates
// and billing use the same rates (audit 2026-11-19 F3: this table once priced
// claude-opus-4-7 at $15/$75 while it bills $5/$25).

type TierModel = Omit<ModelCostConfig, "costPer1MInput" | "costPer1MOutput">;

const PROVIDER_TIERS: Record<Provider, Record<ModelTier, TierModel>> = {
  anthropic: {
    haiku: {
      tier: "haiku",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      maxContext: 200_000,
      quality: 0.6,
      speedTokensPerSec: 150,
    },
    sonnet: {
      tier: "sonnet",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxContext: 1_000_000,
      quality: 0.88,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "anthropic",
      model: "claude-opus-4-7",
      maxContext: 1_000_000,
      quality: 1.0,
      speedTokensPerSec: 40,
    },
  },
  openai: {
    haiku: {
      tier: "haiku",
      provider: "openai",
      model: "gpt-4o-mini",
      maxContext: 128_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "openai",
      model: "gpt-4o",
      maxContext: 128_000,
      quality: 0.85,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "openai",
      model: "o3",
      maxContext: 200_000,
      quality: 1.0,
      speedTokensPerSec: 30,
    },
  },
  gemini: {
    haiku: {
      tier: "haiku",
      provider: "gemini",
      // gemini-2.0-flash had no PriceBook price (retired); 2.5-flash is priced.
      model: "gemini-2.5-flash",
      maxContext: 1_000_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "gemini",
      model: "gemini-2.5-pro",
      maxContext: 1_000_000,
      quality: 0.85,
      speedTokensPerSec: 60,
    },
    opus: {
      tier: "opus",
      provider: "gemini",
      model: "gemini-2.5-pro",
      maxContext: 1_000_000,
      quality: 0.9,
      speedTokensPerSec: 60,
    },
  },
  ollama: {
    haiku: {
      tier: "haiku",
      provider: "ollama",
      model: "llama3.2:3b",
      maxContext: 128_000,
      quality: 0.4,
      speedTokensPerSec: 100,
    },
    sonnet: {
      tier: "sonnet",
      provider: "ollama",
      model: "llama3.1:8b",
      maxContext: 128_000,
      quality: 0.6,
      speedTokensPerSec: 60,
    },
    opus: {
      tier: "opus",
      provider: "ollama",
      model: "llama3.1:70b",
      maxContext: 128_000,
      quality: 0.8,
      speedTokensPerSec: 20,
    },
  },
  litellm: {
    haiku: {
      tier: "haiku",
      provider: "litellm",
      model: "gpt-4o-mini",
      maxContext: 128_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "litellm",
      model: "gpt-4o",
      maxContext: 128_000,
      quality: 0.85,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "litellm",
      model: "claude-opus-4-7",
      maxContext: 1_000_000,
      quality: 1.0,
      speedTokensPerSec: 40,
    },
  },
};

/**
 * A tier's model with its prices read from the PriceBook (`priceFor` in
 * `@reactive-agents/llm-provider`), the one price source the adapters bill
 * with. An unpriced model gets no price fields (unknown, not $0).
 *
 * @param tier - haiku / sonnet / opus
 * @param provider - provider whose tier table to use; default Anthropic
 */
export const getModelCostConfig = (
  tier: ModelTier,
  provider?: Provider,
): ModelCostConfig => {
  const row = PROVIDER_TIERS[provider ?? "anthropic"][tier];
  return Option.match(priceFor(row.provider, row.model), {
    onNone: () => row,
    onSome: (price) => ({ ...row, costPer1MInput: price.input, costPer1MOutput: price.output }),
  });
};

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

/**
 * Input-cost estimate in USD for `text` on `config`'s model; `undefined` when
 * the model's price is unknown.
 */
export const estimateCost = (text: string, config: ModelCostConfig): number | undefined =>
  config.costPer1MInput === undefined
    ? undefined
    : (estimateTokens(text) / 1_000_000) * config.costPer1MInput;

// ─── Heuristic Classifier ───

export const heuristicClassify = (task: string): ModelTier | null => {
  const wordCount = task.split(/\s+/).length;
  const hasCodeBlock = /```/.test(task);
  const hasMultiStep = /\b(step|then|next|finally|after|before)\b/i.test(task);
  const hasAnalysis = /\b(analyze|compare|evaluate|synthesize|critique)\b/i.test(task);

  // Simple tasks < 50 words, no code, no multi-step
  if (wordCount < 50 && !hasCodeBlock && !hasMultiStep && !hasAnalysis) {
    return "haiku";
  }

  // Complex tasks with code, multi-step, and analysis
  if (hasCodeBlock && hasMultiStep && hasAnalysis) {
    return "opus";
  }

  // Medium complexity: code or multi-step or analysis (but not all)
  if (hasCodeBlock || hasAnalysis) {
    return "sonnet";
  }

  // Default to sonnet for ambiguous cases
  return null;
};

// ─── Calibration-aware routing context ──────────────────────────────────
//
// FIX-32: previously the router picked tiers from heuristics alone — if a
// model's `toolCallReliability` was poor, the choice ignored that. Callers
// can now supply `RoutingContext` to bias routing away from unreliable
// tiers when the task needs reliable tool calls (e.g. agentic flows).
//
// The data shape is intentionally narrow (just the fields the router
// actually consumes) so the cost package doesn't pull a hard dependency on
// `@reactive-agents/reactive-intelligence` calibration types. Callers
// translate from their calibration store into this shape.

export interface RoutingContext {
  /**
   * When true, the router avoids tiers whose `calibration.toolCallReliability`
   * is below `toolReliabilityThreshold`. Defaults to false (heuristic-only).
   */
  readonly requiresTools?: boolean;
  /**
   * Per-tier calibration data. Typically translated from the framework's
   * calibration store. Tiers without an entry are treated as "unknown" and
   * the router does NOT escalate past them on unknown-data alone.
   */
  readonly calibration?: Partial<
    Record<ModelTier, { readonly toolCallReliability?: number }>
  >;
  /** Minimum acceptable toolCallReliability when requiresTools is true. Default: 0.5 */
  readonly toolReliabilityThreshold?: number;
}

export const TIER_ORDER: readonly ModelTier[] = ["haiku", "sonnet", "opus"];

/**
 * Returns true iff the given string is a provider that has a tier table in
 * PROVIDER_TIERS. Stays in sync with PROVIDER_TIERS automatically — no
 * separate hardcoded set to drift.
 */
export const isRoutableProvider = (p: string | undefined): p is Provider =>
  p !== undefined && Object.hasOwn(PROVIDER_TIERS, p);

/**
 * Walk the tier ladder from `start` upward, returning the first tier whose
 * calibration data either is missing (unknown — assume usable) or meets the
 * threshold. If every tier's calibration is below threshold, return the
 * highest-reliability tier seen. Pure function — no Effect.
 */
function escalateForToolReliability(
  start: ModelTier,
  ctx: RoutingContext,
): { tier: ModelTier; escalatedFrom?: ModelTier } {
  const threshold = ctx.toolReliabilityThreshold ?? 0.5;
  const startIdx = TIER_ORDER.indexOf(start);
  let bestTier = start;
  let bestReliability = -1;
  for (let i = startIdx; i < TIER_ORDER.length; i++) {
    const t = TIER_ORDER[i]!;
    const r = ctx.calibration?.[t]?.toolCallReliability;
    if (r === undefined) {
      // Unknown — assume usable; don't penalize a tier on missing data.
      return { tier: t, escalatedFrom: i === startIdx ? undefined : start };
    }
    if (r >= threshold) {
      return { tier: t, escalatedFrom: i === startIdx ? undefined : start };
    }
    if (r > bestReliability) {
      bestReliability = r;
      bestTier = t;
    }
  }
  // No tier met threshold — return the most-reliable tier seen.
  return { tier: bestTier, escalatedFrom: bestTier === start ? undefined : start };
}

// ─── Complexity Analysis ───

export const analyzeComplexity = (
  task: string,
  _context?: string,
  provider?: Provider,
  routingContext?: RoutingContext,
): Effect.Effect<ComplexityAnalysis, RoutingError> =>
  Effect.gen(function* () {
    const analysis = yield* Effect.try({
      try: () => {
        const heuristic = heuristicClassify(task);
        let tier = heuristic ?? "sonnet";
        const factors: string[] = ["heuristic-classification"];

        // FIX-32: when caller supplies calibration + requiresTools, escalate
        // away from tiers with poor tool-call reliability. Pure tier-ladder
        // walk; no LLM calls, no service lookup. Caller translates calibration
        // store data into the narrow shape declared in RoutingContext.
        if (routingContext?.requiresTools && routingContext?.calibration) {
          const escalated = escalateForToolReliability(tier, routingContext);
          if (escalated.escalatedFrom !== undefined) {
            factors.push(`tool-reliability-escalation:${escalated.escalatedFrom}->${escalated.tier}`);
            tier = escalated.tier;
          } else {
            factors.push("tool-reliability-confirmed");
          }
        }

        const config = getModelCostConfig(tier, provider);
        const score =
          tier === "haiku" ? 0.2 :
          tier === "sonnet" ? 0.5 : 0.9;

        if (/```/.test(task)) factors.push("contains-code");
        if (/\b(step|then|next|finally)\b/i.test(task)) factors.push("multi-step");
        if (/\b(analyze|compare|evaluate)\b/i.test(task)) factors.push("analysis-required");

        const estimatedCost = estimateCost(task, config);
        return {
          score,
          factors,
          recommendedTier: tier,
          estimatedTokens: estimateTokens(task),
          ...(estimatedCost !== undefined ? { estimatedCost } : {}),
        };
      },
      catch: (e) => new RoutingError({ message: "Complexity analysis failed", taskComplexity: undefined }),
    });

    // Task 9b (shadow-only): fire the batched judgment tier-classification
    // question via Effect.forkDaemon — never awaited, never altering
    // `analysis`. See adaptive.ts's judgmentClassifyShadow (Task 9) for the
    // identical pattern.
    yield* judgmentComplexityShadow(task, analysis.recommendedTier);

    return analysis;
  });

/**
 * Task 9b (shadow-only). Fires the batched judgment tier-classification
 * question via `Effect.forkDaemon` — never awaited, never altering `current`
 * (the tier actually recommended by the existing heuristic path above).
 * Emits `JudgmentShadow` on the event bus with an agreement verdict for later
 * analysis (Task 9b Step 4's exit gate). Backend-agnostic — works against
 * whichever `JudgmentBackend` the resolved `JudgmentService` was constructed
 * with.
 *
 * Absent `JudgmentService` or `EventBus` (no `.withJudgment()` on the
 * builder, or no observability layer) is a clean, zero-cost no-op —
 * `Effect.serviceOption` resolves `None` without adding either to this
 * function's (or `analyzeComplexity`'s) requirements.
 */
function judgmentComplexityShadow(task: string, current: ModelTier): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;
    const maybeEventBus = yield* Effect.serviceOption(EventBus);
    if (Option.isNone(maybeEventBus)) return;
    const judgment = maybeJudgment.value;
    const eventBus = maybeEventBus.value;

    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        const result = yield* judgment
          .ask({
            state: buildComplexityJudgmentState({ task }),
            questions: buildComplexityJudgmentQuestions(),
            // Observation-only (publishes JudgmentShadow, drives nothing): bounded by the shadow gate.
            priority: "shadow",
          })
          .pipe(Effect.either);

        const judged = Either.isRight(result) ? answerToTier(result.right.tier) : null;
        const confidence = Either.isRight(result)
          ? (result.right.tier.kind === "noul" ? null : result.right.tier.confidence)
          : null;

        yield* eventBus.publish({
          _tag: "JudgmentShadow",
          site: "complexity-router",
          judged,
          current,
          agreement: judged === null ? null : judged === current,
          confidence: judged === null ? null : confidence,
        });
      }),
    );
  });
}

// ─── Route to Model ───

export const routeToModel = (
  task: string,
  context?: string,
  provider?: Provider,
  routingContext?: RoutingContext,
): Effect.Effect<ModelCostConfig, RoutingError> =>
  Effect.map(analyzeComplexity(task, context, provider, routingContext), (analysis) =>
    getModelCostConfig(analysis.recommendedTier, provider),
  );
