import { ref, readonly } from "vue";
import type { AgentStreamEvent, AgentHookState } from "./types.js";

/**
 * Stream agent output token-by-token from an SSE endpoint.
 *
 * @example
 * ```vue
 * <script setup>
 * const { text, status, error, run, cancel } = useAgentStream("/api/agent");
 * </script>
 * ```
 */
export function useAgentStream(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
) {
  const text = ref("");
  const events = ref<AgentStreamEvent[]>([]);
  const status = ref<AgentHookState>("idle");
  const error = ref<string | null>(null);
  const output = ref<string | null>(null);
  let abortController: AbortController | null = null;

  function cancel() {
    abortController?.abort();
    status.value = "idle";
  }

  async function run(prompt: string, body?: Record<string, unknown>) {
    abortController?.abort();
    abortController = new AbortController();

    text.value = "";
    events.value = [];
    error.value = null;
    output.value = null;
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
            events.value = [...events.value, event];
            if (event._tag === "TextDelta" && "text" in event) {
              text.value += (event as { text: string }).text;
            } else if (event._tag === "StreamCompleted" && "output" in event) {
              output.value = (event as { output: string }).output;
              status.value = "completed";
              return;
            } else if (event._tag === "StreamError" && "cause" in event) {
              throw new Error((event as { cause: string }).cause);
            } else if (event._tag === "StreamCancelled") {
              status.value = "idle";
              return;
            }
          } catch {
            // Non-JSON — skip
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
    text: readonly(text),
    events: readonly(events),
    status: readonly(status),
    error: readonly(error),
    output: readonly(output),
    run,
    cancel,
  };
}
