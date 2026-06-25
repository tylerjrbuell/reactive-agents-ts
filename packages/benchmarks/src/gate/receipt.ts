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

export function formatGateReceipt(verdict: GateVerdict): string {
  const header = `LIFT GATE · ${verdict.candidateVariantId} vs ${verdict.baselineVariantId}`;
  const cols = `  ${"tier".padEnd(18)} ${"base".padStart(6)}  ${"cand".padStart(6)}  ${"lift".padStart(8)}  ${"tok".padStart(8)}  verdict`;
  const rows = verdict.perTier.map(tierRow).join("\n");
  const agg =
    `  AGGREGATE  ${verdict.aggregate.liftPp.toFixed(1)}pp · ` +
    `${verdict.aggregate.tokenOverheadPct.toFixed(1)}% tok · ` +
    `tiers=${verdict.aggregate.tiersCovered}` +
    (verdict.partial ? " · PARTIAL" : "");
  const decision = `  DECISION: ${verdict.decision.toUpperCase()} — ${verdict.rationale}`;
  return [header, cols, rows, agg, decision].join("\n");
}
