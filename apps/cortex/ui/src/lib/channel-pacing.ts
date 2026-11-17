/**
 * Lab · Channels: how fast a route may send into one conversation (`minGapMs`). Pure (no fetch, no DOM).
 * The framework's `validateRoutes` is the authority; these rules answer before the request.
 *
 * `minGapMs`: least gap in milliseconds, 0 to 60 000, whole numbers, between two messages the router sends
 * into one conversation (replies, acknowledgements and notices alike). Blank or 0 = off, never written.
 * Hidden on webhook routes (the reply is the HTTP response, there is nothing to pace).
 */

/** The framework's `RouteSpec.minGapMs` upper bound. */
export const MIN_GAP_MAX_MS = 60_000;

/** The part of a route draft this module edits. */
export interface PacingDraft {
  /** Milliseconds, typed; blank or 0 = off. */
  minGapMs: string;
}

/** The editor field for a saved route (`undefined` = off). */
export function pacingDraftFromWire(r: { minGapMs?: number }): PacingDraft {
  return { minGapMs: r.minGapMs === undefined ? "" : String(r.minGapMs) };
}

/** The wire field for the editor value. Blank, 0 or a non-number is left out so the route stays unpaced. */
export function pacingWireFromDraft(d: PacingDraft): { minGapMs?: number } {
  const t = d.minGapMs.trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n > 0 ? { minGapMs: n } : {};
}

/** Problems that would make the framework refuse the value, in plain words. */
export function pacingProblems(d: PacingDraft): string[] {
  const t = d.minGapMs.trim();
  if (t === "") return [];
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= MIN_GAP_MAX_MS ? [] : [`Minimum gap must be a whole number of milliseconds from 0 to ${MIN_GAP_MAX_MS}.`];
}
