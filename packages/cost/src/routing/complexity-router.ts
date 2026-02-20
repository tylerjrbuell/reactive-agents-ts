import { Effect } from "effect";
import type { ModelTier, ModelCostConfig, ComplexityAnalysis } from "../types.js";
import { RoutingError } from "../errors.js";

// ─── Model cost configurations ───

const MODEL_CONFIGS: Record<ModelTier, ModelCostConfig> = {
  haiku: {
    tier: "haiku",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    costPer1MInput: 1.0,
    costPer1MOutput: 5.0,
    maxContext: 200_000,
    quality: 0.6,
    speedTokensPerSec: 150,
  },
  sonnet: {
    tier: "sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 200_000,
    quality: 0.85,
    speedTokensPerSec: 80,
  },
  opus: {
    tier: "opus",
    provider: "anthropic",
    model: "claude-opus-4-20250514",
    costPer1MInput: 15.0,
    costPer1MOutput: 75.0,
    maxContext: 1_000_000,
    quality: 1.0,
    speedTokensPerSec: 40,
  },
};

export const getModelCostConfig = (tier: ModelTier): ModelCostConfig =>
  MODEL_CONFIGS[tier];

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

// ─── Complexity Analysis ───

export const analyzeComplexity = (
  task: string,
  _context?: string,
): Effect.Effect<ComplexityAnalysis, RoutingError> =>
  Effect.try({
    try: () => {
      const heuristic = heuristicClassify(task);
      const tier = heuristic ?? "sonnet";
      const config = getModelCostConfig(tier);

      const score =
        tier === "haiku" ? 0.2 :
        tier === "sonnet" ? 0.5 : 0.9;

      const factors: string[] = ["heuristic-classification"];
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
): Effect.Effect<ModelCostConfig, RoutingError> =>
  Effect.map(analyzeComplexity(task, context), (analysis) =>
    getModelCostConfig(analysis.recommendedTier),
  );
