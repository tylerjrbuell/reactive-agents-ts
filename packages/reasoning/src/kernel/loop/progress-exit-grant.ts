/**
 * progress-exit-grant.ts — progress-aware exit denial at the exit gate (Plan 9,
 * follow-up to item 2f; opt-in: `.withHarness({ progressAwareExit: true })`).
 *
 * The gate's `deny-once` nudge is ONE per run, shared by every soft guard
 * (`exit-gate.ts` `disposeExit`). The 2f ablations (wiki/Research/Ablations/
 * 2026-11-06-loop-progress-aware-rerun) found the nudge spent by the first soft
 * exit, after which the next soft exit of ANY guard (dispatcher early-stop,
 * stall, low-delta, loop) ended the run with 1-4 of 6 output files missing,
 * although work had landed in between. 2f only redirected a second LOOP verdict.
 *
 * The rule, at the one shared authority: once the nudge is spent, a later SOFT
 * guard exit with work outstanding is denied again (a progress grant) when the
 * RunLedger recorded progress since the gate's most recent denial. Bounds:
 *   - at most {@link PROGRESS_EXIT_GRANT_LIMIT} grants per run;
 *   - each grant needs progress after the previous denial (no progress → the
 *     exit is disposed exactly as without the switch);
 *   - only with room for one more iteration under the cap (the same test the
 *     deny-once nudge uses); a `cap` proposal and model proposals are unchanged.
 *
 * Progress is the same measure 2f reads: an `artifact` ledger entry, or an
 * executed tool result the progress arbiter classifies as substantive (a
 * guard's duplicate note is harness-authored, a refused call never ran, META
 * tools and no-op results do not count).
 */
import { classifyToolResult } from "../assessment/progress-arbiter.js";
import type { LedgerEntry } from "../ledger/run-ledger.js";
import type { KernelState } from "../state/kernel-state.js";
import type { ReasoningStep } from "../../types/index.js";

/** Most progress grants the gate gives in one run, on top of the deny-once nudge. */
export const PROGRESS_EXIT_GRANT_LIMIT = 3;

/** The reason a progress grant records (gate step `exitGate.grant`, guard-fired event). */
export const PROGRESS_EXIT_GRANT_REASON = "progress_since_last_exit" as const;

/** The guard name of the activation event a grant emits. */
export const PROGRESS_EXIT_GUARD = "progress_aware_exit";

/**
 * The harness switch (`HarnessConfig.progressAwareExit`). Read structurally so a
 * harness object without the field reads OFF.
 */
export function progressAwareExitEnabled(harness: object | undefined): boolean {
  return harness !== undefined && "progressAwareExit" in harness && harness.progressAwareExit === true;
}

/** Does this ledger fact count as progress (new artifact or substantive tool evidence)? */
export function isProgressEntry(e: LedgerEntry): boolean {
  if (e.kind === "artifact") return true;
  if (e.kind !== "tool-result" || e.refused === true) return false;
  return classifyToolResult(e.toolName, e.success, e.preview, e.harnessAuthored === true).kind === "substantive";
}

/**
 * True when the ledger recorded progress after the harness-signal entry of step
 * `stepId`. False when that step is not in the ledger (nothing to measure from).
 */
export function ledgerProgressAfterStep(state: KernelState, stepId: string): boolean {
  const ledger = state.ledger ?? [];
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i]!;
    if (e.kind === "harness-signal" && e.stepId === stepId) {
      return ledger.slice(i + 1).some(isProgressEntry);
    }
  }
  return false;
}

/** Progress grants the gate already gave in this run. */
export function progressGrantsUsed(steps: readonly ReasoningStep[]): number {
  return steps.filter((s) => s.metadata?.exitGate?.grant === PROGRESS_EXIT_GRANT_REASON).length;
}

/**
 * May the gate grant one more denial? True when the switch is on, the guards'
 * deny-once was spent, grants remain, and the ledger shows progress since the
 * gate's most recent guard denial (the deny-once or a previous grant).
 * The caller still applies the soft-kind, outstanding and room tests.
 */
export function progressGrantAvailable(state: KernelState, harness: object | undefined): boolean {
  if (!progressAwareExitEnabled(harness)) return false;
  if (progressGrantsUsed(state.steps) >= PROGRESS_EXIT_GRANT_LIMIT) return false;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i]!;
    if (step.metadata?.exitGate?.gateDecision === "deny-once") return ledgerProgressAfterStep(state, step.id);
  }
  return false; // the nudge is not spent yet: deny-once handles this exit
}
