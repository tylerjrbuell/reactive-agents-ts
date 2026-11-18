// packages/trace/src/attribution-decline.ts
//
// Honest declines (measurement overhaul 0.5/0.6, audits 02 D1/D2 and 03 attribution
// item 2). A run whose tools always failed and whose final text says so, without
// inventing a result, did the right thing. When the harness stopped it before it
// could finalize an abstention (`terminatedBy=dispatcher-early-stop`) the run reads
// `status=failure`, and the cause classifier then blames the broken tool
// (`environment:tool-failure`). The text+provenance check lives here once: the
// attribution rule below and the benchmark scorer (`packages/benchmarks/src/judge.ts`)
// both use it. Rule order and the verdict assembly live in attribution.ts.
//
//   harness:honest-decline-mislabeled  the run failed, did not end in an abstention,
//                               every real tool call failed, and the final text is an
//                               honest decline (admits it cannot, names why, reports no
//                               number the failing tools did not print)

import { gatherFacts, isMeta, ev1, clip, oneLine, type Facts, type Rule } from "./attribution-facts.js";
import type { Trace } from "./replay.js";

/** Outcomes of a run's real (non-meta) tool calls: the provenance an honest decline rests on. */
export interface ToolProvenance {
  /** Real tool calls that succeeded. */
  readonly toolOk: number;
  /** Real tool calls that failed. */
  readonly toolFailed: number;
  /** The failing calls' error text, to tell a quoted number from an invented one. */
  readonly failedErrors: readonly string[];
}

const INABILITY = /\b(?:cannot|can'?t|can\s+not|unable\s+to|not\s+able\s+to|could\s+not|couldn'?t|do(?:es)?\s+not\s+(?:exist|have)|don'?t\s+have|no\s+such\s+file)\b/i;
const CAUSE = /\b(?:not\s+(?:be\s+)?(?:found|read|accessed|opened|located)|no\s+such\s+file|enoent|exist|missing|unreadable|inaccessible|unavailable|(?:read|access|open|find|locate|load)\b)/i;
const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g;

/**
 * Whether `output` is an honest decline: it admits inability, names why (the data
 * or tool is unreachable), and reports no number the failing tools did not print.
 * Deterministic, zero tokens.
 *
 * @param output The run's final text.
 * @param provenance Tool outcomes; when given, the decline only counts if tools ran and none succeeded.
 * @returns True for an honest decline.
 */
export function isHonestDecline(output: string, provenance?: ToolProvenance): boolean {
  if (!INABILITY.test(output) || !CAUSE.test(output)) return false;
  if (provenance !== undefined && !(provenance.toolFailed > 0 && provenance.toolOk === 0)) return false;
  const quoted = provenance?.failedErrors.join("\n") ?? "";
  return (output.match(NUMBER) ?? []).every((n) => quoted.includes(n));
}

/** The real (non-meta) tool-call outcomes of one run. */
const provenanceOf = (f: Facts): ToolProvenance => {
  const ends = f.toolEnds.filter((t) => !isMeta(t.toolName));
  const failed = ends.filter((t) => t.ok === false);
  return {
    toolOk: ends.length - failed.length,
    toolFailed: failed.length,
    failedErrors: failed.map((t) => t.error ?? String(t.result ?? "")),
  };
};

/**
 * The real (non-meta) tool-call outcomes of a recorded run, for callers that
 * grade a decline against its trace (the benchmark rescore).
 *
 * @param trace A loaded trace (one run).
 */
export const toolProvenanceOf = (trace: Trace): ToolProvenance => provenanceOf(gatherFacts(trace));

/**
 * A failed run that ended on an honest decline over always-failing tools is a
 * harness mislabel (the stop path reported failure for correct behavior), not an
 * environment fault and not a model one.
 */
export const ruleHonestDecline: Rule = ({ f }) => {
  const done = f.completed;
  if (done === undefined || f.abstained || done.output === undefined) return undefined;
  const provenance = provenanceOf(f);
  if (!isHonestDecline(done.output, provenance)) return undefined;
  const ends = f.toolEnds.filter((t) => !isMeta(t.toolName));
  const failed = ends.filter((t) => t.ok === false);
  return {
    reason: "harness:honest-decline-mislabeled",
    evidence: [
      ev1(failed[0]!, `${failed.length}/${ends.length} real tool calls ok:false; first ${failed[0]!.toolName}: ${clip(oneLine(provenance.failedErrors[0] ?? ""), 100)}`),
      ev1(done, `run ended status=${done.status} terminatedBy=${f.terminatedBy ?? "?"} on an honest decline: ${clip(oneLine(done.output), 120)}`),
    ],
    needs: [],
  };
};
