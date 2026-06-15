import { writable } from "svelte/store";
import { parsePartialObject } from "./parse-partial.js";
import type { AgentStreamEvent } from "./types.js";

export interface StructuredStreamState {
  /** Progressively-filled DeepPartial of the structured object. Updated on every TextDelta. */
  object: Record<string, unknown>;
  /** Raw accumulated text (JSON being streamed). */
  text: string;
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
}

/**
 * Create a reactive Svelte store that streams a structured JSON object token-by-token,
 * surfacing a `DeepPartial`-style `object` that updates as JSON arrives.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createStructuredStream } from "@reactive-agents/svelte";
 *   const stream = createStructuredStream("/api/agent/structured");
 * </script>
 * <button on:click={() => stream.run("Generate a user profile")}>Run</button>
 * {#if $stream.object.name}<p>Name: {$stream.object.name}</p>{/if}
 * {#if $stream.status === "completed"}<pre>{JSON.stringify($stream.object, null, 2)}</pre>{/if}
 * ```
 */
export function createStructuredStream(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): { subscribe: ReturnType<typeof writable<StructuredStreamState>>["subscribe"]; run: (prompt: string, body?: Record<string, unknown>) => Promise<void>; cancel: () => void } {
  const store = writable<StructuredStreamState>({
    object: {},
    text: "",
    status: "idle",
    error: null,
  });

  let abortController: AbortController | null = null;

  function cancel() {
    abortController?.abort();
    store.update((s) => ({ ...s, status: "idle" }));
  }

  async function run(prompt: string, body?: Record<string, unknown>) {
    abortController?.abort();
    abortController = new AbortController();
    store.set({ object: {}, text: "", status: "streaming", error: null });

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
              const next = { ...s };
              if (event._tag === "TextDelta" && "text" in event) {
                next.text = s.text + (event as { text: string }).text;
                next.object = parsePartialObject(next.text);
              } else if (event._tag === "StreamCompleted" && "output" in event) {
                const finalOutput = (event as { output: string }).output;
                next.object = parsePartialObject(finalOutput ?? next.text);
                next.status = "completed";
              } else if (event._tag === "StreamError" && "cause" in event) {
                next.error = (event as { cause: string }).cause;
                next.status = "error";
              } else if (event._tag === "StreamCancelled") {
                next.status = "idle";
              }
              return next;
            });
          } catch { /* skip non-JSON SSE lines */ }
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
