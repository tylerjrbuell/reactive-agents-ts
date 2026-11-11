/**
 * Shared display formatters for agent UIs: cost, tokens and time. Pure; the
 * time formatters take the clock and locale as arguments so output is
 * reproducible in tests. Durations: {@link formatTurnDuration} in
 * `turn-duration.ts`.
 */

/**
 * US dollars for a run or turn: `$1.50`, `$0.042`, `$0.0042`. A positive amount
 * below a hundredth of a cent reads `<$0.0001`, never `$0.0000`; zero reads
 * `$0.00`; a missing or non-finite amount reads `—`.
 */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd <= 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

const compact = (n: number, unit: number, suffix: string): string =>
  `${(n / unit).toFixed(1).replace(/\.0$/, "")}${suffix}`;

/** Token counts: `999`, `1k`, `12.3k`, `2.5M`. Negative or non-finite input reads `0`. */
export function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  if (v < 1_000) return String(v);
  if (v < 1_000_000) return compact(v, 1_000, "k");
  return compact(v, 1_000_000, "M");
}

/** Locale and time zone for the time formatters; the viewer's when absent. */
export interface TimeFormatOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"} ago`;

/**
 * How long ago `ts` was, the way a chat shows it: `just now`, `3 minutes ago`,
 * `2 hours ago`, `yesterday`, `3 days ago`; a week or more ago (or in the
 * future) reads as a short date (`Oct 31`).
 */
export function formatRelativeTime(ts: number, now: number, opts: TimeFormatOptions = {}): string {
  const d = now - ts;
  if (d < -MIN || d >= 7 * DAY) {
    return new Date(ts).toLocaleDateString(opts.locale, {
      month: "short",
      day: "numeric",
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    });
  }
  if (d < 45_000) return "just now";
  if (d < HOUR) return unit(Math.max(1, Math.round(d / MIN)), "minute");
  if (d < DAY) return unit(Math.floor(d / HOUR), "hour");
  if (d < 2 * DAY) return "yesterday";
  return unit(Math.floor(d / DAY), "day");
}

/** The time of day of `ts`: `7:21 PM` (locale-dependent). */
export function formatClockTime(ts: number, opts: TimeFormatOptions = {}): string {
  return new Date(ts).toLocaleTimeString(opts.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  });
}
