import { getDateInTimezone, shouldFireAt } from "../services/cron-parser.js";
import type { CronExpression } from "../services/cron-parser.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** True when the hour/day/month/weekday fields can match this local time (minutes are checked later). */
const coarseMatch = (cron: CronExpression, ms: number, tz: string): boolean => {
  const d = getDateInTimezone(new Date(ms), tz);
  return (
    cron.hours.includes(d.hour) &&
    cron.daysOfMonth.includes(d.day) &&
    cron.months.includes(d.month) &&
    cron.daysOfWeek.includes(d.dayOfWeek)
  );
};

/**
 * Minute instants in the window `(fromMs, toMs]` at which `cron` fires in `tz`, oldest first.
 * `keep: "oldest"` stops after `limit` matches; `keep: "newest"` returns the last `limit`.
 *
 * Hour blocks whose first and last minute cannot match are skipped, so a monthly cron over a year
 * costs thousands of formatter calls, not half a million.
 */
export const cronMatches = (
  cron: CronExpression,
  tz: string,
  fromMs: number,
  toMs: number,
  opts: { readonly limit: number; readonly keep: "oldest" | "newest" },
): readonly number[] => {
  const out: number[] = [];
  if (toMs <= fromMs) return out;
  const firstMinute = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const lastMinute = Math.floor(toMs / MINUTE_MS) * MINUTE_MS;
  let blockStart = Math.floor(firstMinute / HOUR_MS) * HOUR_MS;
  while (blockStart <= lastMinute) {
    const blockEnd = blockStart + HOUR_MS - MINUTE_MS;
    if (coarseMatch(cron, blockStart, tz) || coarseMatch(cron, blockEnd, tz)) {
      const lo = Math.max(blockStart, firstMinute);
      const hi = Math.min(blockEnd, lastMinute);
      for (let t = lo; t <= hi; t += MINUTE_MS) {
        if (shouldFireAt(cron, new Date(t), tz)) {
          out.push(t);
          if (opts.keep === "oldest" && out.length >= opts.limit) return out;
          if (opts.keep === "newest" && out.length > opts.limit) out.shift();
        }
      }
    }
    blockStart += HOUR_MS;
  }
  return out;
};

/** First fire strictly after `afterMs` within `horizonMs` (default 366 days), or null. */
export const nextCronFire = (
  cron: CronExpression,
  tz: string,
  afterMs: number,
  horizonMs: number = 366 * 24 * HOUR_MS,
): number | null => cronMatches(cron, tz, afterMs, afterMs + horizonMs, { limit: 1, keep: "oldest" })[0] ?? null;
