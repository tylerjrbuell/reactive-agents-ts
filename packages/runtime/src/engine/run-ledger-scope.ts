/**
 * The engine's run-scoped ledger seam (Wave C.2 slice 1).
 *
 * A run is not a pass. The engine executes reasoning up to three ways — the
 * terminal pass (`reasoning-think.ts`), the verification retry
 * (`verification-think-retry.ts`) and the post-think continuation
 * (`reasoning-harness-hooks.ts`) — and each is a SEPARATE kernel execution with
 * its own `state.ledger` starting at seq 0. Each auxiliary pass overwrites
 * `ctx.metadata.reasoningResult`, so before this module the engine forwarded the
 * LAST pass's ledger and silently discarded every fact its siblings recorded.
 *
 * The run-scoped ledger lives at `ctx.metadata.runLedger`, accumulated here and
 * read by `execution-engine.ts` in preference to any single pass's copy. The
 * merge itself belongs to the ledger's home in `@reactive-agents/reasoning`
 * (`kernel/ledger/run-scope.ts`) — this module never mints or appends an entry,
 * it only decides WHEN a pass is absorbed and under which provenance, which is
 * what `check-ledger-writes.sh` requires of every writer outside that home.
 */
import type { LedgerPass, RunLedger } from "@reactive-agents/reasoning";
import { mergePassLedger } from "@reactive-agents/reasoning";

/** The engine-context metadata key the run-scoped ledger accumulates under. */
export const RUN_LEDGER_METADATA_KEY = "runLedger";

/** The slice of a normalized reasoning result this seam reads. */
export interface PassLedgerSource {
  readonly metadata?: { readonly runLedger?: RunLedger };
}

/** The run-scoped ledger accumulated so far, if any. */
export function readRunLedger(
  metadata: Readonly<Record<string, unknown>> | undefined,
): RunLedger | undefined {
  const value = metadata?.[RUN_LEDGER_METADATA_KEY];
  return Array.isArray(value) ? (value as RunLedger) : undefined;
}

/**
 * Seed the run's ledger from its PRIMARY (terminal) pass. That pass's seqs are
 * already dense from 0, so it becomes the run ledger verbatim — a single-pass
 * run therefore produces a byte-identical ledger to what Wave C.1 shipped.
 */
export function seedRunLedger(pass: PassLedgerSource | null | undefined): RunLedger | undefined {
  const ledger = pass?.metadata?.runLedger;
  return ledger && ledger.length > 0 ? ledger : undefined;
}

/**
 * Absorb an AUXILIARY pass's ledger into the run's, re-basing seq and stamping
 * provenance so the fact stays attributable to the pass that recorded it.
 *
 * Returns the run ledger unchanged when the pass recorded nothing, so a caller
 * never needs to guard. `prior` being absent is normal: an auxiliary pass can
 * complete on a run whose primary pass recorded no entries at all.
 */
export function absorbPassLedger(
  prior: RunLedger | undefined,
  pass: PassLedgerSource | null | undefined,
  provenance: LedgerPass,
): RunLedger | undefined {
  const merged = mergePassLedger(prior, pass?.metadata?.runLedger, provenance);
  return merged.length > 0 ? merged : undefined;
}

/**
 * The metadata patch an auxiliary pass site spreads into the context it returns:
 *
 *   metadata: { ...ctx.metadata, reasoningResult: r,
 *               ...absorbedLedgerMetadata(ctx.metadata, r, "continuation") }
 *
 * One named call per site rather than a hand-written merge, because there are
 * five such sites and a hand-written one that drifts drops a pass's facts
 * silently — the defect class the cross-cutting cascade exists to end. Yields an
 * EMPTY patch when nothing was recorded, so the key is never written as
 * `undefined` and a run with no ledger stays byte-identical to Wave C.1.
 */
export function absorbedLedgerMetadata(
  ctxMetadata: Readonly<Record<string, unknown>> | undefined,
  pass: PassLedgerSource | null | undefined,
  provenance: LedgerPass,
): Readonly<Record<string, RunLedger>> {
  const merged = absorbPassLedger(readRunLedger(ctxMetadata), pass, provenance);
  return merged ? { [RUN_LEDGER_METADATA_KEY]: merged } : {};
}
