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
//
// Disposition (HS-116 / Audit R3 / WS-4 Phase 2 prune — 2026-05-28):
// 9 declared variants; 5 fire in failure-corpus (✅ ACTIVE), 4 have
// evaluators+handlers but no corpus-confirmed firing (🟡 UNFIRED — corpus
// expansion follow-up). The 4 prior handler-less variants
// (prompt-switch / memory-boost / skill-reinject / human-escalate) were
// pruned per master plan §3.6 RC-3 + anti-mission #6 — evaluators existed
// but no handlers were registered, so the dispatcher rejected them with
// `no-handler`. Re-introduce only when a real dispatch handler ships
// alongside the variant (anti-scaffold discipline, North Star §9).

export type ControllerDecision =
  /** ✅ ACTIVE — fires on entropy convergence / iteration budget low. */
  | { readonly decision: "early-stop"; readonly reason: string; readonly iterationsSaved: number }
  /**
   * @experimental 🟡 UNFIRED — handler registered (`contextCompressHandler`,
   * see handlers/index.ts:4) but no corpus-confirmed firing. Corpus
   * expansion needed before promotion.
   */
  | { readonly decision: "compress"; readonly sections: readonly string[]; readonly estimatedSavings: number }
  /** ✅ ACTIVE — fires on stagnant strategy / repeated failure. */
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string }
  /**
   * @experimental 🟡 UNFIRED — handler registered (`tempAdjustHandler`).
   * Corpus expansion needed for entropy-driven temperature adjustment scenarios.
   */
  | { readonly decision: "temp-adjust"; readonly delta: number; readonly reason: string }
  /**
   * @experimental 🟡 UNFIRED — handler registered (`skillActivateHandler`).
   * Cross-session skill persistence (HS-122) needed to populate skill-match
   * scenarios in corpus.
   */
  | { readonly decision: "skill-activate"; readonly skillName: string; readonly trigger: "entropy-match" | "task-match"; readonly confidence: string }
  /** ✅ ACTIVE — fires on detected missing required tool / capability gap. */
  | { readonly decision: "tool-inject"; readonly toolName: string; readonly reason: string }
  /**
   * @experimental 🟡 UNFIRED — handler registered (`toolFailureRedirectHandler`).
   * Corpus needs scenarios with repeated tool failures (≥N attempts on same
   * tool with consistent error).
   */
  | { readonly decision: "tool-failure-redirect"; readonly failingTool: string; readonly streakCount: number; readonly reason: string }
  /** ✅ ACTIVE — fires on N consecutive non-progressing iterations. */
  | { readonly decision: "stall-detect"; readonly reason: string; readonly stalledIterations: number }
  /**
   * @experimental 🟡 UNFIRED — handler registered (`harnessHarmDetectorHandler`).
   * Corpus needs scenarios where harness inputs (loop, guard, oracle nudge)
   * worsen agent outcome — currently no signal triggers the suspected→confirmed
   * detection chain.
   */
  | { readonly decision: "harness-harm"; readonly reason: string; readonly harmLevel: "suspected" | "confirmed" };

export type ReactiveControllerConfig = {
  readonly earlyStop: boolean;
  readonly contextCompression: boolean;
  readonly strategySwitch: boolean;
  readonly earlyStopConvergenceCount?: number;
  readonly earlyStopIterationsBeforeMax?: number;
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
  /**
   * Number of consecutive THOUGHT steps at the tail of the ledger with no
   * intervening tool ACTION/observation — i.e. how long the agent has been
   * "thinking without acting". Used by stall-detect to distinguish a genuine
   * stall (flat entropy AND no recent tool progress) from a confidently
   * low-entropy agent that is actively making distinct tool calls (rw-9
   * regression: gpt-4o-mini find→file-read was killed as "stuck"). When omitted,
   * stall-detect preserves prior behavior (no tool-progress suppression).
   */
  readonly consecutiveThoughtsWithoutAction?: number;
  /**
   * True when `state.output` is a non-empty user-facing string.
   *
   * Backstop for FM-A3 (Spurious Tool Engagement → empty-run termination):
   * RI's `early-stop` MUST NOT terminate a run that has produced no user-facing
   * output unless we're at the last allowed iteration (`iteration ≥ maxIterations - 1`).
   * Otherwise the kernel exits `done` with `state.output=null`, which the runtime
   * wraps as `status="failure", error="Reasoning failed"` — an unhelpful empty failure.
   *
   * Caller must compute from kernel state at call time. When omitted, the
   * suppression defaults to a permissive `true` (preserves prior behavior for
   * outer-loop synthetic evaluators in plan-execute / ToT that maintain their
   * own output bookkeeping).
   */
  readonly hasUserOutput?: boolean;
  /**
   * Operational model tier — drives tier-gated evaluator thresholds (e.g.
   * stall-detect's STALL_WINDOW_BY_TIER: local=2, mid=3, large=4, frontier=5).
   *
   * Caller (kernel `reactive-observer`) supplies `profile.tier`. When omitted,
   * evaluators default to `"local"` (most conservative window) so outer-loop
   * synthetic callers (plan-execute / ToT) that don't plumb tier keep prior
   * behavior. DEFECT 1 fix (2026-05-31): before this field the tier was
   * hardcoded `"local"` in stall-detect, making the per-tier table dead.
   */
  readonly tier?: "local" | "mid" | "large" | "frontier";
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
