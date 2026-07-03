import { useMemo } from "react";
import type { FetchLike } from "@reactive-agents/ui-core";
import type { AgentStreamEvent, AgentHookState, UseAgentStreamReturn } from "../types.js";
import { useRun } from "./use-run.js";

const toLegacyStatus = (s: string): AgentHookState =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed"
      ? "completed"
      : s === "error"
        ? "error"
        : "idle";

/** Merge two HeadersInit values, with `override` taking precedence per-key. */
const mergeHeaders = (base?: HeadersInit, override?: HeadersInit): Headers => {
  const merged = new Headers(base);
  new Headers(override).forEach((value, key) => merged.set(key, value));
  return merged;
};

/**
 * Wrap the global `fetch` so legacy `requestInit` options (extra headers,
 * `credentials`, `mode`, etc.) still reach the network call — `useRun`
 * itself only knows about `endpoint`/`fetchImpl`, so back-compat threading
 * happens here rather than being silently dropped.
 */
const withRequestInit = (
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): FetchLike | undefined => {
  if (!requestInit) return undefined;
  return (input, init) =>
    fetch(input, {
      ...requestInit,
      ...init,
      headers: mergeHeaders(init?.headers, requestInit.headers),
    });
};

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
  const fetchImpl = useMemo(() => withRequestInit(requestInit), [requestInit]);
  const { state, run, cancel } = useRun({ endpoint, fetchImpl });

  return useMemo(
    () => ({
      text: state.text,
      events: state.events as unknown as AgentStreamEvent[],
      status: toLegacyStatus(state.status),
      error: state.error ?? null,
      output: state.output ?? null,
      run: (prompt: string, body?: Record<string, unknown>) => run(prompt, body),
      cancel,
    }),
    [state, run, cancel],
  );
}
