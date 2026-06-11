/**
 * runner-helpers/grounding-block.ts — Block-mode evidence-grounding outcome.
 *
 * Phase D1 of the opt-in evidence-grounding redesign. The terminal verifier
 * (verifier.ts Check 5) pushes a `name: "evidence-grounded"` check with
 * severity `reject` ONLY when the user enabled `grounding: { mode: "block" }`.
 * In `warn` mode the check is `warn` (advisory) and rides the existing
 * `softFail` surface path in runner.ts — UNTOUCHED here.
 *
 * `block` mode must:
 *   1. NEVER hard-fail the run (the prior always-on grounding impediment is
 *      exactly what this redesign removes).
 *   2. NEVER loop past `maxRetries`.
 *
 * So this helper is a PURE decision: given the terminal verdict, the current
 * grounding-block retry count, and the grounding config, return one of:
 *   - `pass`    — no block-mode grounding reject; runner's normal branching runs.
 *   - `retry`   — within the retry budget: one corrective synthesis attempt,
 *                 with `guidance` (the ungrounded figures) to inject.
 *   - `degrade` — budget exhausted: accept the answer + attach `warning`
 *                 (mirrors the `softFail` warn-surface). Status stays non-failed.
 *
 * The runner owns the side effects (LLM re-synthesis on `retry`, the
 * `state.meta.verificationWarning` write on `degrade`, the counter bump). This
 * module owns only the bounded decision — so the cap-then-degrade invariant is
 * unit-testable without standing up the full kernel.
 *
 * Counter ownership note: this uses a DEDICATED `meta.groundingBlockRetry`
 * counter, NOT the arbitrator's `synthesisRetryCount`. The latter is owned by
 * the Arbitrator (Sprint 3.4 Scaffold 3) and budgeted inside the in-loop
 * synthesis-quality path; reusing it here would cross the arbitrator's
 * single-decider boundary and conflate two distinct retry budgets.
 *
 * Pure — no Effect, no state mutation, no I/O.
 */

import { checkSeverity, type VerificationResult } from "../../capabilities/verify/verifier.js";
import type { GroundingConfig } from "../../state/kernel-state.js";

/** Default block-mode corrective retries before degrading to warn. */
export const DEFAULT_GROUNDING_BLOCK_MAX_RETRIES = 1;

export type GroundingBlockOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "retry"; readonly guidance: string }
  | { readonly kind: "degrade"; readonly warning: string };

/**
 * Find a terminal `evidence-grounded` check that failed with `reject`
 * severity (block mode). Returns undefined when grounding passed, ran in
 * `warn` mode, or wasn't present (off by default).
 */
export function findGroundingBlockReject(
  verdict: VerificationResult,
):
  | { readonly name: string; readonly reason?: string }
  | undefined {
  return verdict.checks.find(
    (c) =>
      c.name === "evidence-grounded" &&
      !c.passed &&
      checkSeverity(c) === "reject",
  );
}

/**
 * Decide the block-mode grounding outcome.
 *
 * @param verdict     The terminal verification result.
 * @param retryCount  `state.meta.groundingBlockRetry ?? 0` — corrective
 *                    attempts already spent this run.
 * @param grounding   The opt-in config (`input.grounding`). Absent ⇒ `pass`.
 */
/**
 * True when there is a NON-grounding blocking failure (escalate, or a reject
 * check other than `evidence-grounded`). When present, the run must take the
 * normal hard-fail / escalate path — grounding's cap-then-degrade must NOT
 * rescue a parrot / harness-fallback / structural failure.
 */
export function hasNonGroundingBlock(verdict: VerificationResult): boolean {
  return verdict.checks.some((c) => {
    if (c.name === "evidence-grounded") return false;
    const sev = checkSeverity(c);
    return sev === "reject" || sev === "escalate";
  });
}

export function decideGroundingBlockOutcome(
  verdict: VerificationResult,
  retryCount: number,
  grounding: GroundingConfig | undefined,
): GroundingBlockOutcome {
  // Only block mode is handled here. Absent / warn mode ⇒ defer to the
  // runner's existing branching (warn rides softFail; absent never rejects).
  if (!grounding || grounding.mode !== "block") return { kind: "pass" };

  const reject = findGroundingBlockReject(verdict);
  if (!reject) return { kind: "pass" };

  // A coexisting structural failure (parrot, harness fallback, escalate) must
  // NOT be degraded-to-warn by grounding. Defer to the runner's hard path so
  // the answer is still suppressed / escalated.
  if (hasNonGroundingBlock(verdict)) return { kind: "pass" };

  const violations = reject.reason ?? "output contains figures not found in tool observations";
  const max = grounding.maxRetries ?? DEFAULT_GROUNDING_BLOCK_MAX_RETRIES;

  if (retryCount < max) {
    return {
      kind: "retry",
      guidance:
        `Your answer contains figures not grounded in the tool observations: ${violations}. ` +
        `Revise the answer to use ONLY figures present in the tool results.`,
    };
  }

  // Budget exhausted: degrade to warn — surface the answer WITH a warning,
  // never hard-fail. Mirrors the softFail warn-surface contract.
  return {
    kind: "degrade",
    warning: `evidence-grounding (block) degraded to warn after ${max} retr${max === 1 ? "y" : "ies"}: ${violations}`,
  };
}
