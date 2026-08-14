/**
 * loop/terminate-reason.ts — Leaf type module for the kernel termination
 * reason surface.
 *
 * Extracted from `terminate.ts` (GH #184, cycle break) so the
 * `runner-helpers/deliverable.ts` ↔ `terminate.ts` import cycle is severed:
 * `deliverable.ts` only needed the `TerminateReason` TYPE from `terminate.ts`,
 * while `terminate.ts` needs the `commitDeliverable` RUNTIME function from
 * `deliverable.ts`. Hoisting the shared type to this dependency-free leaf lets
 * both files import the type from here without the mutual edge.
 *
 * This module imports NOTHING — keep it that way so it stays a true leaf.
 */

/**
 * Enumerable union of kernel-emitted termination reason codes (R23 surface).
 * Sources: runner.ts `terminate()` callers, arbitrator.ts `applyTermination()`
 * literal `terminatedBy` values, oracle-decision passthrough reasons, and
 * dispatcher intermediates observed on `state.meta.terminatedBy`. Templated
 * reasons (`controller_early_stop:<reason>`, `loop_detected:<reason>`) are
 * omitted — callers should prefix-match. Enforces only `TerminateOptions.reason`;
 * `Verdict.terminatedBy` in arbitrator.ts is still `string` (followup).
 */
export type TerminateReason =
  | "low_delta_guard" | "switching_exhausted" | "harness_deliverable"
  | "harness_synthesis"
  | "oracle_forced" | "loop_graceful" | "budget_exceeded" | "max_iterations"
  | "kernel_error" | "controller_signal_veto" | "loop_detected_with_veto"
  | "end_turn" | "final_answer_tool" | "final_answer" | "llm_end_turn"
  | "content_stable" | "final_answer_regex" | "entropy_converged"
  | "dispatcher-early-stop" | "dispatcher-strategy-switch"
  // User-initiated stop via the RunController checkpoint (P1 mission 2B —
  // routed through terminate() so the stop-checkpoint path stops bypassing the
  // single-owner termination + output-writer invariants).
  | "stop_requested"
  // User-initiated HARD terminate() via the RunController checkpoint (FM-5,
  // Phase 4 Task 4). Distinct from "stop_requested" so the raw
  // `state.meta.terminatedBy` channel doesn't mislabel a hard abort as a
  // graceful stop; both narrow to the same public "end_turn" terminatedBy
  // via `deriveTerminatedBy`'s whitelist (no public-surface change).
  | "terminate_requested"
  // Durable HITL (Phase D): the act capability gated a flagged tool call and
  // paused the run for human approval. A NON-FAILURE terminal reason — the
  // terminal post-condition gate passes it through (a paused run has
  // intentionally not met its post-conditions and must not be demoted to
  // `failed`). The engine detects this reason to persist `awaiting-approval`.
  | "awaiting-approval"
  // Durable pause (Task 9): the act capability intercepted a
  // `request_user_input` tool call and paused the run for a human answer.
  // Mirrors `awaiting-approval` exactly — a NON-FAILURE terminal reason;
  // Task 10 persists/resumes it via `state.meta.awaitingInteractionFor`.
  | "awaiting-interaction"
  // O3: model honestly declined — cannot ground a response or a required input
  // is unavailable. Non-failure terminal (goalAchieved=false, success=false but
  // not a crash). Task 5 (legitimacy gate) + Task 6 (forced path) extend this.
  | "abstained"
  // E3 (meta-loop Phase 5a): the pace-terminal actuator forced a final generous
  // synthesis when the run hit the terminal budget band (burnRatio ≥ 0.95),
  // pre-empting the `budget_exceeded` cliff that would DISCARD the answer (audit
  // 05-#1). A NON-FAILURE terminal reason: the terminal post-condition gate
  // passes it through (a partial-but-real answer ships instead of being nulled),
  // and `deriveTerminatedBy` narrows it to `end_turn` → honest `goalAchieved`
  // unknown (never a false success). Set only under the long-horizon profile.
  | "budget_terminal";

/**
 * The two templated reason families (Phase 3 vocabulary closure). Producers:
 * `reactiveControllerEarlyStopEvaluator` ("controller_early_stop: <reason>"),
 * the arbitrator's controller-early-stop / loop-detected intent branches, and
 * the dispatcher intermediates. Consumers prefix-match.
 */
