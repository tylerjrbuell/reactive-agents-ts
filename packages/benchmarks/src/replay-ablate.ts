// replay-ablate — zero-token mechanism triage.
//
// WHAT THIS IS FOR. Measurement used to have two modes and nothing between:
// deterministic cells (free, ~1s — does the mechanism FIRE?) and live arms
// (hours + dollars — does it HELP?). Every promotion question jumped to the
// expensive one, which is why six lift measurements exist against 83 withers
// and 43 env flags. `low_delta_guard` alone cost a multi-hour campaign plus
// three VOID arm-sets.
//
// This is the middle tier. The replay lane rebuilds a REAL agent over a
// recorded LLM table with no provider, so a harness variant can be run against
// a fixed model trajectory for free. The effect signal is TABLE CONSUMPTION:
//
//   dispensed < tableSize   the variant STOPPED EARLY  — the guard-misfire detector
//   table exhausted / miss  the variant ran FURTHER than the recording
//   tool-sequence diff      the variant changed control flow, and where
//   output mismatch         the variant changed the deliverable
//
// Any of these = the mechanism is LIVE on that shape. None of them, across the
// whole corpus = the mechanism is INERT and is a deletion or demotion
// candidate — decided without spending a live arm on it.
//
// SCOPE LIMIT, do not overread. This measures CONTROL FLOW, not accuracy. A
// mechanism that changes the PROMPT makes the model say something different,
// which a fixed table cannot simulate — those still need live arms (e.g.
// RA_THOUGHT_CONTINUITY). A flag reported INERT here is inert *on the recorded
// shapes*, which is a statement about the corpus as much as the mechanism:
// grow the corpus before reading INERT as "safe to delete".
//
// Run one flag per PROCESS: several flags are read at module load, so toggling
// in-process would not take effect. The runner spawns this file per flag.
//
//   bun run packages/benchmarks/src/replay-ablate.ts <FLAG> [value]
//   bun run packages/benchmarks/src/replay-ablate.ts --baseline
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadRecordedRun } from "@reactive-agents/replay";
import { checkRecordedRun, goldenDir, type GoldenSidecar } from "./replay-lane.js";

export interface AblationCell {
  readonly golden: string;
  readonly ok: boolean;
  readonly dispensed: number;
  readonly tableSize: number;
  /** First divergence line, trimmed — absent when the cell matched. */
  readonly failure?: string;
}

export interface AblationResult {
  readonly flag: string;
  readonly value: string | undefined;
  readonly cells: readonly AblationCell[];
}

/** Replay every committed golden once under the CURRENT process env. */
export async function ablateAllGoldens(): Promise<readonly AblationCell[]> {
  const dir = goldenDir();
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""))
    .sort();

  const cells: AblationCell[] = [];
  for (const name of names) {
    const sidecar = JSON.parse(readFileSync(join(dir, `${name}.expect.json`), "utf8")) as GoldenSidecar;
    // Re-load per cell: a RecordedRun's LLM table is a consumable cursor.
    const run = await loadRecordedRun(join(dir, `${name}.jsonl`));
    try {
      const r = await checkRecordedRun(run, sidecar);
      cells.push({
        golden: name,
        ok: r.ok,
        dispensed: r.dispensed,
        tableSize: r.tableSize,
        ...(r.ok ? {} : { failure: (r.failures[0] ?? "").replace(/\s+/g, " ").slice(0, 140) }),
      });
    } catch (e) {
      // A hard throw (e.g. the replay LLM layer dying on a table miss) IS a
      // divergence, not an infrastructure error — record it as one rather than
      // aborting the sweep.
      cells.push({
        golden: name,
        ok: false,
        dispensed: 0,
        tableSize: run.llmTable.size,
        failure: `THREW: ${String(e).replace(/\s+/g, " ").slice(0, 120)}`,
      });
    }
  }
  return cells;
}

if (import.meta.main) {
  const [flagArg, valueArg] = process.argv.slice(2);
  const isBaseline = flagArg === "--baseline" || flagArg === undefined;
  const flag = isBaseline ? "(baseline)" : flagArg;
  const value = isBaseline ? undefined : (valueArg ?? "1");
  if (!isBaseline) process.env[flag] = value;

  const cells = await ablateAllGoldens();
  const out: AblationResult = { flag, value, cells };
  // Single machine-readable line; the runner aggregates.
  console.log(`__ABLATE__${JSON.stringify(out)}`);
}
