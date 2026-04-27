/**
 * shared/termination-oracle.ts — Scored signal pipeline for ReAct kernel exit logic.
 *
 * Replaces scattered if/else exit conditions with a composable evaluator chain.
 * Each TerminationSignalEvaluator inspects TerminationContext and returns a
 * SignalVerdict (or null to abstain). The resolver aggregates verdicts with
 * short-circuit semantics for high-confidence signals.
 */

import type { ReasoningStep } from "../../../types/index.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { FINAL_ANSWER_RE, extractFinalAnswer } from "../act/tool-parsing.js";
import { META_TOOLS } from "../../state/kernel-constants.js";

// ── Local structural types ──────────────────────────────────────────────
// These mirror shapes from @reactive-agents/reactive-intelligence without
// creating a cross-package dependency. The reasoning package deliberately
// avoids depending on reactive-intelligence (see service-utils.ts).

export interface ToolRequest {
  readonly tool: string;
  readonly input: string;
}

/** Subset of ControllerDecision from reactive-intelligence. */
export interface ReactiveDecision {
  readonly decision: "early-stop" | "compress" | "switch-strategy";
  readonly reason: string;
}

/** Subset of EntropyTrajectory from reactive-intelligence. */
export interface EntropyTrajectory {
  readonly history?: readonly number[];
  readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
  readonly derivative: number;
  readonly momentum: number;
}

/** Subset of EntropyScore from reactive-intelligence (composite + trajectory). */
export interface EntropyScoreLike {
  readonly composite: number;
  readonly trajectory?: EntropyTrajectory;
}

export interface TerminationContext {
  readonly thought: string;
  readonly thinking?: string;
  readonly stopReason: string;
  readonly toolRequest: ToolRequest | null;
  readonly iteration: number;
  readonly tier?: "local" | "mid" | "large" | "frontier";
  readonly steps: readonly ReasoningStep[];
  readonly priorThought?: string;
  readonly entropy?: EntropyScoreLike;
  readonly trajectory?: EntropyTrajectory;
  readonly controllerDecisions?: readonly ReactiveDecision[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly allToolSchemas: readonly ToolSchema[];
  readonly redirectCount: number;
  readonly priorFinalAnswerAttempts: number;
  readonly taskDescription: string;
  /**
   * Run-wide accumulated controller decision strings (from
   * state.controllerDecisionLog). Each entry is "decisionType: reason".
   * Used by controllerSignalVetoEvaluator to detect pathological controller
   * activity that should override an apparent successful exit.
   */
  readonly controllerDecisionLog?: readonly string[];
}

export interface SignalVerdict {
  /**
   * "fail" (S2.5 Slice C+ / CHANGE A — Verdict-Override pattern):
   * Exit the kernel AND mark the run as failed (status="failed", success=false),
   * regardless of the agent's own success claim. Used when the controller's
   * accumulated activity (repeated tactical interventions without escalation,
   * high entropy, tool-failure streaks) contradicts the agent's exit signal.
   */
  readonly action: "exit" | "redirect" | "continue" | "fail";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly output?: string;
}

export interface TerminationSignalEvaluator {
  readonly name: string;
  readonly evaluate: (ctx: TerminationContext) => SignalVerdict | null;
}

export interface TerminationDecision {
  readonly shouldExit: boolean;
  readonly action: SignalVerdict["action"];
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;
  readonly output?: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;
}

// ── Resolver ────────────────────────────────────────────────────────────

function confidenceRank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

export function evaluateTermination(
  ctx: TerminationContext,
  evaluators: readonly TerminationSignalEvaluator[],
): TerminationDecision {
  const verdicts: Array<{ evaluator: string; verdict: SignalVerdict }> = [];

  for (const ev of evaluators) {
    const verdict = ev.evaluate(ctx);
    if (!verdict) continue;

    verdicts.push({ evaluator: ev.name, verdict });

    // Short-circuit: high-confidence FAIL veto (CHANGE A — Verdict-Override).
    // Wins over any subsequent exit/continue verdict because controller-level
    // failure detection trumps the agent's own success claim. shouldExit=true
    // so the kernel terminates this iteration; the action="fail" tells
    // think.ts to set status="failed" not status="done".
    if (verdict.action === "fail" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence exit
    if (verdict.action === "exit" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence continue (e.g., tool call pending)
    if (verdict.action === "continue" && verdict.confidence === "high") {
      return { shouldExit: false, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
  }

  // Failure verdicts trump exits at the same confidence band — the
  // Verdict-Override pattern says: when the controller signals failure, the
  // kernel terminates as failed even if another evaluator wanted a success exit.
  const fails = verdicts
    .filter((v) => v.verdict.action === "fail")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));
  const bestFail = fails[0];
  if (bestFail) {
    return {
      shouldExit: true,
      ...bestFail.verdict,
      evaluator: bestFail.evaluator,
      allVerdicts: verdicts,
    };
  }

  const exits = verdicts
    .filter((v) => v.verdict.action === "exit")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));
  const redirects = verdicts
    .filter((v) => v.verdict.action === "redirect")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));

  const bestExit = exits[0];
  const bestRedirect = redirects[0];

  if (bestExit && bestRedirect) {
    if (confidenceRank(bestExit.verdict.confidence) >= confidenceRank(bestRedirect.verdict.confidence)) {
      return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
    }
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }
  if (bestExit) {
    return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
  }
  if (bestRedirect) {
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }

  return {
    shouldExit: false,
    action: "continue",
    confidence: "low",
    reason: "no_exit_signal",
    evaluator: "none",
    allVerdicts: verdicts,
  };
}

