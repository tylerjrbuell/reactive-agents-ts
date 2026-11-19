/**
 * Terminal-record predicates for `analyzeCause` (cause.ts): which guard names
 * mean an unresolved tool call, and when a failed pass terminal is explained
 * by a later strategy acceptance. Pure, trace events only.
 */
import type { GuardFiredEvent, LedgerEntryTraceEvent, RunCompletedEvent, TraceEvent } from "./events.js";

/**
 * Guard names that record an unresolved TOOL CALL (the model's reply was
 * tool-call text that could not be executed). Matched by name, not by the bare
 * word "unresolved": `checklist-unresolved` (88c9957b7, outcome `warn`) lists
 * advisory todo rows that ended without evidence and says nothing about tool
 * calls; the loose `/unresolved/` read it as tool-protocol on
 * 01M7T8XTQEARASBWPNVYEEZJZ0 (2026-11-19).
 */
export const UNRESOLVED_TOOL_CALL_GUARD = /^(?:tool[-_]call[-_]unresolved|unresolved[-_]tool[-_]call)/;

/**
 * True when a failed `terminal_decision` belongs to a capped kernel PASS that
 * the strategy then answered past: the run ledger records an accepted terminal
 * verdict after that decision (reasoning `answer-acceptance.ts`, e.g.
 * reflexion's critique accepting the synthesized report), and the runtime
 * shipped the resulting `partial` as success through its tolerance lane. Both
 * halves are explicit trace records, so the status is explained, not
 * contradicted (01M7T8TYQ8ZRZX1445590XMESP, 01M7T4XDDRM2VGPW1GCHWG7YR6,
 * 2026-11-19). The strategy-level terminal emits no `terminal_decision` of its
 * own, so the last one on the trace is the pass's.
 *
 * @param terminalDecision The last `terminal_decision` guard event.
 * @param completed The run's `run-completed` event.
 * @param events Every event of the run.
 */
export function acceptedAfterFailedPass(
  terminalDecision: GuardFiredEvent | undefined,
  completed: RunCompletedEvent | undefined,
  events: readonly TraceEvent[],
): boolean {
  const td = terminalDecision;
  if (td === undefined || completed?.outcome?.tolerated !== true) return false;
  return events
    .filter((e): e is LedgerEntryTraceEvent => e.kind === "ledger-entry" && e.seq > td.seq)
    .some((e) => e.entries.some((r) => r["kind"] === "verdict" && r["gate"] === "terminal" && r["verified"] === true));
}
