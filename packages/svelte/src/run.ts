import { writable } from "svelte/store";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type ConnectOptions,
  type FetchLike,
  type RunState,
} from "@reactive-agents/ui-core";

export interface CreateRunOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

export interface RunStore {
  subscribe: ReturnType<typeof writable<RunState>>["subscribe"];
  run: (prompt: string, body?: Record<string, unknown>) => void;
  reattach: (runId: string, cursor?: number) => void;
  cancel: () => void;
}

export function createRun(opts: CreateRunOptions): RunStore {
  const store = writable<RunState>(initialRunState());
  let controller: AbortController | null = null;

  const drive = (connectOpts: Omit<ConnectOptions, "signal" | "fetchImpl">) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    store.set(initialRunState());
    void (async () => {
      let next = initialRunState();
      try {
        for await (const event of connectRunStream({ ...connectOpts, fetchImpl: opts.fetchImpl, signal })) {
          next = reduceRunState(next, event, { objectMode: opts.objectMode });
          store.set(next);
        }
      } catch (err) {
        if (signal.aborted) return;
        const cause = err instanceof Error ? err.message : String(err);
        store.update((s) => ({ ...s, status: "error", error: cause }));
      }
    })();
  };

  return {
    subscribe: store.subscribe,
    run: (prompt, body) => drive({ endpoint: opts.endpoint, body: { prompt, ...body } }),
    reattach: (runId, cursor) => drive({ endpoint: opts.endpoint, attach: { runId, cursor } }),
    cancel: () => {
      controller?.abort();
      store.update((s) => ({ ...s, status: "cancelled" }));
    },
  };
}
