/**
 * Terminal-record predicates for `analyzeCause` (cause.ts): which guard names
 * mean an unresolved tool call, and when a strategy's acceptance of its answer
 * after a capped pass explains the terminal records. Pure, trace events only.
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
 * Terminal authority a strategy records when its own check accepted the answer
 * after a pass ended without one (reasoning `terminal-authority.ts`
 * `STRATEGY_ACCEPTED_AUTHORITY`, since 8c0d95e6d). The strategy then emits its
 * own `terminal_decision` (status `done`, this authority) after the capped
 * pass's `failed` one, and `run-completed.outcome.authority` names it.
 */
export const STRATEGY_ACCEPTED_AUTHORITY = "strategy-accepted";

/**
 * The contradiction a strategy-accepted terminal can still carry: the strategy's
 * `terminal_decision` (last on the trace, authority `strategy-accepted`) says
 * one `finalStatus` and `run-completed.outcome.status` says another. Undefined
 * when the last decision is not the strategy's acceptance, when either status
 * is absent, or when they agree (the consistent case: the acceptance decided
 * the run and both records say so).
 *
 * @param terminalDecision The last `terminal_decision` guard event.
 * @param completed The run's `run-completed` event.
 * @returns The two disagreeing statuses, or undefined.
 */
export function strategyAcceptedStatusConflict(
  terminalDecision: GuardFiredEvent | undefined,
  completed: RunCompletedEvent | undefined,
): { readonly finalStatus: string; readonly outcomeStatus: string } | undefined {
  const meta = terminalDecision?.metadata;
  if (meta?.["authority"] !== STRATEGY_ACCEPTED_AUTHORITY) return undefined;
  const finalStatus = meta["finalStatus"];
  const outcomeStatus = completed?.outcome?.status;
  if (typeof finalStatus !== "string" || typeof outcomeStatus !== "string") return undefined;
  return finalStatus === outcomeStatus ? undefined : { finalStatus, outcomeStatus };
}

/**
 * Pre-8c0d95e6d traces only: true when a failed `terminal_decision` belongs to
 * a capped kernel PASS that the strategy then answered past: the run ledger
 * records an accepted terminal verdict after that decision (reasoning
 * `answer-acceptance.ts`, e.g. reflexion's critique accepting the synthesized
 * report), and the runtime shipped the resulting `partial` as success through
 * its tolerance lane. Both halves are explicit trace records, so the status is
 * explained, not contradicted (01M7T8TYQ8ZRZX1445590XMESP,
 * 01M7T4XDDRM2VGPW1GCHWG7YR6, 2026-11-19). Those traces carry no strategy-level
 * `terminal_decision`, so the last one is the pass's. Since 8c0d95e6d the
 * strategy records its own (status `done`, authority
 * {@link STRATEGY_ACCEPTED_AUTHORITY}) after the pass's, so the last decision
 * is no longer `failed` and this exemption is not reached; it stays for
 * recorded corpora.
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
