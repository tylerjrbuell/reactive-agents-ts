// File: src/kernel/ledger/run-scope.ts
//
// Run-scoped ledger (Wave C.2 slice 1) — the ledger outlives ONE kernel call.
//
// C.1 made the RunLedger real inside a single reasoning pass. But a RUN is not
// a pass: the engine executes up to three (the terminal pass, the verification
// retry, the post-think continuation), each a separate kernel execution with
// its own `state.ledger` starting at seq 0. Only one survived onto
// `result.metadata.runLedger`; every fact a sibling pass recorded was thrown
// away — which is why the auxiliary-pass fence has no evidence store to read,
// why engine-side facts have nowhere to go, and why a sub-agent's work leaves
// no trace in its parent (DEBT-REGISTER §3, all three the same missing
// substrate).
//
// This module is that substrate: merge a completed pass's ledger into the run's
// ledger, preserving the append-only DAG law.
//
// ── seq re-base ──────────────────────────────────────────────────────────────
// A pass ledger is seq 0..n; the run ledger already holds m entries. Merged
// entries are re-assigned m..m+n so the run ledger stays dense and monotonic
// (the codec + every projector rely on it). This is sound because NO production
// code writes a seq-based cross-reference between entries — see
// `run-scope.test.ts`, which pins that. If one is ever introduced, this function
// is where the ref remap belongs; the pin will fail first and say so.
//
// ── provenance ───────────────────────────────────────────────────────────────
// Merged entries carry `pass`, naming which pass produced them. Entries from the
// run's primary pass carry none, so the common ledger is byte-identical to what
// C.1 shipped.

import type { LedgerEntry, RunLedger } from "./run-ledger.js";
import { appendEntries } from "./run-ledger.js";

/**
 * Which pass of a run produced an entry. A sub-agent's whole ledger merges under
 * `sub-agent:<name>`, so a parent can see what a child actually did rather than
 * a summary string.
 */
export type LedgerPass =
  | "verification-retry"
  | "continuation"
  | `sub-agent:${string}`;

/**
 * Merge one completed pass's ledger into the run's, re-basing `seq` and stamping
 * provenance. Pure — returns a NEW ledger; neither input is mutated and the run
 * ledger's existing entries keep their identity (DAG law).
 *
 * An empty or absent pass ledger returns the run ledger unchanged (identity), so
 * a caller never has to guard before absorbing.
 */
export function mergePassLedger(
  runLedger: RunLedger | undefined,
  passLedger: RunLedger | undefined,
  pass: LedgerPass,
): RunLedger {
  const incoming = passLedger ?? [];
  if (incoming.length === 0) return runLedger ?? [];
  // `appendEntries` assigns the run-scoped seq; the pass's own seq is dropped
  // rather than preserved, because two passes both starting at 0 would otherwise
  // collide and break the dense-index contract.
  //
  // `pass ?? provenance` PRESERVES an already-stamped entry. A single kernel
  // pass (verification-retry / continuation) carries no stamp, so every entry
  // takes `provenance`. But a sub-agent's ledger may already hold entries from
  // ITS OWN nested children (stamped `sub-agent:grandchild`); those keep their
  // innermost attribution rather than being flattened to the immediate child.
  return appendEntries(
    runLedger,
    incoming.map(
      ({ seq: _passSeq, ...rest }) => ({ ...rest, pass: rest.pass ?? pass }) as LedgerEntry,
    ),
  );
}

/**
 * The entries a given pass contributed. `undefined` selects the primary pass —
 * the entries that carry no provenance stamp.
 */
export function entriesOfPass(
  ledger: RunLedger | undefined,
  pass: LedgerPass | undefined,
): RunLedger {
  return (ledger ?? []).filter((e) => e.pass === pass);
}
