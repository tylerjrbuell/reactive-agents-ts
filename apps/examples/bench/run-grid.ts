import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { TIERS, type Tier } from "./tiers.js";
import { gradeDeliverable } from "./faithfulness.js";
import { getTask } from "./tasks.js";

export interface Arm {
  readonly label: string;                       // "baseline" | "candidate"
  readonly env: Record<string, string>;         // arm-distinguishing env (e.g. { RA_OVERHAUL: "1" })
}
export interface Cell {
  readonly tier: Tier;
  readonly taskId: string;
  readonly arm: Arm;
  readonly run: number;                          // 0..n-1
}
export interface GridConfig {
  readonly tiers: readonly Tier[];
  readonly taskIds: readonly string[];
  readonly arms: readonly Arm[];
  readonly n: number;
}

/** Pure: expand the grid into ordered cells. */
export function planCells(cfg: GridConfig): Cell[] {
  const cells: Cell[] = [];
  for (const tier of cfg.tiers)
    for (const taskId of cfg.taskIds)
      for (const arm of cfg.arms)
        for (let run = 0; run < cfg.n; run++) cells.push({ tier, taskId, arm, run });
  return cells;
}

/** Run one cell via spot-test; grade + append its result line to the per-arm/tier manifest. */
function runCell(cell: Cell, outDir: string): void {
  const tierSpec = TIERS.find((t) => t.tier === cell.tier);
  if (!tierSpec) throw new Error(`no tier spec: ${cell.tier}`);
  const env = {
    ...process.env,
    ...cell.arm.env,
    SPOT_PROVIDER: tierSpec.provider,
    SPOT_MODEL: tierSpec.model,
    SPOT_TASK_ID: cell.taskId,
  };
  const res = spawnSync("bun", ["run", "apps/examples/spot-test.ts"], { env, encoding: "utf8" });
  const line = (res.stdout ?? "").split("\n").find((l) => l.startsWith("SPOT_RESULT_JSON="));
  const manifest = `${outDir}/manifest-${cell.arm.label}-${cell.tier}.jsonl`;
  const parsed = line ? JSON.parse(line.slice("SPOT_RESULT_JSON=".length)) : { error: "no result line", taskId: null };
  // Grade faithfulness NOW — the deliverable path (./bench-out/<taskId>.md) is fixed per
  // task, so the next cell/arm/run overwrites it. Per-cell grading avoids the overwrite race.
  const faithfulness = gradeDeliverable(cell.taskId, getTask(cell.taskId).expectedSections, outDir).coverage;
  appendFileSync(
    manifest,
    JSON.stringify({ tier: cell.tier, task: cell.taskId, run: cell.run, faithfulness, result: parsed }) + "\n",
  );
}

export function runGrid(cfg: GridConfig, outDir = "./bench-out"): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/grid-config.json`, JSON.stringify(cfg, null, 2));
  for (const cell of planCells(cfg)) runCell(cell, outDir);
}

// CLI entry: `bun run apps/examples/bench/run-grid.ts` (uses default config).
if (import.meta.main) {
  runGrid({
    tiers: ["local", "mid", "frontier"],
    taskIds: ["overflow-summarize", "overflow-transcribe", "multi-result-accumulation", "recall-temptation", "dishonest-success-bait"],
    arms: [
      { label: "baseline", env: {} },
      { label: "candidate", env: { RA_OVERHAUL: "1" } },
    ],
    n: 3,
  });
}
