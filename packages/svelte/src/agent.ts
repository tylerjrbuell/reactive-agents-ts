import { writable } from "svelte/store";
import { createRun } from "./run.js";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface AgentState {
  output: string | null;
  loading: boolean;
  error: string | null;
}

const sseEvent = (event: Record<string, unknown>): Response =>
  new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

/**
 * Adapts `createRun`'s SSE-oriented transport to also accept a legacy
 * single-shot JSON endpoint (the original, pre-ui-core `createAgent`
 * contract: POST -> `{ output }` JSON, or a non-2xx response on failure).
 * A response already speaking `text/event-stream` passes straight through
 * to `connectRunStream`/`reduceRunState` unchanged.
 */
const compatFetch = (requestInit?: Omit<RequestInit, "method" | "body">): FetchLike =>
  async (input, init) => {
    const headers = { ...requestInit?.headers, ...(init?.headers as Record<string, string> | undefined) };
    const res = await fetch(input, { ...requestInit, ...init, headers });
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) return res;
    if (!res.ok) {
      return sseEvent({ _tag: "StreamError", cause: `HTTP ${res.status}: ${res.statusText}` });
    }
    const data = (await res.json().catch(() => ({}))) as { output?: string; result?: string };
    const output = data.output ?? data.result ?? "";
    return sseEvent({ _tag: "StreamCompleted", output, metadata: {} });
  };

export function createAgent(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body">,
) {
  const inner = createRun({ endpoint, fetchImpl: compatFetch(requestInit) });
  const store = writable<AgentState>({ output: null, loading: false, error: null });

  let resolver: { resolve: (v: string) => void; reject: (e: Error) => void } | null = null;
  let lastStatus = "idle";

  inner.subscribe((rs) => {
    // Ignore createRun's internal idle reset tick — `loading` is managed
    // explicitly around the call to `run()` below so it flips true
    // synchronously (matching the pre-rewire contract), not only once the
    // first streamed event arrives.
    if (rs.status === "idle") return;
    store.update((s) => ({
      output: rs.output ?? s.output,
      loading: rs.status !== "completed" && rs.status !== "error" && rs.status !== "cancelled",
      error: rs.error ?? null,
    }));
    if (rs.status !== lastStatus) {
      lastStatus = rs.status;
      if (rs.status === "completed") resolver?.resolve(rs.output ?? "");
      else if (rs.status === "error") resolver?.reject(new Error(rs.error ?? "run failed"));
    }
  });

  return {
    subscribe: store.subscribe,
    run: (prompt: string, body?: Record<string, unknown>): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        resolver = { resolve, reject };
        lastStatus = "idle";
        store.set({ output: null, loading: true, error: null });
        inner.run(prompt, body);
      }),
  };
}
