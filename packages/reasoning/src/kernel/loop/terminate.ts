// Single-owner termination helper (Stage 5 W4 — FIX-18 / NS §2.5).
//
// Background: the kernel had 9 sites that transitioned `status: "done"` —
// 8 in `kernel/loop/runner.ts` (low-delta guard, fallback deliver, harness-
// deliverable, oracle-forced, loop-graceful, required-tool-nudge-exhausted,
// and the loop-detection escape paths) plus 1 in
// `kernel/capabilities/decide/arbitrator.ts` (the verdict oracle). CHANGE A
// wired the oracle into 1 of 9 sites; the other 8 bypassed it. This was the
// failure-corpus root cause per North Star §2.5.
//
// Resolution: every imperative termination site outside the Arbitrator now
// routes through `terminate()` below. The Arbitrator stays the canonical
// verdict-driven oracle (its own `transitionState` call is allowed); this
// helper owns the imperative paths that predate the oracle and can't easily
// be folded into a Verdict.
//
// CI lint at `scripts/check-termination-paths.sh` fails if a new direct
// `status: "done"` transition appears outside this helper or the Arbitrator.

import type { Deliverable, Rationale } from "@reactive-agents/core";
import { deliverableToContent } from "@reactive-agents/core";
import type { KernelMeta, KernelState } from "../state/kernel-state.js";
import { transitionState } from "../state/kernel-state.js";
import { commitAbstention, commitDeliverable, commitNoAnswer } from "./runner-helpers/deliverable.js";
import { describeUnmet } from "../capabilities/verify/post-conditions.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { deliveryConditions } from "../contract/declared-deliverables.js";
import { deliverableEvidenceVerified, provenanceOf } from "./runner-helpers/deliverable-decision.js";

// `TerminateReason` lives in the dependency-free leaf `terminate-reason.ts`
// (GH #184) so `runner-helpers/deliverable.ts` can import the type without the
// `deliverable.ts` ↔ `terminate.ts` cycle. Re-exported here so existing
// `from "../terminate.js"` type importers keep resolving.
export type { TerminateReason } from "./terminate-reason.js";
import type { TerminateReason } from "./terminate-reason.js";

export type TerminateOptions = {
  /**
   * The `terminatedBy` reason. REQUIRED — every termination must declare why.
   * Common values: `"low_delta_guard"`, `"harness_deliverable"`, `"oracle_forced"`,
   * `"loop_graceful"`, `"dispatcher-early-stop"`, `"dispatcher-strategy-switch"`.
   *
   * Constrained to `TerminateReason` so the kernel-emitted termination surface
   * stays enumerable for downstream assertions (R23 / M9 oracle witness).
   */
  readonly reason: TerminateReason;
  /**
   * The user-visible output, as a typed {@link Deliverable} (P1 mission 2B).
   *
   * `terminate()` does NOT write `state.output` from a raw string — that would
   * make it a string→output launderer and defeat the typed-provenance contract.
   * Callers construct the Deliverable that proves provenance (model_synthesis
   * for model-authored text, tool_artifact/harness_synthesis for assembled
   * observations, sentinel for empty/abort). `terminate()` finalizes status and
   * delegates the output string to the single writer `commitDeliverable`.
   */
  readonly deliverable: Deliverable;
  /**
   * Additional KernelMeta fields to merge alongside `terminatedBy`. Common use:
   * `previousTerminatedBy`, `escalateTo`, etc. Do NOT pass `terminatedBy` here
   * — that's set from `reason`.
   */
  readonly extraMeta?: Partial<KernelMeta>;
  /**
   * Optional structured rationale for the termination (v0.11.x).
   * When provided, surfaces on `KernelStateSnapshotEvent.terminationRationale`.
   * Use when `reason` is opaque (e.g. "quality_threshold") and the rationale
   * carries the threshold/score context that makes the choice auditable.
   */
  readonly rationale?: Rationale;
};

// Sprint-1 A4 (2026-06-02): RA_POST_CONDITIONS flag deleted. Terminal
// post-condition verification is unconditional — closes the false-success
// hole at the imperative gateway. Aligns with canonical-harness-core
// part 4 (state-grounded verification as success authority).

