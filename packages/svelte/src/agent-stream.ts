import { writable } from "svelte/store";
import { createRun } from "./run.js";
import { compatFetch } from "./agent.js";
import type { AgentStreamEvent } from "./types.js";

export interface AgentStreamState {
  text: string;
  events: AgentStreamEvent[];
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
  output: string | null;
}

const toLegacy = (s: string): AgentStreamState["status"] =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed"
    ? "completed"
    : s === "error"
    ? "error"
    : "idle";

const TERMINAL = new Set(["completed", "error", "cancelled"]);

/**
 * Create a reactive Svelte store that streams agent output token-by-token.
 * Returns a store + run() and cancel() functions.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createAgentStream } from "@reactive-agents/svelte";
 *   const agent = createAgentStream("/api/agent");
 * </script>
 * <button on:click={() => agent.run("Hello!")}>Run</button>
 * <p>{$agent.text}</p>
 * ```
 */
export function createAgentStream(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
) {
  const inner = createRun({ endpoint, fetchImpl: compatFetch(requestInit) });
  const store = writable<AgentStreamState>({ text: "", events: [], status: "idle", error: null, output: null });

  // run() resolves only once the underlying run reaches a terminal status —
  // callers read the store synchronously right after `await run()` and
  // expect the terminal state (or error state) to already be visible; it
  // never rejects, mirroring the pre-rewire behavior where a StreamError
  // event was absorbed into store state rather than thrown.
  let pending: (() => void) | null = null;
  let lastStatus = "idle";

  inner.subscribe((rs) => {
    store.set({
      text: rs.text,
      events: rs.events as unknown as AgentStreamEvent[],
      status: toLegacy(rs.status),
      error: rs.error ?? null,
      output: rs.output ?? null,
    });
    if (rs.status !== lastStatus) {
      lastStatus = rs.status;
      if (TERMINAL.has(rs.status)) {
        pending?.();
        pending = null;
      }
    }
  });

  return {
    subscribe: store.subscribe,
    run: (prompt: string, body?: Record<string, unknown>): Promise<void> =>
      new Promise<void>((resolve) => {
        pending = resolve;
        inner.run(prompt, body);
      }),
    cancel: () => inner.cancel(),
  };
}
