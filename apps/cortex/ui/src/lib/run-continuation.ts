/**
 * How the UI words and finds a Continue's run chain. A Continue (chat, `resumeRun({ newRun: true })`)
 * is a new run that names the run it continues (`continuedFrom`, stored on the run row and on the
 * chat turn). The chain itself (what continued a run, the whole chain) is ui-core's
 * (`run-lineage.ts`); this adds the short words and hrefs the Runs list, the run header, the
 * chat turn and the trace drawer share. A run with no link yields nothing, so older runs render
 * exactly as before.
 */
import { continuationsOf, type LineageRun } from "@reactive-agents/ui-core";
import { shortRunId } from "./run-view.js";

/** The run link both ends of a continuation show. */
export interface RunLink {
  readonly runId: string;
  readonly href: string;
  /** Short id for the chip. */
  readonly short: string;
}

/** A link to a run's view page. */
export function runLinkOf(runId: string): RunLink {
  return { runId, href: `/run/${encodeURIComponent(runId)}`, short: shortRunId(runId) };
}

/** The run `run` continues, or `undefined` for an ordinary or older run. */
export function continuedFromLink(run: { readonly continuedFrom?: string | undefined }): RunLink | undefined {
  return run.continuedFrom ? runLinkOf(run.continuedFrom) : undefined;
}

/** The runs that continue `runId` among the loaded `runs`, in list order (empty when none, or not loaded). */
export function continuationLinks(runs: readonly LineageRun[], runId: string): RunLink[] {
  return continuationsOf(runs, runId).map(runLinkOf);
}

/** Chip words for the run a run continues. */
export const continuedFromWords = "continued from";

/** Chip words for the runs that continued a run: one names it, more count them. */
export function continuedIntoWords(links: readonly RunLink[]): string | undefined {
  if (links.length === 0) return undefined;
  return links.length === 1 ? "continued as" : `continued ${links.length} times`;
}
