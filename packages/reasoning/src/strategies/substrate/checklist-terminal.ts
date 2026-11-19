/**
 * substrate/checklist-terminal.ts — the todo list's terminal, shared by every
 * strategy (AGENTS.md pitfall 12: outcome logic in the shared substrate).
 *
 * `runStrategy` calls {@link settleChecklist} on the terminal ledger (after the
 * accepted answer is recorded, before the mint) and
 * {@link withChecklistReconciliation} on the minted result:
 *   - rows the ledger evidences are closed by the harness with provenance
 *     (verify/checklist-evidence.ts), announced like every other ledger growth
 *     so the live checklist (ChecklistUpdated -> Cortex) shows them;
 *   - the run's todo outcome rides `metadata.extensions.checklist`
 *     ({@link ChecklistReconciliation}); rows left without evidence are listed
 *     there as `unresolved` and traced as one `checklist-unresolved` guard
 *     (outcome `warn`).
 *
 * Open rows never cap the status: todo rows are advisory and never decide
 * done-ness (core checklist law); the contract requirements do. The record
 * makes them visible instead of silently open.
 */
import { Effect, Ref } from "effect";
import type { ReasoningMetadata } from "../../types/index.js";
import { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import { recordChecklistItems } from "../../kernel/ledger/emit.js";
import { appendAnnounced, type LedgerSinkTarget } from "../../kernel/ledger/ledger-sink.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";
import {
  checklistReconciliation,
  reconcileChecklistAtTerminal,
  type ChecklistReconciliation,
} from "../../kernel/capabilities/verify/checklist-evidence.js";

/** Guard name of the trace record listing rows that ended without evidence. */
export const CHECKLIST_UNRESOLVED_GUARD = "checklist-unresolved";

/**
 * Close every row the terminal ledger evidences, announced to `target`.
 * Returns the ledger unchanged when nothing closes or the `autoTick` kill
 * switch is off (`harness.autoTick: false`, `RA_AUTO_TICK=0`).
 */
export function settleChecklist(
  ledger: RunLedger,
  iteration: number,
  target: LedgerSinkTarget,
): Effect.Effect<RunLedger, never, RunEnvelope> {
  return Effect.gen(function* () {
    if ((yield* RunEnvelope).harness.autoTick === false) return ledger;
    const facts = reconcileChecklistAtTerminal(ledger, iteration);
    if (facts.length === 0) return ledger;
    const ref = yield* Ref.make(ledger);
    return yield* appendAnnounced(ref, (l) => recordChecklistItems(l, facts), target);
  });
}

/**
 * Attach the run's todo outcome to `metadata.extensions.checklist` and trace
 * its unresolved rows. Identity for a run that kept no todo list.
 */
export function withChecklistReconciliation<R extends { readonly metadata: ReasoningMetadata }>(
  result: R,
  ledger: RunLedger,
  taskId: string,
): Effect.Effect<R> {
  const report: ChecklistReconciliation | undefined = checklistReconciliation(ledger);
  if (report === undefined) return Effect.succeed(result);
  const next: R = { ...result, metadata: { ...result.metadata, extensions: { ...result.metadata.extensions, checklist: report } } };
  if (report.unresolved.length === 0) return Effect.succeed(next);
  return emitGuardFired({
    taskId,
    iteration: 0,
    guard: CHECKLIST_UNRESOLVED_GUARD,
    outcome: "warn",
    reason: `${report.unresolved.length} of ${report.total} todo rows ended with no evidence: ${report.unresolved.map((u) => `${u.id} "${u.title}"`).join(", ")}`,
    metadata: { unresolved: report.unresolved, done: report.done, total: report.total },
  }).pipe(Effect.as(next));
}
