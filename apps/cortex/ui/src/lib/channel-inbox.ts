/**
 * Lab · Channels: the router's inbox status. Pure (no fetch, no DOM). The framework reports envelope
 * counts per status (`router.status.inbox`) only when the router's store keeps a durable inbox; without
 * one, messages wait in memory and a restart loses what had not been answered.
 */

/** The framework's inbox statuses, in the order a message moves through them. */
export const INBOX_STATUSES = ["received", "running", "done", "failed", "dropped"] as const;
/** One inbox status. */
export type InboxStatusName = (typeof INBOX_STATUSES)[number];
/** Envelope count per status. */
export type InboxCountsWire = Readonly<Record<InboxStatusName, number>>;

/** The note shown when the router has no durable inbox. */
export const IN_MEMORY_INBOX_NOTE = "In-memory inbox (resets on restart).";

/** Read `status.router.inbox` off the wire: all five counts must be whole numbers, else no inbox. */
export function parseInboxCounts(router: unknown): InboxCountsWire | null {
  if (typeof router !== "object" || router === null) return null;
  const inbox: unknown = (router as { inbox?: unknown }).inbox;
  if (typeof inbox !== "object" || inbox === null) return null;
  const rec = inbox as Record<string, unknown>;
  const counts = INBOX_STATUSES.map((s) => rec[s]);
  if (!counts.every((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  return { received: counts[0] as number, running: counts[1] as number, done: counts[2] as number, failed: counts[3] as number, dropped: counts[4] as number };
}

/** The panel's rows: a count per status, or none (the caller shows the in-memory note). */
export function inboxRows(inbox: InboxCountsWire | null): readonly { readonly status: InboxStatusName; readonly count: number }[] {
  return inbox === null ? [] : INBOX_STATUSES.map((status) => ({ status, count: inbox[status] }));
}
