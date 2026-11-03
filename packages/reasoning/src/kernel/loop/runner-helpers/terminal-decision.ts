// File: src/kernel/loop/runner-helpers/terminal-decision.ts
//
// Emit the `terminal_decision` guard-fired record AND stamp it on the final
// state's meta (trace-feedback item 2). The stamp is what lets the strategy mint
// (`finalizeStrategyResult`) compare the runtime-visible final status against
// THIS record and emit a `terminal_status_override` diagnostic when they differ
// — one record, two readers, no second source of truth.
//
// Emit-only + a meta stamp: no control flow reads either. Runner §10 delegates
// here verbatim (the former inline emit moved, unchanged, plus `authority`).

import { Effect } from "effect";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { deriveTerminalAuthority } from "../../state/terminal-authority.js";
import { kernelReconciledStatus } from "../../state/terminal-outcome.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { terminalDecisionMetadata } from "./deliverable-decision.js";

/**
 * A loop that exits on the iteration / LLM-call cap (or a strategy switch that
 * spent the pass) leaves `status` non-terminal ("thinking") and no
 * `terminatedBy`. That exit is a cap exhaustion: record it as one, never as a
 * `thinking` terminal with authority `none-recorded`.
 */
function isExhaustedExit(state: KernelState): boolean {
  return state.status !== "done" && state.status !== "failed" && state.meta.terminatedBy === undefined;
}

/**
 * Observe the already-decided terminal decision; returns the state with it stamped.
 *
 * Vocabulary: `status` is the LEGACY two-value label (`done|failed`, kept for
 * compatibility; `done` also covers partial/abstained). `finalStatus`
 * (`completed|partial|abstained|failed`) is the truthful label and is ALWAYS
 * present on both the event and the stamped record.
 */
export function emitTerminalDecision(args: {
  readonly state: KernelState;
  readonly taskId: string;
}): Effect.Effect<KernelState, never> {
  const { state, taskId } = args;
  return Effect.gen(function* () {
    const exhausted = isExhaustedExit(state);
    // Derivation view only: the stamped kernel state keeps its raw meta so no
    // downstream gate (give-up / harness-forced) sees a changed terminatedBy.
    const view: KernelState = exhausted
      ? { ...state, meta: { ...state.meta, terminatedBy: "max_iterations" } }
      : state;
    const legacyStatus = state.status === "done" ? "done" : "failed";
    const finalStatus =
      exhausted && !(typeof state.output === "string" && state.output.trim().length > 0)
        ? "failed"
        : kernelReconciledStatus(view);
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: "terminal_decision",
      outcome: "terminate",
      reason: typeof view.meta.terminatedBy === "string" ? view.meta.terminatedBy : (state.status === "failed" ? "failed" : "done"),
      metadata: { ...terminalDecisionMetadata(view), status: legacyStatus, finalStatus },
    });
    return transitionState(state, {
      meta: { ...state.meta, terminalDecision: { taskId, iteration: state.iteration, status: legacyStatus, authority: deriveTerminalAuthority(view.meta), finalStatus } },
    });
  });
}
