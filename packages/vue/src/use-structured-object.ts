import { ref, readonly } from "vue";
import { parsePartialObject } from "./parse-partial.js";
import type { AgentStreamEvent, AgentHookState } from "./types.js";

/**
 * Stream a structured JSON object token-by-token from an SSE endpoint,
 * surfacing a `DeepPartial`-style `object` ref that updates as JSON arrives.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useStructuredObject } from "@reactive-agents/vue";
 * const { object, status, error, run } = useStructuredObject("/api/agent/structured");
 * </script>
 * <template>
 *   <button @click="run('Generate a user profile')">Run</button>
 *   <p v-if="object.name">Name: {{ object.name }}</p>
 *   <pre v-if="status === 'completed'">{{ JSON.stringify(object, null, 2) }}</pre>
 * </template>
 * ```
 */
export function useStructuredObject(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
) {
  const object = ref<Record<string, unknown>>({});
  const text = ref("");
  const status = ref<AgentHookState>("idle");
  const error = ref<string | null>(null);
  let abortController: AbortController | null = null;

  function cancel() {
    abortController?.abort();
    status.value = "idle";
  }

  async function run(prompt: string, body?: Record<string, unknown>) {
    abortController?.abort();
    abortController = new AbortController();

    object.value = {};
    text.value = "";
    error.value = null;
    status.value = "streaming";

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
            if (event._tag === "TextDelta" && "text" in event) {
              text.value += (event as { text: string }).text;
              object.value = parsePartialObject(text.value);
            } else if (event._tag === "StreamCompleted" && "output" in event) {
              const finalOutput = (event as { output: string }).output;
              object.value = parsePartialObject(finalOutput ?? text.value);
              status.value = "completed";
              return;
            } else if (event._tag === "StreamError" && "cause" in event) {
              error.value = (event as { cause: string }).cause;
              status.value = "error";
              return;
            } else if (event._tag === "StreamCancelled") {
              status.value = "idle";
              return;
            }
          } catch {
            // Non-JSON SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      error.value = err instanceof Error ? err.message : String(err);
      status.value = "error";
    }
  }

  return {
    object: readonly(object),
    text: readonly(text),
    status: readonly(status),
    error: readonly(error),
    run,
    cancel,
  };
}
