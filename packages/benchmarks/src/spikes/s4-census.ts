// Spike S4: zero-token trigger census. For each saved cell whose trace resolves on disk,
// derive the set of mechanism keys that acted, then count rate per cell and per task.
import { existsSync, readFileSync } from "node:fs";
import { mechanismActivity, parseTrace } from "@reactive-agents/trace";
import type { SavedCell } from "./cells.js";

/** Keys for one cell: trace activity (guards, signals, switches, requirements) plus raw guard names and the ending. */
export function cellKeys(cell: SavedCell): ReadonlySet<string> | undefined {
  if (!cell.traceFile || !existsSync(cell.traceFile)) return undefined;
  const trace = parseTrace(readFileSync(cell.traceFile, "utf8"));
  if (trace.events.length === 0) return undefined;
  const keys = new Set<string>(mechanismActivity(trace));
  for (const e of trace.events) {
    // mechanismActivity drops guard-fired events whose outcome is "pass"; lean_final_turn is recorded that way.
    if (e.kind === "guard-fired") keys.add(`guard-any:${e.guard}`);
  }
  if (cell.terminatedBy) keys.add(`end:${cell.terminatedBy}`);
  return keys;
}

/** One row of the trigger census. */
export interface CensusRow {
  readonly key: string;
  readonly cellsFired: number;
  readonly cells: number;
  readonly rate: number;
  readonly tasksFired: number;
  readonly tasks: number;
  /** Task with the highest firing rate, and that rate. */
  readonly topTask: string;
  readonly topTaskRate: number;
}

/**
 * Rate of each key across cells.
 *
 * @param keyed Each cell with its key set (cells without a resolvable trace are excluded by the caller).
 * @returns Rows sorted by rate, descending.
 */
export function census(keyed: readonly { readonly cell: SavedCell; readonly keys: ReadonlySet<string> }[]): readonly CensusRow[] {
  const total = keyed.length;
  const perTask = new Map<string, number>();
  for (const { cell } of keyed) perTask.set(cell.taskId, (perTask.get(cell.taskId) ?? 0) + 1);
  const counts = new Map<string, { n: number; byTask: Map<string, number> }>();
  for (const { cell, keys } of keyed) {
    for (const k of keys) {
      const e = counts.get(k) ?? { n: 0, byTask: new Map<string, number>() };
      e.n++;
      e.byTask.set(cell.taskId, (e.byTask.get(cell.taskId) ?? 0) + 1);
      counts.set(k, e);
    }
  }
  const rows: CensusRow[] = [...counts].map(([key, e]) => {
    const top = [...e.byTask].map(([t, n]) => ({ t, r: n / (perTask.get(t) ?? 1) })).sort((a, b) => b.r - a.r || a.t.localeCompare(b.t))[0]!;
    return { key, cellsFired: e.n, cells: total, rate: total === 0 ? 0 : e.n / total, tasksFired: e.byTask.size, tasks: perTask.size, topTask: top.t, topTaskRate: top.r };
  });
  return rows.sort((a, b) => b.rate - a.rate || a.key.localeCompare(b.key));
}

/** Effect-given-trigger needed for a whole-suite lift of `wholePp` at trigger rate `rate`. */
export const requiredEffectGivenTrigger = (wholePp: number, rate: number): number => (rate <= 0 ? Number.POSITIVE_INFINITY : wholePp / rate);
