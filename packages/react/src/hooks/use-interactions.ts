import { useCallback, useState } from "react";
import { respondToInteraction, type FetchLike } from "@reactive-agents/ui-core";

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
      const result = await respondToInteraction({
        endpoint: opts.interactionEndpoint,
        runId,
        interactionId,
        value,
        fetchImpl,
      });
      if (result.error) setError(result.error);
      setPending(false);
      return { success: result.success, output: result.output };
    },
    [fetchImpl, opts.interactionEndpoint],
  );

  return { respond, pending, error };
}
