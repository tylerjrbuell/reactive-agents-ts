/**
 * Lab · Channels: how long a routed turn may run (`turnTimeoutMs`) and whether the sender is told when a
 * turn fails (`failureNotice`). Pure (no fetch, no DOM). The server runs the framework's `validateRoutes`,
 * which is the authority; these rules give the answer before the request.
 *
 * The timeout is edited in seconds (people think in seconds) and saved in milliseconds. Blank means the
 * framework default (120 s) and is never written as an explicit value. `failureNotice` defaults on, so
 * only an opt-out (`false`) is written.
 */

/** The framework default turn limit (`RouteSpec.turnTimeoutMs`), in seconds. */
export const TURN_TIMEOUT_DEFAULT_SEC = 120;

/** The part of a route draft this module edits. */
export interface TurnLimitDraft {
  /** Seconds, typed; blank = the framework default. */
  turnTimeoutSec: string;
  /** Tell the sender when a turn fails. Framework default: on. */
  failureNotice: boolean;
}

/** The editor fields for a saved route (`undefined` = framework default). */
export function turnLimitDraftFromWire(r: { turnTimeoutMs?: number; failureNotice?: boolean }): TurnLimitDraft {
  return {
    turnTimeoutSec: r.turnTimeoutMs === undefined ? "" : String(r.turnTimeoutMs / 1000),
    failureNotice: r.failureNotice !== false,
  };
}

/** The wire fields for the editor values. A default is left out so the route stays on the framework's. */
export function turnLimitWireFromDraft(d: TurnLimitDraft): { turnTimeoutMs?: number; failureNotice?: false } {
  const sec = Number(d.turnTimeoutSec.trim());
  const hasTimeout = d.turnTimeoutSec.trim() !== "" && Number.isFinite(sec);
  return {
    ...(hasTimeout ? { turnTimeoutMs: Math.round(sec * 1000) } : {}),
    ...(d.failureNotice ? {} : { failureNotice: false as const }),
  };
}

/** Problems that would make the framework refuse the limit, in plain words. */
export function turnLimitProblems(d: TurnLimitDraft, message = "Turn limit must be 1 second or more."): string[] {
  const t = d.turnTimeoutSec.trim();
  if (t === "") return [];
  const n = Number(t);
  return Number.isFinite(n) && n >= 1 ? [] : [message];
}