/**
 * Terminal PostCondition hard-stop — the success authority at the single-owner
 * imperative gateway (the brief's "verifier.ts + terminate.ts" wiring).
 *
 * The Arbitrator's `applyPostConditionGate` STEERS mid-loop: a would-be
 * exit-success with unmet conditions is converted to a re-entry escalation so
 * the model gets another shot. But the imperative paths that route through
 * `terminate()` (stall/harness-deliverable, loop-graceful, oracle-forced,
 * required-tool-nudge-exhausted) bypass the Arbitrator's verdict — an exhausted
 * stall can force-deliver around the gated verdict and report a FALSE success
 * (cogito GitHub-MCP: result.success=true with ./commits.md never written).
 *
 * This gate closes that hole: unconditionally (no opt-out), with a non-empty
 * stored condition set AND a ledger that leaves a condition unmet, the terminal
 * state resolves to `status:"failed"` (honest partial failure) regardless of
 * `opts.reason` — even though output may already be assembled. `status:"failed"`
 * is the EXISTING channel that surfaces `result.success === false` (same one
 * max_iterations / kernel_error / the §9.0 verifier-rejection use). The
 * transitionState invariant nulls the output on failure, matching the §9.0
 * precedent.
 *
 * Reads the conditions DERIVED ONCE at run-start and stored on
 * `state.meta.postConditions` — the SAME set the Arbitrator's steer gate reads.
 * NO LLM, NO fs: `verifyPostConditions` is a pure ledger scan.
 *
 * No stored conditions → byte-identical pass-through to the original
 * done-transition below.
 */
function applyTerminalPostConditionGate(
  state: KernelState,
  opts: TerminateOptions,
): KernelState | null {
  // Durable HITL (Phase D): an approval pause is NOT a failure. The run is
  // intentionally suspended before its post-conditions could be met; demoting it
  // to `status:"failed"` would mislabel a resumable pause as a dead run. Pass
  // through to the normal terminal transition so the engine sees a clean
  // `terminatedBy:"awaiting-approval"`.
  // Durable pause (Task 9): a `request_user_input` interaction pause is the
  // same shape — the run is intentionally suspended awaiting a human answer,
  // not failed. Mirrors the awaiting-approval treatment exactly.
  // O3 (Task 6): an abstained run intentionally declines to answer — post-conditions
  // are moot (no iterations could have met them when grounding was structurally
  // impossible). Pass through so `status:"done"` + `terminatedBy:"abstained"` is
  // set cleanly without the gate re-demoting to `status:"failed"`.
  // E3 (meta-loop Phase 5a): a `budget_terminal` forced synthesis is an
  // intentional HONEST PARTIAL delivery — the run hit the terminal budget band
  // and synthesized the best answer it could before the `budget_exceeded` cliff.
  // Demoting it to `status:"failed"` here would null the answer (the very
  // discard audit 05-#1 fixes), so it passes through like abstention: the answer
  // ships, `meta.budgetTerminalPartial` + `verificationWarning` carry the honest
  // partial label. Set only under the long-horizon profile → byte-identical off.
  // Exit-gate draft handoff (owner decision 2026-11-10): the gate already
  // judged the unmet conditions and refused the deliverable
  // (`deliverableDecision.accepted:false`, its `outstanding` list appended to
  // the model's draft). Like `budget_terminal` it is an honest labelled
  // partial; demoting it here would null the model's own answer.
  if (
    opts.reason === "awaiting-approval" ||
    opts.reason === "awaiting-interaction" ||
    opts.reason === "abstained" ||
    opts.reason === "budget_terminal" ||
    opts.extraMeta?.deliverableDecision?.exitGate?.gateDecision === "handoff"
  )
    return null;
  // Widened with the contract's per-item deliverables (declared-deliverables.ts)
  // — the SAME set the Arbitrator's steer gate reads.
  const conditions = deliveryConditions(state.meta);
  if (!conditions || conditions.length === 0) return null;

  // Route through the single delivery authority (Move 2): it composes the
  // run-scoped ledger (delegated writes live only there) AND disk ground truth
  // (an unlinked/unknown-path-arg write escapes the reconstruction, but a file
  // on disk WAS produced). Ground truth is ON by default inside the authority,
  // so this imperative path cannot silently regress to filesystem-blind.
  const result = verifyDelivery(conditions, {
    steps: state.steps,
    output: deliverableToContent(opts.deliverable),
    ledger: state.ledger,
  });
  if (result.unmet.length === 0) return null; // state-grounded success — proceed

  // Unmet post-conditions at a forced/imperative termination: refuse success.
  // The run cannot honestly report a delivered success while a required
  // deliverable was never produced. status:"failed" → result.success=false.
  return transitionState(state, {
    status: "failed" as const,
    error:
      `Post-condition(s) unmet at termination (terminatedBy=${opts.reason}): ` +
      describeUnmet(result.unmet),
    meta: {
      ...state.meta,
      terminatedBy: opts.reason,
      previousTerminatedBy: state.meta.terminatedBy,
      ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
      ...(opts.extraMeta ?? {}),
    },
  });
}

