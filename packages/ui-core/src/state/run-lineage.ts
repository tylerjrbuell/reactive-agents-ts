/**
 * Run lineage: how runs that continue one another link up.
 *
 * `agent.resumeRun(runId, { newRun: true })` starts a NEW run (own id, own trace) and stamps the
 * run it continues as `continuedFrom` (on the run row, the result and `run-started.config`). A
 * UI that lists runs reads only that one field; these helpers derive the rest (what continued a
 * run, the whole chain) from a list of runs, so every list, drawer or comparison picker shows the
 * same chain. Runs with no link (every run before the feature, every ordinary run) are a chain of
 * one and render as they always did.
 */

/** The slice of a run lineage reads. */
export interface LineageRun {
  readonly runId: string;
  /** The run this one continues (`resumeRun({ newRun: true })`); absent on an ordinary run. */
  readonly continuedFrom?: string | undefined;
}

/** Ids of the runs that continue `runId` directly, in list order. */
export function continuationsOf(runs: readonly LineageRun[], runId: string): string[] {
  return runs.filter((r) => r.continuedFrom === runId).map((r) => r.runId);
}

/**
 * The chain `runId` belongs to, oldest first: back through `continuedFrom` to the first run, then
 * forward through each run's continuation (the first listed when a run was continued twice). A
 * run with no link is `[runId]`. A parent that is not in `runs` (pruned, or not loaded) ends the
 * walk back there but is still named, so the chain never loses a link it knows about.
 */
export function continuationChainOf(runs: readonly LineageRun[], runId: string): string[] {
  const byId = new Map(runs.map((r) => [r.runId, r]));
  const back: string[] = [];
  const seen = new Set<string>([runId]);
  for (let id = byId.get(runId)?.continuedFrom; id !== undefined && !seen.has(id); id = byId.get(id)?.continuedFrom) {
    back.unshift(id);
    seen.add(id);
  }
  const forward: string[] = [];
  for (let id = continuationsOf(runs, runId)[0]; id !== undefined && !seen.has(id); id = continuationsOf(runs, id)[0]) {
    forward.push(id);
    seen.add(id);
  }
  return [...back, runId, ...forward];
}
