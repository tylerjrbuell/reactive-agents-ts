import { useCallback, useEffect, useState } from "react";
import { fetchInbox, type FetchLike, type InboxRun } from "@reactive-agents/ui-core";

// InboxRun now lives in ui-core; re-export to preserve this module's API.
export type { InboxRun } from "@reactive-agents/ui-core";

export interface UseTaskInboxOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly pollMs?: number;
}

export interface UseTaskInboxReturn {
  readonly runs: readonly InboxRun[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useTaskInbox(opts: UseTaskInboxOptions): UseTaskInboxReturn {
  const [runs, setRuns] = useState<readonly InboxRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        setRuns(await fetchInbox({ endpoint: opts.endpoint, fetchImpl }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchImpl, opts.endpoint]);

  useEffect(() => {
    refresh();
    if (!opts.pollMs) return;
    const id = setInterval(refresh, opts.pollMs);
    return () => clearInterval(id);
  }, [refresh, opts.pollMs]);

  return { runs, loading, error, refresh };
}
