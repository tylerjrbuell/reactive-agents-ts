import { writable, derived } from "svelte/store";
import type { AgentStreamEvent } from "./types.js";

export interface AgentStreamState {
  text: string;
  events: AgentStreamEvent[];
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
  output: string | null;
}

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
  const store = writable<AgentStreamState>({
    text: "", events: [], status: "idle", error: null, output: null,
  });

  let abortController: AbortController | null = null;

  function cancel() {
    abortController?.abort();
    store.update((s) => ({ ...s, status: "idle" }));
  }

  async function run(prompt: string, body?: Record<string, unknown>) {
    abortController?.abort();
    abortController = new AbortController();
    store.set({ text: "", events: [], status: "streaming", error: null, output: null });

    try {
      const res = await fetch(endpoint, {
        ...requestInit,
        method: "POST",
        signal: abortController.signal,
        headers: { "Content-Type": "application/json", ...requestInit?.headers },
        body: JSON.stringify({ prompt, ...body }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw) as AgentStreamEvent;
            store.update((s) => {
              const next = { ...s, events: [...s.events, event] };
              if (event._tag === "TextDelta" && "text" in event) {
                next.text = s.text + (event as { text: string }).text;
              } else if (event._tag === "StreamCompleted" && "output" in event) {
                next.output = (event as { output: string }).output;
                next.status = "completed";
              } else if (event._tag === "StreamError" && "cause" in event) {
                next.error = (event as { cause: string }).cause;
                next.status = "error";
              } else if (event._tag === "StreamCancelled") {
                next.status = "idle";
              }
              return next;
            });
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
        status: "error",
      }));
    }
  }

  return { subscribe: store.subscribe, run, cancel };
}
