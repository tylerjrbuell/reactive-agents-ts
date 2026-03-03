// ─── Lightweight Cron Expression Parser (zero external deps) ─────────────────
//
// Parses standard 5-field cron expressions:
//   minute  hour  day-of-month  month  day-of-week
//
// Supports: *, N, N-M, */N, N-M/S, comma-separated lists, day name aliases.

export interface CronExpression {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
}

// ─── Day Name Aliases ────────────────────────────────────────────────────────

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

// ─── Field Parser ────────────────────────────────────────────────────────────

/**
 * Parse a single cron field.
 * Handles: *, N, N-M, *\/N, N-M/S, comma-separated lists (each element
 * can be a number, range, or step expression).
 *
 * Returns null if the field is invalid.
 */
const parseField = (
  field: string,
  min: number,
  max: number,
): readonly number[] | null => {
  // Replace day-of-week names (only relevant when caller passes DOW field)
  let normalized = field.toUpperCase();
  for (const [name, num] of Object.entries(DAY_NAMES)) {
    normalized = normalized.replace(
      new RegExp(`\\b${name}\\b`, "g"),
      String(num),
    );
  }

  // Comma-separated list — split and recurse
  if (normalized.includes(",")) {
    const parts = normalized.split(",");
    const combined = new Set<number>();
    for (const part of parts) {
      const parsed = parseField(part.trim(), min, max);
      if (parsed === null) return null;
      for (const v of parsed) combined.add(v);
    }
    return [...combined].sort((a, b) => a - b);
  }

  // Step expression: */N or N-M/S
  if (normalized.includes("/")) {
    const [rangePart, stepStr] = normalized.split("/");
    const step = Number(stepStr);
    if (!Number.isFinite(step) || step <= 0) return null;

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [lo, hi] = rangePart.split("-").map(Number);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      start = lo;
      end = hi;
    } else {
      return null;
    }

    if (start < min || end > max || start > end) return null;

    const values: number[] = [];
    for (let i = start; i <= end; i += step) {
      values.push(i);
    }
    return values;
  }

  // Wildcard
  if (normalized === "*") {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }

  // Range: N-M
  if (normalized.includes("-")) {
    const [loStr, hiStr] = normalized.split("-");
    const lo = Number(loStr);
    const hi = Number(hiStr);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;

    const values: number[] = [];
    for (let i = lo; i <= hi; i++) values.push(i);
    return values;
  }

  // Single number
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return [num];
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a 5-field cron expression string.
 * Returns null if the expression is invalid.
 *
 * Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6)
 */
export const parseCron = (expression: string): CronExpression | null => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const minutes = parseField(fields[0], 0, 59);
  const hours = parseField(fields[1], 0, 23);
  const daysOfMonth = parseField(fields[2], 1, 31);
  const months = parseField(fields[3], 1, 12);
  const daysOfWeek = parseField(fields[4], 0, 6);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
};

/**
 * Convert a UTC date to a specific timezone (IANA timezone string).
 * Returns date components (minute, hour, day, month, day-of-week) in that timezone.
 */
export const getDateInTimezone = (
  date: Date,
  timezone: string,
): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  dayOfWeek: number;
} => {
  try {
    // Get all date parts in the target timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const part of parts) {
      partMap[part.type] = part.value;
    }

    // Map weekday name to 0-6 (0=Sunday, 6=Saturday)
    const weekdayMap: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
    };

    return {
      minute: parseInt(partMap.minute || "0", 10),
      hour: parseInt(partMap.hour || "0", 10),
      day: parseInt(partMap.day || "1", 10),
      month: parseInt(partMap.month || "1", 10),
      dayOfWeek: weekdayMap[partMap.weekday] ?? date.getUTCDay(),
    };
  } catch {
    // Fallback to UTC if timezone is invalid
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    };
  }
};

/**
 * Check if a cron expression should fire at a given date.
 * Optional timezone parameter converts to local time before checking.
 */
export const shouldFireAt = (
  cron: CronExpression,
  date: Date,
  timezone?: string,
): boolean => {
  const dateInfo = timezone
    ? getDateInTimezone(date, timezone)
    : {
        minute: date.getUTCMinutes(),
        hour: date.getUTCHours(),
        day: date.getUTCDate(),
        month: date.getUTCMonth() + 1,
        dayOfWeek: date.getUTCDay(),
      };

  return (
    cron.minutes.includes(dateInfo.minute) &&
    cron.hours.includes(dateInfo.hour) &&
    cron.daysOfMonth.includes(dateInfo.day) &&
    cron.months.includes(dateInfo.month) &&
    cron.daysOfWeek.includes(dateInfo.dayOfWeek)
  );
};
