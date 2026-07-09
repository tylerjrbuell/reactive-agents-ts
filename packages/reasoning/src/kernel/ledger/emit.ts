// File: src/kernel/ledger/emit.ts
//
// Discarded-evidence emitters (Wave C / task C1) — the concrete audit-01 win.
// These record facts the terminal path used to COMPUTE-AND-DISCARD:
//   - the exit VERDICT (recomputed and thrown away at both gates, audit 01)
//   - evidence-grounding CLAIMS (extracted and thrown away, audit 01-F2)
// onto the append-only RunLedger, so the Assessment + receipt + projector can
// read them instead of re-deriving from prose.
//
// Pure — returns a NEW ledger. Callers (arbitrator.applyTermination) append
// these BEFORE handing the ledger to `transitionState` via `patch.ledger`.

import type { ReasoningStep } from "../../types/index.js";
import {
  buildEvidenceCorpusFromSteps,
  classifyMeasurementClaims,
} from "../capabilities/verify/evidence-grounding.js";
import { appendEntries, appendEntry, type RunLedger } from "./run-ledger.js";

/** The terminal verdict, distilled to the ledger's verdict shape. */
export interface TerminalVerdictFact {
  readonly verified: boolean;
  readonly terminatedBy?: string;
  readonly reason?: string;
  readonly iteration: number;
}

/**
 * Record the terminal verdict — the exit decision that the gates surfaced only
 * as steering guidance and otherwise discarded (audit 01). One `verdict` fact,
 * `gate: "terminal"`.
 */
export function recordTerminalVerdict(
  ledger: RunLedger | undefined,
  fact: TerminalVerdictFact,
): RunLedger {
  return appendEntry(ledger, {
    kind: "verdict",
    iteration: fact.iteration,
    gate: "terminal",
    verified: fact.verified,
    ...(fact.terminatedBy !== undefined ? { terminatedBy: fact.terminatedBy } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
  });
}

/**
 * Record a compaction as a `compaction-marker` fact (C4, audit 03-F4). The
 * dropped-ref enumeration turns the old "summarized" lie into a checkable
 * record: every ref here remains resolvable in the store (recallable refs also
 * via the `recall` meta-tool). No-op when nothing was dropped.
 *
 * De-duped against the most recent `compaction-marker`: because compaction
 * re-runs every over-budget iteration, an identical dropped-ref set would
 * otherwise append a redundant marker each turn. Only a CHANGED set (or the
 * first marker) is recorded — the ledger stays a log of distinct compactions.
 */
export function recordCompactionMarker(
  ledger: RunLedger | undefined,
  droppedRefs: readonly string[],
  iteration: number,
  reason?: string,
): RunLedger {
  if (droppedRefs.length === 0) return ledger ?? [];
  const base = ledger ?? [];
  const lastMarker = [...base].reverse().find((e) => e.kind === "compaction-marker");
  if (lastMarker && lastMarker.kind === "compaction-marker") {
    const prev = lastMarker.droppedRefs;
    if (prev.length === droppedRefs.length && prev.every((r, i) => r === droppedRefs[i])) {
      return base;
    }
  }
  return appendEntry(base, {
    kind: "compaction-marker",
    iteration,
    droppedRefs: [...droppedRefs],
    ...(reason !== undefined ? { reason } : {}),
  });
}

/**
 * Record a compaction that ran but could NOT shrink the window — everything in
 * the thread was a protected class (C4 shrink self-check). A `harness-signal`
 * fact so the run is never silently stuck at the window ceiling. De-duped so a
 * persistent no-shrink condition records once, not every iteration.
 */
export function recordCompactionNoShrink(
  ledger: RunLedger | undefined,
  iteration: number,
): RunLedger {
  const base = ledger ?? [];
  const last = [...base].reverse().find(
    (e) => e.kind === "harness-signal" && e.signal === "compaction-no-shrink",
  );
  if (last) return base;
  return appendEntry(base, {
    kind: "harness-signal",
    iteration,
    signal: "compaction-no-shrink",
    detail: "compaction attempted but window did not shrink (all entries protected)",
  });
}

/**
 * Record a mid-run adaptive-harness recompile (Wave G / G1). The policy compiler
 * re-derived the HarnessPlan from the live RunAssessment (deepen on repeated
 * failure / stall, lean on a clean trajectory); this logs WHY as a queryable
 * ledger fact. Keeps the append primitive in the ledger home so
 * check-ledger-writes.sh holds.
 */
export function recordHarnessRecompiled(
  ledger: RunLedger | undefined,
  iteration: number,
  detail: string,
): RunLedger {
  return appendEntry(ledger ?? [], {
    kind: "harness-signal",
    iteration,
    signal: "harness-recompiled",
    detail,
  });
}

/**
 * Record the empirical measurement claims asserted in the final output, each
 * classified (grounded|not) against the tool-observation corpus built from the
 * run's steps. Previously extracted by the fabrication guard and discarded
 * (audit 01-F2, evidence-grounding.ts). No-op when the output carries no claims.
 */
export function recordEvidenceClaims(
  ledger: RunLedger | undefined,
  output: string | null | undefined,
  steps: readonly ReasoningStep[],
  scratchpad: ReadonlyMap<string, string> | undefined,
  iteration: number,
  tolerance = 0.01,
): RunLedger {
  if (typeof output !== "string" || output.trim().length === 0) return ledger ?? [];
  const corpus = buildEvidenceCorpusFromSteps(steps, scratchpad);
  const claims = classifyMeasurementClaims(output, corpus, tolerance);
  if (claims.length === 0) return ledger ?? [];
  return appendEntries(
    ledger,
    claims.map((c) => ({
      kind: "claim" as const,
      iteration,
      text: c.phrase,
      value: c.value,
      grounded: c.grounded,
    })),
  );
}
