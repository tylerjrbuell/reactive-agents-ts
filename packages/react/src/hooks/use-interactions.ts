import { useCallback, useState } from "react";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface UseInteractionsOptions {
  readonly interactionEndpoint: string;
  readonly fetchImpl?: FetchLike;
}
export interface UseInteractionsReturn {
  readonly respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
  readonly pending: boolean;
  readonly error: string | null;
}

export function useInteractions(opts: UseInteractionsOptions): UseInteractionsReturn {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const respond = useCallback(
    async (runId: string, interactionId: string, value: unknown) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetchImpl(opts.interactionEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, interactionId, value }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { success: boolean; output: string };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return { success: false, output: "" };
      } finally {
        setPending(false);
      }
    },
    [fetchImpl, opts.interactionEndpoint],
  );

  return { respond, pending, error };
}