export type TemplatedTerminateReason =
  | `controller_early_stop:${string}`
  | `loop_detected:${string}`;

/**
 * Everything a kernel Verdict may carry as `terminatedBy` — the R23 closed
 * vocabulary. `Verdict.terminatedBy` (arbitrator.ts) is constrained to this;
 * the oracle-decision passthrough site carries the one documented narrow cast
 * (evaluator reason vocabulary is closed over this union — see
 * arbitrator.ts oracle-decision branch).
 */
export type RawTerminatedBy = TerminateReason | TemplatedTerminateReason;


/**
 * Structural stand-in for `KernelState["status"]`. Declared locally so this
 * module stays a true leaf (see header) — the two unions are pinned equal by
 * `terminate-reason.leaf.test.ts`.
 */
export type KernelStatusLike =
  | "thinking"
  | "acting"
  | "observing"
  | "done"
  | "failed"
  | "evaluating";

/**
 * Derive the canonical `terminatedBy` + raw open-string channel from a kernel
 * state's `meta.terminatedBy` + `status` pair.
 *
 * Returns BOTH:
 *   - `terminatedBy`: the closed 5-value enum used by `ReActKernelResult.terminatedBy`
 *   - `rawTerminatedBy?`: the raw `state.meta.terminatedBy` string, preserved
 *     so dynamic killswitch reasons (e.g. `"budget-limit:tokens:1/0"`) survive
 *     the narrowing for downstream observability.
 *
 * `rawTerminatedBy` is OMITTED (not set to `undefined`) when the source is
 * absent, so spread-based consumers don't pollute their result with
 * `{ rawTerminatedBy: undefined }`.
 *
 * Narrowing to `"final_answer"` is WHITELIST-gated (DEFECT 3, 2026-05-31):
 * only genuine model-answer reasons — `final_answer`, `final_answer_regex`,
 * `content_stable`, `entropy_converged` — map to `"final_answer"`. Any other
 * `status === "done"` (harness/give-up reasons such as
 * `controller_early_stop:*`, `low_delta_guard`, `oracle_forced`,
 * `harness_deliverable`, `loop_graceful`, killswitch cut-offs, etc.) narrows
 * to `"end_turn"`, NOT `"final_answer"`. The old catch-all `done → final_answer`
 * was a codified lie: it forced `deriveGoalAchieved` to return `true` on FAILED
 * runs (the observed `success:false` + `goalAchieved:true` incoherence).
 * `end_turn` yields an honest `goalAchieved` null ("unknown") instead of the lie.
 * A whitelist miss under-claims (honest, loud); a blacklist miss would
 * over-claim (silent lie) — so whitelist is the chosen error-asymmetry.
 *
 * Pure / synchronous / no Effect — exported for unit testability.
 */
export function deriveTerminatedBy(state: { meta: { terminatedBy?: unknown }; status: KernelStatusLike }): {
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" | "llm_error" | "abstained";
  rawTerminatedBy?: string;
} {
  const rawTerminatedBy =
    typeof state.meta.terminatedBy === "string" ? state.meta.terminatedBy : undefined;
  const terminatedBy:
    | "final_answer"
    | "final_answer_tool"
    | "max_iterations"
    | "end_turn"
    | "llm_error"
    | "abstained" =
    rawTerminatedBy === "llm_error"
      ? "llm_error"
      : rawTerminatedBy === "final_answer_tool"
        ? "final_answer_tool"
        : rawTerminatedBy === "abstained"
          ? "abstained"
          : rawTerminatedBy === "end_turn" || rawTerminatedBy === "llm_end_turn"
            ? "end_turn"
            : rawTerminatedBy === "final_answer" ||
                rawTerminatedBy === "final_answer_regex" ||
                rawTerminatedBy === "content_stable" ||
                rawTerminatedBy === "entropy_converged"
              ? "final_answer"
              : state.status === "done"
                ? "end_turn"
                : "max_iterations";
  return rawTerminatedBy !== undefined
    ? { terminatedBy, rawTerminatedBy }
    : { terminatedBy };
}
