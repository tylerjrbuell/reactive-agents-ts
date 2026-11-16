/**
 * Lab · Channels: how a route treats messages that arrive close together (`batchWindowMs`) and while a
 * turn is already running (`midRun`). Pure (no fetch, no DOM). The server runs the framework's
 * `validateRoutes`, which is the authority; these rules give the answer before the request.
 *
 * `batchWindowMs`: milliseconds, 0 to 30 000, whole numbers; blank or 0 = off (every message is its own
 * turn), never written. `midRun`: `queue` is the framework default and is never written; `fold` and
 * `interrupt` are written. Webhook routes reject both keys (the reply is the HTTP response).
 */

/** The framework's `RouteSpec.batchWindowMs` upper bound. */
export const BATCH_WINDOW_MAX_MS = 30_000;

/** What a message that arrives during a running turn does. */
export type MidRunMode = "queue" | "fold" | "interrupt";

/** The part of a route draft this module edits. */
export interface BatchingDraft {
  /** Milliseconds, typed; blank or 0 = off. */
  batchWindowMs: string;
  /** Framework default: `queue`. */
  midRun: MidRunMode;
}

/** The choices for the mid-run select, with plain-words descriptions. */
export const MID_RUN_CHOICES: readonly { value: MidRunMode; label: string; description: string }[] = [
  { value: "queue", label: "Wait its turn", description: "The new message waits in line and runs after the current turn (default)." },
  { value: "fold", label: "Join the running turn", description: "The new message is added to the turn in progress at its next safe step; anything not picked up runs as one follow-up." },
  { value: "interrupt", label: "Stop and restart", description: "The running turn is cancelled and a new one starts from the combined messages." },
];

/** The editor fields for a saved route (`undefined` = framework default). */
export function batchingDraftFromWire(r: { batchWindowMs?: number; midRun?: MidRunMode }): BatchingDraft {
  return { batchWindowMs: r.batchWindowMs === undefined ? "" : String(r.batchWindowMs), midRun: r.midRun ?? "queue" };
}

/** The wire fields for the editor values. A default is left out so the route stays on the framework's. */
export function batchingWireFromDraft(d: BatchingDraft): { batchWindowMs?: number; midRun?: "fold" | "interrupt" } {
  const t = d.batchWindowMs.trim();
  const n = Number(t);
  return {
    ...(t !== "" && Number.isFinite(n) && n > 0 ? { batchWindowMs: n } : {}),
    ...(d.midRun === "queue" ? {} : { midRun: d.midRun }),
  };
}

/** Problems that would make the framework refuse the values, in plain words. */
export function batchingProblems(d: BatchingDraft): string[] {
  const t = d.batchWindowMs.trim();
  if (t === "") return [];
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= BATCH_WINDOW_MAX_MS ? [] : [`Batch window must be a whole number of milliseconds from 0 to ${BATCH_WINDOW_MAX_MS}.`];
}
