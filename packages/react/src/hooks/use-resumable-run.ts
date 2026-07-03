import { useRun, type UseRunReturn } from "./use-run.js";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface UseResumableRunOptions {
  readonly endpoint: string;
  readonly runId: string;
  readonly cursor?: number;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

/** Reattach to a durable run on mount, replaying from the given cursor. */
export function useResumableRun(opts: UseResumableRunOptions): UseRunReturn {
  return useRun({
    endpoint: opts.endpoint,
    fetchImpl: opts.fetchImpl,
    objectMode: opts.objectMode,
    attach: { runId: opts.runId, cursor: opts.cursor },
  });
}
