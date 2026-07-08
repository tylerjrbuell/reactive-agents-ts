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
