// `rax-diagnose cause <runId|path>` — deterministic failure-cause classifier.
//
// Single-run mode prints cause, confidence, evidence and the trace signals
// that would have made the verdict decisive, plus the harness-vs-model
// attribution (`attribution` in --json). `--all [dir]` tallies causes
// across a directory of traces (audit §1.5 rule 13 cohort mode).

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  analyzeCause,
  attributeFailure,
  renderCause,
  tallyCauses,
  loadTrace,
  classifyProvenance,
  type CauseAnalysis,
  type CauseTally,
} from "@reactive-agents/trace";
import { candidateTraceDirs, resolveTracePath } from "../lib/resolve.js";

/** Options for {@link causeCommand}. */
export interface CauseOpts {
  readonly json?: boolean;
  /** Cohort mode: tally causes across every trace under the target directory. */
  readonly all?: boolean;
  /** Cohort mode only: exclude synthetic (`test` provider/model) traces. */
  readonly real?: boolean;
}

/** Recursively list `.jsonl` trace files under `dir`, skipping the shared `llm-direct.jsonl` sink. */
export async function listTraceFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true });
  return entries
    .filter((e) => e.endsWith(".jsonl") && basename(e) !== "llm-direct.jsonl")
    .map((e) => join(dir, e))
    .sort();
}

/** One classified file in a cohort. */
export interface CohortCause {
  readonly path: string;
  readonly analysis: CauseAnalysis;
}

/**
 * Classify every trace under `dirs`. Files with no events, or with neither a
 * `run-started` nor a terminal event (stray sinks), are skipped.
 */
export async function classifyDirectories(
  dirs: readonly string[],
  opts: { readonly real?: boolean } = {},
): Promise<readonly CohortCause[]> {
  const out: CohortCause[] = [];
  for (const dir of dirs) {
    for (const path of await listTraceFilesRecursive(dir)) {
      if (opts.real) {
        const first = (await readFile(path, "utf8")).split("\n", 1)[0] ?? "";
        if (classifyProvenance(first) === "synthetic") continue;
      }
      const trace = await loadTrace(path);
      const hasRun = trace.events.some((e) => e.kind === "run-started" || e.kind === "run-completed" || e.kind === "run-aborted");
      if (!hasRun) continue;
      out.push({ path, analysis: analyzeCause(trace) });
    }
  }
  return out;
}

/** Render a {@link CauseTally} as a table (exported for tests). */
export function renderCauseTally(t: CauseTally, label: string): string {
  const pct = (n: number): string => (t.total === 0 ? "0%" : `${((100 * n) / t.total).toFixed(0)}%`);
  const L: string[] = [];
  L.push(`${label}: ${t.total} run(s)`);
  L.push(`  confidence: decisive=${t.byConfidence.decisive} (${pct(t.byConfidence.decisive)}) probable=${t.byConfidence.probable} (${pct(t.byConfidence.probable)}) insufficient-trace=${t.byConfidence["insufficient-trace"]} (${pct(t.byConfidence["insufficient-trace"])})`);
  if (t.notRuns > 0) L.push(`  skipped: ${t.notRuns} direct-chat trace(s) (not runs)`);
  L.push(`  cause x status:`);
  for (const [k, n] of Object.entries(t.byCauseAndStatus).sort((a, b) => b[1] - a[1])) {
    const [cause, status] = k.split("|");
    L.push(`    ${String(n).padStart(5)}  ${(cause ?? "").padEnd(24)} ${status ?? ""}`);
  }
  return L.join("\n");
}

/**
 * Run the `cause` command.
 *
 * @param target A runId, `.jsonl` path, `latest` (single mode); a directory (cohort mode, optional).
 */
export async function causeCommand(target: string | undefined, opts: CauseOpts = {}): Promise<void> {
  if (opts.all) {
    const dirs = target !== undefined ? [target] : candidateTraceDirs();
    const cohort = await classifyDirectories(dirs, { real: opts.real });
    const tally = tallyCauses(cohort.map((c) => c.analysis));
    console.log(
      opts.json
        ? JSON.stringify({ dirs, tally, runs: cohort.map((c) => ({ path: c.path, cause: c.analysis.cause, subCause: c.analysis.subCause, confidence: c.analysis.confidence, outcomeStatus: c.analysis.outcomeStatus })) }, null, 2)
        : renderCauseTally(tally, `Causes across ${dirs.join(", ")}${opts.real ? " (real traces only)" : ""}`),
    );
    return;
  }
  if (target === undefined) {
    console.error("Error: cause requires a runId or path. Try: rax-diagnose cause latest (or: cause --all [dir])");
    process.exit(2);
  }
  const trace = await loadTrace(await resolveTracePath(target));
  const analysis = analyzeCause(trace);
  // Harness-vs-model attribution rides along (see `rax-diagnose attribute` for the full report).
  const attribution = attributeFailure(trace);
  console.log(
    opts.json
      ? JSON.stringify({ ...analysis, attribution }, null, 2)
      : `${renderCause(analysis)}\n  attribution ${attribution.verdict} (${attribution.reason}) confidence=${attribution.confidence} — run \`rax-diagnose attribute\` for evidence`,
  );
}
