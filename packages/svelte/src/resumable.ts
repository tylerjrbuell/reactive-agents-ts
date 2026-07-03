import { createRun, type RunStore } from "./run.js";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface CreateResumableRunOptions {
  readonly endpoint: string;
  readonly runId: string;
  readonly cursor?: number;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

/** Reattach to a durable run immediately, replaying from the given cursor. */
export function createResumableRun(opts: CreateResumableRunOptions): RunStore {
  const store = createRun({ endpoint: opts.endpoint, fetchImpl: opts.fetchImpl, objectMode: opts.objectMode });
  store.reattach(opts.runId, opts.cursor);
  return store;
}
