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
  promptVariantId?: string;
  systemPromptTokens?: number;
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
  readonly telemetry?: boolean | {
    readonly enabled: boolean;
    readonly endpoint?: string;
  };
  readonly models?: Record<string, ModelRegistryEntry>;
  /** Path to a persistent SQLite file for calibration data. Defaults to `:memory:`. */
  readonly calibrationDbPath?: string;
};

// ─── Controller Types (Phase 2) ───

export type ControllerDecision =
  | { readonly decision: "early-stop"; readonly reason: string; readonly iterationsSaved: number }
  | { readonly decision: "compress"; readonly sections: readonly string[]; readonly estimatedSavings: number }
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string }
  | { readonly decision: "temp-adjust"; readonly delta: number; readonly reason: string }
  | { readonly decision: "skill-activate"; readonly skillName: string; readonly trigger: "entropy-match" | "task-match"; readonly confidence: string }
  | { readonly decision: "prompt-switch"; readonly fromVariant: string; readonly toVariant: string; readonly reason: string }
  | { readonly decision: "tool-inject"; readonly toolName: string; readonly reason: string }
  | { readonly decision: "tool-failure-redirect"; readonly failingTool: string; readonly streakCount: number; readonly reason: string }
  | { readonly decision: "memory-boost"; readonly from: "recent" | "keyword"; readonly to: "semantic"; readonly reason: string }
  | { readonly decision: "skill-reinject"; readonly skillName: string; readonly reason: string }
  | { readonly decision: "human-escalate"; readonly reason: string; readonly decisionsExhausted: readonly string[] }
  | { readonly decision: "stall-detect"; readonly reason: string; readonly stalledIterations: number }
  | { readonly decision: "harness-harm"; readonly reason: string; readonly harmLevel: "suspected" | "confirmed" };

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
  // NEW fields for 7 new evaluators:
  readonly currentTemperature?: number;
  readonly availableSkills?: readonly { name: string; confidence: "tentative" | "trusted" | "expert"; taskCategories: readonly string[] }[];
  readonly activeSkillNames?: readonly string[];
  readonly availableToolNames?: readonly string[];
  readonly activePromptVariantId?: string;
  readonly activeRetrievalMode?: "recent" | "keyword" | "semantic";
  readonly priorDecisionsThisRun?: readonly string[];
  readonly contextHasSkillContent?: boolean;
  /** Count of consecutive failures of the same tool at the end of the message history.
   *  Computed from state.messages role==="tool_result" isError===true streak. */
  readonly consecutiveToolFailures?: number;
  /** Name of the tool currently on a failure streak, if any. */
  readonly failingToolName?: string;
};

export const defaultReactiveIntelligenceConfig: ReactiveIntelligenceConfig = {
  entropy: {
    enabled: true,
    tokenEntropy: true,
    semanticEntropy: true,
    trajectoryTracking: true,
  },
  controller: {
    earlyStop: true,
    branching: false,
    contextCompression: true,
    strategySwitch: true,
    causalAttribution: false,
  },
  learning: {
    banditSelection: true,
    skillSynthesis: true,
  },
  telemetry: false,
  calibrationDbPath: "~/.reactive-agents/calibration.db",
};
