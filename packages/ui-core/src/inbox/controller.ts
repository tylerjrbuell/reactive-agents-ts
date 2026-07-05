import type { FetchLike } from "../stream/connect.js";

/** A durable run as surfaced by the inbox endpoint (createInboxEndpoint). */
export interface InboxRun {
  readonly runId: string;
  readonly task: string;
  readonly status: string;
  readonly updatedAt: number;
}

/** Fetch the durable-run inbox for the resolved identity. Throws on non-ok. */
export const fetchInbox = async (opts: {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
}): Promise<readonly InboxRun[]> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.endpoint, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as InboxRun[];
};
