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

/** Observe the already-decided terminal decision; returns the state with it stamped. */
export function emitTerminalDecision(args: {
  readonly state: KernelState;
  readonly taskId: string;
}): Effect.Effect<KernelState, never> {
  const { state, taskId } = args;
  return Effect.gen(function* () {
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: "terminal_decision",
      outcome: "terminate",
      reason: typeof state.meta.terminatedBy === "string" ? state.meta.terminatedBy : (state.status === "failed" ? "failed" : "done"),
      metadata: terminalDecisionMetadata(state),
    });
    return transitionState(state, {
      meta: { ...state.meta, terminalDecision: { taskId, iteration: state.iteration, status: state.status, authority: deriveTerminalAuthority(state.meta), finalStatus: kernelReconciledStatus(state) } },
    });
  });
}