// ── Levenshtein Utility ──────────────────────────────────────────────────────

/** Normalized Levenshtein similarity (0-1, 1 = identical). No external dependencies. */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i]![j] = j; continue; }
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - matrix[a.length]![b.length]! / maxLen;
}

// ── Tier-aware threshold tables ────────────────────────────────────────────

/** Entropy derivative thresholds per tier (more negative = stricter). */
const ENTROPY_CONVERGENCE_THRESHOLDS: Record<string, number> = {
  local: -0.03,
  mid: -0.05,
  large: -0.07,
  frontier: -0.15,
};

/** Content similarity thresholds per tier (higher = stricter). */
const CONTENT_STABILITY_THRESHOLDS: Record<string, number> = {
  local: 0.80,
  mid: 0.85,
  large: 0.90,
  frontier: 0.95,
};

// ── Built-in Signal Evaluators ──────────────────────────────────────────────

export const pendingToolCallEvaluator: TerminationSignalEvaluator = {
  name: "PendingToolCall",
  evaluate: (ctx) => {
    if (ctx.toolRequest) return { action: "continue", confidence: "high", reason: "tool_call_pending" };
    return null;
  },
};

export const finalAnswerToolEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerTool",
  evaluate: (_ctx) => {
    // Placeholder — final-answer tool accept/reject logic stays in handleActing.
    // When handleActing accepts, it transitions to "done" directly.
    return null;
  },
};

export const entropyConvergenceEvaluator: TerminationSignalEvaluator = {
  name: "EntropyConvergence",
  evaluate: (ctx) => {
    if (!ctx.entropy || !ctx.trajectory) return null;
    if (ctx.stopReason !== "end_turn") return null;

    const threshold = ENTROPY_CONVERGENCE_THRESHOLDS[ctx.tier ?? "mid"] ?? -0.05;
    const converging = ctx.trajectory.shape === "converging" && ctx.trajectory.derivative < threshold;
    if (converging && ctx.thought.trim().length > 0) {
      return { action: "exit", confidence: "high", reason: "entropy_converged", output: ctx.thought.trim() };
    }
    return null;
  },
};

export const reactiveControllerEarlyStopEvaluator: TerminationSignalEvaluator = {
  name: "ReactiveControllerEarlyStop",
  evaluate: (ctx) => {
    if (!ctx.controllerDecisions) return null;
    const earlyStop = ctx.controllerDecisions.find((d) => d.decision === "early-stop");
    if (!earlyStop) return null;
    return { action: "exit", confidence: "high", reason: `controller_early_stop: ${earlyStop.reason}`, output: ctx.thought.trim() };
  },
};

export const contentStabilityEvaluator: TerminationSignalEvaluator = {
  name: "ContentStability",
  evaluate: (ctx) => {
    if (!ctx.priorThought || ctx.toolRequest) return null;
    const current = ctx.thought.trim();
    const prior = ctx.priorThought.trim();
    if (current.length === 0 || prior.length === 0) return null;

    if (current === prior) {
      return { action: "exit", confidence: "high", reason: "content_stable", output: current };
    }
    // Fuzzy match only for substantive content (>= 100 chars) to avoid
    // false positives on short incrementing outputs like "Step 1..." / "Step 2..."
    const stabilityThreshold = CONTENT_STABILITY_THRESHOLDS[ctx.tier ?? "mid"] ?? 0.85;
    if (current.length >= 100 && normalizedLevenshtein(current, prior) > stabilityThreshold) {
      return { action: "exit", confidence: "medium", reason: "content_stable", output: current };
    }
    return null;
  },
};

