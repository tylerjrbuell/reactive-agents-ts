// `rax-diagnose attribute <runId|path>` — is it my harness config or the model?
//
// Single-run mode prints the attribution of a failed run: the verdict
// (harness / model / unattributed / not-failed), the reason, the divergence
// turn, the evidence events and the signals that would have made it decisive.
// `--all [dir]` tallies attributions across a directory of traces.
// Both modes also list which harness mechanisms acted (`mechanismActivity`):
// guards that did not pass, injected signals, strategy switches and
// requirements by source, so a change under test can be seen to have run.
// Zero tokens: reads the recorded trace only.

import { readFile } from "node:fs/promises";
import {
  attributeFailure,
  renderAttribution,
  tallyAttributions,
  loadTrace,
  classifyProvenance,
  mechanismActivity,
  runSegmentNote,
  type Attribution,
  type AttributionTally,
  type MechanismActivity,
  type RunSegmentRef,
} from "@reactive-agents/trace";
import { candidateTraceDirs, resolveTracePath } from "../lib/resolve.js";
import { pickRuns, type SegmentSelector } from "../lib/segments.js";
import { listTraceFilesRecursive } from "./cause.js";

/** Options for {@link attributeCommand}. */
export interface AttributeOpts {
  readonly json?: boolean;
  /** Cohort mode: tally attributions across every trace under the target directory. */
  readonly all?: boolean;
  /** Cohort mode only: exclude synthetic (`test` provider/model) traces. */
  readonly real?: boolean;
  /** Single mode: which run of a file that holds several (default the last; `all` reports each). */
  readonly segment?: SegmentSelector;
}

/** One attributed run in a cohort. */
export interface CohortAttribution {
  readonly path: string;
  /** The run's position when its file holds several runs under one runId. */
  readonly runSegment?: RunSegmentRef;
  readonly attribution: Attribution;
  readonly activity: MechanismActivity;
}

/** Run counts per activity key across a cohort, most frequent first (exported for tests). */
export function tallyActivity(runs: readonly MechanismActivity[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const run of runs) for (const k of run) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Attribute every trace under `dirs`. Files with no run events (stray sinks)
 * are skipped, as in `cause --all`.
 */
export async function attributeDirectories(
  dirs: readonly string[],
  opts: { readonly real?: boolean } = {},
): Promise<readonly CohortAttribution[]> {
  const out: CohortAttribution[] = [];
  for (const dir of dirs) {
    for (const path of await listTraceFilesRecursive(dir)) {
      if (opts.real) {
        const first = (await readFile(path, "utf8")).split("\n", 1)[0] ?? "";
        if (classifyProvenance(first) === "synthetic") continue;
      }
      const trace = await loadTrace(path);
      const hasRun = trace.events.some((e) => e.kind === "run-started" || e.kind === "run-completed" || e.kind === "run-aborted");
      if (!hasRun) continue;
      // One entry per run: a file whose runId was reused holds several.
      for (const run of pickRuns(trace, "all")) {
        out.push({
          path,
          ...(run.ref !== undefined ? { runSegment: run.ref } : {}),
          attribution: attributeFailure(run.trace),
          activity: mechanismActivity(run.trace),
        });
      }
    }
  }
  return out;
}

/** Render an {@link AttributionTally} as a table (exported for tests). */
export function renderAttributionTally(t: AttributionTally, label: string): string {
  const failed = t.total - t.byVerdict["not-failed"];
  const pct = (n: number): string => (failed === 0 ? "0%" : `${((100 * n) / failed).toFixed(0)}%`);
  const L: string[] = [];
  L.push(`${label}: ${t.total} run(s), ${failed} failed`);
  L.push(`  failed runs by verdict: harness=${t.byVerdict.harness} (${pct(t.byVerdict.harness)}) model=${t.byVerdict.model} (${pct(t.byVerdict.model)}) environment=${t.byVerdict.environment} (${pct(t.byVerdict.environment)}) unattributed=${t.byVerdict.unattributed} (${pct(t.byVerdict.unattributed)})`);
  L.push(`  confidence: decisive=${t.byConfidence.decisive} probable=${t.byConfidence.probable} insufficient-trace=${t.byConfidence["insufficient-trace"]}`);
  L.push(`  by reason:`);
  for (const [reason, n] of Object.entries(t.byReason).sort((a, b) => b[1] - a[1])) {
    L.push(`    ${String(n).padStart(5)}  ${reason}`);
  }
  return L.join("\n");
}

/**
 * Run the `attribute` command.
 *
 * @param target A runId, `.jsonl` path or `latest` (single mode); a directory (cohort mode, optional).
 */
export async function attributeCommand(target: string | undefined, opts: AttributeOpts = {}): Promise<void> {
  if (opts.all) {
    const dirs = target !== undefined ? [target] : candidateTraceDirs();
    const cohort = await attributeDirectories(dirs, { real: opts.real });
    const tally = tallyAttributions(cohort.map((c) => c.attribution));
    const activity = tallyActivity(cohort.map((c) => c.activity));
    console.log(
      opts.json
        ? JSON.stringify({
            dirs,
            tally,
            activity: Object.fromEntries(activity),
            runs: cohort.map((c) => ({
              path: c.path,
              ...(c.runSegment ? { runSegment: c.runSegment } : {}),
              verdict: c.attribution.verdict,
              reason: c.attribution.reason,
              confidence: c.attribution.confidence,
              ...(c.attribution.divergenceTurn ? { divergenceTurn: c.attribution.divergenceTurn } : {}),
              activity: [...c.activity].sort(),
            })),
          }, null, 2)
        : [
            renderAttributionTally(tally, `Attribution across ${dirs.join(", ")}${opts.real ? " (real traces only)" : ""}`),
            `  mechanisms that acted (runs):`,
            ...(activity.length > 0 ? activity.map(([k, n]) => `    ${String(n).padStart(5)}  ${k}`) : ["        none"]),
          ].join("\n"),
    );
    return;
  }
  if (target === undefined) {
    console.error("Error: attribute requires a runId or path. Try: rax-diagnose attribute latest (or: attribute --all [dir])");
    process.exit(2);
  }
  const trace = await loadTrace(await resolveTracePath(target));
  const reports = pickRuns(trace, opts.segment).map((run) => ({
    run,
    attribution: attributeFailure(run.trace),
    activity: [...mechanismActivity(run.trace)].sort(),
  }));
  const json = reports.map(({ run, attribution, activity }) => ({ ...attribution, ...(run.ref ? { runSegment: run.ref } : {}), activity }));
  console.log(
    opts.json
      ? JSON.stringify(opts.segment === "all" ? json : json[0], null, 2)
      : reports
          .map(({ run, attribution, activity }) => {
            const [head, ...rest] = renderAttribution(attribution).split("\n");
            return [head, ...(run.ref ? [`  note      ${runSegmentNote(run.ref)}`] : []), ...rest, `  activity  ${activity.length > 0 ? activity.join(", ") : "none"}`].join("\n");
          })
          .join("\n\n"),
  );
}
