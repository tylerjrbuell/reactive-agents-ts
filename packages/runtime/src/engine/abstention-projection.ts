// File: src/engine/abstention-projection.ts
//
// The SINGLE owner of the run-level abstention surface.
//
// `StreamCompleted.abstention` was declared (stream-types.ts) and never written:
// only the non-streaming path projected it. So `run()` surfaced an abstention and
// `runStream()` silently did not — and the benchmark, which consumes the stream,
// reads exactly that field:
//
//     const terminatedBy = completed.abstention ? "abstained" : meta.terminatedBy
//
// `scoreAbstention` credits an abstention-trap task only on
// `terminatedBy === "abstained"`, so no trap task could score above 0 through the
// streaming path however correctly the harness declined. The honesty rail was
// invisible to its own benchmark.
//
// This module exists so the rule lives in ONE place: copy-pasting the three-line
// projection into both call sites is how the two paths drifted apart to begin
// with.

import type { TerminatedBy } from "@reactive-agents/core";

/** The run-level abstention surface, or `undefined` when the run did not abstain. */
export interface AbstentionSurface {
  readonly reason: string;
  readonly missing: readonly string[];
}

/**
 * Project the abstention surface from a kernel/task result.
 *
 * Present only when the run BOTH terminated as `abstained` AND recorded a
 * reason. An `abstained` terminal with no recorded reason is not surfaced —
 * an abstention the harness cannot explain is not an abstention it should claim.
 */
export function projectAbstention(r: {
  readonly terminatedBy?: TerminatedBy | string;
  readonly abstention?: { readonly reason: string; readonly missing: readonly string[] };
}): AbstentionSurface | undefined {
  if (r.terminatedBy !== "abstained" || r.abstention === undefined) return undefined;
  return { reason: r.abstention.reason, missing: r.abstention.missing };
}
