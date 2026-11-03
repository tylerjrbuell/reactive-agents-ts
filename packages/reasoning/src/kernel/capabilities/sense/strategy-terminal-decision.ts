// File: src/kernel/capabilities/sense/strategy-terminal-decision.ts
//
// The strategy-level `terminal_decision` (R2, 2026-11-03 signal-gap closure).
//
// A kernel pass records its own `terminal_decision` at the runner. A strategy
// whose terminal is NOT a kernel pass (plan-execute's direct dispatch, ToT's
// no-leaf branch, blueprint, code-action, single-analysis) used to emit none,
// so its trace had no decision record at all. `finalizeStrategyResult` calls
// this when the result carries no kernel `terminalDecision`, so EVERY strategy
// result path records exactly one, derived from the SAME TerminalOutcome that
// rides `metadata.extensions.terminalOutcome` (one record, two readers).
//
// Emit-only: nothing branches on it. Vocabulary matches the runner's record:
// `status` is the legacy `done|failed` label, `finalStatus` is always present.

import { Effect } from "effect";
import type { TerminalOutcome } from "../../state/terminal-outcome.js";
import { emitGuardFired } from "../../utils/diagnostics.js";

/** Emit the strategy-owned `terminal_decision` guard-fired record. */
export function emitStrategyTerminalDecision(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly outcome: TerminalOutcome;
}): Effect.Effect<void, never> {
  const { taskId, iteration, outcome } = args;
  const failed = outcome.status === "failed";
  const intent =
    failed ? "fail" : outcome.status === "abstained" ? "abstain" : outcome.status === "partial" ? "deliver-partial" : "deliver";
  return emitGuardFired({
    taskId,
    iteration,
    guard: "terminal_decision",
    outcome: "terminate",
    reason: outcome.terminatedBy ?? (failed ? "failed" : "done"),
    metadata: {
      terminatedBy: outcome.terminatedBy,
      status: failed ? "failed" : "done",
      finalStatus: outcome.status,
      intent,
      verdictSummary: outcome.verdict?.summary ?? null,
      alternatives: [],
      authority: outcome.authority,
      ...(outcome.errorClass !== undefined ? { errorClass: outcome.errorClass } : {}),
    },
  });
}
