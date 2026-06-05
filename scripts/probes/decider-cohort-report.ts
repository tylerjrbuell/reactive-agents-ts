/**
 * decider-cohort-report.ts — aggregate a decider-baseline grid into per-tier
 * CohortStats (the locked thick-baseline the capability-lever arm compares against).
 *
 * Reads a grid manifest (`manifest.jsonl`, one line per cell with the run's taskId),
 * groups taskIds by tier, loads each run's JSONL trace from ~/.reactive-agents/traces,
 * and renders an honesty-gated cohort report per tier. Single-arm: locks the baseline.
 * Compare a second arm later with compareCohorts(baseline, arm).
 *
 * Usage:
 *   bun run decider-cohort-report.ts <OUT_dir_or_manifest.jsonl> [--label thick-baseline]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  loadTrace,
  aggregateCohort,
  analyzeRun,
  renderRunReport,
  type Trace,
} from "@reactive-agents/trace";

const TRACE_DIR = join(homedir(), ".reactive-agents", "traces");

interface ManifestRow {
  tier: string;
  task: string;
  result?: { taskId?: string | null; success?: boolean | null; terminatedBy?: string | null };
}

async function main() {
  const argPath = process.argv[2];
  if (!argPath) {
    console.error("usage: bun run decider-cohort-report.ts <OUT_dir_or_manifest.jsonl> [--label LABEL]");
    process.exit(1);
  }
  const labelFlag = process.argv.indexOf("--label");
  const baseLabel = labelFlag >= 0 ? process.argv[labelFlag + 1]! : "thick-baseline";

  const manifestPath = argPath.endsWith(".jsonl") ? argPath : join(argPath, "manifest.jsonl");
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const rows: ManifestRow[] = (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ManifestRow);

  // Group taskIds by tier (the cohort axis). A cell with no taskId (timeout/crash)
  // is reported but excluded from the cohort — never treated as a real zero.
  const byTier = new Map<string, { taskIds: string[]; missing: number }>();
  for (const r of rows) {
    const t = byTier.get(r.tier) ?? { taskIds: [], missing: 0 };
    const id = r.result?.taskId;
    if (typeof id === "string" && id.length > 0) t.taskIds.push(id);
    else t.missing++;
    byTier.set(r.tier, t);
  }

  console.log(`\n══════ DECIDER BASELINE COHORT — ${baseLabel} ══════`);
  console.log(`manifest: ${manifestPath}  (${rows.length} cells, ${byTier.size} tiers)\n`);

  for (const [tier, { taskIds, missing }] of byTier) {
    const traces: Trace[] = [];
    let unreadable = 0;
    for (const id of taskIds) {
      const p = join(TRACE_DIR, `${id}.jsonl`);
      if (!existsSync(p)) { unreadable++; continue; }
      try { traces.push(await loadTrace(p)); } catch { unreadable++; }
    }
    const label = `${baseLabel}:${tier}`;
    const stats = aggregateCohort(label, traces);

    console.log(`\n┌─ TIER ${tier} ─ n=${stats.n} (cells=${taskIds.length + missing}, missing-taskId=${missing}, unreadable-trace=${unreadable})`);
    console.log(`│  claimed-success: ${(stats.claimedSuccessRate * 100).toFixed(0)}%   (pass^n all-claimed: ${stats.allClaimedSuccess})`);
    console.log(`│  dishonest-suspected: ${(stats.dishonestSuspectedRate * 100).toFixed(0)}%   deliverable-produced: ${(stats.deliverableProducedRate * 100).toFixed(0)}%   (honesty gates)`);
    console.log(`│  honesty distribution: ${JSON.stringify(stats.honestyDistribution)}`);
    console.log(`│  tokens p50/p95: ${stats.tokensP50}/${stats.tokensP95}   avg llmCalls: ${stats.avgLlmCalls.toFixed(1)}`);
    console.log(`│  avg guards-fired: ${stats.avgGuardsFired.toFixed(1)}   overlap-storm rate: ${(stats.overlapStormRate * 100).toFixed(0)}%`);
    console.log(`│  guard frequency: ${JSON.stringify(stats.guardFrequency)}`);
    console.log(`│  failure-mode rates: ${JSON.stringify(stats.failureModeRates)}`);
    console.log(`│  blind metrics: ${stats.blindMetrics.join(", ") || "(none)"}`);
    console.log(`└─`);
  }

  // Per-run terminal detail (cheap, helps eyeball the terminatedBy distribution
  // the D3 fix made truthful).
  console.log(`\n── per-run terminal decisions ──`);
  for (const r of rows) {
    const id = r.result?.taskId;
    if (typeof id !== "string" || !existsSync(join(TRACE_DIR, `${id}.jsonl`))) {
      console.log(`  ${r.tier}/${r.task}: NO TRACE (success=${r.result?.success ?? "?"}, terminatedBy=${r.result?.terminatedBy ?? "?"})`);
      continue;
    }
    const a = analyzeRun(await loadTrace(join(TRACE_DIR, `${id}.jsonl`)));
    const term = a.interventions.terminalDecision?.reason ?? a.terminatedBy ?? "?";
    console.log(`  ${r.tier}/${r.task}: ${a.honesty.label}  ended-by=${term}  tokens=${a.cost.totalTokens}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
