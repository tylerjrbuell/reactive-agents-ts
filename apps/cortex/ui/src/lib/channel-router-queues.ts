/**
 * Lab · Channels: the router's outbox (messages waiting to be sent, sent, failed) and follow-up timers
 * (pending, fired, cancelled). Pure (no fetch, no DOM). The framework reports each as counts per status
 * under `router.status` only when the router's store keeps it; otherwise the key is absent and the panel
 * shows nothing for it (never a made-up zero).
 */

/** Outbox statuses, in the order a message moves through them. */
export const OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
/** Follow-up timer statuses. */
export const TIMER_STATUSES = ["pending", "fired", "cancelled"] as const;

/** Counts per status for one of the two panels. */
export type StatusCounts<S extends string> = Readonly<Record<S, number>>;
/** Outbox counts. */
export type OutboxCountsWire = StatusCounts<(typeof OUTBOX_STATUSES)[number]>;
/** Follow-up timer counts. */
export type TimerCountsWire = StatusCounts<(typeof TIMER_STATUSES)[number]>;

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Read `status.router[key]` off the wire: every status must be a whole non-negative count, else null (not kept). */
function parseCounts<S extends string>(router: unknown, key: "outbox" | "timers", statuses: readonly S[]): StatusCounts<S> | null {
  if (typeof router !== "object" || router === null) return null;
  const raw: unknown = (router as Record<string, unknown>)[key];
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<S, number>> = {};
  for (const s of statuses) {
    const n = rec[s];
    if (!isCount(n)) return null;
    out[s] = n;
  }
  return out as StatusCounts<S>;
}

/** `router.outbox` as counts, or null when the router has no durable outbox. */
export const parseOutboxCounts = (router: unknown): OutboxCountsWire | null => parseCounts(router, "outbox", OUTBOX_STATUSES);
/** `router.timers` as counts, or null when the router runs without follow-up timers. */
export const parseTimerCounts = (router: unknown): TimerCountsWire | null => parseCounts(router, "timers", TIMER_STATUSES);

/** One labelled group of counts in the status panel. */
export interface CountGroup {
  readonly label: string;
  readonly rows: readonly { readonly status: string; readonly count: number }[];
}

/** The groups to draw: only the ones the router reports, outbox first. */
export function queueGroups(outbox: OutboxCountsWire | null, timers: TimerCountsWire | null): CountGroup[] {
  return [
    ...(outbox ? [{ label: "Outbox", rows: OUTBOX_STATUSES.map((status) => ({ status, count: outbox[status] })) }] : []),
    ...(timers ? [{ label: "Follow-up timers", rows: TIMER_STATUSES.map((status) => ({ status, count: timers[status] })) }] : []),
  ];
}