export const llmEndTurnEvaluator: TerminationSignalEvaluator = {
  name: "LLMEndTurn",
  evaluate: (ctx) => {
    if (ctx.stopReason !== "end_turn") return null;
    if (ctx.thought.trim().length === 0) return null;
    const remainingRequired = ctx.requiredTools.filter((t) => !ctx.toolsUsed.has(t));
    if (remainingRequired.length > 0) return null;
    return { action: "exit", confidence: "medium", reason: "llm_end_turn", output: ctx.thought.trim() };
  },
};

export const finalAnswerRegexEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerRegex",
  evaluate: (ctx) => {
    const thought = ctx.thought;
    const thinking = ctx.thinking ?? "";
    if (!FINAL_ANSWER_RE.test(thought) && !FINAL_ANSWER_RE.test(thinking)) return null;

    const extracted = extractFinalAnswer(thought) || extractFinalAnswer(thinking);
    if (!extracted || extracted.trim().length === 0) return null;
    return { action: "exit", confidence: "medium", reason: "final_answer_regex", output: extracted.trim() };
  },
};

export const completionGapEvaluator: TerminationSignalEvaluator = {
  name: "CompletionGap",
  evaluate: (ctx) => {
    // Completion gap logic is injected at integration time since it depends
    // on detectCompletionGaps from react-kernel.ts. This evaluator is
    // a factory target — the kernel passes a configured instance.
    // Default: no opinion.
    if (ctx.redirectCount >= 1) return null;
    return null;
  },
};

// ── controllerSignalVetoEvaluator (CHANGE A — Verdict-Override) ──────────────
//
// Why: corpus traces (2026-04-25) showed 3 of 4 labeled-failure scenarios
// terminated with success=true at iter 3-9 — well within budget. The agents
// stopped while STILL FAILING and the framework declared success because the
// only termination signal it consulted was the agent's own end_turn. Yet the
// controller had been firing tactical interventions repeatedly without ever
// escalating to switch-strategy. The veto reads that controller history and
// converts the would-be success into a correct failure.
//
// Trigger conditions (all must hold to veto):
//   1. Agent is signaling exit (stopReason === "end_turn" OR has a textual
//      thought ready to be the final answer)
//   2. controllerDecisionLog shows pathological tactical activity:
//        - ≥2 stall-detect decisions, OR
//        - ≥3 tool-inject decisions, OR
//        - high entropy (composite > 0.55) AND ≥1 stall-detect
//   3. switch-strategy NEVER fired in this run (no escalation occurred)
//
// Conservative on purpose — false vetoes (rejecting a correct success) are
// worse than missed vetoes. If success-typescript-paradigm-style runs (1
// stall-detect + recovery) start tripping the veto, raise thresholds.
//
// Pattern: Verdict-Override. The agent's self-report is one signal; the
// controller's aggregate history is another; the meta-controller produces the
// final verdict by reconciling them.
export const controllerSignalVetoEvaluator: TerminationSignalEvaluator = {
  name: "ControllerSignalVeto",
  evaluate: (ctx) => {
    const log = ctx.controllerDecisionLog ?? [];
    if (log.length === 0) return null;

    // Extract decision types — entries are formatted "decisionType: reason".
    const decisionTypes = log.map((e) => e.split(":", 1)[0]?.trim() ?? "");

    // Escalation already happened — trust the controller's own escalation path.
    const hasEscalation = decisionTypes.some((d) => d === "switch-strategy");
    if (hasEscalation) return null;

    const stallCount = decisionTypes.filter((d) => d === "stall-detect").length;
    const injectCount = decisionTypes.filter((d) => d === "tool-inject").length;
    const entropy = ctx.entropy?.composite ?? 0;

    const repeatedStall = stallCount >= 2;
    const repeatedInject = injectCount >= 3;
    const stallWithHighEntropy = stallCount >= 1 && entropy > 0.55;

    if (!repeatedStall && !repeatedInject && !stallWithHighEntropy) return null;

    // Only veto if the agent is actually trying to exit. If the kernel is
    // mid-loop and we'd just continue anyway, the veto adds no value.
    const lookingToExit =
      ctx.stopReason === "end_turn" || ctx.thought.trim().length > 0;
    if (!lookingToExit) return null;

    const reasons: string[] = [];
    if (repeatedStall) reasons.push(`${stallCount} stall-detect`);
    if (repeatedInject) reasons.push(`${injectCount} tool-inject`);
    if (stallWithHighEntropy)
      reasons.push(`stall+entropy=${entropy.toFixed(2)}`);

    return {
      action: "fail",
      confidence: "high",
      reason: `controller_signal_veto: ${reasons.join(", ")} without switch-strategy escalation`,
      // No output — the run is being marked as failed; the kernel surfaces
      // the veto reason as state.error instead.
    };
  },
};

