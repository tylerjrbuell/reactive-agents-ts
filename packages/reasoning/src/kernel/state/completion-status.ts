// File: src/kernel/state/completion-status.ts
//
// The single honest channel between "the kernel stopped" and "the caller was
// told the truth about it" (H5 / P0, wiring audit 2026-07-09).
//
// THE DEFECT. `runner.ts` has two paths that deliberately ship an answer the
// terminal verifier did NOT bless, because discarding real work would be worse:
//
//   • `onlyHarnessAuthorshipFailed` (runner.ts:1220) — the harness concatenated
//     a deliverable the model never authored. Only `output-is-model-authored`
//     failed. `status` stays "done"; `meta.harnessAuthoredOutput = true`.
//   • the budget-terminal pace action (pace-terminal.ts:137) — the token cliff
//     arrived with requirements outstanding. `meta.budgetTerminalPartial = true`.
//
// Both were meant to "ship it HONESTLY LABELED". Neither label was ever read:
// `harnessAuthoredOutput` was not even declared on the meta type (written via an
// `as KernelState["meta"]` cast), and `verificationWarning` never reached
// `extraMetadata`. Meanwhile the strategies mapped `status:"done" → "completed"`,
// and `reasoning-post-think.ts:85` derives `success = status === "completed"`.
//
// So a run could return `result.success === true` alongside `verified: false`,
// and the honesty existed only in a code comment. In a framework whose thesis is
// honest reporting, that is the defect that matters most.
//
// THE RULE. Shipping a partial is fine. Calling it "completed" is not. A run
// that shipped output the verifier did not bless is `partial`. Downstream that
// makes `success === false` through the EXISTING mapping — no new flag for a
// caller to remember to check, which is precisely how the old markers died.

import type { KernelState } from "./kernel-state.js";

/**
 * Did the harness ship output the terminal verifier did not bless?
 *
 * Only the two HARD markers count. A bare `verificationWarning` does not: it
 * also rides the grounding-`degrade` path, whose documented policy is to surface
 * the answer with a warning attached — an explicit, blessed outcome rather than
 * an unverified ship.
 */
export function shippedUnverified(meta: KernelState["meta"]): boolean {
  return meta.harnessAuthoredOutput === true || meta.budgetTerminalPartial === true;
}

/**
 * Map the kernel's terminal state onto the caller-visible completion status.
 *
 * `failed` is absorbing — an unverified ship never upgrades a failure. `done`
 * degrades to `partial` when the harness shipped unverified. Everything else is
 * `partial`, matching the pre-existing strategy mapping.
 */
export function resolveCompletionStatus(
  state: KernelState,
): "completed" | "partial" | "failed" {
  if (state.status === "failed") return "failed";
  if (state.status !== "done") return "partial";
  return shippedUnverified(state.meta) ? "partial" : "completed";
}

/**
 * The honesty fields that must cross the result boundary with an unverified
 * ship. Spread into a strategy's `extraMetadata`. Empty for a clean run, so the
 * default result shape is unchanged.
 */
export function honestPartialMetadata(
  meta: KernelState["meta"],
): Record<string, unknown> {
  return {
    ...(meta.verificationWarning !== undefined
      ? { verificationWarning: meta.verificationWarning }
      : {}),
    ...(meta.harnessAuthoredOutput === true ? { harnessAuthoredOutput: true } : {}),
    ...(meta.budgetTerminalPartial === true ? { budgetTerminalPartial: true } : {}),
  };
}
