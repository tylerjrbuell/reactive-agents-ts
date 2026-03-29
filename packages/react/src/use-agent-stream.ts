import { useState, useCallback, useRef } from "react";
import type { AgentStreamEvent, AgentHookState, UseAgentStreamReturn } from "./types.js";

/**
 * Stream agent output token-by-token from an SSE endpoint.
 *
 * The endpoint should return a Server-Sent Events response produced by
 * `AgentStream.toSSE(agent.runStream(prompt))` on the server.
 *
 * @param endpoint - URL of the server-side agent SSE endpoint
 * @param requestInit - Optional fetch options (headers, etc.)
 *
 * @example
 * ```tsx
 * function Chat() {
 *   const { text, status, run } = useAgentStream("/api/agent");
 *   return (
 *     <div>
 *       <button onClick={() => run("What is the weather in Portland?")}>Ask</button>
 *       <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
 *       {status === "streaming" && <span>●</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgentStream(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): UseAgentStreamReturn {
  const [text, setText] = useState("");
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [status, setStatus] = useState<AgentHookState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const run = useCallback(
    (prompt: string, body?: Record<string, unknown>) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Reset state
      setText("");
      setEvents([]);
      setError(null);
      setOutput(null);
      setStatus("streaming");

      void (async () => {
        try {
          const res = await fetch(endpoint, {
            ...requestInit,
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", ...requestInit?.headers },
            body: JSON.stringify({ prompt, ...body }),
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
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
                setEvents((prev) => [...prev, event]);

                if (event._tag === "TextDelta" && "text" in event) {
                  setText((prev) => prev + (event as { text: string }).text);
                } else if (event._tag === "StreamCompleted" && "output" in event) {
                  const completed = event as { output: string };
                  setOutput(completed.output);
                  setStatus("completed");
                  return;
                } else if (event._tag === "StreamError" && "cause" in event) {
                  throw new Error((event as { cause: string }).cause);
                } else if (event._tag === "StreamCancelled") {
                  setStatus("idle");
                  return;
                }
              } catch {
                // Non-JSON line — skip
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus("error");
        }
      })();
    },
    [endpoint, requestInit],
  );

  return { text, events, status, error, output, run, cancel };
}