/** Default evaluator chain — ordered for short-circuit performance.
 *  controllerSignalVeto runs FIRST so its high-confidence "fail" verdict can
 *  short-circuit before any successful-exit evaluator gets a chance to fire.
 *  finalAnswerRegex runs before llmEndTurn because it extracts a clean answer
 *  (stripping the "FINAL ANSWER:" prefix), while end_turn returns raw thought. */
export const defaultEvaluators: readonly TerminationSignalEvaluator[] = [
  pendingToolCallEvaluator,
  controllerSignalVetoEvaluator,
  finalAnswerToolEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  finalAnswerRegexEvaluator,
  llmEndTurnEvaluator,
  completionGapEvaluator,
];

// ─── Arbitrator — Sole Termination Authority (Sprint 3.3) ────────────────────
//
// The Arbitrator is the SINGLE place that decides whether the kernel
// terminates and whether termination is success or failure. Every code path
// that previously transitioned state.status="done" now flows through here.
//
// Pre-Sprint-3.3, 9 code paths set status="done" independently. CHANGE A
// (controllerSignalVeto) wired the oracle into one path, but corpus N=2
// proved that didn't move the needle — the other 8 paths bypassed the veto
// entirely. Sprint 3.3 is the structural fix: all 9 paths emit a typed
// TerminationIntent; the Arbitrator resolves intents into Verdicts; the
// loop runner applies Verdicts to state.
//
// Pattern: Sole Termination Authority — same shape as S2.5's Sole Author
// pattern for prompt assembly. One owner, typed contract, observable, no
// parallel paths.

// ─── TerminationIntent: what each phase emits ────────────────────────────────

/**
 * A typed signal a phase emits when it observes a termination-worthy event.
 * The Arbitrator resolves intents into Verdicts. Phases never decide
 * success/failure themselves.
 *
 * Each variant captures one of the 9 pre-Sprint-3.3 termination paths,
 * preserving its semantic intent. The Arbitrator may upgrade or downgrade
 * the verdict (e.g., turn an agent-final-answer into exit-failure when the
 * controller-signal veto fires).
 */
export type TerminationIntent =
  /** Agent invoked the final-answer tool (act.ts final-answer-tool path). */
  | { readonly kind: "agent-final-answer"; readonly via: "tool"; readonly output: string }
  /** Agent emitted FINAL ANSWER: prefix detected by regex. */
  | { readonly kind: "agent-final-answer"; readonly via: "regex"; readonly output: string }
  /** Agent emitted end_turn with no tool call (think.ts oracle path). */
  | { readonly kind: "agent-final-answer"; readonly via: "end-turn"; readonly output: string }
  /** Trivial-task fast path — no tools needed (think.ts:553). */
  | { readonly kind: "fast-path-completed"; readonly output: string }
  /** Loop detector observed repetition (loop-detector + think loop paths). */
  | { readonly kind: "loop-detected"; readonly output: string; readonly reason: string }
  /** Controller dispatched early-stop via reactive-observer. */
  | { readonly kind: "controller-early-stop"; readonly output: string; readonly reason: string }
  /** Kernel runner exhausted maxIterations. */
  | { readonly kind: "max-iterations"; readonly output: string }
  /** Kernel runner hit an unrecoverable LLM/runtime error. */
  | { readonly kind: "kernel-error"; readonly error: string }
  /**
   * Termination oracle returned an explicit decision (the legacy entry
   * point — preserved so think.ts:910 can keep using the existing
   * evaluateTermination chain while still flowing through the Arbitrator).
   */
  | { readonly kind: "oracle-decision"; readonly decision: TerminationDecision; readonly output: string };

// ─── Verdict: what the Arbitrator returns ────────────────────────────────────

/**
 * The Arbitrator's resolved verdict for an iteration. The loop runner
 * applies it to state.
 */
export type Verdict =
  | { readonly action: "continue" }
  | {
      readonly action: "exit-success";
      readonly output: string;
      readonly terminatedBy: string;
    }
  | {
      readonly action: "exit-failure";
      readonly error: string;
      readonly terminatedBy: string;
      readonly output?: string;
    }
  | {
      readonly action: "escalate";
      readonly nextStrategy: string;
      readonly reason: string;
    };

// ─── ArbitrationContext: the run-wide signals the Arbitrator consults ────────

/**
 * Run-wide signals the Arbitrator consults when resolving an intent.
 * Mirrors TerminationContext but framed for the intent-resolution path.
 */
