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
    /**
     * @deprecated No effect on its own: the compress evaluator was deleted
     * (RI controller census 2026-11-06 — it could never apply). Like the other
     * controller keys it still enables the controller layer when `true`.
     */
    readonly contextCompression?: boolean;
    readonly strategySwitch?: boolean;
    readonly causalAttribution?: boolean;
  };
  readonly learning: {
    readonly skillSynthesis?: boolean;
    readonly skillDir?: string;
    /**
     * OPT-IN (default OFF/absent) — wires a real `StrategySelector`
     * implementation (`StrategySelectorServiceLive`, `./learning/strategy-selector.ts`)
     * into the composed RI layer so `packages/runtime`'s `strategy-select.ts`
     * Phase actually consults bandit-learned reward stats (written by
     * `updateArm` in `learning-engine.ts`) instead of always falling back to
     * `config.defaultStrategy`. Before this flag existed, `selectArm` was
     * dead code — the bandit recorded outcomes for a decision it never made.
     *
     * DO NOT flip `enabled` to default `true` without a cross-tier
     * ablation-warden pass first — this changes actual runtime strategy
     * selection and must clear the project's lift rule (≥3pp lift AND
     * ≤15% token overhead across ≥2 model tiers) before ever defaulting on.
     */
    readonly banditStrategySelection?: {
      readonly enabled: boolean;
      /** Candidate strategy names to select between. Defaults to the
       *  framework's core registered strategies when omitted — see
       *  `DEFAULT_BANDIT_ARM_IDS` in `./learning/strategy-selector.ts`. */
      readonly armIds?: readonly string[];
    };
  };
  readonly telemetry?: boolean | {
    readonly enabled: boolean;
    readonly endpoint?: string;
  };
  /** Show the one-time "Reactive Intelligence" telemetry banner. Defaults to
   *  `true`; set `false` to silence it without disabling telemetry itself. */
  readonly notice?: boolean;
  readonly models?: Record<string, ModelRegistryEntry>;
  /** Path to a persistent SQLite file for calibration data. Defaults to `:memory:`. */
  readonly calibrationDbPath?: string;
};

// ─── Controller Types (Phase 2) ───
//
// Every variant has a registered handler whose effect reaches the run. The RI
// controller census (2026-11-06, 966 traces) deleted the variants that never
// did: temp-adjust (inert), compress (unreachable), skill-activate (no input),
// tool-inject and stall-detect (never past threshold), harness-harm (no
// producer). Re-introduce a variant only with a handler and firing evidence.

export type ControllerDecision =
  /** Fires on entropy convergence, or near the iteration cap on a spinning run. */
  | { readonly decision: "early-stop"; readonly reason: string; readonly iterationsSaved: number }
  /** Fires on a flat, high-entropy loop the kernel already redirected (only when switching is available). */
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string; readonly confidence?: number }
  /**
   * Fires on a same-tool failure streak of 2+ batches (`toolFailureRedirectHandler`):
   * a nudge on the first fire, an early-stop when the model still calls the tool.
   * Fired 30 times across the lh-a0 + H3 traces (2026-11-06), every time as an
   * early-stop before the first-fire fix.
   */
  | { readonly decision: "tool-failure-redirect"; readonly failingTool: string; readonly streakCount: number; readonly reason: string };

/**
 * Controller output that is NOT an intervention: never dispatched, never logged
 * as a fire. The kernel observer records it as a trace event so a mechanism
 * that acted by standing down is visible (h3 verdict reads trace activity).
 *
 * `early-stop-withheld` — the near-cap early-stop branch would have fired on a
 * spinning entropy shape, but the run produced new evidence this pass (S2a,
 * spike pack 2026-11-06). Without it the stand-down left no trace, and the
 * early-stop/redirect verdict (2026-11-06) read the fix as inert.
 */
export type ControllerNotice = {
  readonly decision: "early-stop-withheld";
  readonly reason: string;
};

/** Everything the controller's `evaluate` returns. */
export type ControllerOutput = ControllerDecision | ControllerNotice;

/** True for controller output that must not reach the dispatcher. */
export const isControllerNotice = (output: ControllerOutput): output is ControllerNotice =>
  output.decision === "early-stop-withheld";

export type ReactiveControllerConfig = {
  readonly earlyStop: boolean;
  readonly strategySwitch: boolean;
  readonly earlyStopConvergenceCount?: number;
  readonly earlyStopIterationsBeforeMax?: number;
  readonly flatIterationsBeforeSwitch?: number;
};

/**
 * One tool call identified by tool name and a key-order-insensitive hash of
 * its arguments. Two calls with equal `name` and `argsKey` are the same call.
 */
export type ToolCallIdentity = {
  readonly name: string;
  readonly argsKey: string;
};

