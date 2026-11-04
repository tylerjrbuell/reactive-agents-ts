// File: src/ledger.ts
// ImprovementLedger (L4) — the dogfood improvement chain:
//   weakness → hypothesis → verdict → regression-baseline.
//
// The single committed record of the harness-improvement loop
// (`wiki/Research/Harness-Reports/improvement-ledger.json`). Two writers:
//   - `rax eval gate --ledger` → a lift-gate verdict (recordGateOutcome);
//   - `src/h3/verdict.ts --ledger` → a targeted attribution verdict
//     (recordAttributionOutcome): did the targeted harness reason drop?
// Pure core (record* / formatLedger) takes `id` + `createdAt` as inputs so it
// stays deterministic; load/save are the only fs functions.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GateDecision, GateVerdict } from "./gate/types.js";

export const LEDGER_VERSION = 1;

export type ImprovementStatus = "adopted" | "opt-in" | "rejected";

export interface RegressionBaseline {
  readonly metric: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
  readonly liftPp: number;
  readonly tokenOverheadPct: number;
  readonly tiersCovered: number;
  readonly pinnedAt: string;
}

/**
 * Verdict of a targeted attribution rerun (`src/h3/verdict.ts`): did the
 * targeted harness-attributable reason drop, with no new harness reason?
 * - `fixed`: target 0 after, no other harness reason rose.
 * - `improved`: target dropped (not to 0), no other harness reason rose.
 * - `shifted`: target dropped, but another harness reason rose (the runs now
 *   fail later, on a different harness defect). Not a success.
 * - `no-change`: target did not drop.
 * - `regressed`: target rose, or the pooled pass rate dropped resolvably.
 */
export type AttributionDecision = "fixed" | "improved" | "shifted" | "no-change" | "regressed";

/** Evidence behind an {@link AttributionDecision} entry. */
export interface AttributionEvidence {
  /** The targeted attribution reason, e.g. `harness:tool-call-dropped`. */
  readonly reason: string;
  /** Runs carrying `reason` before / after, over the same targeted cells. */
  readonly before: number;
  readonly after: number;
  /** Other `harness:*` reasons whose count rose. Non-empty ⇒ not `fixed`/`improved`. */
  readonly newHarnessReasons: readonly string[];
  /** True iff the pooled pass-rate change has disjoint 95% Wilson intervals. */
  readonly passRateResolvable: boolean;
  /** Targeted cells, `tier|taskId`. */
  readonly cells: readonly string[];
}

export interface ImprovementEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  /** Free-form cross-reference (issue id, failure-mode id, attribution reason). */
  readonly weaknessRef?: string;
  readonly hypothesis: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
  readonly decision: GateDecision | AttributionDecision;
  /** Gate entries: lift on the gate metric. Attribution entries: pooled pass-rate delta. */
  readonly liftPp: number;
  /** Gate entries: scored token overhead. Attribution entries: mean billed-token delta (0 when unbilled). */
  readonly tokenOverheadPct: number;
  readonly rationale: string;
  readonly regressionBaseline?: RegressionBaseline;
  /** Present only on attribution entries. */
  readonly attribution?: AttributionEvidence;
  readonly status: ImprovementStatus;
}

export interface ImprovementLedger {
  readonly version: number;
  readonly entries: readonly ImprovementEntry[];
}

export interface RecordGateParams {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  readonly weaknessRef?: string;
  readonly hypothesis: string;
  readonly metric: string;
  readonly verdict: GateVerdict;
}

export function emptyLedger(): ImprovementLedger {
  return { version: LEDGER_VERSION, entries: [] };
}

function statusFor(decision: GateDecision): ImprovementStatus {
  return decision === "default-on" ? "adopted" : decision === "opt-in" ? "opt-in" : "rejected";
}