export interface ArbitrationContext {
  readonly iteration: number;
  readonly maxIterations?: number;
  readonly task: string;
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  /** Run-wide controller decision history (state.controllerDecisionLog). */
  readonly controllerDecisionLog?: readonly string[];
  /** Latest entropy score, for the veto check. */
  readonly entropyComposite?: number;
  /** Verifier output for the most recent observation, if any. */
  readonly latestVerification?: { readonly verified: boolean; readonly summary: string };
  /**
   * Sprint 3.4 Scaffold 3 — synthesis-grounding retry counter. Tracks how
   * many corrective iterations have already been triggered for this run.
   * The Arbitrator escalates only when this is below the cap (default 1).
   */
  readonly synthesisRetryCount?: number;
  /**
   * Per-run scratchpad — full tool result content keyed by `_tool_result_N`.
   * The grounding check uses this to look up COMPLETE tool data when an
   * observation step's content is a compressed preview. Without this, the
   * grounding corpus only contains the preview's first ~5 items and falsely
   * rejects synthesized claims that reference items 6-N.
   */
  readonly scratchpad?: ReadonlyMap<string, string>;
}

// ─── Veto evaluator (Sprint 3.3 — uses controllerDecisionLog patterns) ───────

/**
 * Detects pathological tactical activity that should override an apparent
 * agent success.
 *
 * Critical refinement (Sprint 3.3 — corpus run 1 result):
 * controllerDecisionLog includes BOTH dispatched and suppressed
 * interventions. Suppressed interventions on success scenarios (knowledge
 * recall tasks with low entropy) were producing false-positive vetoes.
 * The differentiator between success and failure scenarios is whether the
 * agent encountered ACTUAL TOOL FAILURES — failure scenarios have
 * always-error tools that produce failed observations; success scenarios
 * (no tools or successful tools) don't.
 *
 * The veto now requires THREE conditions:
 *   1. Pathological controller activity pattern (stall/inject thresholds)
 *   2. No switch-strategy escalation
 *   3. AT LEAST ONE failed tool observation in the run's steps (concrete
 *      evidence the agent's success claim is contradicted by reality)
 *
 * This eliminates the false-veto regression on knowledge-recall successes
 * while preserving the corpus signal on real failures (which always have
 * failed tool observations).
 */
function shouldVetoSuccess(ctx: ArbitrationContext): { readonly veto: true; readonly reason: string } | { readonly veto: false } {
  const log = ctx.controllerDecisionLog ?? [];
  if (log.length === 0) return { veto: false };

  const decisionTypes = log.map((e) => e.split(":", 1)[0]?.trim() ?? "");
  if (decisionTypes.some((d) => d === "switch-strategy")) return { veto: false };

  const stallCount = decisionTypes.filter((d) => d === "stall-detect").length;
  const injectCount = decisionTypes.filter((d) => d === "tool-inject").length;
  const entropy = ctx.entropyComposite ?? 0;

  // Stall threshold bumped 2 → 3 to match the stall-detector's own
  // escalation threshold (see stall-detector.ts). Previously the stall
  // detector would emit 2 nudges and this veto would fire on observation 2,
  // killing runs while the soft nudge revision was still mid-flight.
  // High-entropy threshold lifted 1 → 2 so a single benign restatement
  // no longer pairs with momentary high entropy to fire the veto.
  const repeatedStall = stallCount >= 3;
  const repeatedInject = injectCount >= 3;
  const stallWithHighEntropy = stallCount >= 2 && entropy > 0.55;

  if (!repeatedStall && !repeatedInject && !stallWithHighEntropy) {
    return { veto: false };
  }

  // Concrete evidence: at least one observation step where a USER-FACING
  // tool returned success=false. Meta-tool rejections (final-answer
  // refused because required tools missing, recall() hitting an absent
  // key, etc.) are framework signaling, not real "the agent's claim
  // contradicts reality" evidence. Without filtering these out, ANY run
  // that calls final-answer prematurely produces a "failed observation"
  // and triggers the veto on stall threshold.
  const hasFailedToolObservation = ctx.steps.some((s) => {
    if (s.type !== "observation") return false;
    const obs = s.metadata?.observationResult;
    if (!obs || obs.success !== false) return false;
    const toolName = obs.toolName;
    // Drop meta-tool rejections — they're not concrete tool failures.
    if (typeof toolName === "string" && META_TOOLS.has(toolName)) return false;
    return true;
  });
  if (!hasFailedToolObservation) {
    return { veto: false };
  }

  const reasons: string[] = [];
  if (repeatedStall) reasons.push(`${stallCount} stall-detect`);
  if (repeatedInject) reasons.push(`${injectCount} tool-inject`);
  if (stallWithHighEntropy) reasons.push(`stall+entropy=${entropy.toFixed(2)}`);
  reasons.push("with tool-failure evidence");

  return {
    veto: true,
    reason: `controller_signal_veto: ${reasons.join(", ")} without switch-strategy escalation`,
  };
}

