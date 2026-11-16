/**
 * Compute offload (harness switch `computeOffload`, default OFF).
 *
 * Spike wiki/Research/Harness-Reports/2026-11-15-compute-offload-spike.md: 35%
 * of accepted runs on aggregation tasks (sum, mean, group totals) got the
 * computed figure wrong, and `code-execute` was absent from the tool surface in
 * 86% of them. Weak models computed a mean of 20 numbers in their head and were
 * right 0 of 14 times.
 *
 * This module is the deterministic trigger (no LLM, no clock): does the task
 * text ask for a numeric aggregate over data the run reads? Two parts must both
 * hold, so a task that only mentions a data file (fetch prices into a file) or
 * only the word "count" (a comment count to fetch) stays quiet:
 *
 *  1. an aggregate verb or noun: sum, total, mean, average, median, percent,
 *     ratio, "add the counts together", double, quantify, "number of";
 *  2. a data-source reference: a file with a data extension, or csv /
 *     spreadsheet / dataset wording.
 *
 * Consumers: the tool-surface floor (`resolve-think-surface.ts`) keeps
 * `code-execute` visible, and the guidance seam (`loop/iterate-compute-offload-seam.ts`)
 * adds one advisory line. Advisory only: nothing here vetoes or ends a run.
 */
import type { ToolSchema } from "../attend/tool-formatting.js";

/** The compute tool this mechanism keeps reachable. */
export const COMPUTE_TOOL = "code-execute";

/** Aggregate verbs and nouns. Bare "count" is excluded: "comment count" is a lookup, not a computation. */
const AGGREGATE =
  /\b(sum|sums|summed|total|totals|subtotal|mean|average|averaged|median|percent|percentage|ratio|tally|double|halve|multiply|multiplied|quantify|quantified|number of|add\b[^.\n]{0,40}\btogether)\b/i;

/** A data source the run reads: a data-extension file, or data-set wording. */
const DATA_SOURCE =
  /\b[\w./-]+\.(csv|tsv|json|jsonl|ndjson|xlsx|txt|log)\b|\b(csv|spreadsheet|dataset|data set|rows|records)\b/i;

/** True when the task asks for a numeric aggregate over data it reads. Pure. */
export function asksForComputedAggregate(task: string): boolean {
  return AGGREGATE.test(task) && DATA_SOURCE.test(task);
}

/** The one advisory line the guidance seam sends. */
export const COMPUTE_OFFLOAD_LINE = "Compute figures with code-execute; do not estimate them mentally.";

/**
 * The schemas the surface resolver sees, with `code-execute` added from the
 * permitted catalog when this run's task triggers the switch and the tool is
 * absent from the pre-filtered list. The catalog is `KernelInput.allToolSchemas`
 * (what this agent is PERMITTED to use), so this never widens permission.
 * Switch off or no trigger: the same array comes back untouched.
 */
export function withComputeToolSchema(
  augmented: readonly ToolSchema[],
  catalog: readonly ToolSchema[] | undefined,
  triggered: boolean,
): readonly ToolSchema[] {
  if (!triggered || augmented.some((ts) => ts.name === COMPUTE_TOOL)) return augmented;
  const schema = (catalog ?? []).find((ts) => ts.name === COMPUTE_TOOL);
  return schema === undefined ? augmented : [...augmented, schema];
}
