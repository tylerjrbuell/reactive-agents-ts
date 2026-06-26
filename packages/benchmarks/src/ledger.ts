// File: src/ledger.ts
// ImprovementLedger (L4) — the gate-driven dogfood improvement chain:
//   weakness → hypothesis → gate verdict → regression-baseline.
//
// COMPLEMENTS (does not replace) the harness-improvement-loop skill's
// `loop-state.json`: that file tracks the PROBE loop (passes, probeHistory,
// coverageMap, and probe-metric baselines such as iterations / kernel-steps).
// THIS ledger tracks the GATE-driven loop (lift-percentage verdicts). The two
// are distinct concerns — no duplication. An entry may cross-reference a
// loop-state.json `knownWeakness.id` via `weaknessRef`.
// Pure core (recordGateOutcome / formatLedger) takes `id` + `createdAt` as
// inputs so it stays deterministic; load/save are the only fs functions.
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

export interface ImprovementEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly weakness: string;
  readonly weaknessRef?: string; // cross-ref to loop-state.json knownWeakness.id
  readonly hypothesis: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
  readonly decision: GateDecision;
  readonly liftPp: number;
  readonly tokenOverheadPct: number;
  readonly rationale: string;
  readonly regressionBaseline?: RegressionBaseline;
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