export function recordGateOutcome(
  ledger: ImprovementLedger,
  p: RecordGateParams,
): ImprovementLedger {
  const decision = p.verdict.decision;
  const agg = p.verdict.aggregate;
  // Pin a regression-baseline only for a real positive lift worth protecting.
  const pin = decision !== "reject" && agg.liftPp > 0;
  const entry: ImprovementEntry = {
    id: p.id,
    createdAt: p.createdAt,
    weakness: p.weakness,
    ...(p.weaknessRef ? { weaknessRef: p.weaknessRef } : {}),
    hypothesis: p.hypothesis,
    baselineVariantId: p.verdict.baselineVariantId,
    candidateVariantId: p.verdict.candidateVariantId,
    decision,
    liftPp: agg.liftPp,
    tokenOverheadPct: agg.tokenOverheadPct,
    rationale: p.verdict.rationale,
    ...(pin
      ? {
          regressionBaseline: {
            metric: p.metric,
            baselineVariantId: p.verdict.baselineVariantId,
            candidateVariantId: p.verdict.candidateVariantId,
            liftPp: agg.liftPp,
            tokenOverheadPct: agg.tokenOverheadPct,
            tiersCovered: agg.tiersCovered,
            pinnedAt: p.createdAt,
          },
        }
      : {}),
    status: statusFor(decision),
  };
  return { version: ledger.version, entries: [...ledger.entries, entry] };
}

/** Input to {@link recordAttributionOutcome}. */
export interface RecordAttributionParams {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  readonly hypothesis: string;
  /** Harness variant both arms ran (H3: `ra-default`). */
  readonly variantId: string;
  readonly decision: AttributionDecision;
  readonly passRateDeltaPp: number;
  readonly tokenDeltaPct: number | null;
  readonly rationale: string;
  readonly attribution: AttributionEvidence;
}

/**
 * Append a targeted attribution verdict. `fixed` / `improved` record as
 * `adopted` (the fix stays on the path it targeted); `shifted` / `no-change` /
 * `regressed` as `rejected`. Promotion to default-on still needs the full H3 + lift gate.
 */
export function recordAttributionOutcome(
  ledger: ImprovementLedger,
  p: RecordAttributionParams,
): ImprovementLedger {
  const entry: ImprovementEntry = {
    id: p.id,
    createdAt: p.createdAt,
    weakness: p.weakness,
    weaknessRef: p.attribution.reason,
    hypothesis: p.hypothesis,
    baselineVariantId: `before:${p.variantId}`,
    candidateVariantId: `after:${p.variantId}`,
    decision: p.decision,
    liftPp: p.passRateDeltaPp,
    tokenOverheadPct: p.tokenDeltaPct ?? 0,
    rationale: p.rationale,
    attribution: p.attribution,
    status: p.decision === "fixed" || p.decision === "improved" ? "adopted" : "rejected",
  };
  return { version: ledger.version, entries: [...ledger.entries, entry] };
}

export function formatLedger(ledger: ImprovementLedger): string {
  if (ledger.entries.length === 0) return "Improvement ledger: no entries.";
  const header = `Improvement ledger · ${ledger.entries.length} entr${ledger.entries.length === 1 ? "y" : "ies"}`;
  const rows = ledger.entries.map((e) => {
    const lift = `${e.liftPp >= 0 ? "+" : ""}${e.liftPp.toFixed(1)}pp`;
    const pin = e.regressionBaseline ? " [baseline pinned]" : "";
    return `  ${e.status.padEnd(8)} ${e.candidateVariantId} vs ${e.baselineVariantId}  ${lift}  — ${e.weakness}${pin}`;
  });
  return [header, ...rows].join("\n");
}

export async function loadLedger(path: string): Promise<ImprovementLedger> {
  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { version?: unknown }).version !== "number" ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return emptyLedger();
    }
    return parsed as ImprovementLedger;
  } catch {
    return emptyLedger();
  }
}

export async function saveLedger(path: string, ledger: ImprovementLedger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2), "utf8");
}
