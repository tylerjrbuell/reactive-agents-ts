/**
 * Per-channel traffic read from the framework's durable inbox and outbox (`router_inbox`,
 * `router_outbox`, opened by `channel-hub-durable-inbox.ts` on the Cortex db file).
 *
 * A restart zeroes the adapters' own counters, but these rows persist, so the Gateway overview reads
 * them instead of keeping a second counter. Read-only; the framework owns the tables, prunes terminal
 * rows (7 days / 50 000 by default) and the numbers cover what it keeps. A missing table (the durable
 * inbox never opened on this file) gives `null`: the caller then labels adapter counters "since restart".
 */
import type { makeDurableRouterStore } from "./channel-hub-store.js";

/** The Cortex database handle, typed as the router store factory takes it. */
type CortexDb = Parameters<typeof makeDurableRouterStore>[0];

/** What one channel moved, from stored rows. */
export interface StoredChannelStats {
  /** Envelopes the router accepted from the platform. */
  readonly received: number;
  /** Replies the outbox delivered. */
  readonly sent: number;
  /** Replies the outbox gave up on. */
  readonly failed: number;
  readonly lastInboundAt: number | null;
  readonly lastSentAt: number | null;
}

interface InboxAgg { readonly adapter_id: string; readonly n: number; readonly last: number | null }
interface OutboxAgg { readonly adapter_id: string; readonly status: string; readonly n: number; readonly last: number | null }

/** Stats per channel id, or `null` when the durable tables are not there. A channel with no rows is absent (zero). */
export const storedChannelStats = (db: CortexDb): ReadonlyMap<string, StoredChannelStats> | null => {
  try {
    // Redelivery markers carry an empty adapter id; they are not messages.
    const inbox = db.prepare("SELECT adapter_id, COUNT(*) AS n, MAX(received_at) AS last FROM router_inbox WHERE adapter_id != '' GROUP BY adapter_id").all() as InboxAgg[];
    const outbox = db.prepare("SELECT adapter_id, status, COUNT(*) AS n, MAX(settled_at) AS last FROM router_outbox GROUP BY adapter_id, status").all() as OutboxAgg[];
    const out = new Map<string, StoredChannelStats>();
    const cur = (id: string): StoredChannelStats => out.get(id) ?? { received: 0, sent: 0, failed: 0, lastInboundAt: null, lastSentAt: null };
    for (const r of inbox) out.set(r.adapter_id, { ...cur(r.adapter_id), received: r.n, lastInboundAt: r.last });
    for (const r of outbox) {
      if (r.status === "sent") out.set(r.adapter_id, { ...cur(r.adapter_id), sent: r.n, lastSentAt: r.last });
      else if (r.status === "failed") out.set(r.adapter_id, { ...cur(r.adapter_id), failed: r.n });
    }
    return out;
  } catch {
    return null;
  }
};
