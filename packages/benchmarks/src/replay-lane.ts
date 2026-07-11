// bench:replay — the deterministic capability lane CI runs keyless.
//
// Loads every committed golden in packages/benchmarks/golden/, rebuilds a REAL
// agent over each recording (makeReplayAgent), replays it with NO live
// provider, and FAILS on any divergence:
//   - output mismatch (replayed deliverable != recorded run-completed.output)
//   - LLM-table under-consumption (replay made fewer model calls than recorded)
//   - LLM-table over-consumption / control-flow divergence (the sequential
//     table misses → the replay LLM layer dies loudly → surfaced as a failure)
//   - tool-sequence divergence (name + argsHash per call, from the replayed
//     run's own reasoning steps vs the recorded tool table)
//   - sidecar expectation failures (expectOutputIncludes / expectToolsUsed):
//     a replay that faithfully matches a GARBAGE recording is still caught.
import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import {
  diffTraces,
  loadRecordedRun,
  snapshotFromAgentResult,
  snapshotFromRecordedRun,
  type RecordedRun,
} from "@reactive-agents/replay";
import { makeReplayAgent, type ReplayAgentOptions } from "./replay-agent.js";

// ─── Golden sidecar ───────────────────────────────────────────────────────────

/**
 * Committed next to each golden as `<name>.expect.json`. Carries the harness
 * config the recording ran with (recordings do not serialize config —
 * `run-started.config` is `{}`) plus record-side truth assertions.
 */
export interface GoldenSidecar {
  readonly name: string;
  /** The task text (run-started.task is "" — trace-completeness gap). */
  readonly task: string;
  readonly strategy?: string;
  readonly builtins?: readonly string[];
  readonly requiredTools?: readonly string[];
  readonly maxIterations?: number;
  /** "live" replays real builtin tools inside fileRoot; "recorded" dispenses from the tool table. */
  readonly toolMode?: "recorded" | "live";
  /** Absolute NEUTRAL path (no user segments) recreated by the lane before replay. */
  readonly fileRoot?: string;
  /** Record-side truth: substrings the replayed deliverable must contain. */
  readonly expectOutputIncludes?: readonly string[];
  /** Record-side truth: exact successful tool-name set (order-insensitive). */
  readonly expectToolsUsed?: readonly string[];
}

export interface GoldenCheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly dispensed: number;
  readonly tableSize: number;
  readonly durationMs: number;
}

// ─── Core check (exported so the mutation-proof test can corrupt a run in-memory) ──

