/**
 * decide/termination-types.ts — the oracle's shared structural vocabulary.
 *
 * Moved verbatim from `arbitrator.ts` (GH #220 / quality program Task 7) so
 * the Arbitrator's authority block can stay focused on the terminal decision
 * itself. Every name here is still re-exported from `arbitrator.ts`; existing
 * import paths are unchanged.
 *
 * These mirror shapes from @reactive-agents/reactive-intelligence without
 * creating a cross-package dependency (see the original note in arbitrator.ts).
 */

import type { ReasoningStep } from "../../../types/index.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

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
  /**
   * A2 — long-horizon veto window: only the last N `controllerDecisionLog`
   * entries count toward controllerSignalVetoEvaluator's stall/inject
   * thresholds. Absent → run-cumulative (today's behavior).
   */
  readonly vetoDecisionWindow?: number;
  /**
   * E2 (audit 02-#2 / #5) — the run's RunAssessment phase, surfaced ONLY under
   * the long-horizon profile (absent off the profile → byte-identical). When
   * `"synthesize"` the controller veto stands down: the run has reached the
   * synthesis endgame and confiscating a finishing run's success on stale
   * tactical churn is exactly the veto-at-finish-line misfire.
   */
  readonly assessmentPhase?: import("../../assessment/assess.js").RunPhase;
  /**
   * A2 — grounding/coverage redirect budget for the terminal gate consulted by
   * llmEndTurnEvaluator (default 1 = one-shot; ≥30-iter long-horizon → 2).
   */
  readonly redirectBudget?: number;
  /**
   * B2 check 2.5 — the run's compiled RunContract (from state.meta.runContract).
   * When present, the terminal gate's coverage check consumes REQUIREMENT
   * satisfaction (verify against `steps`) instead of the tool-name diff. Absent
   * → today's tool-name coverage (byte-identical). Threaded by think.ts from
   * state.meta.runContract.
   */
  readonly runContract?: import("../../contract/run-contract.js").RunContract;
  /**
   * The run-scoped RunLedger (from `state.ledger`), threaded by think.ts. Passed
   * into the terminal gate's coverage `verify()` so a DELEGATED write — which
   * lives only in the ledger, not in the parent's `steps` — can satisfy an
   * `ArtifactProduced` requirement. Absent → steps-only (prior behaviour).
   */
  readonly ledger?: import("../../ledger/run-ledger.js").RunLedger;
  /**
   * 2026-08-16 root fix — the run's scratchpad (from `state.scratchpad`),
   * threaded by think.ts. `llmEndTurnEvaluator` resolves unconsumed stored
   * evidence through it so an `end_turn` candidate answer is redirected once,
   * with the full fetched content injected, when the model has evidence in
   * hand it never read back. Absent → the evidence check is inert
   * (byte-identical for any caller that omits it).
   */
  readonly scratchpad?: ReadonlyMap<string, string>;
  /**
   * 2026-08-15 — dedicated one-shot budget for the evidence-grounding redirect,
   * separate from `redirectCount` (which grounding/coverage share). Without
   * this, a run that already spent its generic "Not done yet" redirect on an
   * UNRELATED grounding/coverage gap permanently starves the evidence check
   * for the rest of the run — measured live (gemini-2.5-flash, trace
   * 01M03XF7QQRXKPE71VT5T2C88J): an end_turn candidate with 4 unconsumed
   * scratchpad keys exited ungrounded because the evidence check never got
   * its own turn. Counted by think.ts scanning for the evidence guidance's
   * distinguishing "Before finalizing:" text, independent of the generic
   * "⚠️ Not done yet" prefix every redirect shares. Absent → treated as 0
   * (byte-identical for any caller that omits it).
   */
  readonly evidenceRedirectCount?: number;
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
