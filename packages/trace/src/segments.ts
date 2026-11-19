// packages/trace/src/segments.ts
//
// One trace file can hold several runs under one runId: a Cortex "Continue"
// reuses the runId, so the recorder appends a second `run-started` ... terminal
// to the same file. A reader that treats the file as one run mixes them: the
// first `run-started` with the last `run-completed`, and tool counts summed over
// both (conformance audit 2026-11-18, I2: a failed first run hidden behind a
// successful Continue).
//
// `runSegments` splits a trace at each `run-started` of the trace's own runId.
// Events before the first `run-started` stay with the first segment. A
// `run-started` with another runId (a sub-run's event, if one ever lands in the
// file) does not start a segment. A trace with at most one `run-started` comes
// back unchanged, as the only element.

import type { Trace } from "./replay.js";
import type { TraceEvent } from "./events.js";

/**
 * Split a trace into one {@link Trace} per run that shares its runId.
 *
 * @param trace A loaded trace (one file).
 * @returns The runs in recorded order; `[trace]` when the file holds one run.
 */
export function runSegments(trace: Trace): readonly Trace[] {
  const starts = trace.events.flatMap((e, i) => (e.kind === "run-started" && e.runId === trace.runId ? [i] : []));
  if (starts.length <= 1) return [trace];
  const bounds = [0, ...starts.slice(1), trace.events.length];
  const out: Trace[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const events: readonly TraceEvent[] = trace.events.slice(bounds[k], bounds[k + 1]);
    out.push({ runId: trace.runId, events });
  }
  return out;
}

/**
 * The last run in a trace file (see {@link runSegments}): the run a reader of
 * "how did this runId end" means.
 *
 * @param trace A loaded trace (one file).
 * @returns The last segment, and how many runs the file holds.
 */
export function lastRunSegment(trace: Trace): { readonly trace: Trace; readonly count: number } {
  const segs = runSegments(trace);
  return { trace: segs.at(-1) ?? trace, count: segs.length };
}
