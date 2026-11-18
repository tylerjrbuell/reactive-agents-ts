// Spike S3: replay saved cells through the REAL v1 lift gate (evaluateLiftGate), the same
// way wiki/Research/Ablations/*/to-session.ts adapters do, so v1 vs v2 compare like for like.
import { aggregateRuns } from "../aggregate.js";
import { evaluateLiftGate } from "../gate/gate.js";
import { DEFAULT_LIFT_POLICY, type GateDecision, type GateVerdict, type LiftPolicy } from "../gate/types.js";
import type { RunScore, SessionReport, TaskVariantReport } from "../types.js";
import { type SavedCell, billed, groupByTierTask, isMeasured } from "./cells.js";
import { mean } from "./stats.js";

const toRun = (c: SavedCell, i: number): RunScore => ({
  runIndex: i,
  dimensions: [
    {
      dimension: "accuracy",
      score: c.accuracy ?? 0,
      evidence: "",
      ...(isMeasured(c) ? {} : { scoreState: "inconclusive" as const }),
    },
  ],
  tokensUsed: c.tokens,
  ...(c.billedTokens !== null ? { billedTokens: c.billedTokens } : {}),
  durationMs: c.durationMs,
  output: "",
  status: c.status === "pass" ? "pass" : c.status === "error" ? "error" : "fail",
});

const arm = (variantId: string, cells: readonly SavedCell[]): readonly TaskVariantReport[] =>
  [...groupByTierTask(cells)].map(([key, cs]) => {
    const [tier, taskId] = key.split("\u0000") as [string, string];
    const measured = cs.filter(isMeasured);
    return {
      ...aggregateRuns(taskId, tier, { type: "internal", id: variantId, label: variantId, config: {} }, cs.map(toRun)),
      meanTokens: mean(measured.map((c) => c.tokens)) || 0,
      meanBilledTokens: mean(measured.map(billed)) || 0,
      meanCacheReadTokens: 0,
    };
  });

/**
 * Evaluate the v1 lift gate over saved baseline and candidate cells.
 *
 * @param base Baseline cells (all tiers).
 * @param cand Candidate cells (all tiers).
 * @param policy Policy override (defaults to DEFAULT_LIFT_POLICY, as `rax eval gate` uses).
 * @returns The v1 gate verdict.
 */
export function v1Evaluate(base: readonly SavedCell[], cand: readonly SavedCell[], policy: LiftPolicy = DEFAULT_LIFT_POLICY): GateVerdict {
  const taskReports: readonly TaskVariantReport[] = [...arm("base", base), ...arm("cand", cand)];
  const report = { taskReports } as SessionReport;
  return evaluateLiftGate(report, "base", "cand", policy);
}

/** True when v1 treats the decision as a rejection. */
export const v1Rejects = (d: GateDecision): boolean => d === "reject";
