/**
 * decide/arbitration-types.ts — the Arbitrator's typed I/O contract.
 *
 * TerminationIntent (what each phase emits), Verdict (what the Arbitrator
 * returns), and ArbitrationContext (the run-wide signals it consults). Moved
 * verbatim from `arbitrator.ts` (GH #220 / quality program Task 7); all three
 * names are still re-exported from `arbitrator.ts`. The resolution logic that
 * consumes them (arbitrate / arbitrateInner) deliberately STAYS in
 * `arbitrator.ts` — one owner, one decision site (Sprint 3.3, closes G-5).
 */

import type { ReasoningStep } from "../../../types/index.js";
import type { RawTerminatedBy } from "../../loop/terminate-reason.js";
import type { BudgetSignal } from "./budget-signal.js";
import type { TerminationDecision } from "./termination-types.js";

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
      readonly terminatedBy: RawTerminatedBy;
    }
  | {
      readonly action: "exit-failure";
      readonly error: string;
      readonly terminatedBy: RawTerminatedBy;
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
  /**
   * The run-scoped RunLedger. Carries facts `steps` structurally cannot: a
   * sub-agent's tool calls and artifacts, merged under `sub-agent:<name>`
   * (Wave C.2 slice 2). Read by the post-condition gate so a DELEGATED
   * deliverable counts as produced. Populated once, in
   * `arbitrationContextFromState`, so no call site can forget it.
   */
  readonly ledger?: import("../../ledger/run-ledger.js").RunLedger;
  /**
   * W4.3 — the run's compiled RunContract (from `state.meta.runContract`), so the
   * controller-early-stop branch can consult terminal-gate COVERAGE exactly like
   * every other exit (a flat-trajectory early-stop must not preempt an
   * unsatisfied contract). Absent → the coverage consult is skipped.
   */
  readonly runContract?: import("../../contract/run-contract.js").RunContract;
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  /** Run-wide controller decision history (state.controllerDecisionLog). */
  readonly controllerDecisionLog?: readonly string[];
  /**
   * A2 — long-horizon veto window: only the last N decision-log entries count
   * toward the stall/inject veto thresholds. Absent → run-cumulative (today).
   */
  readonly vetoDecisionWindow?: number;
  /**
   * E2 (audit 02-#2 / #5) — the run's RunAssessment phase, surfaced ONLY under
   * the long-horizon profile. `"synthesize"` ⇒ `shouldVetoSuccess` stands down
   * (kills the veto-at-finish-line misfire). Absent off the profile →
   * byte-identical.
   */
  readonly assessmentPhase?: import("../../assessment/assess.js").RunPhase;
  /**
   * A2 — grounding/coverage redirect budget for the terminal gate (default 1).
   * Absent → one-shot (today). ≥30-iter long-horizon runs raise it to 2.
   */
  readonly redirectBudget?: number;
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
  /**
   * Budget signal — derived from state.tokens / state.cost vs declared
   * BudgetLimits. Issue #128 / North Star v5.0 Pillar 6. When
   * `budget.status === "exceeded"`, the Arbitrator's pre-intent guard
   * returns exit-failure with terminatedBy="budget_exceeded" dominating
   * every intent.kind branch. Absent when no limits are declared — the
   * pre-guard becomes a no-op (backward-compatible).
   */
  readonly budget?: BudgetSignal;
  /**
   * F1 — grounded-terminal invariant (2026-07-02). Mirror of
   * `state.meta.groundingRedirectCount`: how many times the grounded-terminal
   * gate already rejected an ungrounded terminal this run. 0/absent → the gate
   * may reject ONCE; ≥1 → the next ungrounded terminal is accepted so the
   * runner's forced-abstention path (§7.5) can convert it to "abstained".
   */
  readonly groundingRedirectCount?: number;
  /**
   * PostCondition spine — the run's state-grounded success conditions, derived
   * ONCE at kernel-start and stored on `state.meta.postConditions`. Surfaced
   * here by `arbitrationContextFromState` so the steer gate reads the SAME set
   * the terminal gate (`kernel/loop/terminate.ts`) reads — no double-derivation
   * divergence. When absent (direct callers / pre-stored runs),
   * `applyPostConditionGate` falls back to deriving from `task` + `requiredTools`.
   */
  readonly postConditions?: readonly import("../verify/post-conditions.js").PostCondition[];
}