// ─── arbitrate(): the single decision function ───────────────────────────────

/**
 * Sprint 3.4 Scaffold 3 — synthesis-quality gate at the Arbitrator.
 *
 * For agent-final-answer intents, run the generalized grounding check on the
 * intent's output against the run's evidence corpus. When the synthesis is
 * ungrounded (or contains framework compression-marker echo) AND we haven't
 * yet retried, return an escalate("retry-with-feedback") Verdict instead of
 * exit-success. The runner consumes the escalation and runs ONE more
 * reasoning iteration with the feedback injected as guidance.
 *
 * Bounded by maxRetries (default 1) — first revision usually fixes it.
 */
function synthesisQualityRetry(
  intent: { readonly output: string },
  ctx: ArbitrationContext,
): { readonly retry: false } | { readonly retry: true; readonly feedback: string } {
  // Cap at 1 retry — bounded cost; the model's first revision is usually
  // the right one. If a second pass also fails, accept the failure outcome
  // rather than looping.
  const SYNTHESIS_RETRY_MAX = 1;
  const currentRetries = ctx.synthesisRetryCount ?? 0;
  if (currentRetries >= SYNTHESIS_RETRY_MAX) return { retry: false };

  // Build the evidence corpus from prior observations. Look up scratchpad
  // for COMPLETE content when an observation has a `storedKey` — without
  // this the corpus only contains the compressed preview's first ~5 items
  // and the grounding check falsely rejects claims about items 6-N.
  const corpus = ctx.steps
    .filter(
      (s) =>
        s.type === "observation" &&
        typeof s.content === "string" &&
        s.content.trim().length > 0,
    )
    .map((s) => {
      const storedKey = s.metadata?.storedKey as string | undefined;
      const fullFromScratchpad =
        storedKey && ctx.scratchpad ? ctx.scratchpad.get(storedKey) : undefined;
      return fullFromScratchpad ?? s.content;
    })
    .join("\n\n");

  if (corpus.length < 20) return { retry: false }; // no evidence → can't ground

  // Use lazy-require pattern to avoid runtime cycle (verify ↔ decide).
  // Since we're in the same package, a static import is fine — both modules
  // are siblings under capabilities/.
  const grounding = validateGroundingForRetry(intent.output, corpus);
  if (grounding.verified) return { retry: false };

  // Build feedback the model can act on.
  // IMPORTANT: do not include literal example strings of the bad output —
  // local models often copy quoted negative examples verbatim. Describe the
  // failure abstractly and instruct the model toward the desired shape.
  const feedback = grounding.compressionEchoDetected
    ? `Your previous answer was rejected because it described the structure of the tool result instead of synthesizing the actual values. Use the concrete fields (titles, scores, names, numbers) from the tool observations above and produce the answer the user requested. Do not describe the data — present it.`
    : `Your previous answer contained claims that don't appear in the tool observations: ${grounding.ungroundedClaims.slice(0, 5).map((c) => `"${c.slice(0, 50)}"`).join(", ")}. Please regenerate the answer citing only specific values found in the tool results above.`;

  return { retry: true, feedback };
}

// Late binding to avoid cycle ambiguity in tooling. Both files compile fine
// either way; this keeps the import block at the top tidy.
import { validateGeneralizedGrounding as validateGroundingForRetry } from "../verify/evidence-grounding.js";

/**
 * The Arbitrator's resolution function. Takes a TerminationIntent (what a
 * phase observed) and an ArbitrationContext (run-wide signals), and returns
 * exactly ONE Verdict. This is the function that closes G-5: every code path
 * that wants to terminate the kernel calls arbitrate() and applies the
 * returned Verdict.
 *
 * Resolution rules:
 * - max-iterations → always exit-failure (budget exhausted)
 * - kernel-error → always exit-failure (unrecoverable)
 * - controller-early-stop → exit-success with output (controller chose to stop)
 * - loop-detected → exit-success when output present + no veto, else exit-failure
 * - fast-path-completed → exit-success when no veto fires + synthesis grounded
 * - agent-final-answer → exit-success when no veto fires + synthesis grounded;
 *                        veto → exit-failure; ungrounded → escalate (retry once)
 * - oracle-decision → forward the oracle's verdict
 *
 * Sprint 3.4 Scaffold 3 — synthesis-grounding retry escalation:
 * agent-final-answer + ungrounded synthesis → escalate("retry-with-feedback").
 * Bounded by ctx.synthesisRetryCount (default cap: 1).
 */
