// packages/trace/src/activity.ts
//
// Which harness mechanisms ACTED in a run, read from trace events only
// (feedback-loop design: "did the change under test actually run?").
//
// A pass-rate delta means nothing if the mechanism being measured never fired:
// on 2026-11-04 a todo-list checklist looked like a 0/5 → 3/5 lift on H3
// todo-heavy, yet the `todo` tool was never offered, so the checklist never
// ran. `mechanismActivity` turns each run into a set of stable activity keys;
// `compareActivity` says which keys changed between two cohorts. Both are pure
// and zero-token, and work on any recorded trace (bench or user run).
//
// Key families (stable across code versions: no line numbers, no ids):
//   guard:<guard>:<outcome>          a guard-fired event that did not pass
//   signal:<signalKind>@<origin>     a harness signal injected into the run
//                                    (origin with any `:<line>` suffix removed)
//   strategy-switch:<from>-><to>     a strategy switch
//   requirement:<kind>@<source>      a contract requirement, by provenance source;
//                                    requirements first declared on the run ledger
//                                    after compile use source `declared-mid-run`

import type { Trace } from "./replay.js";
import type { TraceEvent } from "./events.js";

/** The set of activity keys for one run. */
export type MechanismActivity = ReadonlySet<string>;

/**
 * Activity keys for one run (see the file header for the key families).
 *
 * @param trace A loaded trace (one run).
 * @returns The distinct mechanism keys that acted in the run.
 */
export function mechanismActivity(trace: Trace): MechanismActivity {
  const keys = new Set<string>();
  const compiled = new Set<string>();
  for (const e of trace.events) collect(e, keys, compiled);
  for (const e of trace.events) {
    if (e.kind !== "ledger-entry") continue;
    for (const entry of e.entries) {
      const id = entry["requirementId"];
      const kind = entry["requirementKind"];
      if (entry["kind"] !== "requirement" || entry["status"] !== "declared" || typeof id !== "string") continue;
      if (!compiled.has(id)) keys.add(`requirement:${typeof kind === "string" ? kind : "unknown"}@declared-mid-run`);
    }
  }
  return keys;
}

function collect(e: TraceEvent, keys: Set<string>, compiled: Set<string>): void {
  switch (e.kind) {
    case "guard-fired":
      if (e.outcome !== "pass") keys.add(`guard:${e.guard}:${e.outcome}`);
      return;
    case "harness-signal-injected":
      keys.add(`signal:${e.signalKind}@${e.origin.replace(/:\d+(?::\d+)?$/, "")}`);
      return;
    case "strategy-switched":
      keys.add(`strategy-switch:${e.from}->${e.to}`);
      return;
    case "contract-compiled":
      for (const r of e.requirements) {
        compiled.add(r.id);
        keys.add(`requirement:${r.kind}@${r.provenance?.source ?? "unknown"}`);
      }
      return;
    default:
      return;
  }
}

/** How often one activity key occurred in each cohort. */
export interface ActivityDelta {
  readonly key: string;
  /** Runs (of `beforeRuns`) in which the key occurred. */
  readonly before: number;
  /** Runs (of `afterRuns`) in which the key occurred. */
  readonly after: number;
}

/** Output of {@link compareActivity}. */
export interface ActivityComparison {
  readonly beforeRuns: number;
  readonly afterRuns: number;
  /** Keys whose run count changed, largest change first. */
  readonly changed: readonly ActivityDelta[];
}

const countRuns = (runs: readonly MechanismActivity[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const run of runs) for (const k of run) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
};

/**
 * Compare mechanism activity between two cohorts of runs.
 *
 * @param before Activity of each run in the baseline cohort.
 * @param after Activity of each run in the changed cohort.
 * @returns Every key whose run count differs, ordered by the size of the change.
 */
export function compareActivity(
  before: readonly MechanismActivity[],
  after: readonly MechanismActivity[],
): ActivityComparison {
  const b = countRuns(before);
  const a = countRuns(after);
  const changed: ActivityDelta[] = [];
  for (const key of new Set([...b.keys(), ...a.keys()])) {
    const d = { key, before: b.get(key) ?? 0, after: a.get(key) ?? 0 };
    if (d.before !== d.after) changed.push(d);
  }
  const rate = (n: number, of: number): number => (of === 0 ? 0 : n / of);
  changed.sort((x, y) =>
    Math.abs(rate(y.after, after.length) - rate(y.before, before.length)) -
      Math.abs(rate(x.after, after.length) - rate(x.before, before.length)) || x.key.localeCompare(y.key));
  return { beforeRuns: before.length, afterRuns: after.length, changed };
}

/**
 * Runs in which a mechanism fired: those with at least one key that contains
 * `mechanism` (e.g. `exit_gate`, `requirement:artifact-produced@task-text`).
 *
 * @param runs Activity of each run.
 * @param mechanism A key or key fragment.
 * @returns How many runs carry a matching key.
 */
export function runsWithMechanism(runs: readonly MechanismActivity[], mechanism: string): number {
  return runs.filter((run) => [...run].some((k) => k.includes(mechanism))).length;
}
