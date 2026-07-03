import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type FetchLike,
  type RunState,
} from "@reactive-agents/ui-core";

export interface UseRunOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
  readonly auto?: { readonly prompt: string; readonly body?: Record<string, unknown> };
  readonly attach?: { readonly runId: string; readonly cursor?: number };
}

export interface UseRunReturn {
  readonly state: RunState;
  readonly run: (prompt: string, body?: Record<string, unknown>) => void;
  readonly cancel: () => void;
  readonly reattach: (runId: string, cursor?: number) => void;
}

export function useRun(opts: UseRunOptions): UseRunReturn {
  const [state, setState] = useState<RunState>(initialRunState);
  const abortRef = useRef<AbortController | null>(null);

  const drive = useCallback(
    (connectOpts: Parameters<typeof connectRunStream>[0]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(initialRunState());
      void (async () => {
        let next = initialRunState();
        try {
          for await (const event of connectRunStream({ ...connectOpts, signal: controller.signal })) {
            next = reduceRunState(next, event, { objectMode: opts.objectMode });
            setState(next);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const cause = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, status: "error", error: cause }));
        }
      })();
    },
    [opts.objectMode],
  );

  const run = useCallback(
    (prompt: string, body?: Record<string, unknown>) =>
      drive({ endpoint: opts.endpoint, body: { prompt, ...body }, fetchImpl: opts.fetchImpl }),
    [drive, opts.endpoint, opts.fetchImpl],
  );

  const reattach = useCallback(
    (runId: string, cursor?: number) =>
      drive({ endpoint: opts.endpoint, attach: { runId, cursor }, fetchImpl: opts.fetchImpl }),
    [drive, opts.endpoint, opts.fetchImpl],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: "cancelled" }));
  }, []);

  // auto-run / attach on mount
  useEffect(() => {
    if (opts.attach) reattach(opts.attach.runId, opts.attach.cursor);
    else if (opts.auto) run(opts.auto.prompt, opts.auto.body);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, run, cancel, reattach };
}