export function arbitrate(intent: TerminationIntent, ctx: ArbitrationContext): Verdict {
  switch (intent.kind) {
    case "max-iterations":
      return {
        action: "exit-failure",
        error: `Maximum iterations (${ctx.maxIterations ?? "?"}) exceeded`,
        terminatedBy: "max_iterations",
        output: intent.output,
      };

    case "kernel-error":
      return {
        action: "exit-failure",
        error: intent.error,
        terminatedBy: "kernel_error",
      };

    case "controller-early-stop": {
      // Controller chose to stop. The DISPATCH itself is trustworthy, but
      // the OUTCOME interpretation depends on whether the run was healthy.
      // If tool-failure evidence + pathological controller log are present,
      // the early-stop is "framework giving up" not "task complete" → veto.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: `controller_early_stop_with_failure_evidence: ${veto.reason}`,
          terminatedBy: "controller_signal_veto",
          output: intent.output,
        };
      }
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: `controller_early_stop:${intent.reason}`,
      };
    }

    case "loop-detected": {
      // Loop detection is a controller decision, not an agent claim. But if
      // the agent never produced output AND the controller is also showing
      // pathological signals, mark as failure.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: `loop-detected with controller veto: ${veto.reason}`,
          terminatedBy: "loop_detected_with_veto",
          output: intent.output,
        };
      }
      // Loop detection without veto → graceful exit with whatever output exists.
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: `loop_detected:${intent.reason}`,
      };
    }

    case "fast-path-completed": {
      // Trivial tasks shouldn't need controller activity. If they do, something
      // is very wrong — apply veto.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: veto.reason,
          terminatedBy: "controller_signal_veto",
        };
      }
      // Use "end_turn" — react-kernel.ts maps it to the canonical
      // terminatedBy enum value matching pre-Sprint-3.3 behavior.
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: "end_turn",
      };
    }

    case "agent-final-answer": {
      // Agent self-claimed success. Apply Verdict-Override: if controller
      // signals contradict, mark as failure.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: veto.reason,
          terminatedBy: "controller_signal_veto",
        };
      }

      // Sprint 3.4 Scaffold 3 — synthesis-grounding gate. If the answer
      // contains framework compression markers OR systematically lacks
      // claims that appear in the evidence corpus, escalate for ONE
      // corrective iteration with explicit feedback.
      const retryCheck = synthesisQualityRetry(intent, ctx);
      if (retryCheck.retry) {
        return {
          action: "escalate",
          nextStrategy: "retry-with-feedback",
          reason: retryCheck.feedback,
        };
      }

      // Preserve the existing terminatedBy strings for downstream consumers
      // (react-kernel.ts, tests, telemetry): "final_answer_tool" / "final_answer"
      // / "end_turn" — the via discriminator picks the legacy name.
      const terminatedBy =
        intent.via === "tool"
          ? "final_answer_tool"
          : intent.via === "regex"
            ? "final_answer"
            : "end_turn";
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy,
      };
    }

    case "oracle-decision": {
      // Oracle already ran the evaluator chain (including the veto evaluator).
      // Use decision.reason for terminatedBy — react-kernel.ts maps these
      // canonical reason strings ("llm_end_turn", "final_answer_regex",
      // etc.) to the public terminatedBy enum.
      if (intent.decision.action === "fail") {
        return {
          action: "exit-failure",
          error: intent.decision.reason,
          terminatedBy: "controller_signal_veto",
          output: intent.output,
        };
      }
      if (intent.decision.action === "exit") {
        // Map oracle's evaluator reasons to terminatedBy strings that
        // react-kernel.ts's existing mapping already understands. Any
        // reason starting with "content_stable" or "entropy_converged"
        // is a stability-based exit ⇒ "end_turn" downstream.
        const reason = intent.decision.reason ?? "oracle";
        const terminatedBy =
          reason === "content_stable" || reason.startsWith("entropy_converged")
            ? "llm_end_turn"
            : reason;
        return {
          action: "exit-success",
          output: intent.decision.output ?? intent.output,
          terminatedBy,
        };
      }
      // continue / redirect from the oracle
      return { action: "continue" };
    }

    default: {
      // exhaustive check
      const _exhaust: never = intent;
      void _exhaust;
      return { action: "continue" };
    }
  }
}

// ─── applyTermination(): helper to apply a Verdict to KernelState ────────────

/**
 * Imports KernelState lazily through the type-only import so this file
 * remains free of cyclic runtime dependencies. The helper mutates state via
 * transitionState (the canonical state-mutation path).
 */
