/**
 * Persistence of the channel hub's activity feed and per-route counters (`cortex_hub_activity`,
 * `cortex_hub_route_counters`), so a restart shows what happened instead of zeros.
 *
 * One writer: `HubActivityTracker` folds each router event once and hands the result here. Nothing in
 * this file counts anything. Rows hold classifications, route ids and counts, never message text.
 */
import type { HubActivity, HubActivityStore, RouteCounters } from "../services/channel-hub-activity.js";
import type { makeDurableRouterStore } from "../services/channel-hub-store.js";

/** The Cortex database handle, typed as the router store factory takes it. */
type CortexDb = Parameters<typeof makeDurableRouterStore>[0];

/** Newest feed rows kept in the table (the in-memory feed shows 50). */
export const HUB_ACTIVITY_KEEP = 200;

interface ActivityRow {
  readonly at: number;
  readonly kind: string;
  readonly channel_id: string | null;
  readonly route_id: string | null;
  readonly detail: string;
  readonly ack_reason: string | null;
  readonly ack_ms: number | null;
  readonly simulated: number;
}

interface CounterRow {
  readonly route_id: string;
  readonly matched: number;
  readonly denied: number;
  readonly answered: number;
  readonly failed: number;
  readonly dropped: number;
  readonly cost_usd: number;
}

const KINDS: readonly HubActivity["kind"][] = ["matched", "denied", "unrouted", "answered", "acknowledged", "failed", "dropped", "conflict", "edited", "reset"];
const ACK_REASONS = ["timeout", "empty", "thinking_only", "error"] as const;

const kindOf = (v: string): HubActivity["kind"] | undefined => KINDS.find((k) => k === v);
const ackReasonOf = (v: string | null): (typeof ACK_REASONS)[number] | undefined => ACK_REASONS.find((r) => r === v);

const toActivity = (r: ActivityRow): HubActivity | null => {
  const kind = kindOf(r.kind);
  if (!kind) return null;
  const ack = ackReasonOf(r.ack_reason);
  return {
    at: r.at,
    kind,
    detail: r.detail,
    simulated: r.simulated === 1,
    ...(r.channel_id ? { channelId: r.channel_id } : {}),
    ...(r.route_id ? { routeId: r.route_id } : {}),
    ...(ack ? { ackFallbackReason: ack } : {}),
    ...(r.ack_ms !== null ? { ackLatencyMs: r.ack_ms } : {}),
  };
};

/** A store over `db`. Reads and writes fail soft: a broken table loses history, never an event. */
export const makeHubActivityStore = (db: CortexDb): HubActivityStore => {
  const insert = db.prepare(
    "INSERT INTO cortex_hub_activity (at, kind, channel_id, route_id, detail, ack_reason, ack_ms, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const prune = db.prepare("DELETE FROM cortex_hub_activity WHERE id <= ?");
  const bumpRow = db.prepare(
    `INSERT INTO cortex_hub_route_counters (route_id, matched, denied, answered, failed, dropped, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(route_id) DO UPDATE SET
       matched = matched + excluded.matched, denied = denied + excluded.denied, answered = answered + excluded.answered,
       failed = failed + excluded.failed, dropped = dropped + excluded.dropped, cost_usd = cost_usd + excluded.cost_usd`,
  );
  return {
    append: (a) => {
      try {
        const r = insert.run(a.at, a.kind, a.channelId ?? null, a.routeId ?? null, a.detail, a.ackFallbackReason ?? null, a.ackLatencyMs ?? null, a.simulated ? 1 : 0);
        prune.run(Number(r.lastInsertRowid) - HUB_ACTIVITY_KEEP);
      } catch {
        /* history is best-effort */
      }
    },
    bump: (routeId, d) => {
      try {
        bumpRow.run(routeId, d.matched, d.denied, d.answered, d.failed, d.dropped, d.costUsd);
      } catch {
        /* history is best-effort */
      }
    },
    loadFeed: (limit) => {
      try {
        const rows = db.prepare("SELECT at, kind, channel_id, route_id, detail, ack_reason, ack_ms, simulated FROM cortex_hub_activity ORDER BY id DESC LIMIT ?").all(limit) as ActivityRow[];
        return rows.reverse().flatMap((r) => {
          const a = toActivity(r);
          return a ? [a] : [];
        });
      } catch {
        return [];
      }
    },
    loadCounters: () => {
      const out = new Map<string, RouteCounters>();
      try {
        const rows = db.prepare("SELECT route_id, matched, denied, answered, failed, dropped, cost_usd FROM cortex_hub_route_counters").all() as CounterRow[];
        for (const r of rows) out.set(r.route_id, { matched: r.matched, denied: r.denied, answered: r.answered, failed: r.failed, dropped: r.dropped, costUsd: r.cost_usd });
      } catch {
        /* history is best-effort */
      }
      return out;
    },
  };
};
