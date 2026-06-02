// packages/trace/src/cohort.ts
//
// Cross-run aggregation + cohort comparison — the improvement FEEDBACK LOOP
// instrument. A "cohort" is a set of runs sharing a label (e.g. one arm of an
// A/B: "thick-baseline" vs "thin-core"). Aggregates per-run RunAnalysis into
// cohort stats, then compares two cohorts into a trust-gated verdict.
//
// BULLETPROOF GUARANTEES (the whole point):
//   1. Honesty distribution is FIRST-CLASS. A cohort only "improves" if its
//      dishonest-success-suspected rate is flat-or-down AND deliverable-produced
//      is flat-or-up. A token/success win bought by loosening honesty is a
//      REGRESSION, said out loud. (success is self-reported — never trust it raw.)
//   2. Coverage is carried THROUGH. A metric blind in either cohort is flagged
//      inconclusive, never silently compared as a real zero (dead-scaffold
//      discipline, across cohorts).

import type { Trace } from "./replay.js";
import { analyzeRun, type AnalyzeOptions, type RunAnalysis } from "./analyze.js";

export interface CohortStats {
  readonly label: string;
  readonly n: number;
  // ── Outcome (honesty-aware) ──
  /** Fraction claiming success (pass@1 estimate — NOT verified). */
  readonly claimedSuccessRate: number;
  /** Strict pass^n: every run in the cohort claimed success. */
  readonly allClaimedSuccess: boolean;
  /** Honesty guard — fraction flagged dishonest-success-suspected. Lower is better. */
  readonly dishonestSuspectedRate: number;
  /** Honesty guard — fraction that produced a deliverable file. Higher is better. */
  readonly deliverableProducedRate: number;
  /** honesty label → count. */
  readonly honestyDistribution: Readonly<Record<string, number>>;
  // ── Cost ──
  readonly tokensP50: number;
  readonly tokensP95: number;
  readonly avgLlmCalls: number;
  // ── Intervention density ──
  readonly avgGuardsFired: number;
  /** Fraction of runs with ≥1 overlap storm. */
  readonly overlapStormRate: number;
  /** guard name → total fires across the cohort. */
  readonly guardFrequency: Readonly<Record<string, number>>;
  // ── Failure modes ──
  /** failure mode → fraction of runs exhibiting it. */
  readonly failureModeRates: Readonly<Record<string, number>>;
  // ── Coverage (carried through) ──
  /** A metric blind in ANY run of the cohort — comparisons on these are inconclusive. */
  readonly blindMetrics: readonly string[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function aggregateCohort(
  label: string,
  traces: readonly Trace[],
  opts: AnalyzeOptions = {},
): CohortStats {
  const runs: RunAnalysis[] = traces.map((t) => analyzeRun(t, opts));
  const n = runs.length;
  const frac = (count: number) => (n === 0 ? 0 : count / n);

  const claimed = runs.filter((r) => r.honesty.claimedSuccess).length;
  const dishonest = runs.filter((r) => r.honesty.label === "dishonest-success-suspected").length;
  const deliverable = runs.filter((r) => r.honesty.deliverableProduced).length;

  const honestyDistribution: Record<string, number> = {};
  for (const r of runs) honestyDistribution[r.honesty.label] = (honestyDistribution[r.honesty.label] ?? 0) + 1;

  const tokens = runs.map((r) => r.cost.totalTokens).sort((a, b) => a - b);
  const avgLlmCalls = n === 0 ? 0 : runs.reduce((s, r) => s + r.cost.llmCalls, 0) / n;

  const avgGuardsFired = n === 0 ? 0 : runs.reduce((s, r) => s + r.interventions.guardsFired, 0) / n;
  const overlapRuns = runs.filter((r) => r.interventions.overlapStorms.length > 0).length;
  const guardFrequency: Record<string, number> = {};
  for (const r of runs) for (const g of r.interventions.byGuard) guardFrequency[g.guard] = (guardFrequency[g.guard] ?? 0) + g.count;

  const failureModeCounts: Record<string, number> = {};
  for (const r of runs) for (const f of r.failureModes) failureModeCounts[f.mode] = (failureModeCounts[f.mode] ?? 0) + 1;
  const failureModeRates: Record<string, number> = {};
  for (const [m, c] of Object.entries(failureModeCounts)) failureModeRates[m] = frac(c);

  const blindMetrics = [...new Set(runs.flatMap((r) => r.coverage.blindSpots.map((b) => b.metric)))];

  return {
    label, n,
    claimedSuccessRate: frac(claimed),
    allClaimedSuccess: n > 0 && claimed === n,
    dishonestSuspectedRate: frac(dishonest),
    deliverableProducedRate: frac(deliverable),
    honestyDistribution,
    tokensP50: percentile(tokens, 50),
    tokensP95: percentile(tokens, 95),
    avgLlmCalls,
    avgGuardsFired,
    overlapStormRate: frac(overlapRuns),
    guardFrequency,
    failureModeRates,
    blindMetrics,
  };
}

export interface CohortDelta {
  readonly a: CohortStats;
  readonly b: CohortStats;
  /**
   * Trust-gated verdict on B-vs-A:
   *   - "B regresses"       : honesty loosened (dishonest↑ or deliverable↓) OR success dropped.
   *   - "B improves"        : honesty held AND (success↑ or tokens↓ at flat success).
   *   - "B neutral"         : honesty held, no material outcome/cost delta.
   *   - "inconclusive (blind)": a decisive metric is blind in a cohort — can't call it.
   */
  readonly verdict: "B improves" | "B regresses" | "B neutral" | "inconclusive (blind)";
  readonly reasons: readonly string[];
  readonly deltas: {
    readonly claimedSuccessRate: number;
    readonly dishonestSuspectedRate: number;
    readonly deliverableProducedRate: number;
    readonly tokensP50: number;
    readonly avgGuardsFired: number;
    readonly overlapStormRate: number;
  };
}

const EPS = 0.02; // rate noise floor

export function compareCohorts(a: CohortStats, b: CohortStats): CohortDelta {
  const deltas = {
    claimedSuccessRate: b.claimedSuccessRate - a.claimedSuccessRate,
    dishonestSuspectedRate: b.dishonestSuspectedRate - a.dishonestSuspectedRate,
    deliverableProducedRate: b.deliverableProducedRate - a.deliverableProducedRate,
    tokensP50: b.tokensP50 - a.tokensP50,
    avgGuardsFired: b.avgGuardsFired - a.avgGuardsFired,
    overlapStormRate: b.overlapStormRate - a.overlapStormRate,
  };
  const reasons: string[] = [];

  // ── Honesty gate (FIRST — a token/success win on loosened honesty is a regression) ──
  const honestyLoosened =
    deltas.dishonestSuspectedRate > EPS || deltas.deliverableProducedRate < -EPS;
  if (honestyLoosened) {
    if (deltas.dishonestSuspectedRate > EPS) reasons.push(`dishonest-success-suspected ↑ ${(deltas.dishonestSuspectedRate * 100).toFixed(0)}pp — honesty REGRESSED`);
    if (deltas.deliverableProducedRate < -EPS) reasons.push(`deliverable-produced ↓ ${(-deltas.deliverableProducedRate * 100).toFixed(0)}pp — honesty REGRESSED`);
    return { a, b, verdict: "B regresses", reasons, deltas };
  }

  // ── Coverage gate — a decisive metric blind in either cohort ──
  const decisiveBlind = [...new Set([...a.blindMetrics, ...b.blindMetrics])].filter((m) =>
    /overlap|token|cache/i.test(m),
  );

  // ── Outcome / cost ──
  if (deltas.claimedSuccessRate < -EPS) {
    reasons.push(`claimed-success ↓ ${(-deltas.claimedSuccessRate * 100).toFixed(0)}pp`);
    return { a, b, verdict: "B regresses", reasons, deltas };
  }
  const successUp = deltas.claimedSuccessRate > EPS;
  const tokensDown = a.tokensP50 > 0 && deltas.tokensP50 < -0.02 * a.tokensP50;
  const tokensUp = a.tokensP50 > 0 && deltas.tokensP50 > 0.05 * a.tokensP50;

  if (successUp) reasons.push(`claimed-success ↑ ${(deltas.claimedSuccessRate * 100).toFixed(0)}pp (honesty held)`);
  if (tokensDown) reasons.push(`tokensP50 ↓ ${(-deltas.tokensP50).toFixed(0)} (${a.tokensP50}→${b.tokensP50})`);
  if (tokensUp) reasons.push(`tokensP50 ↑ ${deltas.tokensP50.toFixed(0)} (${a.tokensP50}→${b.tokensP50})`);
  if (Math.abs(deltas.avgGuardsFired) > 0.5) reasons.push(`avg interventions ${deltas.avgGuardsFired > 0 ? "↑" : "↓"} ${Math.abs(deltas.avgGuardsFired).toFixed(1)}`);
  if (Math.abs(deltas.overlapStormRate) > EPS) reasons.push(`overlap-storm rate ${deltas.overlapStormRate > 0 ? "↑" : "↓"} ${Math.abs(deltas.overlapStormRate * 100).toFixed(0)}pp`);

  let verdict: CohortDelta["verdict"];
  if (successUp || (tokensDown && !tokensUp)) verdict = "B improves";
  else if (tokensUp && !successUp) {
    reasons.push("tokens up without success gain");
    verdict = "B regresses";
  } else verdict = "B neutral";

  // Coverage gate: blind metrics are ADDITIONAL signal. A verdict grounded in
  // PRESENT metrics (tokens/success/honesty) stands — note the blind ones as a
  // caveat. But a "neutral" call is only trustworthy if nothing decisive is
  // blind: a real delta could be hiding in the unwired signal → inconclusive.
  if (decisiveBlind.length > 0) {
    reasons.push(`⚠ additional signal BLIND (not wired): ${decisiveBlind.join("; ")}`);
    if (verdict === "B neutral") verdict = "inconclusive (blind)";
  }

  if (reasons.length === 0) reasons.push("no material delta (honesty held)");
  return { a, b, verdict, reasons, deltas };
}

export function renderCohortDelta(d: CohortDelta): string {
  const L: string[] = [];
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  L.push(`═══ ${d.b.label} vs ${d.a.label}  →  ${d.verdict.toUpperCase()} ═══`);
  L.push(`  n: ${d.a.label}=${d.a.n}  ${d.b.label}=${d.b.n}`);
  L.push(`  claimed-success: ${pct(d.a.claimedSuccessRate)} → ${pct(d.b.claimedSuccessRate)}`);
  L.push(`  dishonest-suspected: ${pct(d.a.dishonestSuspectedRate)} → ${pct(d.b.dishonestSuspectedRate)}   (honesty gate)`);
  L.push(`  deliverable-produced: ${pct(d.a.deliverableProducedRate)} → ${pct(d.b.deliverableProducedRate)}   (honesty gate)`);
  L.push(`  tokensP50: ${d.a.tokensP50} → ${d.b.tokensP50}   tokensP95: ${d.a.tokensP95} → ${d.b.tokensP95}`);
  L.push(`  avg interventions: ${d.a.avgGuardsFired.toFixed(1)} → ${d.b.avgGuardsFired.toFixed(1)}   overlap-storm rate: ${pct(d.a.overlapStormRate)} → ${pct(d.b.overlapStormRate)}`);
  L.push(`  WHY:`);
  for (const r of d.reasons) L.push(`    - ${r}`);
  return L.join("\n");
}
