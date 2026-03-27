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
};

export function computeCompositeEntropy(input: CompositeInput): EntropyScore {
  const {
    token, structural, semantic, behavioral, contextPressure,
    logprobsAvailable, iteration, maxIterations,
    trajectory, modelTier = "unknown", temperature,
  } = input;

  // Short-run bypass: ≤2 iterations doesn't have enough data points for meaningful
  // trajectory analysis — treat the run as clean completion to avoid false "stalled" grades.
  if (iteration <= 2) {
    const iWeight = iterationWeight(iteration, maxIterations);
    const defaultTrajectory: EntropyTrajectory = {
      history: [], derivative: 0, momentum: 0.15, shape: "flat",
    };
    return {
      composite: 0.15,
      sources: {
        token: token,
        structural,
        semantic: semantic,
        behavioral,
        contextPressure,
      },
      trajectory: trajectory ?? defaultTrajectory,
      confidence: "high" as const,
      modelTier,
      iteration,
      iterationWeight: iWeight,
      timestamp: Date.now(),
    };
  }

  const weights = logprobsAvailable ? { ...WEIGHTS_WITH_LOGPROBS } : { ...WEIGHTS_WITHOUT_LOGPROBS };

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
