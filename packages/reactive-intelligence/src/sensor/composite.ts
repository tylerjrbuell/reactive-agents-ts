import type { EntropyScore, EntropyTrajectory } from "../types.js";
import { iterationWeight } from "./entropy-trajectory.js";

// Default weights — replaced by conformal calibration after MIN_CALIBRATION_RUNS
const WEIGHTS_WITH_LOGPROBS = {
  token: 0.30,
  structural: 0.25,
  semantic: 0.15,
  behavioral: 0.20,
  contextPressure: 0.10,
};

const WEIGHTS_WITHOUT_LOGPROBS = {
  token: 0,
  structural: 0.40,
  semantic: 0.25,
  behavioral: 0.25,
  contextPressure: 0.10,
};

// Per-category weight overrides (without logprobs — the common case for local models).
// These tune which entropy sources matter most for each task shape.
const CATEGORY_WEIGHTS: Record<string, { structural: number; semantic: number; behavioral: number; contextPressure: number }> = {
  "quick-lookup":   { structural: 0.30, semantic: 0.20, behavioral: 0.35, contextPressure: 0.15 },
  "deep-research":  { structural: 0.35, semantic: 0.30, behavioral: 0.20, contextPressure: 0.15 },
  "code-write":     { structural: 0.30, semantic: 0.35, behavioral: 0.20, contextPressure: 0.15 },
  "code-debug":     { structural: 0.30, semantic: 0.35, behavioral: 0.25, contextPressure: 0.10 },
  "data-analysis":  { structural: 0.35, semantic: 0.25, behavioral: 0.25, contextPressure: 0.15 },
  "file-operation": { structural: 0.30, semantic: 0.15, behavioral: 0.40, contextPressure: 0.15 },
  "communication":  { structural: 0.25, semantic: 0.20, behavioral: 0.40, contextPressure: 0.15 },
  "multi-step":     { structural: 0.30, semantic: 0.20, behavioral: 0.35, contextPressure: 0.15 },
};

type CompositeInput = {
  token: number | null;
  structural: number;
  semantic: number | null;
  behavioral: number;
  contextPressure: number;
  logprobsAvailable: boolean;
  iteration: number;
  maxIterations: number;
  trajectory?: EntropyTrajectory;
  modelTier?: "frontier" | "local" | "unknown";
  temperature?: number;
  taskCategory?: string;
};

export function computeCompositeEntropy(input: CompositeInput): EntropyScore {
  const {
    token, structural, semantic, behavioral, contextPressure,
    logprobsAvailable, iteration, maxIterations,
    trajectory, modelTier = "unknown", temperature, taskCategory,
  } = input;

  // Short-run bypass: ≤2 iterations doesn't have enough data points for meaningful
  // trajectory analysis. Compute a real weighted composite from available sources
  // but mark confidence as "low" so decision-makers (stall-detect) know the
  // signal is preliminary. Previously hardcoded composite to 0.15 with "high"
  // confidence — stall-detect's local-tier window=2 evaluated entirely on that
  // synthetic value, and Grade B "stalled" messages were misleading on 1-2
  // iteration runs that completed successfully.
  if (iteration <= 2) {
    const iWeight = iterationWeight(iteration, maxIterations);
    const defaultTrajectory: EntropyTrajectory = {
      history: [], derivative: 0, momentum: 0.15, shape: "flat",
    };
    // Compute a real composite from available sources rather than hardcoding
    const shortRunWeights = logprobsAvailable
      ? { ...WEIGHTS_WITH_LOGPROBS }
      : { ...WEIGHTS_WITHOUT_LOGPROBS };
    if (semantic === null) {
      const redistribution = shortRunWeights.semantic;
      shortRunWeights.semantic = 0;
      shortRunWeights.structural += redistribution * 0.5;
      shortRunWeights.behavioral += redistribution * 0.5;
    }
    const shortRunComposite = Math.max(0, Math.min(1,
      (token ?? 0) * shortRunWeights.token +
      structural * shortRunWeights.structural +
      (semantic ?? 0) * shortRunWeights.semantic +
      behavioral * shortRunWeights.behavioral +
      contextPressure * shortRunWeights.contextPressure,
    ));
    return {
      composite: shortRunComposite,
      sources: {
        token: token,
        structural,
        semantic: semantic,
        behavioral,
        contextPressure,
      },
      trajectory: trajectory ?? defaultTrajectory,
      confidence: "low" as const,
      modelTier,
      iteration,
      iterationWeight: iWeight,
      timestamp: Date.now(),
    };
  }

  // Start from per-category overrides when available, otherwise use defaults
  const categoryOverride = taskCategory ? CATEGORY_WEIGHTS[taskCategory] : undefined;
  const weights = logprobsAvailable
    ? { ...WEIGHTS_WITH_LOGPROBS }
    : categoryOverride
      ? { token: 0, ...categoryOverride }
      : { ...WEIGHTS_WITHOUT_LOGPROBS };

  // Temperature 0 discount for token entropy
  if (logprobsAvailable && temperature === 0) {
    weights.token = 0.15;
    // Redistribute to structural
    weights.structural += 0.15;
  }

  // If semantic unavailable, redistribute its weight
  if (semantic === null) {
    const redistribution = weights.semantic;
    weights.semantic = 0;
    weights.structural += redistribution * 0.5;
    weights.behavioral += redistribution * 0.5;
  }

  // Compute weighted sum
  const composite =
    (token ?? 0) * weights.token +
    structural * weights.structural +
    (semantic ?? 0) * weights.semantic +
    behavioral * weights.behavioral +
    contextPressure * weights.contextPressure;

  // Determine confidence tier
  const sourcesPresent =
    (token !== null ? 1 : 0) +
    1 + // structural always present
    (semantic !== null ? 1 : 0) +
    1; // behavioral always present

  const confidence: "high" | "medium" | "low" =
    sourcesPresent >= 4 ? "high" :
    sourcesPresent >= 3 ? "medium" : "low";

  const iWeight = iterationWeight(iteration, maxIterations);

  const defaultTrajectory: EntropyTrajectory = {
    history: [], derivative: 0, momentum: composite, shape: "flat",
  };

  return {
    composite: Math.max(0, Math.min(1, composite)),
    sources: {
      token: token,
      structural,
      semantic: semantic,
      behavioral,
      contextPressure,
    },
    trajectory: trajectory ?? defaultTrajectory,
    confidence,
    modelTier,
    iteration,
    iterationWeight: iWeight,
    timestamp: Date.now(),
  };
}