import type {
  KernelState as _KernelState,
} from "../../state/kernel-state.js";
import { transitionState } from "../../state/kernel-state.js";

/**
 * Apply a Verdict to KernelState. The single helper every termination
 * site calls instead of setting state.status directly.
 *
 * Sprint 3.3 wires all 9 termination sites through this helper. After this
 * commit, a `grep "status.*\"done\""` in src/kernel/{capabilities,loop}/
 * outside arbitrator.ts should return zero matches (cf-24 pins this).
 */
export function applyTermination(
  state: _KernelState,
  verdict: Verdict,
  extraMeta?: Record<string, unknown>,
): _KernelState {
  switch (verdict.action) {
    case "continue":
      return state;
    case "exit-success":
      return transitionState(state, {
        status: "done" as const,
        output: verdict.output,
        meta: {
          ...state.meta,
          terminatedBy: verdict.terminatedBy,
          ...(extraMeta ?? {}),
        },
      });
    case "exit-failure":
      return transitionState(state, {
        status: "failed" as const,
        error: verdict.error,
        output: verdict.output ?? null,
        meta: {
          ...state.meta,
          terminatedBy: verdict.terminatedBy,
          ...(extraMeta ?? {}),
        },
      });
    case "escalate": {
      // Escalation is signaled in meta. State.status stays "thinking".
      // Sprint 3.4 Scaffold 3 — when nextStrategy === "retry-with-feedback",
      // inject feedback as pendingGuidance so think.ts surfaces it next
      // iteration AND increment the retry counter so we don't loop forever.
      // For other escalations (legacy strategy switch), preserve the
      // existing behavior.
      if (verdict.nextStrategy === "retry-with-feedback") {
        const currentRetry =
          ((state.meta as Record<string, unknown>).synthesisRetryCount as number | undefined) ?? 0;
        return transitionState(state, {
          pendingGuidance: {
            ...(state.pendingGuidance ?? { requiredToolsPending: [], loopDetected: false }),
            errorRecovery: verdict.reason, // surfaced in system prompt's Guidance section
          },
          meta: {
            ...state.meta,
            synthesisRetryCount: currentRetry + 1,
            // Don't set escalateTo for retry-with-feedback so the runner's
            // strategy-switch handler doesn't fire on this.
            ...(extraMeta ?? {}),
          },
        });
      }
      // Legacy escalate (strategy switch): keep existing semantics.
      return transitionState(state, {
        meta: {
          ...state.meta,
          escalateTo: verdict.nextStrategy,
          escalationReason: verdict.reason,
          ...(extraMeta ?? {}),
        },
      });
    }
  }
}

/**
 * Convenience: arbitrate + apply in one call. The single entry point most
 * termination sites use.
 */
export function arbitrateAndApply(
  state: _KernelState,
  intent: TerminationIntent,
  ctx: ArbitrationContext,
  extraMeta?: Record<string, unknown>,
): _KernelState {
  const verdict = arbitrate(intent, ctx);
  return applyTermination(state, verdict, extraMeta);
}

/**
 * Helper: build an ArbitrationContext from a KernelState + KernelInput-like
 * structure. Used by call sites that have state in hand.
 */
export function arbitrationContextFromState(
  state: _KernelState,
  input: { readonly task: string; readonly requiredTools?: readonly string[] },
): ArbitrationContext {
  const entropyMeta = state.meta.entropy as
    | { latestScore?: { composite?: number } }
    | undefined;
  const verifSteps = state.steps.filter(
    (s) =>
      s.type === "observation" &&
      s.metadata?.verification !== undefined,
  );
  const lastVerif = verifSteps[verifSteps.length - 1]?.metadata
    ?.verification as { verified: boolean; summary: string } | undefined;

  return {
    iteration: state.iteration,
    maxIterations: state.meta.maxIterations as number | undefined,
    task: input.task,
    steps: state.steps,
    toolsUsed: state.toolsUsed,
    requiredTools: input.requiredTools ?? [],
    controllerDecisionLog: state.controllerDecisionLog,
    entropyComposite: entropyMeta?.latestScore?.composite,
    latestVerification: lastVerif,
    // Sprint 3.4 Scaffold 3 — surface the synthesis retry counter so the
    // Arbitrator can decide whether to escalate again.
    synthesisRetryCount:
      (state.meta as Record<string, unknown>).synthesisRetryCount as number | undefined,
    // Surface scratchpad so the grounding check sees full tool data, not
    // the compressed-preview content stored on observation steps.
    scratchpad: state.scratchpad,
  };
}