export async function checkRecordedRun(
  run: RecordedRun,
  sidecar: GoldenSidecar,
): Promise<GoldenCheckResult> {
  const started = Date.now();
  const failures: string[] = [];

  if (run.llmTable.size === 0) {
    return {
      name: sidecar.name,
      ok: false,
      failures: ["golden contains no llm-exchange events — nothing to replay"],
      dispensed: 0,
      tableSize: 0,
      durationMs: Date.now() - started,
    };
  }

  // The lane recreates the exact fileRoot the recording used, so live tool
  // calls resolve to byte-identical absolute paths (argsHash parity).
  if (sidecar.toolMode === "live" && sidecar.fileRoot !== undefined) {
    rmSync(sidecar.fileRoot, { recursive: true, force: true });
    mkdirSync(sidecar.fileRoot, { recursive: true });
  }

  const opts: ReplayAgentOptions = {
    strategy: sidecar.strategy,
    traceDir: null,
    builtins: sidecar.builtins,
    requiredTools: sidecar.requiredTools,
    maxIterations: sidecar.maxIterations,
    adaptiveTools: false,
    toolMode: sidecar.toolMode ?? "recorded",
    fileRoot: sidecar.fileRoot,
  };

  let dispensed = 0;
  const tableSize = run.llmTable.size;
  try {
    const handle = await makeReplayAgent(run, opts);
    try {
      const outcome = await handle.run(sidecar.task);
      dispensed = handle.stats().dispensed;

      const original = snapshotFromRecordedRun(run);
      const replayed = snapshotFromAgentResult(outcome, run);
      const diff = diffTraces(original, replayed);

      if (!diff.outputDiff.equal) {
        failures.push(
          `output mismatch: recorded ${JSON.stringify(diff.outputDiff.original)?.slice(0, 120)} vs replay ${JSON.stringify(diff.outputDiff.replay)?.slice(0, 120)}`,
        );
      }
      if (dispensed < tableSize) {
        failures.push(
          `LLM-table under-consumption: replay dispensed ${dispensed}/${tableSize} recorded exchanges — the replayed harness made fewer model calls than the recording`,
        );
      }
      if (diff.toolSequenceDiff.length > 0) {
        failures.push(
          `tool-sequence divergence: ${JSON.stringify(diff.toolSequenceDiff).slice(0, 300)}`,
        );
      }
      for (const needle of sidecar.expectOutputIncludes ?? []) {
        if (!(outcome.output ?? "").includes(needle)) {
          failures.push(`record-side truth failed: output does not include ${JSON.stringify(needle)}`);
        }
      }
      if (sidecar.expectToolsUsed !== undefined) {
        const used = [...new Set((outcome.toolCalls ?? []).filter((t) => t.ok).map((t) => t.toolName))].sort();
        const expected = [...sidecar.expectToolsUsed].sort();
        if (JSON.stringify(used) !== JSON.stringify(expected)) {
          failures.push(
            `record-side truth failed: toolsUsed ${JSON.stringify(used)} != expected ${JSON.stringify(expected)}`,
          );
        }
      }
    } finally {
      await handle.dispose();
    }
  } catch (e) {
    // Table miss / over-consumption / any control-flow divergence dies loudly
    // inside the replay layers — surfaced here instead of crashing the lane.
    failures.push(`replay run failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    name: sidecar.name,
    ok: failures.length === 0,
    failures,
    dispensed,
    tableSize,
    durationMs: Date.now() - started,
  };
}

// ─── Golden discovery + file-level entrypoints ────────────────────────────────

export function goldenDir(): string {
  // src/ and dist/ are both one level below the package root.
  return join(import.meta.dir, "..", "golden");
}

export interface GoldenEntry {
  readonly goldenPath: string;
  readonly sidecarPath: string;
  readonly sidecar: GoldenSidecar;
}

export function listGoldens(dir: string = goldenDir()): GoldenEntry[] {
  if (!existsSync(dir)) return [];
  const entries: GoldenEntry[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".jsonl")) continue;
    const name = basename(f, ".jsonl");
    const sidecarPath = join(dir, `${name}.expect.json`);
    if (!existsSync(sidecarPath)) {
      throw new Error(`golden ${f} has no sidecar ${name}.expect.json — every golden must carry record-side truth`);
    }
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as GoldenSidecar;
    entries.push({ goldenPath: join(dir, f), sidecarPath, sidecar });
  }
  return entries;
}

export async function checkGolden(entry: GoldenEntry): Promise<GoldenCheckResult> {
  const run = await loadRecordedRun(entry.goldenPath);
  return checkRecordedRun(run, entry.sidecar);
}

/** Run the whole lane. Returns process-style exit code (0 = green). */
export async function runReplayLane(dir: string = goldenDir()): Promise<number> {
  const entries = listGoldens(dir);
  if (entries.length === 0) {
    console.error(`bench:replay: no goldens found in ${dir} — run bench:replay:record first`);
    return 1;
  }
  let failed = 0;
  for (const entry of entries) {
    const res = await checkGolden(entry);
    const badge = res.ok ? "PASS" : "FAIL";
    console.log(
      `[bench:replay] ${badge} ${res.name} (${res.dispensed}/${res.tableSize} exchanges, ${res.durationMs}ms)`,
    );
    if (!res.ok) {
      failed++;
      for (const f of res.failures) console.log(`  - ${f}`);
    }
  }
  console.log(`[bench:replay] ${entries.length - failed}/${entries.length} goldens green`);
  return failed === 0 ? 0 : 1;
}
