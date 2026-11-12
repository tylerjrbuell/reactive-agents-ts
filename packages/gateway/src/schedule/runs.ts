import type { Schedule, ScheduleRun } from "./types.js";

/** Most recent runs kept per schedule (oldest dropped first). */
export const MAX_RUN_HISTORY = 20;
const DEFAULT_MAX_FIRES = 10;
/** Recorded on a run that was `running` when the process died and will not be re-offered. */
export const INTERRUPTED_ERROR = "interrupted by gateway restart";

/** Run history, oldest first. Rows persisted before `runs` existed fall back to `lastRun`. */
export const runHistory = (s: Schedule): readonly ScheduleRun[] => s.runs ?? (s.lastRun ? [s.lastRun] : []);

/** Record a new run as the latest: `lastRun` follows it and the history stays bounded. */
export const appendRun = (s: Schedule, run: ScheduleRun): Schedule => ({
  ...s,
  lastRun: run,
  runs: [...runHistory(s), run].slice(-MAX_RUN_HISTORY),
});

/**
 * Update the run with `fireId` wherever it sits in the history (a later fire-all fire does not
 * orphan an earlier one). Undefined when the fire is unknown (already trimmed, or never ran).
 */
export const updateRun = (
  s: Schedule,
  fireId: string,
  f: (run: ScheduleRun) => ScheduleRun,
): Schedule | undefined => {
  const history = runHistory(s);
  const idx = history.findIndex((r) => r.fireId === fireId);
  if (idx < 0) return undefined;
  const runs = history.map((r, i) => (i === idx ? f(r) : r));
  return { ...s, runs, lastRun: runs[runs.length - 1] };
};

/**
 * Crash recovery for one loaded schedule. Runs still `running` were handed out before the
 * process died and never settled. Following the schedule's catch-up policy, the newest of them
 * are re-offered (at-least-once); the rest are closed as failed so nothing stays `running`
 * forever. Manual runs and runs of paused schedules are never re-offered.
 * Undefined when nothing was interrupted.
 */
export const planRecovery = (
  s: Schedule,
): { readonly schedule: Schedule; readonly reoffer: readonly ScheduleRun[] } | undefined => {
  const history = runHistory(s);
  if (!history.some((r) => r.status === "running")) return undefined;
  const eligible = s.enabled ? history.filter((r) => r.status === "running" && r.trigger !== "manual") : [];
  const { mode, maxFires } = s.catchUp;
  const keep = mode === "skip" ? [] : mode === "fire-once" ? eligible.slice(-1) : eligible.slice(-(maxFires ?? DEFAULT_MAX_FIRES));
  const kept = new Set(keep.map((r) => r.fireId));
  const runs = history.map((r): ScheduleRun =>
    r.status === "running" && !kept.has(r.fireId) ? { ...r, status: "failed", error: INTERRUPTED_ERROR } : r,
  );
  return { schedule: { ...s, runs, lastRun: runs[runs.length - 1] }, reoffer: keep };
};
