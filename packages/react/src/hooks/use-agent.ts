import { useCallback, useMemo, useRef } from "react";
import type { FetchLike } from "@reactive-agents/ui-core";
import type { UseAgentReturn } from "../types.js";
import { useRun } from "./use-run.js";

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
 * happens here rather than being silently dropped. `useRun` owns its own
 * `AbortController` per run, so its `signal` always wins over anything in
 * `requestInit`.
 */
const withRequestInit = (requestInit?: Omit<RequestInit, "method" | "body">): FetchLike | undefined => {
  if (!requestInit) return undefined;
  return (input, init) =>
    fetch(input, {
      ...requestInit,
      ...init,
      headers: mergeHeaders(init?.headers, requestInit.headers),
    });
};

/**
 * One-shot agent call — waits for completion, returns the full output.
 * For streaming token-by-token use `useAgentStream` instead.
 *
 * @param endpoint - URL of the server-side agent endpoint (POST, returns JSON with `output`)
 *
 * @example
 * ```tsx
 * function Summary({ text }: { text: string }) {
 *   const { output, loading, error, run } = useAgent("/api/agent");
 *   return (
 *     <div>
 *       <button onClick={() => run(`Summarize: ${text}`)} disabled={loading}>
 *         {loading ? "Summarizing..." : "Summarize"}
 *       </button>
 *       {output && <p>{output}</p>}
 *       {error && <p style={{ color: "red" }}>{error}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgent(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body">,
): UseAgentReturn {
  const fetchImpl = useMemo(() => withRequestInit(requestInit), [requestInit]);
  const { state, run } = useRun({ endpoint, fetchImpl });

  const resolverRef = useRef<{ resolve: (v: string) => void; reject: (e: Error) => void } | null>(null);
  const lastStatus = useRef(state.status);

  // Resolve/reject the pending promise when the run terminates.
  if (lastStatus.current !== state.status) {
    lastStatus.current = state.status;
    if (state.status === "completed") resolverRef.current?.resolve(state.output ?? "");
    else if (state.status === "error") resolverRef.current?.reject(new Error(state.error ?? "run failed"));
  }

  const runPromise = useCallback(
    (prompt: string, body?: Record<string, unknown>) =>
      new Promise<string>((resolve, reject) => {
        resolverRef.current = { resolve, reject };
        run(prompt, body);
      }),
    [run],
  );

  return useMemo(
    () => ({
      output: state.output ?? null,
      loading:
        state.status === "streaming" ||
        state.status === "awaiting-interaction" ||
        state.status === "awaiting-approval",
      error: state.error ?? null,
      run: runPromise,
    }),
    [state.output, state.status, state.error, runPromise],
  );
}
