// File: src/gate/on-path.ts
//
// Wiring audit 2026-07-09: `evaluateLiftGate` had ZERO production callers. It
// lived in `src/gate/`, was unit-tested against hand-built fixtures, and was
// reachable only via `rax eval gate --report <SessionReport.json>` — which needs
// a report that only `--output` persists. So an ablation printed a table of
// point means with no uncertainty attached, and a human (twice, in this repo's
// history) read a variant gap off that table and called it a finding.
//
// This module puts the gate ON the session path. Two entry points:
//
//   • `gateReceiptFor(...)` — the explicit verdict when the caller names a
//     baseline and candidate variant.
//   • `powerWarningFor(...)` — an UNCONDITIONAL check that runs on every
//     multi-variant session. If any cell carries fewer than `minRuns` runs, the
//     printed means cannot support any comparison, and we say so out loud rather
//     than letting the table imply otherwise.
//
// The design rule this encodes: a number that cannot support a conclusion must
// never be printed without the caveat attached to it.

import { evaluateLiftGate } from "./gate.js";
import { formatGateReceipt } from "./receipt.js";
import { DEFAULT_LIFT_POLICY, type LiftGateOptions, type LiftPolicy } from "./types.js";
import type { SessionReport } from "../types.js";

/** Fewest runs observed across every cell of the report. */
export function minRunsInReport(report: SessionReport): number {
  const rows = report.taskReports ?? [];
  if (rows.length === 0) return 0;
  return Math.min(...rows.map((r) => r.runs?.length ?? 0));
}

/** Distinct variant ids present in the report. */
export function variantIdsIn(report: SessionReport): readonly string[] {
  return Array.from(new Set((report.taskReports ?? []).map((r) => r.variantId)));
}

/**
 * The warning to print alongside any multi-variant summary whose cells are too
 * thin to compare. `undefined` when the report is adequately sampled (or has
 * nothing to compare).
 */
export function powerWarningFor(
  report: SessionReport,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): string | undefined {
  if (variantIdsIn(report).length < 2) return undefined;
  const n = minRunsInReport(report);
  if (n >= policy.minRuns) return undefined;
  return (
    `\n  ⚠ UNDERPOWERED: some cells ran n=${n} (policy minimum is ${policy.minRuns}).\n` +
    `    Per-cell accuracy is near-Bernoulli, so the means above cannot support a\n` +
    `    variant comparison. A gap between variants here is NOT evidence of an effect.\n` +
    `    Re-run with --runs ${policy.minRuns} or more, then use --gate <baseline>,<candidate>.`
  );
}

/**
 * The full gate receipt for a named baseline→candidate comparison, or an error
 * string when those variants are not both present.
 */
export function gateReceiptFor(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
  options?: LiftGateOptions,
): string {
  const ids = variantIdsIn(report);
  const missing = [baselineVariantId, candidateVariantId].filter((v) => !ids.includes(v));
  if (missing.length > 0) {
    return `  --gate: variant(s) not in this session: ${missing.join(", ")}. Present: ${ids.join(", ")}`;
  }
  const verdict = evaluateLiftGate(
    report,
    baselineVariantId,
    candidateVariantId,
    policy,
    options,
  );
  return `  ${baselineVariantId} → ${candidateVariantId}\n${formatGateReceipt(verdict)}`;
}
