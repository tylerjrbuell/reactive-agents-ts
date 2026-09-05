// File: src/gate/receipt.ts
import type { GateVerdict, LiftPolicy, TierEvidence } from "./types.js";
import { DEFAULT_LIFT_POLICY } from "./types.js";
import { scoredTokenOverheadPct } from "./types.js";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function tierRow(t: TierEvidence, policy: LiftPolicy): string {
  const verdict = t.inconclusive
    ? "INCONCLUSIVE"
    : t.regresses
      ? "REGRESS"
      : t.passes
        ? "PASS"
        : "BELOW";
  const base = (t.baselineMetric * 100).toFixed(1);
  const cand = (t.candidateMetric * 100).toFixed(1);
  const lift = `${t.liftPp >= 0 ? "+" : ""}${t.liftPp.toFixed(1)}pp`;
  const tok = `${t.tokenOverheadPct >= 0 ? "+" : ""}${t.tokenOverheadPct.toFixed(1)}%`;
  const row = `  ${t.tier.padEnd(18)} ${base.padStart(6)}  ${cand.padStart(6)}  ${lift.padStart(8)}  ${tok.padStart(8)}  ${verdict}`;
  // Both legs on every receipt. A reader must be able to see WHY a verdict
  // differs from a pre-amendment one without re-running anything.
  const tokLine =
    `    · tokens raw ${fmtPct(t.tokenOverheadPct)} | billed ${fmtPct(t.billedTokenOverheadPct)}` +
    ` (scored: ${policy.tokenLeg}) | cacheHit ${(t.cacheHitRate * 100).toFixed(1)}%`;
  return `${row}\n${tokLine}`;
}

/**
 * Sub-lines under a tier row: the paired per-task deltas the tier's estimate
 * is built from, any tasks excluded as unpaired (never silent), and the
 * pass^8 reliability read (or its absence, called out as underpowered).
 */
function tierDetailLines(t: TierEvidence): string[] {
  const lines: string[] = [];
  // A single-task tier's row already IS the task delta — no duplicate line.
  if (t.perTask.length > 1) {
    for (const p of t.perTask) {
      const d = `${p.dPp >= 0 ? "+" : ""}${p.dPp.toFixed(1)}pp`;
      lines.push(`    · ${p.taskId.slice(0, 24).padEnd(24)} ${d.padStart(8)} ± ${p.sePp.toFixed(1)}pp`);
    }
  }
  if (t.unpairedTaskIds.length > 0) {
    lines.push(
      `    · unpaired (excluded from estimate): ${t.unpairedTaskIds.join(", ")}`,
    );
  }
  if (!t.inconclusive) {
    lines.push(
      t.passK === undefined
        ? `    · passK: underpowered (pass^8 needs n ≥ 8 per cell) — not evaluated, never blocks`
        : `    · pass^8 ${(t.passK.baseline * 100).toFixed(1)}% → ${(t.passK.candidate * 100).toFixed(1)}%` +
            (t.passK.nonRegression
              ? " (non-regression ok)"
              : " (RELIABILITY REGRESSION — blocks default-on)"),
    );
  }
  return lines;
}

export function formatGateReceipt(
  verdict: GateVerdict,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): string {
  const header = `LIFT GATE · ${verdict.candidateVariantId} vs ${verdict.baselineVariantId}`;
  const cols = `  ${"tier".padEnd(18)} ${"base".padStart(6)}  ${"cand".padStart(6)}  ${"lift".padStart(8)}  ${"tok".padStart(8)}  verdict`;
  const rows = verdict.perTier
    .flatMap((t) => [tierRow(t, policy), ...tierDetailLines(t)])
    .join("\n");
  // The aggregate headline prints the leg the verdict was SCORED on, labeled,
  // consistent with the per-tier sub-line. The other leg is one line up on
  // every tier row, so nothing is hidden.
  const agg =
    `  AGGREGATE  ${verdict.aggregate.liftPp.toFixed(1)}pp · ` +
    `${scoredTokenOverheadPct(verdict.aggregate, policy).toFixed(1)}% ${policy.tokenLeg} tok · ` +
    `tiers=${verdict.aggregate.tiersCovered}` +
    (verdict.partial ? " · PARTIAL" : "");
  const decision = `  DECISION: ${verdict.decision.toUpperCase()} — ${verdict.rationale}`;
  return [header, cols, rows, agg, decision].join("\n");
}
