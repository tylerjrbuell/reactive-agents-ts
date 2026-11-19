// Run selection for a trace file that holds several runs under one runId (a
// reused runId, e.g. Cortex "Continue"). `cause` and `attribute` report the
// last run by default and say how many share the id; `--segment=<n>` picks one
// (1-based), `--segment=all` reports each.

import { runSegments, type RunSegmentRef, type Trace } from "@reactive-agents/trace";
import { DiagnoseUsageError } from "../errors.js";

/** One run picked from a trace file, with its position when the file holds several. */
export interface PickedRun {
  readonly trace: Trace;
  /** Absent when the file holds one run. */
  readonly ref?: RunSegmentRef;
}

/** `--segment` value: a 1-based run number, `all`, or absent (the last run). */
export type SegmentSelector = number | "all" | undefined;

/**
 * Parse a `--segment` flag value.
 *
 * @param flag The raw flag (`--segment=2` gives `"2"`).
 * @returns The selector; fails on anything but a positive integer or `all`.
 */
export function parseSegmentFlag(flag: string | boolean | undefined): SegmentSelector {
  if (flag === undefined || flag === false) return undefined;
  if (flag === "all") return "all";
  const n = typeof flag === "string" && /^[1-9]\d*$/.test(flag) ? Number(flag) : NaN;
  if (Number.isNaN(n)) throw new DiagnoseUsageError({ message: `--segment takes a run number (1, 2, ...) or "all", got ${String(flag)}` });
  return n;
}

/**
 * The runs a single-run report covers.
 *
 * @param trace The loaded trace file.
 * @param selector Which run(s); default the last.
 */
export function pickRuns(trace: Trace, selector: SegmentSelector): readonly PickedRun[] {
  const segs = runSegments(trace);
  const count = segs.length;
  const at = (i: number): PickedRun => (count > 1 ? { trace: segs[i]!, ref: { index: i + 1, count } } : { trace: segs[i]! });
  if (selector === "all") return segs.map((_, i) => at(i));
  if (selector === undefined) return [at(count - 1)];
  if (selector > count) {
    throw new DiagnoseUsageError({ message: `--segment=${selector}: this trace holds ${count} run(s)` });
  }
  return [at(selector - 1)];
}
