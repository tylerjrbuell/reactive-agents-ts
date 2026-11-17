/**
 * Interrupted desk runs: runs that ended without completing (stopped or paused by
 * the user, a loop guard, a spent budget, a timeout, an error) that the framework
 * left resumable in the durable store (`RunRecord.resumable`, `stop`). The file
 * keeps its name from when only loop stops were listed; it lists every kind now.
 * The Runs list offers Continue on them; Continue calls the framework's
 * `agent.resumeRun(durableRunId, { note?, extraIterations? })` on an agent
 * rebuilt from the run's stored launch config under the same agent id (runner
 * `resumeCrashed`, shared with crash resume), so the store, the config hash and
 * the task id all match the original.
 *
 * Sibling of `crashed-runs.ts` (runs a crash left `live`): same readers
 * (`listDurableRuns`), same rule that a missing store file is skipped without
 * opening it. Cortex never opens `runs.db` with SQL.
 */
import { existsSync } from "node:fs";
import { Effect } from "effect";
import { listDurableRuns } from "@reactive-agents/runtime";
import { durableRunsDbPath, isDurableBuild, parseLaunch, type CrashedRun, type DeskRunDb } from "./crashed-runs.js";
import { resumableRunsOf, type ResumableRunWire } from "./loop-stop-resume.js";

/** An interrupted desk run, with what Continue rebuilds its agent from. */
export interface LoopStoppedRun extends CrashedRun {
  /** The durable row status (`paused`, `stopped`, `failed`, ...). */
  readonly status: ResumableRunWire["status"];
  /** Why the run did not finish (`user-paused`, `user-stopped`, `loop`, `budget`, `timeout`, `error`, `crash`). */
  readonly kind: ResumableRunWire["kind"];
  /** What it had done and what was open, when the framework recorded a stop. */
  readonly stop?: ResumableRunWire["stop"];
}

/** Wire shape of a loop-stopped run (`GET /api/loop-stopped-runs`): no launch config. */
export type LoopStoppedRunSummary = Omit<LoopStoppedRun, "launch">;

/** Drop the launch config before a loop-stopped run goes over the wire. */
export const loopStoppedSummaryOf = ({ launch: _launch, ...rest }: LoopStoppedRun): LoopStoppedRunSummary => rest;

interface DeskRunRow {
  readonly run_id: string;
  readonly agent_id: string;
  readonly started_at: number;
  readonly display_name: string | null;
  readonly launch_params_json: string;
}

/** Most desk runs one scan looks at (newest first): each durable one opens its store. */
const SCAN_LIMIT = 100;

/** Options for {@link findLoopStoppedRuns}. */
export interface FindLoopStoppedRunsOptions {
  /** Runs this process is running now (runner active map): never offered. */
  readonly activeRunIds: ReadonlySet<string>;
  /** Only this run (the Continue route). */
  readonly runId?: string;
  /** Home dir for the framework's default durable dir (tests). */
  readonly home?: string;
}

/**
 * Durable desk runs not running now whose store holds a resumable record (any
 * kind of interruption). A run whose store file does not exist is skipped without opening it,
 * so looking never creates a store.
 */
export const findLoopStoppedRuns = (
  db: DeskRunDb,
  opts: FindLoopStoppedRunsOptions,
): Effect.Effect<readonly LoopStoppedRun[]> =>
  Effect.gen(function* () {
    const rows = db
      .prepare(
        `SELECT run_id, agent_id, started_at, display_name, launch_params_json FROM cortex_runs
         WHERE status != 'live' AND launch_params_json IS NOT NULL ${opts.runId ? "AND run_id = ?" : ""}
         ORDER BY started_at DESC LIMIT ${SCAN_LIMIT}`,
      )
      .all(...(opts.runId ? [opts.runId] : [])) as DeskRunRow[];
    const out: LoopStoppedRun[] = [];
    for (const row of rows) {
      if (opts.activeRunIds.has(row.run_id)) continue;
      const launch = parseLaunch(row.launch_params_json);
      if (!launch || !isDurableBuild(launch)) continue;
      const dbPath = durableRunsDbPath(row.agent_id, launch.durableRuns?.dir, opts.home);
      if (!existsSync(dbPath)) continue;
      const records = yield* listDurableRuns({ dbPath });
      const [stopped] = resumableRunsOf(records.filter((r) => r.agentId === row.agent_id));
      if (!stopped) continue;
      out.push({
        runId: row.run_id,
        agentId: row.agent_id,
        name: row.display_name,
        startedAt: row.started_at,
        durableRunId: stopped.runId,
        checkpointIteration: stopped.stop?.iteration ?? 0,
        updatedAt: stopped.updatedAt,
        launch,
        status: stopped.status,
        kind: stopped.kind,
        ...(stopped.stop !== undefined ? { stop: stopped.stop } : {}),
      });
    }
    return out;
  });

/** The run row's status and ending, so a failed Continue can put them back. */
export interface RunRowState {
  readonly status: string;
  readonly ending: string | null;
}

/**
 * Mark a finished run `live` again for its continued run: the resumed run's events
 * land on the same Cortex run id, and the row must read as running while it goes.
 * Returns what it was, or `undefined` when there is no such row.
 */
export function reopenRunRow(db: DeskRunDb, runId: string): RunRowState | undefined {
  const row = db.prepare("SELECT status, ending FROM cortex_runs WHERE run_id = ?").get(runId) as RunRowState | null;
  if (!row) return undefined;
  db.prepare("UPDATE cortex_runs SET status = 'live', ending = NULL WHERE run_id = ?").run(runId);
  return row;
}

/** Put a run row back as {@link reopenRunRow} found it (the Continue did not start). */
export function restoreRunRow(db: DeskRunDb, runId: string, state: RunRowState): void {
  db.prepare("UPDATE cortex_runs SET status = ?, ending = ? WHERE run_id = ?").run(state.status, state.ending, runId);
}
