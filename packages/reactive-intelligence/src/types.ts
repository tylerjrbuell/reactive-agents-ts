import { Schema } from "effect";

// ─── Token Logprob (mirrors upstream addition to llm-provider) ───

export type TokenLogprob = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};

// ─── 1A: Token Entropy ───

export type TokenEntropy = {
  readonly tokenEntropies: readonly number[];
  readonly sequenceEntropy: number;
  readonly toolCallEntropy: number;
  readonly peakEntropy: number;
  readonly entropySpikes: readonly { position: number; value: number }[];
};

// ─── 1B: Structural Entropy ───

export type StructuralEntropy = {
  readonly formatCompliance: number;
  readonly orderIntegrity: number;
  readonly thoughtDensity: number;
  readonly vocabularyDiversity: number;
  readonly hedgeScore: number;
  readonly jsonParseScore: number;
};

// ─── 1C: Semantic Entropy ───

export type SemanticEntropy = {
  readonly taskAlignment: number;
  readonly noveltyScore: number;
  readonly adjacentRepetition: number;
  readonly available: boolean;
};

// ─── 1D: Behavioral Entropy ───

export type BehavioralEntropy = {
  readonly toolSuccessRate: number;
  readonly actionDiversity: number;
  readonly loopDetectionScore: number;
  readonly completionApproach: number;
};

// ─── 1E: Context Pressure ───

export type ContextSection = {
  readonly label: string;
  readonly tokenEstimate: number;
  readonly signalDensity: number;
  readonly position: "near" | "mid" | "far";
};

export type ContextPressure = {
  readonly utilizationPct: number;
  readonly sections: readonly ContextSection[];
  readonly atRiskSections: readonly string[];
  readonly compressionHeadroom: number;
};

// ─── 1F: Entropy Trajectory ───

export type EntropyTrajectoryShape =
  | "converging"
  | "flat"
  | "diverging"
  | "v-recovery"
  | "oscillating";

export type EntropyTrajectory = {
  readonly history: readonly number[];
  readonly derivative: number;
  readonly momentum: number;
  readonly shape: EntropyTrajectoryShape;
};

// ─── Composite Entropy Score ───

export type EntropyScore = {
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: EntropyTrajectory;
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iteration: number;
  readonly iterationWeight: number;
  readonly timestamp: number;
  readonly tokenEntropies?: readonly number[];
  readonly entropySpikes?: readonly { position: number; value: number }[];
};

// ─── Model Calibration ───

export type ModelCalibration = {
  readonly modelId: string;
  readonly calibrationScores: readonly number[];
  readonly sampleCount: number;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
  readonly calibrated: boolean;
  readonly lastUpdated: number;
  readonly driftDetected: boolean;
};

// ─── Entropy Meta (typed sub-object for KernelState.meta) ───

export type EntropyMeta = {
  taskDescription?: string;
  modelId?: string;
  temperature?: number;
  lastLogprobs?: readonly TokenLogprob[];
  entropyHistory?: EntropyScore[];
  thoughtEmbeddings?: { embeddings: number[][]; centroid: number[] };
};

// ─── Model Registry Entry ───

export type ModelRegistryEntry = {
  readonly contextLimit: number;
  readonly tier: "frontier" | "local" | "unknown";
  readonly logprobSupport: boolean;
};

// ─── Reactive Intelligence Config ───

export type ReactiveIntelligenceConfig = {
  readonly entropy: {
    readonly enabled: boolean;
    readonly tokenEntropy?: boolean;
    readonly semanticEntropy?: boolean;
    readonly trajectoryTracking?: boolean;
  };
  readonly controller: {
    readonly earlyStop?: boolean;
    readonly branching?: boolean;
    readonly contextCompression?: boolean;
    readonly strategySwitch?: boolean;
    readonly causalAttribution?: boolean;
  };
  readonly learning: {
    readonly banditSelection?: boolean;
    readonly skillSynthesis?: boolean;
    readonly skillDir?: string;
  };
  readonly models?: Record<string, ModelRegistryEntry>;
};

// ─── Controller Types (Phase 2) ───

export type ControllerDecision =
  | { readonly decision: "early-stop"; readonly reason: string; readonly iterationsSaved: number }
  | { readonly decision: "compress"; readonly sections: readonly string[]; readonly estimatedSavings: number }
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string };

export type ReactiveControllerConfig = {
  readonly earlyStop: boolean;
  readonly contextCompression: boolean;
  readonly strategySwitch: boolean;
  readonly earlyStopConvergenceCount?: number;
  readonly flatIterationsBeforeSwitch?: number;
  readonly compressionThreshold?: number;
};

export type ControllerEvalParams = {
  readonly entropyHistory: readonly {
    readonly composite: number;
    readonly trajectory: { readonly shape: string; readonly derivative: number; readonly momentum: number };
  }[];
  readonly iteration: number;
  readonly maxIterations: number;
  readonly strategy: string;
  readonly calibration: {
    readonly highEntropyThreshold: number;
    readonly convergenceThreshold: number;
    readonly calibrated: boolean;
    readonly sampleCount: number;
  };
  readonly config: ReactiveControllerConfig;
  readonly contextPressure: number;
  readonly behavioralLoopScore: number;
};

export const defaultReactiveIntelligenceConfig: ReactiveIntelligenceConfig = {
  entropy: {
    enabled: true,
    tokenEntropy: true,
    semanticEntropy: true,
    trajectoryTracking: true,
  },
  controller: {
    earlyStop: false,
    branching: false,
    contextCompression: false,
    strategySwitch: false,
    causalAttribution: false,
  },
  learning: {
    banditSelection: false,
    skillSynthesis: false,
  },
};
