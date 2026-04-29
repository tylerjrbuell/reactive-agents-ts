import { Effect } from "effect";
import type { ModelTier, ModelCostConfig, ComplexityAnalysis } from "../types.js";
import { RoutingError } from "../errors.js";

// ─── Provider type ───

type Provider = "anthropic" | "openai" | "gemini" | "ollama" | "litellm";

// ─── Model cost configurations per provider ───
// Each provider maps haiku/sonnet/opus to its light/mid/heavy model.

const PROVIDER_CONFIGS: Record<Provider, Record<ModelTier, ModelCostConfig>> = {
  anthropic: {
    haiku: {
      tier: "haiku",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      costPer1MInput: 1.0,
      costPer1MOutput: 5.0,
      maxContext: 200_000,
      quality: 0.6,
      speedTokensPerSec: 150,
    },
    sonnet: {
      tier: "sonnet",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      costPer1MInput: 3.0,
      costPer1MOutput: 15.0,
      maxContext: 1_000_000,
      quality: 0.88,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "anthropic",
      model: "claude-opus-4-7",
      costPer1MInput: 15.0,
      costPer1MOutput: 75.0,
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
      costPer1MInput: 0.15,
      costPer1MOutput: 0.6,
      maxContext: 128_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "openai",
      model: "gpt-4o",
      costPer1MInput: 2.5,
      costPer1MOutput: 10.0,
      maxContext: 128_000,
      quality: 0.85,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "openai",
      model: "o3",
      costPer1MInput: 10.0,
      costPer1MOutput: 40.0,
      maxContext: 200_000,
      quality: 1.0,
      speedTokensPerSec: 30,
    },
  },
  gemini: {
    haiku: {
      tier: "haiku",
      provider: "gemini",
      model: "gemini-2.0-flash",
      costPer1MInput: 0.1,
      costPer1MOutput: 0.4,
      maxContext: 1_000_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "gemini",
      model: "gemini-2.5-pro",
      costPer1MInput: 1.25,
      costPer1MOutput: 10.0,
      maxContext: 1_000_000,
      quality: 0.85,
      speedTokensPerSec: 60,
    },
    opus: {
      tier: "opus",
      provider: "gemini",
      model: "gemini-2.5-pro",
      costPer1MInput: 1.25,
      costPer1MOutput: 10.0,
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
      costPer1MInput: 0,
      costPer1MOutput: 0,
      maxContext: 128_000,
      quality: 0.4,
      speedTokensPerSec: 100,
    },
    sonnet: {
      tier: "sonnet",
      provider: "ollama",
      model: "llama3.1:8b",
      costPer1MInput: 0,
      costPer1MOutput: 0,
      maxContext: 128_000,
      quality: 0.6,
      speedTokensPerSec: 60,
    },
    opus: {
      tier: "opus",
      provider: "ollama",
      model: "llama3.1:70b",
      costPer1MInput: 0,
      costPer1MOutput: 0,
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
      costPer1MInput: 0.15,
      costPer1MOutput: 0.6,
      maxContext: 128_000,
      quality: 0.5,
      speedTokensPerSec: 200,
    },
    sonnet: {
      tier: "sonnet",
      provider: "litellm",
      model: "gpt-4o",
      costPer1MInput: 2.5,
      costPer1MOutput: 10.0,
      maxContext: 128_000,
      quality: 0.85,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "litellm",
      model: "claude-opus-4-7",
      costPer1MInput: 15.0,
      costPer1MOutput: 75.0,
      maxContext: 1_000_000,
      quality: 1.0,
      speedTokensPerSec: 40,
    },
  },
};

// Backward-compatible default: Anthropic
const MODEL_CONFIGS = PROVIDER_CONFIGS.anthropic;

export const getModelCostConfig = (
  tier: ModelTier,
  provider?: Provider,
): ModelCostConfig =>
  (provider ? PROVIDER_CONFIGS[provider] : MODEL_CONFIGS)[tier];

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);

export const estimateCost = (text: string, config: ModelCostConfig): number =>
  (estimateTokens(text) / 1_000_000) * config.costPer1MInput;

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

const TIER_ORDER: readonly ModelTier[] = ["haiku", "sonnet", "opus"];

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
  Effect.try({
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

      return {
        score,
        factors,
        recommendedTier: tier,
        estimatedTokens: estimateTokens(task),
        estimatedCost: estimateCost(task, config),
      };
    },
    catch: (e) => new RoutingError({ message: "Complexity analysis failed", taskComplexity: undefined }),
  });

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
