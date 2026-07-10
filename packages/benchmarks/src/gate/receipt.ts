// File: src/gate/receipt.ts
import type { GateVerdict, TierEvidence } from "./types.js";

function tierRow(t: TierEvidence): string {
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
  return `  ${t.tier.padEnd(18)} ${base.padStart(6)}  ${cand.padStart(6)}  ${lift.padStart(8)}  ${tok.padStart(8)}  ${verdict}`;
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

export function formatGateReceipt(verdict: GateVerdict): string {
  const header = `LIFT GATE · ${verdict.candidateVariantId} vs ${verdict.baselineVariantId}`;
  const cols = `  ${"tier".padEnd(18)} ${"base".padStart(6)}  ${"cand".padStart(6)}  ${"lift".padStart(8)}  ${"tok".padStart(8)}  verdict`;
  const rows = verdict.perTier
    .flatMap((t) => [tierRow(t), ...tierDetailLines(t)])
    .join("\n");
  const agg =
    `  AGGREGATE  ${verdict.aggregate.liftPp.toFixed(1)}pp · ` +
    `${verdict.aggregate.tokenOverheadPct.toFixed(1)}% tok · ` +
    `tiers=${verdict.aggregate.tiersCovered}` +
    (verdict.partial ? " · PARTIAL" : "");
  const decision = `  DECISION: ${verdict.decision.toUpperCase()} — ${verdict.rationale}`;
  return [header, cols, rows, agg, decision].join("\n");
}
