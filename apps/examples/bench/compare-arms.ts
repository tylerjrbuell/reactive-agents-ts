import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { loadTrace, aggregateCohort, compareCohorts, renderCohortDelta, type Trace } from "@reactive-agents/trace";
import { benchVerdict } from "./verdict.js";

const TRACE_DIR = join(homedir(), ".reactive-agents", "traces");

export interface ManifestRow {
  readonly tier: string;
  readonly task: string;
  readonly run: number;
  /** Per-cell faithfulness, graded by run-grid at run time (avoids the deliverable overwrite race). */
  readonly faithfulness?: number;
  readonly result: { taskId?: string | null; success?: boolean | null; benchTaskId?: string | null; expectedSections?: string[] };
}

/** pass^k: 1 iff every run in the rows claimed success. */
export function passKFromManifest(rows: readonly ManifestRow[]): number {
  if (rows.length === 0) return 0;
  return rows.every((r) => r.result.success === true) ? 1 : 0;
}

/** mean per-cell faithfulness (graded at run time by run-grid; read from the manifest row). */
export function meanFaithfulness(rows: readonly ManifestRow[]): number {
  const graded = rows.map((r) => r.faithfulness).filter((x): x is number => typeof x === "number");
  if (graded.length === 0) return 0;
  return graded.reduce((s, x) => s + x, 0) / graded.length;
}

function readManifest(path: string): ManifestRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ManifestRow);
}

function loadTraces(rows: readonly ManifestRow[]): Trace[] {
  const out: Trace[] = [];
  for (const r of rows) {
    const id = r.result.taskId;
    if (typeof id === "string" && existsSync(join(TRACE_DIR, `${id}.jsonl`))) out.push(loadTrace(join(TRACE_DIR, `${id}.jsonl`)));
  }
  return out;
}

/** Compare baseline vs candidate per tier; print BenchVerdict each. CLI: bun run compare-arms.ts <outDir> */
export function compareArms(outDir = "./bench-out"): void {
  for (const tier of ["local", "mid", "frontier"]) {
    const base = readManifest(`${outDir}/manifest-baseline-${tier}.jsonl`);
    const cand = readManifest(`${outDir}/manifest-candidate-${tier}.jsonl`);
    if (base.length === 0 || cand.length === 0) {
      console.log(`\n── ${tier}: missing arm (base=${base.length}, cand=${cand.length}) ──`);
      continue;
    }
    const cohort = compareCohorts(
      aggregateCohort(`baseline:${tier}`, loadTraces(base)),
      aggregateCohort(`candidate:${tier}`, loadTraces(cand)),
    );
    const v = benchVerdict({
      cohort,
      faithfulnessDelta: meanFaithfulness(cand) - meanFaithfulness(base),
      passKDelta: passKFromManifest(cand) - passKFromManifest(base),
    });
    console.log(`\n${renderCohortDelta(cohort)}`);
    console.log(`  BENCH VERDICT [${tier}]: ${v.pass ? "PASS (equal-or-better)" : v.inconclusive ? "INCONCLUSIVE" : "FAIL"}`);
    for (const r of v.reasons) console.log(`    - ${r}`);
  }
}

if (import.meta.main) compareArms(process.argv[2]);
