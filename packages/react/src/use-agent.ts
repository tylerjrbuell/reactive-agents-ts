import { useState, useCallback } from "react";
import type { UseAgentReturn } from "./types.js";

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
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (prompt: string, body?: Record<string, unknown>): Promise<string> => {
      setLoading(true);
      setError(null);
      setOutput(null);
      try {
        const res = await fetch(endpoint, {
          ...requestInit,
          method: "POST",
          headers: { "Content-Type": "application/json", ...requestInit?.headers },
          body: JSON.stringify({ prompt, ...body }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = (await res.json()) as { output?: string; result?: string };
        const result = data.output ?? data.result ?? "";
        setOutput(result);
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, requestInit],
  );

  return { output, loading, error, run };
}