export type ControllerEvalParams = {
  readonly entropyHistory: readonly {
    readonly composite: number;
    readonly trajectory: { readonly shape: string; readonly derivative: number; readonly momentum: number };
    readonly confidence?: "high" | "medium" | "low";
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
  readonly behavioralLoopScore: number;
  readonly priorDecisionsThisRun?: readonly string[];
  /** Count of consecutive BATCHES (assistant turns) whose trailing results failed on
   *  the same tool. Computed by the kernel from state.messages (refusals skipped);
   *  parallel failures in one batch count once. */
  readonly consecutiveToolFailures?: number;
  /** Name of the tool currently on a failure streak, if any. */
  readonly failingToolName?: string;
  /**
   * Canonical-argument keys of the failed calls in the streak (same scheme as
   * {@link ToolCallIdentity.argsKey}). A pending call on `failingToolName`
   * whose key is listed is an identical retry of a failed call.
   */
  readonly failingArgsKeys?: readonly string[];
  /**
   * The tool calls the model emitted this turn that have not run yet (the
   * kernel observer evaluates after think, before act, and after act). The
   * kernel observer always supplies it: an empty array means nothing is
   * pending (after act, or after a turn with no tool calls).
   *
   * tool-failure-redirect reads it:
   * - a non-empty batch that no longer calls the failing tool is a changed
   *   approach, so there is nothing to redirect (lh-a0 baseline 2026-11-06: a
   *   batch of 4 file-writes was early-stopped after two file-read failures);
   * - after the nudge, only a pending IDENTICAL failing call (same tool, same
   *   `argsKey`) re-fires the decision, which the handler turns into an
   *   early stop. Changed arguments are what the nudge asks for (census
   *   2026-11-06: 5 of 6 inspectable post-nudge calls), and a turn with
   *   nothing pending repeats nothing (verdict 2026-11-06, run
   *   01M6RKA3KHF937NA4QV45HWMZR iterations 5-6).
   * Omitted (outer-loop synthetic callers): the first nudge behaves as
   * before; there is no escalation without a pending identical call.
   */
  readonly pendingToolCalls?: readonly ToolCallIdentity[];
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
   * Kernel-side loop evidence. The kernel's repeated-identical-failure streak
   * counter is the single trigger authority for "the agent is stuck"; this
   * evaluator only escalates a stall the kernel has already acted on.
   *
   * `redirectsIssued` is the kernel's `failureRecoveryRedirects` counter (reset
   * across strategy switches). When omitted, `evaluateStrategySwitch` fails
   * CLOSED (no switch) — a caller that has not been updated to plumb this must
   * not silently fall back to the old independent-trigger behavior, which is
   * exactly the RC-3 double-detector defect this field exists to close.
   *
   * Scope note: `failureRecoveryRedirects` only increments on unresolved TOOL
   * failure recovery (`recovery.failedUnresolved.length > 0` in
   * iterate-pass.ts / loop-resolution.ts / stall-deliverable.ts) — this
   * evaluator is therefore unreachable for thought-only loops, or for tool
   * calls that succeed but return unproductive results.
   */
  readonly kernelLoopSignal?: { readonly redirectsIssued: number };
  /**
   * False when the run cannot switch strategy (switching disabled, the
   * default, or its `maxSwitches` used up). Supplied by the kernel observer.
   * `evaluateStrategySwitch` emits no decision when it is false: the kernel
   * turns an unhonorable switch request into a `switching_exhausted` exit, so
   * a switch decision there was really a stop decision with no evidence check
   * (RI census 2026-11-06: 5 of 13 dispatches, e.g. 01M6QANRRJTJ2BGFR7Z4MWAAW6).
   * Omitted (outer-loop synthetic callers) → prior behavior.
   */
  readonly switchingAvailable?: boolean;
  /**
   * E2 (audit 02-#5 / H6 generalized) — the run's RunAssessment phase, supplied
   * by the kernel `reactive-observer` ONLY under the long-horizon profile. When
   * `"synthesize"` the run has reached the answer-composing endgame and
   * `evaluateEarlyStop` MUST NOT fire — amputating the synthesis endgame is
   * exactly the long-horizon failure the 2026-07-08 sweep found (H6 fixed the
   * overflow-guard branch via entropy shape; E2 generalizes it to ANY early-stop
   * branch via the phase). Omitted (profile off / outer-loop synthetic callers)
   * → prior behavior is byte-identical.
   */
  readonly phase?: "orient" | "gather" | "execute" | "synthesize" | "verify";
  /**
   * True when the run's latest RunAssessment shows substantive progress
   * (`evidenceDelta > 0`: a new artifact or a new substantive tool result),
   * the kernel's one progress measure. Supplied by the kernel
   * `reactive-observer` on every path.
   *
   * The overflow early-stop branch reads it: a run near its iteration cap that
   * is still producing evidence is working, not spinning, whatever its entropy
   * shape (spike pack 2026-11-06, S2a: flat entropy stopped runs at iteration
   * 13 of 14 while they wrote one new file per pass). The convergence branch
   * does not read it. Omitted (outer-loop synthetic callers) → prior behavior
   * is byte-identical.
   */
  readonly progressedThisPass?: boolean;
};

export const defaultReactiveIntelligenceConfig: ReactiveIntelligenceConfig = {
  entropy: {
    enabled: true,
    tokenEntropy: true,
    // Default OFF (2026-06-13): the semantic-entropy sensor path is currently
    // non-functional and was silently default-on. Measured breakages
    // (ollama gemma4:e4b + nomic-embed-text probe):
    //   1. LLMService is not provided into the EntropySensorService layer
    //      (sibling, not dep, under runtime.ts `Layer.mergeAll`) → `llm` is
    //      None → the embed never fires.
    //   2. `priorThought` is never populated on the score path → the
    //      `llm && priorThought` gate fails even when llm IS wired.
    //   3. The sensor hardcodes `taskEmbedding: null` and surfaces only
    //      `taskAlignment` (always 0 when taskEmbedding is null), discarding
    //      the meaningful `noveltyScore`/`adjacentRepetition` signals.
    // Re-enabling requires fixing all three + a cross-tier ablation proving
    // it improves early-stop/convergence (prior early-stop levers falsified).
    // Until then the config tells the truth: this sensor source is OFF.
    semanticEntropy: false,
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
    skillSynthesis: true,
  },
  telemetry: false,
  calibrationDbPath: "~/.reactive-agents/calibration.db",
};
