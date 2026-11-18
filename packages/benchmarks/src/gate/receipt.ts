// File: src/gate/receipt.ts
import type { GateVerdict, LiftPolicy, TierEvidence } from "./types.js";
import { DEFAULT_LIFT_POLICY } from "./types.js";
import { scoredTokenOverheadPct } from "./types.js";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtP(p: number): string {
  return p < 0.001 ? "<0.001" : p.toFixed(p < 0.1 ? 4 : 3);
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
    ` (scored: ${policy.tokenLeg}) | billed x${t.billedTokenRatio.toFixed(2)}/run | cacheHit ${(t.cacheHitRate * 100).toFixed(1)}%`;
  return `${row}\n${tokLine}`;
}

/**
 * Sub-lines under a tier row: the paired per-task deltas the tier's estimate
 * is built from, any tasks excluded as unpaired (never silent), and the
 * pass^8 reliability read (or its absence, called out as underpowered).
 */
function tierDetailLines(t: TierEvidence, policy: LiftPolicy): string[] {
  const lines: string[] = [];
  const fisher = new Map((t.exact?.perTask ?? []).map((x) => [x.taskId, x]));
  // A single-task tier's row already IS the task delta — no duplicate line.
  if (t.perTask.length > 1) {
    for (const p of t.perTask) {
      const d = `${p.dPp >= 0 ? "+" : ""}${p.dPp.toFixed(1)}pp`;
      const x = fisher.get(p.taskId);
      const exact = x
        ? `  ${x.baselineSolved}/${x.baselineRuns} → ${x.candidateSolved}/${x.candidateRuns} Fisher p=${fmtP(x.fisherP)}`
        : "";
      lines.push(`    · ${p.taskId.slice(0, 24).padEnd(24)} ${d.padStart(8)} ± ${p.sePp.toFixed(1)}pp${exact}`);
    }
  }
  if (t.exact !== undefined && !t.inconclusive) {
    const m = t.exact.mcnemar;
    lines.push(
      `    · exact McNemar (run-paired, nominal): +${m.b} gained / -${m.c} lost of ${m.pairs} pairs, p=${fmtP(m.p)}`,
    );
  }
  if (!t.inconclusive) {
    lines.push(
      `    · runsNeeded: ${t.runsNeeded}/cell for 80% power at ≥${policy.minLiftPp}pp over ${t.perTask.length} task(s) (have ${t.minRunsObserved})`,
    );
  }
  if (t.unpairedTaskIds.length > 0) {
    lines.push(
      `    · unpaired (excluded from estimate): ${t.unpairedTaskIds.join(", ")}`,
    );
  }
  if (t.runStatus !== undefined) {
    const r = t.runStatus;
    const pct = (n: number, d: number): string => `${n}/${d} (${((100 * n) / d).toFixed(0)}%)`;
    lines.push(
      `    · run status non-success ${pct(r.baselineNonSuccess, r.baselineRuns)} → ${pct(r.candidateNonSuccess, r.candidateRuns)}` +
        (t.statusRegresses ? " (STATUS REGRESSION — accuracy does not see this)" : ""),
    );
    for (const x of t.taskStatusRegressions ?? []) {
      lines.push(
        `    · STATUS REGRESSION task ${x.taskId}: non-success ${x.baselineNonSuccess}/${x.baselineRuns} → ${x.candidateNonSuccess}/${x.candidateRuns}`,
      );
    }
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
    .flatMap((t) => [tierRow(t, policy), ...tierDetailLines(t, policy)])
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