/**
 * Reasons whose sentinel is handled by the normal commit: the two pauses (the
 * sentinel is the paused run's output) and the abstention (`commitAbstention`).
 */
const SENTINEL_OUTPUT_REASONS: ReadonlySet<string> = new Set([
  "awaiting-approval",
  "awaiting-interaction",
  "abstained",
]);

/**
 * A no-answer terminal: the sentinel names why. The output is never written.
 *
 *   - A verified declared artifact IS the deliverable (the file landed): the
 *     run is `done` with empty output, so the post-loop fills it from the
 *     model's own text or the gathered evidence, if any.
 *   - Otherwise the run FAILS with the rendered sentinel as its cause on
 *     `error`; an unmet post-condition (already demoted by the gate) is
 *     appended after it.
 */
function endWithoutAnswer(
  state: KernelState,
  postConditionFailure: KernelState | null,
  opts: TerminateOptions & { readonly deliverable: Extract<Deliverable, { source: "sentinel" }> },
): KernelState {
  const cause = deliverableToContent(opts.deliverable);
  const provenance = { deliverableProvenance: provenanceOf(opts.deliverable) };
  // The gate already failed the run and stamped its meta; the sentinel leads.
  if (postConditionFailure !== null) {
    return transitionState(postConditionFailure, {
      error: `${cause}\n${postConditionFailure.error ?? ""}`.trim(),
      meta: { ...postConditionFailure.meta, ...provenance },
    });
  }
  const meta = {
    ...state.meta,
    terminatedBy: opts.reason,
    ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
    ...(opts.extraMeta ?? {}),
  };
  if (deliverableEvidenceVerified(state.ledger)) {
    return commitNoAnswer(transitionState(state, { status: "done" as const, meta }), opts.deliverable);
  }
  return transitionState(state, { status: "failed" as const, error: cause, meta: { ...meta, ...provenance } });
}

/**
 * Transition the kernel to `status: "done"` with `terminatedBy` and `output`
 * recorded. Single-owner gateway for all imperative termination paths.
 *
 * The Arbitrator's verdict-driven exit-success branch is the only sanctioned
 * caller outside this helper — see `kernel/capabilities/decide/arbitrator.ts`.
 *
 * Terminal PostCondition authority (unconditional; no opt-out): before recording a
 * "done" transition, an unmet stored post-condition demotes the terminal state
 * to "failed" (honest failure) — see `applyTerminalPostConditionGate`.
 */
export const terminate = (state: KernelState, opts: TerminateOptions): KernelState => {
  const failed = applyTerminalPostConditionGate(state, opts);
  // A sentinel is the harness's own sentence, never an answer (owner decision
  // 2026-11-10). Pause sentinels ARE the output (the paused-result mint reads
  // them) and an abstention commits its own way below; any other sentinel
  // means the run has no answer.
  if (opts.deliverable.source === "sentinel" && !SENTINEL_OUTPUT_REASONS.has(opts.reason)) {
    return endWithoutAnswer(state, failed, { ...opts, deliverable: opts.deliverable });
  }
  if (failed) return failed;
  // Compose the two single-owner concepts (P1 mission 2B): `terminate` owns the
  // status/terminatedBy finalize; `commitDeliverable` owns the output string.
  // Set status:"done" + meta FIRST (no `output` key — an output-only patch on a
  // `done` state sticks per the transitionState invariant), THEN funnel the
  // output through the single writer. NO parallel output-writing path is opened.
  const done = transitionState(state, {
    status: "done" as const,
    meta: {
      ...state.meta,
      terminatedBy: opts.reason,
      ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
      ...(opts.extraMeta ?? {}),
    },
  });
  // An abstention ships no harness sentence as output (owner decision
  // 2026-11-10): the sentinel becomes the cause on `error`, output stays empty.
  if (opts.reason === "abstained" && opts.deliverable.source === "sentinel") {
    return commitAbstention(done, opts.deliverable);
  }
  return commitDeliverable(done, opts.deliverable);
};
